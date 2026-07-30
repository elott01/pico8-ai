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

export function readBoard(gpio) {
  const board = [];
  for (let i = 0; i < 9; i++) board.push(gpio[IDX_BOARD + i] | 0);
  return board;
}
