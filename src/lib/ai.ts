// Client-side glue to the /api/move proxy.

import type { Board, CartId } from './gpio.ts';
// The response shape is defined once, by the endpoint that produces it. Importing it
// rather than restating it is what stops the two halves drifting — they previously
// disagreed about `emptyCell` vs `emptyCells` and nothing caught it.
import type { Line, MoveSuccess } from '../../api/_types.ts';

export type { Line };

/** Why there is no model move. `null` means the model answered normally. */
export type AiFailure = 'rate-limited' | 'timeout' | 'error';

// The server's 200 body plus the discriminant this module adds. A 200 does NOT guarantee
// a move: /api/move answers 200 with `move: null` when the model returned nothing usable,
// and 200 with a bare `move` (no analysis) on the no-key branch. Callers must still check
// `move` — hence MoveSuccess declaring `number | null` and optional analysis.
export type AiSuccess = MoveSuccess & { reason: null };

// Discriminated on `reason`, so the analysis fields are unreachable on a turn the model
// did not decide — the panel cannot accidentally pair commentary with a fallback move.
export type AiTurn =
  | AiSuccess
  // retryAfter is optional because the page also synthesises this variant locally while
  // it is sitting out a known rate-limit window, where there is no fresh hint to carry.
  | { reason: 'rate-limited'; move: null; retryAfter?: number }
  | { reason: 'timeout' | 'error'; move: null };

// Always resolves to an object — never null — where `reason` says why there is no move:
// null (the model chose), 'rate-limited' (with retryAfter seconds), 'timeout', 'error'.
// Keeping those distinct is what lets the UI say "rate limited" instead of silently
// showing a fallback move and looking broken. Everything but `move` is display-only.
//
// timeoutMs must stay *below* the cart's own fallback window (ai_max_frames in
// tic_tac_toe.p8, ~15s), so the page always gets to answer and read back the played
// cell; if the cart gives up first it self-plays and the read-back finds nothing.
export async function getAiTurn(
  board: Board,
  game: CartId = 'tic_tac_toe',
  timeoutMs = 10000,
): Promise<AiTurn> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `game` is sent explicitly rather than inferred from board length: the endpoint
      // checks the two against each other, so a mismatch is a loud 400 instead of a board
      // read as the wrong game.
      body: JSON.stringify({ board, game }),
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

    // Unvalidated at runtime, but the cast is now to the endpoint's own published type
    // rather than a local guess. The caller re-checks `move` against the live board
    // before playing it either way.
    return { ...((await r.json()) as MoveSuccess), reason: null };
  } catch (e) {
    // Duck-typed rather than `instanceof Error`, because an abort surfaces as a
    // DOMException and the exact prototype chain varies by runtime.
    const timedOut = (e as { name?: unknown } | null)?.name === 'AbortError';
    return { move: null, reason: timedOut ? 'timeout' : 'error' };
  } finally {
    clearTimeout(t);
  }
}
