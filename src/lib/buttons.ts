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

declare global {
  interface Window {
    // Declared by the export inside the iframe, beside pico8_gpio (see gpio.ts).
    pico8_buttons?: number[];
  }
}
