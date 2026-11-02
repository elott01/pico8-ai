// The cart's screen: a 512px window onto a larger iframe wherever the handheld is
// full-size, the same drawn at 3/4 on a short window, and PICO-8's page with no scrollbars
// at any size.
//
// PICO-8's exported page draws the game at a whole multiple of 128 only when the iframe is
// big enough, so Pico8Game.module.scss makes the iframe 540 x 539 and crops it to the 512px
// square where the game lands. Where it lands is the export's layout, not ours. A new PICO-8
// could move it, and the window would then show a strip of grey and cut off an edge of the
// game, with nothing else noticing. These pin it, before the cart starts and after.

import { test, expect, type Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
type Measured = { view: Box; game: Box; drawn: number };

/**
 * The window and the game, both as drawn on the page, and the size PICO-8 drew the game in
 * the iframe's own pixels. The iframe is laid out full-size even where the handheld is drawn
 * smaller, so its inside is scaled by the ratio of the two. A game not laid out yet measures 0.
 */
function measure(page: Page, id: 'p8_container' | 'canvas'): Promise<Measured> {
  return page.locator('iframe').evaluate((frame: HTMLIFrameElement, id: string) => {
    const view = frame.parentElement!.getBoundingClientRect();
    const offset = frame.getBoundingClientRect();
    const scale = offset.width / frame.offsetWidth;
    const game = frame.contentDocument?.getElementById(id)?.getBoundingClientRect();
    return {
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
      game: {
        x: offset.x + (game?.x ?? 0) * scale,
        y: offset.y + (game?.y ?? 0) * scale,
        width: (game?.width ?? 0) * scale,
        height: (game?.height ?? 0) * scale,
      },
      drawn: game?.width ?? 0,
    };
  }, id);
}

function expectFills({ view, game, drawn }: Measured, size: number) {
  expect(view.width).toBe(size);
  expect(view.height).toBe(size);
  // 4x exactly: any other size means PICO-8 drew it blurry
  expect(drawn).toBe(512);
  expect(game.width).toBeCloseTo(size, 1);
  expect(game.height).toBeCloseTo(size, 1);
  // Half a pixel either way is subpixel layout, not a visible strip
  expect(Math.abs(game.x - view.x)).toBeLessThan(0.5);
  expect(Math.abs(game.y - view.y)).toBeLessThan(0.5);
}

/** Start the cart and wait until its canvas is laid out. */
async function start(page: Page) {
  // The export waits for a click before it starts
  await page.frameLocator('iframe').locator('#p8_start_button').click();
  await expect
    .poll(async () => (await measure(page, 'canvas')).game.width, { timeout: 15_000 })
    .toBeGreaterThan(0);
}

// 1280 has the device beside the panel. 780 has it alone in one column, but still full-size,
// which is the case the crop first missed. A window 1200 tall has room for the full-size
// handheld; one 800 tall draws it at 3/4, where the 512px window shows 384 across.
for (const width of [1280, 780]) {
  for (const [height, size] of [
    [1200, 512],
    [800, 384],
  ]) {
    test.describe(`the screen at ${width} x ${height}`, () => {
      test.use({ viewport: { width, height } });
      // Phones get the plain iframe at column width; PICO-8 lays itself out differently for touch
      test.skip(({ isMobile }) => !!isMobile, 'the crop is for the full-size handheld only');

      test(`the start screen fills the window at ${size}px`, async ({ page }) => {
        await page.goto('/');
        await expect.poll(async () => (await measure(page, 'p8_container')).drawn).toBe(512);
        expectFills(await measure(page, 'p8_container'), size);
      });

      test(`the running game fills the window at ${size}px`, async ({ page }) => {
        await page.goto('/');
        await start(page);
        await expect.poll(async () => (await measure(page, 'canvas')).drawn).toBe(512);
        expectFills(await measure(page, 'canvas'), size);
      });
    });
  }
}

// Below the full-size handheld the iframe is plain and PICO-8 draws the game at 95% of it, pinned
// to the top. The page moves the iframe to centre it, and paints PICO-8's grey page black, so the
// game sits in the black glass with no second bezel. The sizes are blurry here; only the margins
// and the colour are pinned.
for (const width of [620, 480]) {
  test.describe(`the screen at ${width} wide`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the game is centred, on black', async ({ page }) => {
      await page.goto('/');
      await start(page);
      const { view, game } = await measure(page, 'canvas');
      const left = game.x - view.x;
      const right = view.x + view.width - (game.x + game.width);
      const top = game.y - view.y;
      const bottom = view.y + view.height - (game.y + game.height);
      expect(Math.abs(left - right)).toBeLessThan(2);
      expect(Math.abs(top - bottom)).toBeLessThan(2);
      expect(top).toBeGreaterThan(5); // it was 0
      const page8 = await page.locator('iframe').evaluate((f: HTMLIFrameElement) => getComputedStyle(f.contentDocument!.body).backgroundColor);
      expect(page8).toBe('rgb(0, 0, 0)');
    });
  });
}

// The 3/4 handheld is a transform, which leaves its box full-size, so .device sets the
// scaled height itself from --device-height. That token is the full-size shell's height,
// copied by hand: if the shell's contents change and it doesn't follow, the 3/4 handheld
// overlaps the row under it or leaves a gap, and the panel stops lining up with it.
test.describe('--device-height', () => {
  test.skip(({ isMobile }) => !!isMobile, 'a phone has neither the full-size nor the 3/4 handheld');

  // The shell holds the cart buttons, and the grid item it's scaled in is two levels up
  const shellOf = (page: Page) => page.getByRole('group', { name: 'Cart buttons' }).locator('..');

  test('is the full-size shell’s height', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1200 });
    await page.goto('/');
    const [shell, token] = await shellOf(page).evaluate((el: HTMLElement) => [
      el.offsetHeight,
      parseFloat(getComputedStyle(el).getPropertyValue('--device-height')),
    ]);
    expect(shell).toBe(token);
  });

  test('leaves the 3/4 handheld’s box as tall as it is drawn', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    const shell = (await shellOf(page).boundingBox())!;
    const device = (await shellOf(page).locator('xpath=../..').boundingBox())!;
    expect(shell.height).toBeCloseTo(936 * 0.75, 0);
    expect(Math.abs(shell.y + shell.height - (device.y + device.height))).toBeLessThan(1);
  });
});

// PICO-8's page is wider than the iframe, because its menu buttons hang off the game's right
// edge, so the iframe would give it scrollbars. In a real browser they showed inside the
// screen, and where the screen is cropped they would narrow the page and slide the game out
// of the window. scrolling="no" is what stops them.
//
// This checks the attribute, not the scrollbars, because it can't see them: headless
// browsers hide scrollbars, so the page measured the same with and without it. It is here
// so the attribute, which looks obsolete, isn't deleted as such.
test('the cart’s page gets no scrollbars', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveAttribute('scrolling', 'no');

  // And the reason still holds: the page overflows the iframe once the cart runs
  await start(page);
  const overflows = await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const inner = frame.contentDocument!.scrollingElement!;
    return inner.scrollWidth > inner.clientWidth || inner.scrollHeight > inner.clientHeight;
  });
  expect(overflows).toBe(true);
});
