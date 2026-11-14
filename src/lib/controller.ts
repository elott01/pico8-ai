// PICO-8's touch controller, the one the phone's overlay turns on, has X lower-left and O
// upper-right: its handler splits the corner on a diagonal and calls the upper half O. The
// handheld has them the other way round, in the keyboard's order, Z then X, and with
// Gem-in-Eye's main button, X, where a Game Boy's A is. So going fullscreen swapped them under
// the player's thumbs. matchHandheld trades them inside the export's page, from outside it, as
// the overlay already flips p8_touch_detected: it redraws the controller's picture with the two
// circles traded, then trades the two buttons each time the handler has read the touches.
//
// The picture and the buttons trade together or not at all. If the picture isn't the one this
// expects, as a PICO-8 with a different controller might draw, both stay as PICO-8 made them: a
// controller whose buttons don't do what their symbols say is worse than one on the wrong side.

import { BUTTON } from './buttons.ts';

declare global {
  interface Window {
    // The export's: its controller's pictures as data URLs, which its layout reads every time it
    // runs, and its touch handler, which every touch listener calls by this name.
    p8_gfx_dat?: Record<string, string>;
    pico8_buttons_event?: (event: TouchEvent, step: number) => void;
  }
}

// The picture of the right-hand side: the pause bar across the top, O above, X below and left.
const PANEL = 'controls_right_panel';

const matched = new WeakSet<Window>();

/** O and X traded in a button bitfield, everything else left as it is. */
export function tradeOX(held: number): number {
  const o = held & BUTTON.o ? BUTTON.x : 0;
  const x = held & BUTTON.x ? BUTTON.o : 0;
  return (held & ~(BUTTON.o | BUTTON.x)) | o | x;
}

interface Circle {
  x: number; // centre
  y: number;
  r: number; // radius
}

/**
 * The controller's two circles in its picture's alpha, as [upper-right, lower-left], or null if
 * the picture isn't laid out as expected. Read from the picture rather than written down, so a
 * PICO-8 that moves them a little is still traded exactly, and one that redraws them is left
 * alone. The circles sit below the pause bar, past a gap of empty rows, side by side across a
 * gap of empty columns, and are round and the same size.
 */
export function findCircles(alpha: Uint8ClampedArray, width: number, height: number): [Circle, Circle] | null {
  const solid = (x: number, y: number) => alpha[y * width + x] > 32;

  // Runs of rows with anything in them: the bar, then the circles
  const bands: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width && !any; x++) any = solid(x, y);
    if (!any) continue;
    const last = bands.at(-1);
    if (last && last[1] === y - 1) last[1] = y;
    else bands.push([y, y]);
  }
  if (bands.length !== 2) return null;
  const [top, bottom] = bands[1];

  // Runs of columns with anything in them, across the circles' rows
  const runs: [number, number][] = [];
  for (let x = 0; x < width; x++) {
    let any = false;
    for (let y = top; y <= bottom && !any; y++) any = solid(x, y);
    if (!any) continue;
    const last = runs.at(-1);
    if (last && last[1] === x - 1) last[1] = x;
    else runs.push([x, x]);
  }
  if (runs.length !== 2) return null;

  const circle = ([left, right]: [number, number]): Circle | null => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (!solid(x, y)) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const across = right - left + 1;
    const down = maxY - minY + 1;
    if (Math.abs(across - down) > 2) return null;
    return { x: (left + right + 1) / 2, y: (minY + maxY + 1) / 2, r: Math.max(across, down) / 2 };
  };
  const lowerLeft = circle(runs[0]);
  const upperRight = circle(runs[1]);
  if (!lowerLeft || !upperRight) return null;
  if (upperRight.y >= lowerLeft.y || Math.abs(upperRight.r - lowerLeft.r) > 1) return null;
  return [upperRight, lowerLeft];
}

/**
 * The picture with its two circles traded: turned 180° about the point between them, which puts
 * each exactly where the other was. O's ring and X's cross look the same either way up, and the
 * pause bar is left where it is. The turn lands on whole pixels, so nothing is resampled.
 */
async function tradeCircles(src: string): Promise<string | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const alpha = data.filter((_, i) => i % 4 === 3);
  const circles = findCircles(alpha, canvas.width, canvas.height);
  if (!circles) return null;

  const [a, b] = circles;
  const r = Math.max(a.r, b.r) + 2;
  g.save();
  g.beginPath();
  for (const { x, y } of circles) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.clip();
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  g.setTransform(-1, 0, 0, -1, Math.round(a.x + b.x), Math.round(a.y + b.y));
  g.drawImage(img, 0, 0);
  g.restore();
  return canvas.toDataURL();
}

/**
 * The handheld's O and X on PICO-8's controller in the cart's window, once per page. A
 * Gem-in-Eye door is a load() inside the same page, so it keeps them. Resolves to whether they
 * are traded.
 */
export async function matchHandheld(win: Window): Promise<boolean> {
  if (matched.has(win)) return true;
  const src = win.p8_gfx_dat?.[PANEL];
  const handler = win.pico8_buttons_event;
  if (!src || !handler) return false;
  const traded = await tradeCircles(src);
  // Two overlays opened while the first was still drawing: only one may wrap the handler
  if (matched.has(win)) return true;
  if (!traded) return false;
  matched.add(win);
  win.p8_gfx_dat![PANEL] = traded;
  win.document.getElementById(PANEL)?.setAttribute('src', traded);
  // The handler starts every touch from 0 and adds up what every finger down is on, so trading
  // after it can't drift
  win.pico8_buttons_event = (event, step) => {
    handler(event, step);
    const buttons = win.pico8_buttons;
    if (buttons) buttons[0] = tradeOX(buttons[0]);
  };
  return true;
}
