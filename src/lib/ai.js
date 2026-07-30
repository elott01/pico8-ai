// Client-side glue to the /api/move proxy. The API key never lives here — the
// serverless function holds it. This file only asks for a move and sanity-checks
// what comes back.

// Ask the proxy for a turn. Aborts after `timeoutMs` so a slow/over-quota call never
// hangs the game — on timeout the cart plays its own minimax instead.
//
// 10s, not 5s: a turn generates 8 line objects plus commentary before the response
// completes, which can outrun a 5s budget. Aborting early threw away a move the
// model had gotten right and replaced it with a random cell — worse than waiting.
// If this is raised again, update the abort threshold noted in api/move.js.
//
// Resolves to the model's full turn payload so the UI can show its work:
//   { move, winMove, blockMove, lines, commentary, reason }
// `move` is the only field the game needs; the rest is display-only and may be
// absent (e.g. the no-key fallback path returns a bare move).
//
// ALWAYS resolves to an object, never null, and `reason` says why there's no move:
//   null           — success, the model chose
//   'rate-limited' — 429; retryAfter (seconds) says how long to back off
//   'timeout'      — we aborted first
//   'error'        — network failure or a non-OK response
// These must stay distinguishable: a rate-limited player needs to be told that, not
// shown a random move that makes a working AI look broken.
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

    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      const header = Number(r.headers.get('Retry-After'));
      return {
        move: null,
        reason: 'rate-limited',
        retryAfter: Number(body.retryAfter) || header || 60,
      };
    }
    if (!r.ok) return { move: null, reason: 'error' };

    return { ...(await r.json()), reason: null };
  } catch (e) {
    // Distinguish an abort (we stopped waiting) from a real network failure, so the UI
    // can say "timed out" vs "unavailable".
    const timedOut = e.name === 'AbortError';
    return { move: null, reason: timedOut ? 'timeout' : 'error' };
  } finally {
    clearTimeout(t);
  }
}
