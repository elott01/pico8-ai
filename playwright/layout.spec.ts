// Layout and touch, across every project in the config — desktop Chromium, desktop WebKit
// and an emulated iPhone. The card widths and the wrapping behaviour are the parts that
// only break at particular viewports, which is exactly what a single manual check misses.

import { test, expect } from '@playwright/test';

const cards = '[aria-label="Choose a cart"] button';

test('Source opens the repo in a new tab, and says so', async ({ page }) => {
  await page.goto('/');
  const source = page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: /^Source/ });
  await expect(source).toHaveAttribute('href', 'https://github.com/elott01/pico8-ai');
  // Leaving the page would lose a game in progress, so the repo opens beside it
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', /noopener/);
  await expect(source).toHaveAccessibleName('Source (opens in a new tab)');
});

test('the page never scrolls sideways', async ({ page }) => {
  await page.goto('/');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});

// The carts, the handheld and the panel inside a laptop's window at 100% zoom, header
// included, and the three ending level beside each other. 1208 x 879 is the window the
// owner zoomed out to 75% to fit them all in, before the handheld scaled itself. Below
// 1134px tall the handheld and cartridges draw at 3/4; 2560 x 1440 has the full-size ones.
// A shorter window than these, like 1280 x 720, doesn't fit even at 3/4.
for (const [width, height] of [
  [1208, 879],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
]) {
  test(`the arcade fits a ${width} x ${height} window`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone has its own layout, the panel and carts under the device');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const columns = [
      page.getByRole('region', { name: 'Carts' }),
      page.getByRole('group', { name: 'Cart buttons' }).locator('..'), // the shell
      page.locator('aside'),
    ];
    const bottoms = await Promise.all(
      columns.map(async (column) => {
        const box = (await column.boundingBox())!;
        return box.y + box.height;
      }),
    );
    for (const bottom of bottoms) {
      expect(bottom).toBeLessThanOrEqual(height);
      expect(Math.abs(bottom - bottoms[1]!)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('at 3/4 a cartridge keeps its full-size shape, in a shelf that stays wider', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a phone has no 3/4 cartridges');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  expect((await page.getByRole('region', { name: 'Carts' }).boundingBox())!.width).toBe(198);
  // 176 x 261, the full-size cartridge
  for (const card of await page.locator(cards).all()) {
    const box = (await card.boundingBox())!;
    expect(Math.abs(box.width - 132)).toBeLessThan(1);
    expect(Math.abs(box.height - 195.75)).toBeLessThan(1);
  }
});

test('every cartridge is the same size, the empty slot included', async ({ page, isMobile }) => {
  // A cartridge whose tagline ran longer would otherwise be taller than the rest, and the
  // selected cart's dashed outline would stop matching the cartridge it stands in for. The
  // tagline's reserved three lines and the outline drawn over hidden contents keep them
  // equal. In a row, stretching would hide a mismatch, so the wide layout's column is
  // checked too.
  const expectSameSize = async () => {
    const boxes = await Promise.all((await page.locator(cards).all()).map((card) => card.boundingBox()));
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(1);
      expect(Math.abs(box!.height - boxes[0]!.height)).toBeLessThan(1);
    }
  };

  await page.goto('/');
  await expectSameSize();
  if (!isMobile) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await expectSameSize();
  }
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
