// Serverless proxy for the Gemini call: holds the API key, builds the prompt, returns
// the model's move and its reasoning. Vercel pre-parses JSON, so req.body is an object.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, reserveGeminiCall, QuotaError, firstHeader, errorMessage } from './_ratelimit.ts';
import { GEMINI_URL } from './_gemini.ts';
import { GAMES, DEFAULT_GAME, isGameId } from './_games.ts';
import type { GameSpec } from './_games.ts';
import type { Board, ModelReply, MoveSuccess, MoveRateLimited } from './_types.ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Every turn logs one greppable line. Without it a 9.8s request and a 1.4s request look
  // identical from the outside, which is exactly the state this endpoint was in when a
  // player reported timeouts the server had no record of. The client's 10s abort happens
  // where we cannot see it, so `total` is the only evidence of a turn the page gave up on.
  const started = Date.now();
  const stats: CallStats = { calls: 0, geminiMs: 0 };
  const done = (outcome: string, extra = '') => {
    const total = Date.now() - started;
    // A turn can succeed here and still be worthless: getAiTurn aborts at 10s, so anything
    // past that was answered to a client that already gave up and told the player the model
    // timed out. The server cannot observe the abort, so it is flagged by duration instead —
    // otherwise the only record of a timeout is a line that says "ok".
    const late = total >= CLIENT_ABORT_MS ? ' TOO-LATE' : total >= CLIENT_ABORT_MS * 0.8 ? ' SLOW' : '';
    console.log(
      `[move] ${outcome} calls=${stats.calls} gemini=${stats.geminiMs}ms total=${total}ms${extra}${late}`,
    );
  };

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  // 429 rather than a silent { move: null }: the UI has to tell a rate limit apart from
  // a model failure, or a working AI looks broken.
  const limit = await checkRateLimit(req);
  if (limit.limited) {
    const body: MoveRateLimited = { move: null, rateLimited: true, retryAfter: limit.retryAfter };
    res.setHeader('Retry-After', String(body.retryAfter));
    done('rate-limited', ` retryAfter=${limit.retryAfter}s`);
    return res.status(429).json(body);
  }

  const { board, game } = req.body ?? {};

  // An unknown game is rejected rather than defaulted: silently answering a Connect Four
  // request with a tic-tac-toe prompt would look like a bad model, not a bad request.
  if (game !== undefined && !isGameId(game)) {
    return res.status(400).json({ error: `unknown game "${game}"` });
  }
  const spec = GAMES[isGameId(game) ? game : DEFAULT_GAME];

  if (!isValidBoard(board, spec)) {
    return res
      .status(400)
      .json({ error: `board must be a ${spec.cells}-element array of 0/1/2 for ${spec.id}` });
  }

  // No key (fresh checkout): still answer, so the cart/page loop can be exercised.
  if (!process.env.GEMINI_API_KEY) {
    const body: MoveSuccess = { move: spec.legalMoves(board)[0] ?? null };
    return res.status(200).json(body);
  }

  try {
    let parsed = await askGemini(spec, board, stats);
    let move = spec.parseMove(parsed.move);

    // Retry once, echoing the mistake back, when the model names an unplayable move — but
    // only when it actually named one. After a 503 storm there is nothing to correct,
    // and retrying would double the load on an API that is already failing.
    if (move !== null && !spec.isLegalMove(board, move)) {
      console.log(`[move] illegal ${spec.moveUnit} ${move}; retrying with correction`);
      const correction =
        `${spec.moveUnit === 'column' ? 'Column' : 'Cell'} ${move} is NOT playable. ` +
        `You may only play one of these ${spec.moveUnit}s: ` +
        `${JSON.stringify(spec.legalMoves(board))}. Choose one of them.`;
      parsed = await askGemini(spec, board, stats, correction);
      move = spec.parseMove(parsed.move);
    }

    // Annotated with the shared contract, so the client's view of this response and the
    // server's construction of it cannot drift apart silently. The analysis fields are the
    // game's own — neither cart sends the other's.
    const body: MoveSuccess = { move, ...spec.analysis(parsed) };
    // `move=null` here is the model answering with nothing usable — distinct from the
    // catch branch below, and the panel currently cannot tell them apart.
    done(move === null ? `${spec.id} no-move` : `${spec.id} ok`, ` move=${move}`);
    return res.status(200).json(body);
  } catch (e) {
    if (e instanceof QuotaError) {
      const body: MoveRateLimited = { move: null, rateLimited: true, retryAfter: e.retryAfter };
      res.setHeader('Retry-After', String(e.retryAfter));
      done(`${spec.id} quota`, ` retryAfter=${e.retryAfter}s`);
      return res.status(429).json(body);
    }
    // 200 with no move, not a 5xx: the cart plays its own minimax and the game continues.
    done(`${spec.id} FAILED`, ` err=${JSON.stringify(errorMessage(e))}`);
    const body: MoveSuccess = { move: null };
    return res.status(200).json(body);
  }
}

