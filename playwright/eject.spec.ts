// The handheld's Eject button. It unloads the cart: no iframe, no poll loop, an empty slot
// and an "insert a cart" screen, and focus on the shelf, where the next move is. It's the
// middle of the bottom row, so the row's order and layout are checked here too.

import { test, expect, type Page } from '@playwright/test';

const eject = (page: Page) => page.getByRole('button', { name: 'Eject' });

/** Load the page and wait for the cart, since Eject stays disabled until one is up. */
async function loaded(page: Page) {
  await page.goto('/');
  await expect(eject(page)).toBeEnabled();
}

test('Eject empties the device', async ({ page }) => {
  await loaded(page);
  await eject(page).click();

  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByText('insert a cart', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Choose a cart"] [aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Cart ejected' })).toHaveCount(1);
  await expect(page.getByText('Insert a cart to start a game.')).toBeVisible();
  // Nothing left to eject
  await expect(eject(page)).toBeDisabled();
});

test('focus moves to the first cart after an eject', async ({ page }) => {
  await loaded(page);
  await eject(page).click();
  // Eject disables itself, which would otherwise drop focus to the page
  await expect(page.getByRole('button', { name: /Tic-Tac-Toe/ })).toBeFocused();
});

test('a cart goes back in after an eject', async ({ page }) => {
  await loaded(page);
  await eject(page).click();
  await page.getByRole('button', { name: /Connect Four/ }).click();

  await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
  await expect(page.getByText('insert a cart', { exact: true })).toHaveCount(0);
  await expect(eject(page)).toBeEnabled();
});

test('Tab reaches Eject before the cart, which swallows Tab', async ({ page, isMobile }) => {
  test.skip(isMobile, 'tab order is the webkit project’s to check; this is the same engine');
  await loaded(page);
  await page.getByRole('button', { name: /Gem-in-Eye/ }).focus();
  // The bottom row is drawn at the bottom of the shell but sits before the iframe in the DOM,
  // in the order it's drawn. After the iframe, nothing could be reached by Tab at all.
  for (const name of ['Fullscreen', 'Eject', 'CRT']) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
  }
});

// Eject in the middle of the row, on the screen's centre line, and the three buttons one size,
// at full size and at 3/4.
for (const height of [1200, 900]) {
  test(`Eject is centred under the screen, between two buttons its size, ${height} tall`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the phone’s row is the same; the 3/4 handheld is the one that scales');
    await page.setViewportSize({ width: 1400, height });
    await loaded(page);
    const boxes = await Promise.all(
      ['Fullscreen', 'Eject', 'CRT'].map(async (name) => (await page.getByRole('button', { name, exact: true }).boundingBox())!),
    );
    const screen = (await page.locator('iframe').locator('..').boundingBox())!;
    const [fullscreen, middle, crt] = boxes;
    expect(middle!.x + middle!.width / 2).toBeCloseTo(screen.x + screen.width / 2, 0);
    expect(fullscreen!.x).toBeLessThan(middle!.x);
    expect(crt!.x).toBeGreaterThan(middle!.x);
    for (const box of boxes) {
      expect(box.width).toBeCloseTo(middle!.width, 1);
      expect(box.height).toBeCloseTo(middle!.height, 1);
    }
  });
}
