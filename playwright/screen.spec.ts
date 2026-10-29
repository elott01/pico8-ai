// The cart's screen: a 512px window onto a larger iframe wherever the handheld is
// full-size, and PICO-8's page with no scrollbars at any size.
//
// PICO-8's exported page draws the game at a whole multiple of 128 only when the iframe is
// big enough, so Pico8Game.module.scss makes the iframe 540 x 539 and crops it to the 512px
// square where the game lands. Where it lands is the export's layout, not ours. A new PICO-8
// could move it, and the window would then show a strip of grey and cut off an edge of the
// game, with nothing else noticing. These pin it, before the cart starts and after.

import { test, expect, type Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };

/** The window and the game, both in page coordinates. A game not laid out yet measures 0. */
function measure(page: Page, id: 'p8_container' | 'canvas'): Promise<{ view: Box; game: Box }> {
  return page.locator('iframe').evaluate((frame: HTMLIFrameElement, id: string) => {
    const view = frame.parentElement!.getBoundingClientRect();
    const offset = frame.getBoundingClientRect();
    const game = frame.contentDocument?.getElementById(id)?.getBoundingClientRect();
    return {
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
      game: {
        x: offset.x + (game?.x ?? 0),
        y: offset.y + (game?.y ?? 0),
        width: game?.width ?? 0,
        height: game?.height ?? 0,
      },
    };
  }, id);
}

function expectFills({ view, game }: { view: Box; game: Box }) {
  expect(view.width).toBe(512);
  expect(view.height).toBe(512);
  // 4x exactly: any other size means PICO-8 drew it blurry
  expect(game.width).toBe(512);
  expect(game.height).toBe(512);
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
// which is the case the crop first missed.
for (const width of [1280, 780]) {
  test.describe(`the screen at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });
    // Phones get the plain iframe at column width; PICO-8 lays itself out differently for touch
    test.skip(({ isMobile }) => !!isMobile, 'the crop is for the full-size handheld only');

    test('the start screen fills the window at 4x', async ({ page }) => {
      await page.goto('/');
      await expect.poll(async () => (await measure(page, 'p8_container')).game.width).toBe(512);
      expectFills(await measure(page, 'p8_container'));
    });

    test('the running game fills the window at 4x', async ({ page }) => {
      await page.goto('/');
      await start(page);
      await expect.poll(async () => (await measure(page, 'canvas')).game.width).toBe(512);
      expectFills(await measure(page, 'canvas'));
    });
  });
}

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