/** Only the sliver of Gemini's response this code reads. */
type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/** Mutable per-request tally, so the handler can report what a slow turn actually spent. */
type CallStats = { calls: number; geminiMs: number };

// getAiTurn's abort in src/lib/ai.ts. Duplicated rather than imported because api/ must not
// depend on src/ — but the two have to agree, or the TOO-LATE marker lies about which turns
// the player actually saw. See the timeout budget chain in CLAUDE.md: this must stay below
// the cart's ai_max_frames (450 frames ≈ 15s).
const CLIENT_ABORT_MS = 12_000;

async function askGemini(
  spec: GameSpec,
  board: Board,
  stats: CallStats,
  correction?: string,
): Promise<ModelReply> {
  // The handler guards this, but askGemini is separately callable and the fetch header
  // needs a string rather than string | undefined.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  let data: GeminiResponse | undefined;
  let callStart = Date.now();
  // Attempts and backoff have to fit inside the client's request timeout (getAiTurn in
  // src/lib/ai.ts) alongside generation and a possible legality retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    await reserveGeminiCall(); // inside the loop: the quota cap counts calls, not requests
    callStart = Date.now();
    stats.calls++;
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: spec.buildPrompt(board, correction) }] }],
        // Per-board, not per-game: Connect Four's schema enumerates the legal columns, so
        // an illegal one is unrepresentable rather than merely discouraged.
        generationConfig: spec.config(board),
      }),
    });
    data = (await r.json()) as GeminiResponse;

    // 429 and 503 are NOT the same failure and must not share a retry path.
    //
    // 503 is transient overload: waiting helps. 429 means we are over Google's own rate
    // limit, where retrying is both pointless and harmful — three attempts plus backoff
    // turns an instant, honest "rate limited" into a ~2s+ request that eats the client's
    // 10s budget and surfaces as a *timeout* instead. Failing fast here keeps the cause
    // visible, and lets the page pause properly via its Retry-After handling.
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after')) || 60;
      console.log(`[move] gemini 429 (upstream quota) after ${Date.now() - callStart}ms; not retrying`);
      throw new QuotaError(retryAfter);
    }
    if (r.status !== 503) {
      stats.geminiMs += Date.now() - callStart;
      break;
    }
    stats.geminiMs += Date.now() - callStart;
    console.log(`[move] gemini 503 (attempt ${attempt + 1}) after ${Date.now() - callStart}ms, retrying…`);
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text) as ModelReply;
  } catch {
    console.log('[move] unparseable response body:', JSON.stringify(data));
    throw new Error('could not parse model response');
  }
}

// Matching Origin's host against the request's own Host works unchanged on localhost,
// preview deploys and custom domains — no allowlist to keep in sync. A missing Origin
// means a non-browser client, since browsers always send it on POST.
//
// A speed bump, not security: Origin is trivially forged outside a browser. The rate
// limits in _ratelimit.ts are the real control.
function isSameOrigin(req: VercelRequest): boolean {
  const origin = firstHeader(req.headers?.origin);
  if (!origin) return false;

  // x-forwarded-host is what the user actually hit when Vercel's proxy is in front.
  const hosts = [firstHeader(req.headers['x-forwarded-host']), firstHeader(req.headers.host)].filter(
    (h): h is string => Boolean(h),
  );
  try {
    return hosts.includes(new URL(origin).host);
  } catch {
    return false; // malformed Origin
  }
}

// Length is checked against the declared game, so a Connect Four board sent without
// `game` is a 400 rather than 42 cells silently read as tic-tac-toe.
function isValidBoard(board: unknown, spec: GameSpec): board is Board {
  return (
    Array.isArray(board) &&
    board.length === spec.cells &&
    board.every((c) => c === 0 || c === 1 || c === 2)
  );
}
