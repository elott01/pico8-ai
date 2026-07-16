// Client-side glue to the /api/move proxy. The API key never lives here — the
// serverless function holds it. This file only asks for a move and sanity-checks
// what comes back.

// Ask the proxy for a turn. Aborts after `timeoutMs` so a slow/over-quota call never
// hangs the game — on timeout we return null and let validateMove fall back.
//
// 10s, not 5s: a turn generates 8 line objects plus commentary before the response
// completes, which can outrun a 5s budget. Aborting early threw away a move the
// model had gotten right and replaced it with a random cell — worse than waiting.
// If this is raised again, update the abort threshold noted in api/move.js.
//
// Resolves to the model's full turn payload so the UI can show its work:
//   { move, winMove, blockMove, lines, commentary }
// `move` is the only field the game needs; the rest is display-only and may be
// absent (e.g. the no-key fallback path returns a bare move).
export async function getAiTurn(board, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board }),
      signal: ctrl.signal,
    });
    return await r.json();
  } catch (e) {
    // TEMP DIAGNOSTIC — distinguishes "we gave up waiting" from a real network
    // failure. A timeout here alongside a 200 in the server log means the model
    // answered fine and we just weren't patient enough.
    if (e.name === 'AbortError') console.warn(`[ai] timed out after ${timeoutMs}ms — falling back`);
    else console.warn('[ai] request failed — falling back:', e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Always validate — LLMs occasionally return illegal or garbage moves.
// Falls back to a random legal cell so the game stays playable.
export function validateMove(move, board) {
  if (Number.isInteger(move) && board[move] === 0) return move;
  const legal = board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  if (legal.length === 0) return null;
  return legal[Math.floor(Math.random() * legal.length)];
}
