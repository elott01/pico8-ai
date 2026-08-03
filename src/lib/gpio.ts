// GPIO bridge between the page and the PICO-8 cart, and the source of truth for the
// byte protocol — the cart's Lua half must match it.
//
// The web export mirrors the cart's 128 GPIO bytes into a plain JS array declared on
// the *iframe's* window, so it is reached via contentWindow.pico8_gpio, not the top
// window. The cart pokes and peeks; the page does the networking the cart cannot.

export const ST_IDLE = 0;
export const ST_REQUEST = 1;
export const ST_THINKING = 2;
export const ST_READY = 3;

// Byte layout for tic-tac-toe:
//   0      status (above)
//   1..9   board cells: 0 empty, 1 human, 2 AI
//   10     move cell, 0-based, with two meanings across one handshake:
//            - the page writes the move to play, or NO_MOVE if it has none
//            - the cart overwrites it with the cell it ACTUALLY played before
//              returning to idle, so the page can read back what happened
export const IDX_STATUS = 0;
export const IDX_BOARD = 1;
export const IDX_MOVE = 10;

// Any value outside 0..8 trips the cart's fallback to its own minimax; 255 is
// unmistakably not a cell index.
export const NO_MOVE = 255;

export type Status = typeof ST_IDLE | typeof ST_REQUEST | typeof ST_THINKING | typeof ST_READY;

/** One board square: 0 empty, 1 human (X), 2 AI (O). */
export type Cell = 0 | 1 | 2;

/** The 9 board cells, in GPIO order. */
export type Board = Cell[];

/** The cart's 128 GPIO bytes, mirrored by the web export as a plain JS array. */
export type Gpio = number[];

declare global {
  interface Window {
    // Declared by the PICO-8 web export inside the iframe, so it is absent until the
    // cart has loaded.
    pico8_gpio?: Gpio;
  }
}

export function readBoard(gpio: Gpio): Board {
  const board: Board = [];
  // The cart only ever writes 0..2 to these bytes, so narrowing to Cell is an assertion
  // about the cart's half of the protocol (checked by tests/gpio-protocol.test.ts), not
  // a runtime guard.
  for (let i = 0; i < 9; i++) board.push((gpio[IDX_BOARD + i] | 0) as Cell);
  return board;
}
