// Layout and touch, across every project in the config — desktop Chromium, desktop WebKit
// and an emulated iPhone. The card widths and the wrapping behaviour are the parts that
// only break at particular viewports, which is exactly what a single manual check misses.

import { test, expect, type Locator } from '@playwright/test';

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
// 1122px tall the handheld and cartridges draw at 3/4; 2560 x 1440 has the full-size ones.
// 821 tall is the shortest that fits, with the title as high as it goes. A shorter window,
// like 1280 x 720, doesn't fit even at 3/4.
for (const [width, height] of [
  [1564, 821],
  [1564, 838],
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

// The arcade takes the first screen, so the window's bottom edge never cuts About in half, as
// it did to the heading at 970 tall. Height to spare goes equally above and below, which puts
// the top of the header as far from the top of the window as the shell is from the bottom.
for (const [width, height] of [
  [1564, 838],
  [1568, 892],
  [1430, 925],
  [1728, 970],
  [1920, 1080],
  [2560, 1440],
]) {
  test(`the arcade has a ${width} x ${height} window to itself`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone stacks everything, so the arcade is taller than the window');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const header = (await page.locator('header').boundingBox())!;
    const shell = (await page.getByRole('group', { name: 'Cart buttons' }).locator('..').boundingBox())!;
    expect((await page.locator('#about').boundingBox())!.y).toBeGreaterThanOrEqual(height);
    expect(Math.abs(header.y - (height - (shell.y + shell.height)))).toBeLessThan(2);
  });
}

// Only the three columns give up the space above the title, and only when they need it: at
// 892 tall the title is where it was, and so it is at 1000 x 800, where the carts sit under
// the device and the page scrolls anyway. 838 and 892 tall are the arcade centred in the
// window, so they move with the 3/4 handheld's height.
for (const [width, height, top] of [
  [1280, 720, 4],
  [1564, 838, 11],
  [1568, 892, 38],
  [1000, 800, 30],
]) {
  test(`a ${width} x ${height} window has ${top}px above the title`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone is never this big');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    expect(Math.abs((await page.locator('header').boundingBox())!.y - top)).toBeLessThan(1);
  });
}

// A regular window has to stay as it was, so these pin both sides of $big, by width and by
// height: the taller header would push the arcade off a wide, short window.
for (const [width, height, page_, title, panel] of [
  [1728, 970, 1440, '40px', '15px'],
  [1568, 892, 1240, '32px', '13px'],
  [1728, 870, 1240, '32px', '13px'],
] as const) {
  test(`a ${width} x ${height} window has a ${page_}px page`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone is never this big');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    expect((await page.locator('header').boundingBox())!.width).toBe(page_);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', title);
    await expect(page.locator('aside')).toHaveCSS('font-size', panel);
  });
}

test('About’s edges line up with the arcade’s at every layout', async ({ page, isMobile }) => {
  const expectLevel = async () => {
    const header = (await page.locator('header').boundingBox())!;
    const about = (await page.locator('#about').boundingBox())!;
    expect(Math.abs(about.x - header.x)).toBeLessThan(1);
    expect(Math.abs(about.width - header.width)).toBeLessThan(1);
  };

  await page.goto('/');
  await expectLevel();
  if (isMobile) return;
  // Three columns, big and short; the carts under the device, tall and short; one column
  for (const [width, height] of [
    [1728, 970],
    [1400, 900],
    [1100, 1200],
    [900, 800],
    [780, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await expectLevel();
  }
});

test('the panel’s title matches the shelf’s, in font and position', async ({ page, isMobile }) => {
  test.skip(isMobile, 'on a phone the panel and the shelf are stacked, not side by side');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const shelf = page.getByRole('region', { name: 'Carts' }).getByRole('heading');
  const panel = page.locator('aside').getByRole('heading');
  const font = (title: Locator) =>
    title.evaluate((el) => {
      const { fontFamily, fontSize, fontWeight, lineHeight, color, textTransform } = getComputedStyle(el);
      return { fontFamily, fontSize, fontWeight, lineHeight, color, textTransform };
    });
  expect(await font(panel)).toEqual(await font(shelf));

  const top = async (part: Locator) => (await part.boundingBox())!.y;
  const below = 'xpath=following-sibling::*';
  expect(await top(panel)).toBeCloseTo(await top(shelf), 0);
  expect(await top(panel.locator(below))).toBeCloseTo(await top(shelf.locator(below)), 0);
});

test('at 3/4 a cartridge keeps its label full-size, in a shelf that stays wider', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a phone has no 3/4 cartridges');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  expect((await page.getByRole('region', { name: 'Carts' }).boundingBox())!.width).toBe(198);
  // The 128px label and 10.5px each side of it. The tagline gives up its height to the
  // label's, which keeps the cartridge about as tall as a full-size one at 3/4, 196. It's 194,
  // and Chromium draws 193, rounding the zoomed 1.5px borders down
  for (const card of await page.locator(cards).all()) {
    const box = (await card.boundingBox())!;
    expect(Math.abs(box.width - 149)).toBeLessThan(1);
    expect(Math.abs(box.height - 194)).toBeLessThanOrEqual(1);
  }
  // Hidden from sight, not from screen readers
  await expect(page.getByRole('button', { name: /^Gem-in-Eye/ })).toHaveAccessibleName(/talks back$/);
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
