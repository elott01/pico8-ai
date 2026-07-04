// Client-side glue to the /api/move proxy. The API key never lives here — the
// serverless function holds it. This file only asks for a move and sanity-checks
// what comes back.

// Ask the proxy for a move. Aborts after `timeoutMs` so a slow/over-quota call
// never hangs the game — on timeout we return null and let validateMove fall back.
export async function getAiMove(board, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board }),
      signal: ctrl.signal,
    });
    const { move } = await r.json();
    return move;
  } catch {
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
