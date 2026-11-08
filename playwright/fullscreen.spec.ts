// The handheld's Fullscreen button. It runs the export's own fullscreen inside the cart's page,
// so PICO-8 knows and draws the game at a whole multiple of 128. The cart stays in the same
// iframe, so the page's poll loops can still reach it and the run survives the trip.
//
// Those are the export's functions and layout, not ours, so a new PICO-8 could change them.

import { test, expect, type Page } from '@playwright/test';
import { BUTTON } from '../src/lib/buttons.ts';
import { LARGEST_PICTURE } from '../src/lib/crt.ts';

const COMMENTARY = 'SEEN-FROM-FULLSCREEN';

const button = (page: Page) => page.getByRole('button', { name: 'Fullscreen' });
// Inside the cart's page, because that's the only place a click in fullscreen can land
const exit = (page: Page) => page.frameLocator('iframe').getByRole('button', { name: 'Exit', exact: true });

/** The cart as its own page sees it. */
const cart = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument!;
    const canvas = doc.getElementById('canvas')?.getBoundingClientRect();
    return {
      full: doc.fullscreenElement?.id ?? null,
      width: canvas?.width ?? 0,
      x: canvas?.x ?? 0,
      y: canvas?.y ?? 0,
      gpio: !!frame.contentWindow!.pico8_gpio,
    };
  });

const canvasWidth = async (page: Page) => (await cart(page)).width;

/** Load the page and wait for the handheld, since the button stays disabled until a cart is up. */
async function loaded(page: Page) {
  await page.goto('/');
  await expect(button(page)).toBeEnabled();
}

/** Frames the runtime has drawn, which the export reports through pico8_state. */
const frames = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const win = frame.contentWindow as Window & { pico8_state?: { frame_number?: number } };
    return win.pico8_state?.frame_number ?? 0;
  });

/**
 * Press the cart's play button and wait until it's a second in. Sooner, a key pressed goes
 * nowhere, and PICO-8's boot picture changing could pass for the cursor moving.
 */
async function start(page: Page) {
  await page.frameLocator('iframe').locator('#p8_start_button').click();
  await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(30);
}

const leave = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.exitFullscreen());

/** Tic-tac-toe's cursor is the only thing moving on its board, so a changed picture is a move. */
async function expectKeyMovesCursor(page: Page, key: string) {
  const before = await page.screenshot();
  await page.keyboard.down(key);
  await page.waitForTimeout(100); // down and up inside one frame would go unseen
  await page.keyboard.up(key);
  await expect.poll(async () => before.equals(await page.screenshot())).toBe(false);
}

