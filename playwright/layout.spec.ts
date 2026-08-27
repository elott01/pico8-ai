// Layout and touch, across every project in the config — desktop Chromium, desktop WebKit
// and an emulated iPhone. The card widths and the wrapping behaviour are the parts that
// only break at particular viewports, which is exactly what a single manual check misses.

import { test, expect } from '@playwright/test';

const cards = '[aria-label="Choose a cart"] button';

test('the page never scrolls sideways', async ({ page }) => {
  await page.goto('/');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});

test('both cart cards are the same width', async ({ page }) => {
  await page.goto('/');
  const [a, b] = await page.locator(cards).all();
  const ra = await a.boundingBox();
  const rb = await b.boundingBox();

  // Each card sizes to its content otherwise, and Connect Four's 7x6 mini-board makes it
  // visibly wider than Tic-Tac-Toe — which reads as a layout bug rather than a difference
  // between the games. `flex: 1 1 0` is what equalises them; `flex: 1 1 auto` does not.
  expect(Math.abs(ra!.width - rb!.width)).toBeLessThan(1);
});

test('cart cards are large enough to tap', async ({ page }) => {
  await page.goto('/');
  for (const card of await page.locator(cards).all()) {
    const box = await card.boundingBox();
    // WCAG 2.5.5 target size.
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('the cart fits the viewport after switching to the wider board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Connect Four/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);

  const frame = await page.locator('iframe').boundingBox();
  const width = page.viewportSize()!.width;
  expect(frame!.width).toBeLessThanOrEqual(width);
});

test('tapping a card switches the cart', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'tap() needs a touch-enabled context');
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);

  await page.getByRole('button', { name: /Connect Four/ }).tap();
  await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
});
