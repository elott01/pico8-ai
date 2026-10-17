// Serverless proxy for the Gemini call: holds the API key, builds the prompt, returns
// the model's move and its reasoning. Vercel pre-parses JSON, so req.body is an object.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, QuotaError, errorMessage } from './_ratelimit.ts';
import { askGemini as ask, isSameOrigin, CLIENT_ABORT_MS } from './_ask_gemini.ts';
import type { CallStats } from './_ask_gemini.ts';
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
    let parsed = await askGemini(spec, board, stats, started);
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
      parsed = await askGemini(spec, board, stats, started, correction);
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

/** The shared call (_ask_gemini.ts), with this game's prompt and per-board config. */
async function askGemini(
  spec: GameSpec,
  board: Board,
  stats: CallStats,
  started: number,
  correction?: string,
): Promise<ModelReply> {
  const reply = await ask({
    prompt: spec.buildPrompt(board, correction),
    // Per-board, not per-game: Connect Four's schema enumerates the legal columns, so
    // an illegal one is unrepresentable rather than merely discouraged.
    config: spec.config(board),
    stats,
    started,
    tag: 'move',
  });
  return reply as ModelReply;
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
