// GPIO bridge between the page and the PICO-8 cart.
//
// The web export mirrors the cart's 128 GPIO bytes (0x5f80–0x5fff) into a plain
// JS array. The exported .html declares that array (`var pico8_gpio = new
// Array(128)`) on the iframe's own window, so we reach it via
// iframeRef.current.contentWindow.pico8_gpio — NOT the top window. The cart
// pokes/peeks; the page reads/writes the same array and does the networking the
// cart can't do itself.

export const GPIO_LEN = 128;

// Status byte (index 0) state machine — must match the cart's Lua protocol.
export const ST_IDLE = 0;
export const ST_REQUEST = 1;
export const ST_THINKING = 2;
export const ST_READY = 3;

// Byte layout for tic-tac-toe:
//   0      status (above)
//   1..9   board cells: 0 empty, 1 human, 2 AI
//   10     move cell, 0-based (0..8) — the cart adds 1 to index its 1..9 board.
//          Dual meaning across the handshake:
//            • JS writes it before READY: the move to play, or NO_MOVE when the page
//              has none (rate-limited/timeout/error) so the cart plays its own minimax.
//            • The cart overwrites it with the cell it ACTUALLY played, then returns
//              status to idle — so after the handshake JS can read back the real move
//              (needed to show fallback turns in the panel).
export const IDX_STATUS = 0;
export const IDX_BOARD = 1; // board occupies bytes 1..9
export const IDX_MOVE = 10;

// Sentinel written to IDX_MOVE when the page has no move for the cart to play. Any value
// outside 0..8 trips the cart's "garbage → local minimax" recovery; 255 is the max byte
// value, unmistakably not a cell index. The cart then writes the cell it played back to
// IDX_MOVE (see the write-back note above), so the panel can still show the move.
export const NO_MOVE = 255;

// Read the 9 board cells out of a gpio array into a plain [0..8] board that
// api/move.js and ai.js understand (0 empty, 1 human, 2 AI).
export function readBoard(gpio) {
  const board = [];
  for (let i = 0; i < 9; i++) board.push(gpio[IDX_BOARD + i] | 0);
  return board;
}
