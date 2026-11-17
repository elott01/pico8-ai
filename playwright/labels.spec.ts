// The shelf's labels reach the screen pixel for pixel, at every window size.
//
// A label is pixel art, 128 x 128, and the cartridge draws it at 128 screen pixels. Anything
// else breaks it in one of two ways, neither of which a layout check can see. Zoomed to 96
// with the 3/4 cartridge, it lost one row and one column in four, which broke up the text in
// Gem-in-Eye's label, and in Chromium which ones moved with the window's size: each label came
// out as six different pictures across a cycle of 8 window sizes, while WebKit drew one
// picture at all of them. Drawn half a pixel off, a label blends its neighbours together.
// Neither engine does that today, because each snaps an image to whole pixels, but the
// layout puts labels on half and quarter pixels at most sizes, so a change to how a browser
// draws them would show up here.
//
// So each label on screen is compared with its PNG, across a cycle of 8 window sizes in each
// direction, in every layout the shelf has. At 1x, since a half pixel at 2x is a whole one,
// and 1x is where this was seen.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CART_ORDER } from '../src/lib/carts.ts';
import { countDifferences, readLabelPng, SIZE } from '../scripts/cart-label.ts';

const shelf = '[aria-label="Choose a cart"]';
const sources = Object.fromEntries(
  CART_ORDER.map((cart) => [cart, readLabelPng(readFileSync(new URL(`../public/labels/${cart}.png`, import.meta.url)))]),
);

test.use({ deviceScaleFactor: 1 });
test.skip(({ isMobile }) => !!isMobile, 'measured at 1x; a phone draws the labels at 3x');

/** The labels showing on the shelf, with the shelf in view. A cart in the device hides its own. */
async function labelsOnScreen(page: Page) {
  await page.evaluate(async (shelf) => {
    // Under the handheld, the shelf starts below the window
    const box = document.querySelector(shelf)!.getBoundingClientRect();
    if (box.bottom > innerHeight) scrollBy(0, Math.ceil(box.bottom - innerHeight) + 8);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, shelf);
  return page.locator(`${shelf} img`).evaluateAll((labels: HTMLImageElement[]) =>
    labels
      .filter((label) => getComputedStyle(label).visibility === 'visible')
      .map((label) => {
        const { x, y, width } = label.getBoundingClientRect();
        return { cart: new URL(label.src).pathname.split('/').pop()!.replace('.png', ''), x, y, width };
      }),
  );
}

for (const [layout, width, height] of [
  ['full size, beside the handheld', 1440, 1200],
  ['full size, under the handheld', 1100, 1200],
  ['3/4, beside the handheld', 1568, 900],
  ['3/4, under the handheld', 900, 900],
  ['one column', 600, 900],
] as const) {
  test(`the labels are their PNGs, pixel for pixel: ${layout}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    // With the slot empty, every label is on the shelf, whichever cart the page starts with
    const eject = page.getByRole('button', { name: 'Eject' });
    await expect(eject).toBeEnabled();
    await eject.click();
    await expect(page.locator('iframe')).toHaveCount(0);
    // And the mouse off the shelf. Left on Eject, scrolling the shelf into view under the
    // handheld brought a cartridge under it, which lifted on hover while it was being read
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });

    const sizes = [
      ...Array.from({ length: 8 }, (_, step) => [width + step, height]),
      ...Array.from({ length: 7 }, (_, step) => [width, height + step + 1]),
    ];
    const failures: string[] = [];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w!, height: h! });
      const labels = await labelsOnScreen(page);
      expect(labels, `${w} x ${h}`).toHaveLength(CART_ORDER.length);
      for (const label of labels) {
        if (Math.abs(label.width - SIZE) > 0.01) {
          failures.push(`${w} x ${h}, ${label.cart}: drawn ${label.width}px wide`);
          continue;
        }
        // Where the browser snapped it: the nearest whole pixel
        const shot = await page.screenshot({
          clip: { x: Math.round(label.x), y: Math.round(label.y), width: SIZE, height: SIZE },
        });
        try {
          const differ = countDifferences(readLabelPng(shot), sources[label.cart]!);
          if (differ > 0) failures.push(`${w} x ${h}, ${label.cart}: ${differ} pixels differ`);
        } catch (error) {
          // A blended pixel is in no palette
          failures.push(`${w} x ${h}, ${label.cart}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
}
