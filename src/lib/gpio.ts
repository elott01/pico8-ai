// GPIO bridge between the page and the PICO-8 carts, and the source of truth for the
// byte protocol — each cart's Lua half must match the descriptor here.
//
// The web export mirrors the cart's 128 GPIO bytes into a plain JS array declared on
// the *iframe's* window, so it is reached via contentWindow.pico8_gpio, not the top
// window. The cart pokes and peeks; the page does the networking the cart cannot.
//
// Two carts now share the handshake but not the layout, so the per-cart parts live in
// PROTOCOLS rather than as module constants. Nothing outside this file should hardcode a
// byte offset or a board size: that is how the page and a cart drift apart silently, and
// tests/gpio-protocol.test.ts checks both carts' Lua against these values.

export const ST_IDLE = 0;
export const ST_REQUEST = 1;
export const ST_THINKING = 2;
export const ST_READY = 3;

/** Byte 0 in every cart. The one offset that is not per-cart. */
export const IDX_STATUS = 0;

// Any value the cart does not accept as a move trips its own fallback opponent. 255 is
// unmistakably not a cell or a column, and is outside both carts' accepted ranges.
export const NO_MOVE = 255;

export type Status = typeof ST_IDLE | typeof ST_REQUEST | typeof ST_THINKING | typeof ST_READY;

/** One board square: 0 empty, 1 human, 2 AI. */
export type Cell = 0 | 1 | 2;

/** The board cells in GPIO order — row-major from the top-left, in both carts. */
export type Board = Cell[];

/** The cart's 128 GPIO bytes, mirrored by the web export as a plain JS array. */
export type Gpio = number[];

export type CartId = 'tic_tac_toe' | 'connect_four';

/**
 * What a move value names.
 *
 * Tic-tac-toe moves name the cell to fill. Connect Four moves name a *column* and gravity
 * picks the row, so the page never chooses a cell — which is why legality and the panel's
 * highlight both have to go through `landingCell` rather than indexing the board directly.
 */
export type MoveUnit = 'cell' | 'column';

export type Protocol = {
  readonly id: CartId;
  /** First board byte. */
  readonly idxBoard: number;
  /** How many board bytes follow it. */
  readonly cells: number;
  readonly cols: number;
  readonly rows: number;
  /** The dual-meaning move byte: page writes a request, cart overwrites it with the truth. */
  readonly idxMove: number;
  /** Highest move value the cart accepts. The lowest is always 0. */
  readonly maxMove: number;
  readonly moveUnit: MoveUnit;
};

export const PROTOCOLS: Record<CartId, Protocol> = {
  tic_tac_toe: {
    id: 'tic_tac_toe',
    idxBoard: 1,
    cells: 9,
    cols: 3,
    rows: 3,
    idxMove: 10,
    maxMove: 8,
    moveUnit: 'cell',
  },
  connect_four: {
    id: 'connect_four',
    idxBoard: 1,
    cells: 42,
    cols: 7,
    rows: 6,
    idxMove: 43,
    maxMove: 6,
    moveUnit: 'column',
  },
};

export function isCartId(id: string): id is CartId {
  return id in PROTOCOLS;
}

declare global {
  interface Window {
    // Declared by the PICO-8 web export inside the iframe, so it is absent until the
    // cart has loaded.
    pico8_gpio?: Gpio;
  }
}

export function readBoard(gpio: Gpio, p: Protocol): Board {
  const board: Board = [];
  // The cart only ever writes 0..2 to these bytes, so narrowing to Cell is an assertion
  // about the cart's half of the protocol (checked by tests/gpio-protocol.test.ts), not
  // a runtime guard.
  for (let i = 0; i < p.cells; i++) board.push((gpio[p.idxBoard + i] | 0) as Cell);
  return board;
}

/**
 * The board index a move would fill, or null if the move is not playable.
 *
 * One function rather than a legality check plus a separate index calculation, because
 * the two would encode the same rule twice and could disagree — the panel would then ring
 * a cell the cart never filled.
 */
export function landingCell(board: Board, move: number, p: Protocol): number | null {
  if (!Number.isInteger(move) || move < 0 || move > p.maxMove) return null;

  if (p.moveUnit === 'cell') return board[move] === 0 ? move : null;

  // A column: the disc falls to the lowest empty row. The wire is row-major from the
  // TOP, so the bottom row is the last one and the search runs upward from there.
  for (let row = p.rows - 1; row >= 0; row--) {
    const i = row * p.cols + move;
    if (board[i] === 0) return i;
  }
  return null; // column full
}

export function isLegalMove(board: Board, move: number, p: Protocol): boolean {
  return landingCell(board, move, p) !== null;
}
