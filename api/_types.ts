// The /api/move wire contract, owned by the endpoint that produces it and imported by
// the client that consumes it. Underscore-prefixed so Vercel treats it as a helper rather
// than a route.
//
// Before this existed, `api/move.js` and `src/lib/ai.ts` each described this shape by
// hand and drifted — the client declared `emptyCell` while the server sent `emptyCells`,
// which typechecked, tested and built clean and was only caught by reading a live
// response. One definition makes that class of drift a compile error.

/** One board square as it travels over the wire: 0 empty, 1 human, 2 AI. */
export type Cell = 0 | 1 | 2;

/** The 9 cells, row-major. Kept separate from gpio.ts's Board on purpose: that one
 *  describes bytes read out of the cart, this one describes JSON on the wire. */
export type Board = Cell[];

/** One of the 8 winning lines, as scored by the model in its own analysis. */
export type Line = {
  line: number[];
  values: number[];
  ones: number;
  twos: number;
  emptyCells?: number[];
};

/** What the model is asked to return. Every field is its own output so it never has to
 *  do the arithmetic in its head — see buildPrompt in move.ts. */
export type ModelReply = {
  move?: number | null;
  winMove?: number | null;
  blockMove?: number | null;
  lines?: Line[];
  legalCells?: number[];
  commentary?: string | null;
};

// A 200 does NOT guarantee a move: the endpoint answers 200 with `move: null` when the
// model returned nothing usable, and 200 with a bare `move` on the no-key branch.
export type MoveSuccess = {
  move: number | null;
  winMove?: number | null;
  blockMove?: number | null;
  lines?: Line[];
  commentary?: string | null;
};

/** 429. `retryAfter` is seconds, and is mirrored in the Retry-After header. */
export type MoveRateLimited = {
  move: null;
  rateLimited: true;
  retryAfter: number;
};

/** 400/403/405. */
export type MoveError = { error: string };

export type MoveResponse = MoveSuccess | MoveRateLimited | MoveError;
