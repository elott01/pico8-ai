// Client-side glue to the /api/move proxy.

// Always resolves to an object — never null — where `reason` says why there is no move:
// null (the model chose), 'rate-limited' (with retryAfter seconds), 'timeout', 'error'.
// Keeping those distinct is what lets the UI say "rate limited" instead of silently
// showing a fallback move and looking broken. Everything but `move` is display-only.
//
// timeoutMs must stay *below* the cart's own fallback window (ai_max_frames in
// tic_tac_toe.p8, ~15s), so the page always gets to answer and read back the played
// cell; if the cart gives up first it self-plays and the read-back finds nothing.
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
    const timedOut = e.name === 'AbortError';
    return { move: null, reason: timedOut ? 'timeout' : 'error' };
  } finally {
    clearTimeout(t);
  }
}
