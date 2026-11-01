// Player 1's buttons in the PICO-8 web export's pico8_buttons[0], one bit each, numbered as
// btn() numbers them. The export reads that int every frame as input beside the keyboard,
// which is how the handheld's D-pad and keys press the cart's buttons, and how
// playwright/doors.spec.ts walks the knight.
export const BUTTON = {
  left: 1 << 0,
  right: 1 << 1,
  up: 1 << 2,
  down: 1 << 3,
  o: 1 << 4,
  x: 1 << 5,
} as const;

// The keys PICO-8 reads as those same buttons, by keyCode, since that's what its runtime reads.
// Player 2's keys are left out: they press nothing on this handheld.
export const BUTTON_KEYS: Record<number, number> = {
  37: BUTTON.left,
  39: BUTTON.right,
  38: BUTTON.up,
  40: BUTTON.down,
  90: BUTTON.o, // Z
  67: BUTTON.o, // C
  78: BUTTON.o, // N
  88: BUTTON.x, // X
  86: BUTTON.x, // V
  77: BUTTON.x, // M
};

declare global {
  interface Window {
    // Declared by the export inside the iframe, beside pico8_gpio (see gpio.ts).
    pico8_buttons?: number[];
  }
}
