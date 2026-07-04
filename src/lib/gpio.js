// GPIO bridge between the page and the PICO-8 cart.
//
// The web export mirrors the cart's 128 GPIO bytes (0x5f80–0x5fff) into a plain
// JS array at window.pico8_gpio. The cart pokes/peeks; the page reads/writes the
// same array and does the networking the cart can't do itself.

export const GPIO_LEN = 128;

// Status byte (index 0) state machine — must match the cart's Lua protocol.
export const ST_IDLE = 0;
export const ST_REQUEST = 1;
export const ST_THINKING = 2;
export const ST_READY = 3;

// Byte layout for tic-tac-toe:
//   0      status (above)
//   1..9   board cells: 0 empty, 1 human, 2 AI
//   10     AI's chosen cell (0..8)
export const IDX_STATUS = 0;
export const IDX_BOARD = 1; // board occupies bytes 1..9
export const IDX_MOVE = 10;

// Create the shared array BEFORE the player runtime loads, so the cart sees it.
export function initGpio() {
  window.pico8_gpio = new Array(GPIO_LEN).fill(0);
  return window.pico8_gpio;
}
