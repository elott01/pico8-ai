// Serverless proxy for the Gemini call: holds the API key, builds the prompt, returns
// the model's move and its reasoning. Vercel pre-parses JSON, so req.body is an object.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, reserveGeminiCall, QuotaError, firstHeader, errorMessage } from './_ratelimit.ts';
import type { Board, ModelReply, MoveSuccess, MoveRateLimited } from './_types.ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  // 429 rather than a silent { move: null }: the UI has to tell a rate limit apart from
  // a model failure, or a working AI looks broken.
  const limit = await checkRateLimit(req);
  if (limit.limited) {
    const body: MoveRateLimited = { move: null, rateLimited: true, retryAfter: limit.retryAfter! };
    res.setHeader('Retry-After', String(body.retryAfter));
    return res.status(429).json(body);
  }

  const { board } = req.body ?? {};
  if (!isValidBoard(board)) {
    return res.status(400).json({ error: 'board must be a 9-element array of 0/1/2' });
  }

  // No key (fresh checkout): still answer, so the cart/page loop can be exercised.
  if (!process.env.GEMINI_API_KEY) {
    const body: MoveSuccess = { move: firstLegal(board) };
    return res.status(200).json(body);
  }

  try {
    let parsed = await askGemini(board);

    // Retry once, echoing the mistake back, when the model names an occupied cell — but
    // only when it actually named one. After a 503 storm there is no move to correct,
    // and retrying would double the load on an API that is already failing.
    if (Number.isInteger(parsed.move) && !isLegalMove(parsed.move, board)) {
      console.log(`[move] illegal move ${parsed.move}; retrying with correction`);
      const correction =
        `Cell ${parsed.move} is NOT empty. You may only play one of these cells: ` +
        `${JSON.stringify(legalCells(board))}. Choose one of them.`;
      parsed = await askGemini(board, correction);
    }

    // Annotated with the shared contract, so the client's view of this response and the
    // server's construction of it cannot drift apart silently.
    const body: MoveSuccess = {
      move: parsed.move ?? null,
      winMove: parsed.winMove ?? null,
      blockMove: parsed.blockMove ?? null,
      lines: parsed.lines ?? [],
      commentary: parsed.commentary ?? null,
    };
    return res.status(200).json(body);
  } catch (e) {
    if (e instanceof QuotaError) {
      const body: MoveRateLimited = { move: null, rateLimited: true, retryAfter: e.retryAfter };
      res.setHeader('Retry-After', String(e.retryAfter));
      return res.status(429).json(body);
    }
    // 200 with no move, not a 5xx: the cart plays its own minimax and the game continues.
    console.log('[move] gemini call FAILED, falling back to null:', errorMessage(e));
    const body: MoveSuccess = { move: null };
    return res.status(200).json(body);
  }
}

const MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Only the sliver of Gemini's response this code reads. */
type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

async function askGemini(board: Board, correction?: string): Promise<ModelReply> {
  // The handler guards this, but askGemini is separately callable and the fetch header
  // needs a string rather than string | undefined.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  let data: GeminiResponse | undefined;
  // Attempts and backoff have to fit inside the client's request timeout (getAiTurn in
  // src/lib/ai.ts) alongside generation and a possible legality retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    await reserveGeminiCall(); // inside the loop: the quota cap counts calls, not requests
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(board, correction) }] }],
        // JSON out, not prose; low temperature because a move should be near-deterministic.
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    data = (await r.json()) as GeminiResponse;
    if (r.status !== 503 && r.status !== 429) break; // only transient overload is worth retrying
    console.log(`[move] gemini ${r.status} (attempt ${attempt + 1}), retrying…`);
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

function isValidBoard(board: unknown): board is Board {
  return (
    Array.isArray(board) && board.length === 9 && board.every((c) => c === 0 || c === 1 || c === 2)
  );
}

function firstLegal(board: Board): number | null {
  const i = board.indexOf(0);
  return i >= 0 ? i : null;
}

function legalCells(board: Board): number[] {
  return board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
}

function isLegalMove(move: unknown, board: Board): boolean {
  return typeof move === 'number' && Number.isInteger(move) && move >= 0 && move < 9 && board[move] === 0;
}

// Every derivation the model needs is an explicit output field, because it miscounts
// when asked to do the arithmetic in its head — it once emitted "[1,4,7]: 0,2,2" and
// still concluded no line had two 2s, missing the win.
//
// Key order is load-bearing: JSON generates in order, so each field is conditioned on
// the ones above it. `commentary` MUST stay last — above `move` it would let flavor
// text steer the game.
function buildPrompt(board: Board, correction?: string): string {
  return [
    'You are playing tic-tac-toe as player 2 (you are "2").',
    'Board is a 9-element array, indices 0..8, row-major (0,1,2 = top row; 3,4,5 = middle; 6,7,8 = bottom).',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'The 8 winning lines: [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6].',
    '',
    'STEP 1 — "lines": for EACH of the 8 lines above, in order, emit an object:',
    '{"line": [a,b,c], "values": [va,vb,vc], "twos": <how many values equal 2>,',
    '"ones": <how many values equal 1>, "emptyCells": [<indices whose value is 0>]}.',
    'Count carefully. "twos" is literally how many of the three values are the number 2.',
    '',
    'STEP 2 — "winMove": scan your OWN "lines" output. If any line has twos == 2 and',
    'ones == 0 and exactly one emptyCell, set winMove to that empty cell index. Else null.',
    '',
    'STEP 3 — "blockMove": scan your OWN "lines" output. If any line has ones == 2 and',
    'twos == 0 and exactly one emptyCell, set blockMove to that empty cell index. Else null.',
    '',
    'STEP 4 — "legalCells": the list of every board index whose value is 0. These are the',
    'ONLY cells you may play. If winMove/blockMove are set they will appear in this list.',
    '',
    'STEP 5 — "move": apply this priority EXACTLY, and "move" MUST be one of legalCells:',
    '1. If winMove is not null, move = winMove. (Winning ends the game — ALWAYS take it,',
    '   even if blockMove is also set. Never block when you can win.)',
    '2. Else if blockMove is not null, move = blockMove.',
    '3. Else 4 (center) if 4 is in legalCells.',
    '4. Else a corner (0, 2, 6, or 8) that is in legalCells.',
    '5. Else any cell in legalCells.',
    '',
    'STEP 6 — "commentary": ONE short, playful sentence (max 12 words) addressed to your',
    'opponent about the move you just picked. Flavor only — it must NOT change "move".',
    correction ? `\nIMPORTANT: ${correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"lines": [...8 objects...], "winMove": <index|null>, "blockMove": <index|null>,',
    '"legalCells": [...], "move": <index>, "commentary": "<one sentence>"}.',
  ].join(' ');
}