test.describe('on a desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'a finger gets the overlay; see overlay.spec.ts');
  // Firefox's fullscreen fills the screen instead, so playwright.config.ts sets its screen to this
  test.use({ viewport: { width: 1728, height: 1086 } });

  test('the game fills the window at a whole multiple of 128, then returns to the crop', async ({ page }) => {
    await loaded(page);
    await start(page);
    await page
      .locator('iframe')
      .evaluate((frame: HTMLIFrameElement) => ((frame.contentWindow as Window & { run?: string }).run = 'same'));

    await button(page).click();
    await expect.poll(async () => (await cart(page)).full).toBe('p8_playarea');
    await expect.poll(() => canvasWidth(page)).toBe(1024);

    const full = await cart(page);
    expect(full.x).toBe((1728 - 1024) / 2);
    expect(full.y).toBe((1086 - 1024) / 2);
    expect(full.gpio).toBe(true);

    await leave(page);
    await expect.poll(() => canvasWidth(page)).toBe(512);
    expect((await cart(page)).full).toBeNull();
    // A reload would have wiped this, and the run with it
    expect(
      await page
        .locator('iframe')
        .evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as Window & { run?: string }).run),
    ).toBe('same');
  });

  // Real keys and real pixels, not document.activeElement. The export's own focus helper does
  // nothing here, so fullscreen once came up looking right with a cart that took no keys.
  test('the arrow keys move the cursor in fullscreen, and after leaving it', async ({ page }) => {
    await loaded(page);
    await start(page);

    await button(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(1024);
    await expectKeyMovesCursor(page, 'ArrowRight');

    await leave(page);
    await expect.poll(() => canvasWidth(page)).toBe(512);
    await expectKeyMovesCursor(page, 'ArrowLeft');
  });

  // A real click, not just a look. Drawn from this page as a popover, Exit showed up over the
  // fullscreen iframe and could not be clicked, and Playwright's click checks exactly that.
  test('Exit sits beside the game, and a click leaves with the keys still in the cart', async ({ page }) => {
    await loaded(page);
    await start(page);
    await button(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(1024);

    await expect(exit(page)).toBeVisible();
    const box = (await exit(page).boundingBox())!;
    const game = await cart(page);
    expect(box.x).toBeGreaterThanOrEqual(game.x + game.width);
    // The cart's page has no Silkscreen of its own, and a missing font fails silently
    await expect
      .poll(() =>
        exit(page).evaluate((el) =>
          [...el.ownerDocument.fonts].some((font) => font.family.includes('Silkscreen') && font.status === 'loaded'),
        ),
      )
      .toBe(true);

    await exit(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(512);
    expect((await cart(page)).full).toBeNull();
    await expect(exit(page)).toHaveCount(0);
    await expectKeyMovesCursor(page, 'ArrowRight');
  });

  test('Exit fades while the mouse rests, and a move brings it back', async ({ page }) => {
    await loaded(page);
    await start(page);
    await button(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(1024);

    await expect(exit(page)).toHaveCSS('opacity', '1');
    await expect(exit(page)).toHaveCSS('opacity', '0');
    await page.mouse.move(100, 100);
    await expect(exit(page)).toHaveCSS('opacity', '1');
  });

  test('Exit goes when fullscreen ends some other way', async ({ page }) => {
    await loaded(page);
    await start(page);
    await button(page).click();
    await expect(exit(page)).toBeVisible();

    await leave(page);
    await expect(exit(page)).toHaveCount(0);
  });

  test.describe('the CRT filter', () => {
    const filter = (page: Page) => page.frameLocator('iframe').locator('.crt-screen');
    const choose = (page: Page, choice: 'on' | 'off') =>
      page.addInitScript((choice) => localStorage.setItem('pico-crt', choice), choice);

    /** The filter's box and the game's, which should be one box. */
    const boxes = (page: Page) =>
      page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
        const doc = frame.contentDocument!;
        const box = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r && { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const tube = doc.querySelector<HTMLCanvasElement>('.crt-screen');
        return {
          filter: box(tube),
          game: box(doc.getElementById('canvas')),
          // The shader's picture, in device pixels: the game's, through the handheld's transform
          // on a short window, which fullscreen leaves behind
          drawn: tube?.width ?? 0,
          devicePixels: (frame.getBoundingClientRect().width / frame.offsetWidth) * devicePixelRatio,
          // Set once frames fell behind a big picture, which then stops at LARGEST_PICTURE
          slow: tube?.dataset.pace === 'slow',
        };
      });

    const expectOverGame = async (page: Page, width: number) => {
      await expect.poll(async () => (await boxes(page)).filter?.width).toBe(width);
      await expect
        .poll(async () => {
          // The whole size, or, on a machine whose frames fell behind it, the cap and no more.
          // Which one a test machine gets depends on its GPU; never the cap without the reason.
          const { drawn, devicePixels, slow } = await boxes(page);
          const whole = width * devicePixels;
          return drawn === whole || (slow && whole > LARGEST_PICTURE && drawn === LARGEST_PICTURE);
        })
        .toBe(true);
      const { filter, game } = await boxes(page);
      expect(game!.width).toBe(width);
      expect(filter!.height).toBe(game!.height);
      // Half a pixel either way is subpixel layout, not a visible strip
      expect(Math.abs(filter!.x - game!.x)).toBeLessThan(0.5);
      expect(Math.abs(filter!.y - game!.y)).toBeLessThan(0.5);
    };

    test('chosen on the handheld, it covers the game exactly, at the screen\'s own pixel', async ({ page }) => {
      await choose(page, 'on');
      await loaded(page);
      await start(page);
      await button(page).click();
      await expect.poll(() => canvasWidth(page)).toBe(1024);

      await expectOverGame(page, 1024);
      await expect(filter(page)).toHaveCSS('--crt-px', '8px');
      await expect(filter(page)).toHaveCSS('pointer-events', 'none');
      // Enlarged smoothly, where PICO-8's page would have every canvas pixelated
      await expect(filter(page)).toHaveCSS('image-rendering', 'auto');
      await expectKeyMovesCursor(page, 'ArrowRight');
      await expect(exit(page)).toBeVisible();
      await exit(page).click();

      // The same filter, back on the handheld's screen
      await expect.poll(() => canvasWidth(page)).toBe(512);
      await expectOverGame(page, 512);
    });

    test('it follows the game when the window changes', async ({ page, browserName }) => {
      test.skip(browserName === 'chromium', "automation can't resize a fullscreen window there");
      test.skip(browserName === 'firefox', 'resizing the window there leaves fullscreen');
      await choose(page, 'on');
      await loaded(page);
      await start(page);
      await button(page).click();
      await expectOverGame(page, 1024);

      // 7 x 128, so a new size and an odd pixel, not just a smaller copy
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect.poll(() => canvasWidth(page)).toBe(896);
      await expectOverGame(page, 896);
      await expect(filter(page)).toHaveCSS('--crt-px', '7px');
    });

    test('left off on the handheld, fullscreen has none', async ({ page }) => {
      await choose(page, 'off');
      await loaded(page);
      await start(page);
      await button(page).click();
      await expect.poll(() => canvasWidth(page)).toBe(1024);
      await expect(exit(page)).toBeVisible();
      await expect(filter(page)).toHaveCount(0);
    });
  });

  // The page's poll loop is what answers the cart, and the panel is out of sight meanwhile.
  test('a turn taken in fullscreen reaches the model, and is in the panel on the way back', async ({ page }) => {
    await page.route('**/api/move', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ move: 0, winMove: null, blockMove: null, lines: [], commentary: COMMENTARY }),
      }),
    );
    await loaded(page);
    await start(page);
    await button(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(1024);

    const asked = page.waitForResponse('**/api/move');
    await page.keyboard.down('z');
    await page.waitForTimeout(100);
    await page.keyboard.up('z');
    await asked;

    await expect(page.getByText(COMMENTARY)).toBeAttached();
    expect((await cart(page)).full).toBe('p8_playarea');

    await leave(page);
    await expect(page.getByText(COMMENTARY)).toBeVisible();
  });

  // A door resets the machine, and the run crosses in load()'s param. Steered through
  // pico8_buttons for the reason doors.spec.ts gives.
  test("a door's load() stays in fullscreen", async ({ page }) => {
    test.setTimeout(60_000);
    const ran: string[] = [];
    page.on('console', (msg) => {
      const run = /run_cart current_filename: (\w+)\.p8/.exec(msg.text());
      if (run) ran.push(run[1]!);
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Gem-in-Eye/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
    await page.frameLocator('iframe').locator('#p8_start_button').click();
    await expect.poll(() => ran, { timeout: 20_000 }).toContain('gemini');

    await button(page).click();
    await expect.poll(() => canvasWidth(page)).toBe(1024);

    const hold = (held: number) =>
      page.locator('iframe').evaluate((frame: HTMLIFrameElement, held) => {
        frame.contentWindow!.pico8_buttons![0] = held;
      }, held);
    const deadline = Date.now() + 15_000;
    while (!ran.includes('gemini_dungeon')) {
      if (Date.now() > deadline) throw new Error('the knight never reached the dungeon');
      await hold(BUTTON.left);
      await page.waitForTimeout(150);
      await hold(0);
      await page.waitForTimeout(50);
    }

    expect(await cart(page)).toMatchObject({ full: 'p8_playarea', width: 1024 });
  });

  test('pressed before the cart has started, it starts the cart', async ({ page }) => {
    await loaded(page);
    await button(page).click();
    await expect.poll(async () => (await cart(page)).full).toBe('p8_playarea');
    await expect.poll(() => canvasWidth(page), { timeout: 15_000 }).toBe(1024);
  });

  test('Tab reaches it before the cart, which swallows Tab', async ({ page }) => {
    await loaded(page);
    // The last cart on the shelf, which comes right before the handheld's bottom row
    await page.getByRole('button', { name: /Gem-in-Eye/ }).focus();
    await page.keyboard.press('Tab');
    await expect(button(page)).toBeFocused();
  });

  test('it needs a cart', async ({ page }) => {
    await loaded(page);
    await page.getByRole('button', { name: 'Eject' }).click();
    await expect(button(page)).toBeDisabled();
  });
});
