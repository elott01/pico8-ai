// The phone's fullscreen. iPhone has no fullscreen for anything but video, so the Fullscreen
// button stretches the cart's iframe over the page instead and turns on PICO-8's own controller.
//
// It's the same iframe, because the page's poll loops are what answer the cart, so nothing here
// may reload it. And all of it runs on the export's private switches, p8_touch_detected and
// p8_allow_mobile_menu, and the numbers of its layout, so a new PICO-8 could change any of them.
//
// This engine isn't a real iPhone: it has no Safari bars and no home indicator.

import { test, expect, devices, type Page } from '@playwright/test';
import { BUTTON } from '../src/lib/buttons.ts';

const COMMENTARY = 'SEEN-FROM-THE-OVERLAY';

type Cart = Window & {
  pressed: number[];
  run?: string;
  pico8_state?: { frame_number?: number };
  pico8_buttons_event: (event: TouchEvent, step: number) => void;
};

test.skip(({ isMobile }) => !isMobile, 'the touch project only');

const button = (page: Page) => page.getByRole('button', { name: 'Fullscreen' });
const exit = (page: Page) => page.getByRole('button', { name: 'Exit', exact: true });

/** The overlay as the page and the cart's page each see it. */
const look = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const win = frame.contentWindow as Window & Cart;
    const doc = frame.contentDocument!;
    const screen = frame.parentElement!.getBoundingClientRect();
    const canvas = doc.getElementById('canvas')!;
    const box = canvas.getBoundingClientRect();
    const filter = doc.querySelector('.crt-screen')?.getBoundingClientRect();
    return {
      screen: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
      game: { x: box.x, y: box.y, width: box.width },
      filter: filter && { x: filter.x, y: filter.y, width: filter.width },
      touch: win.p8_touch_detected,
      controller: doc.getElementById('touch_controls_gfx')!.style.display,
      icons: [...doc.querySelectorAll<HTMLElement>('#p8_menu_buttons_touch .p8_menu_button')].map(
        (el) => el.style.display,
      ),
      held: win.pico8_buttons![0],
      canvasPointer: canvas.style.pointerEvents,
      run: win.run,
      inTopLayer: frame.parentElement!.matches(':popover-open'),
      handheldFilter: getComputedStyle(frame.parentElement!, '::after').content,
      hash: win.location.hash,
    };
  });

const frames = (page: Page) =>
  page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as Cart).pico8_state?.frame_number ?? 0);

/**
 * Load the page with tic-tac-toe in place of Gem-in-Eye, which it starts with, since these press
 * its board and take its turns. Then wait for the handheld, since the button stays disabled
 * until a cart is up.
 */
async function loaded(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Tic-Tac-Toe/ }).tap();
  await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);
  await expect(button(page)).toBeEnabled();
}

/** Tap the cart's play button, and mark its page, which a reload would wipe. */
async function start(page: Page) {
  await page.frameLocator('iframe').locator('#p8_start_button').tap();
  await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(30);
  await page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) => ((frame.contentWindow as Cart).run = 'same'));
}

/**
 * Tap Fullscreen and wait for the overlay to fill the viewport. The button is below the fold on a
 * phone, so the page is scrolled by now, and x and y are what catch an overlay left up the page.
 */
async function enter(page: Page) {
  await button(page).tap();
  const { width, height } = page.viewportSize()!;
  await expect.poll(async () => (await look(page)).screen).toEqual({ x: 0, y: 0, width, height });
}

/** Hold player 1's buttons through the export's hook: a tap is too short to see on the board. */
async function press(page: Page, held: number) {
  const hold = (bits: number) =>
    page.locator('iframe').evaluate((frame: HTMLIFrameElement, bits) => {
      frame.contentWindow!.pico8_buttons![0] = bits;
    }, bits);
  await hold(held);
  await page.waitForTimeout(100);
  await hold(0);
}

/** Record what PICO-8's own touch handler makes of every touch it's handed. */
const recordTouches = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const win = frame.contentWindow as Cart;
    const real = win.pico8_buttons_event;
    win.pressed = [];
    win.pico8_buttons_event = (event, step) => {
      real(event, step);
      win.pressed.push(win.pico8_buttons![0]);
    };
  });

const touches = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as Cart).pressed);

/** Where PICO-8's handler reads the right of its D-pad: three of its units in from each edge. */
function rightOfDpad(page: Page) {
  const { width, height } = page.viewportSize()!;
  const unit = Math.min(Math.min(width, height) / 12, 40);
  return { x: unit * 5, y: height - unit * 3 };
}

for (const [shape, device] of [
  ['portrait', 'iPhone 15'],
  ['landscape', 'iPhone 15 landscape'],
] as const) {
  test.describe(`held ${shape}`, () => {
    test.use({ viewport: devices[device].viewport });

    test('it fills the page in the same iframe, with the controller and without the icons', async ({ page }) => {
      await loaded(page);
      await start(page);
      const before = await look(page);
      await enter(page);

      await expect.poll(async () => (await look(page)).controller).toBe('table');
      // PICO-8 resizes the game a frame after it draws the controller
      await expect.poll(async () => (await look(page)).game.width).not.toBe(before.game.width);
      const over = await look(page);
      expect(over.inTopLayer).toBe(true);
      expect(over.touch).toBe(true);
      expect(over.run).toBe('same');
      expect(over.icons.every((display) => display === 'none')).toBe(true);
      expect(over.game.width).toBeGreaterThan(0);
      // Short of the whole window it's still the game, not a strip of PICO-8's grey
      expect(over.game.x).toBeGreaterThanOrEqual(0);
      expect(over.game.y + over.game.width).toBeLessThanOrEqual(over.screen.height);
      if (shape === 'portrait') expect(over.game.width).toBeGreaterThan(before.game.width);

      await expect(exit(page)).toBeInViewport({ ratio: 1 });
      const box = (await exit(page).boundingBox())!;
      // Exit must not sit on the game
      const clear =
        box.y >= over.game.y + over.game.width ||
        box.x >= over.game.x + over.game.width ||
        box.x + box.width <= over.game.x;
      expect(clear).toBe(true);
    });

    test('a real touch reaches the controller', async ({ page }) => {
      await loaded(page);
      await start(page);
      await enter(page);
      await recordTouches(page);

      const { x, y } = rightOfDpad(page);
      await page.touchscreen.tap(x, y);
      await expect.poll(() => touches(page)).toContain(BUTTON.right);
    });

    test('Exit puts everything back, and touches stop at the door again', async ({ page }) => {
      await loaded(page);
      await start(page);
      const before = await look(page);
      await enter(page);
      await recordTouches(page);
      await exit(page).tap();

      await expect.poll(async () => (await look(page)).screen.width).toBe(before.screen.width);
      // Held landscape the page is still scrolled to the buttons, and WebKit stops the frames of
      // an iframe out of sight, so PICO-8 only drops its controller once it's back in view
      await page.locator('iframe').scrollIntoViewIfNeeded();
      await expect.poll(async () => (await look(page)).controller).toBe('none');
      const after = await look(page);
      expect(after.game.width).toBe(before.game.width);
      expect(Math.abs(after.game.x - before.game.x)).toBeLessThan(0.5);
      expect(Math.abs(after.game.y - before.game.y)).toBeLessThan(0.5);
      expect(after.touch).toBe(false);
      expect(after.inTopLayer).toBe(false);
      expect(after.canvasPointer).toBe('');
      expect(after.run).toBe('same');
      await expect(exit(page)).toHaveCount(0);
      expect(await page.locator('iframe').getAttribute('popover')).toBeNull();

      const box = (await page.locator('iframe').boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      expect(await touches(page)).toEqual([]);
    });
  });
}

test('a finger still down when Exit is tapped is let go', async ({ page }) => {
  await loaded(page);
  await start(page);
  await enter(page);
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement, held) => {
    frame.contentWindow!.pico8_buttons![0] = held;
  }, BUTTON.left);

  await exit(page).tap();
  await expect.poll(async () => (await look(page)).held).toBe(0);
});

test('tapped before the cart has started, it starts the cart without the export’s touch boot', async ({ page }) => {
  await loaded(page);
  await enter(page);
  await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(30);

  await expect.poll(async () => (await look(page)).controller).toBe('table');
  expect((await look(page)).hash).toBe('');
  const rearranged = await page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.getElementById('body_0')?.style.display);
  expect(rearranged).not.toBe('none');
});

test('a turn taken in the overlay reaches the model, and is in the panel on the way back', async ({ page }) => {
  await page.route('**/api/move', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ move: 0, winMove: null, blockMove: null, lines: [], commentary: COMMENTARY }),
    }),
  );
  await loaded(page);
  await start(page);
  await enter(page);

  const asked = page.waitForResponse('**/api/move');
  await press(page, BUTTON.o);
  await asked;

  await exit(page).tap();
  await expect(page.getByText(COMMENTARY)).toBeVisible();
});

test("a door's load() stays in the overlay", async ({ page }) => {
  test.setTimeout(60_000);
  const ran: string[] = [];
  page.on('console', (msg) => {
    const run = /run_cart current_filename: (\w+)\.p8/.exec(msg.text());
    if (run) ran.push(run[1]!);
  });

  await page.goto('/');
  // The cart the page starts with
  await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
  await page.frameLocator('iframe').locator('#p8_start_button').tap();
  await expect.poll(() => ran, { timeout: 20_000 }).toContain('gemini');
  await enter(page);

  const deadline = Date.now() + 15_000;
  while (!ran.includes('gemini_dungeon')) {
    if (Date.now() > deadline) throw new Error('the knight never reached the dungeon');
    await press(page, BUTTON.left);
    await page.waitForTimeout(50);
  }

  const { width, height } = page.viewportSize()!;
  const over = await look(page);
  expect(over.screen).toEqual({ x: 0, y: 0, width, height });
  expect(over.controller).toBe('table');
  expect(over.touch).toBe(true);
});

test.describe('the page behind it', () => {
  /** Whether a cancellable touch event in the cart's page, or this one, comes out cancelled. */
  const cancelled = (page: Page, where: 'cart' | 'page', type: string) =>
    page.locator('iframe').evaluate(
      (frame: HTMLIFrameElement, { where, type }) => {
        const doc = where === 'cart' ? frame.contentDocument! : document;
        const event = new (doc.defaultView as Window & typeof globalThis).Event(type, {
          bubbles: true,
          cancelable: true,
        });
        doc.body.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { where, type },
    );

  const behind = (page: Page) =>
    page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
      const before = scrollY;
      scrollTo(0, before + 400);
      const moved = scrollY - before;
      scrollTo(0, before);
      const style = (el: Element) => getComputedStyle(el);
      return {
        moved,
        about: style(document.querySelector('#about')!).visibility,
        iframe: style(frame).visibility,
        background: style(document.documentElement).backgroundColor,
      };
    });

  test('it can\'t scroll, it isn\'t drawn, and it comes back where it was', async ({ page }) => {
    await loaded(page);
    await start(page);
    await button(page).scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => scrollY);
    expect(scrolled).toBeGreaterThan(0);
    await enter(page);

    const over = await behind(page);
    expect(over.moved).toBe(0);
    expect(over.about).toBe('hidden');
    expect(over.iframe).toBe('visible');
    expect(over.background).toBe('rgb(0, 0, 0)');

    await exit(page).tap();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrolled);
    const after = await behind(page);
    expect(after.moved).toBeGreaterThan(0);
    expect(after.about).toBe('visible');
  });

  // A drag above PICO-8's controller is the one it doesn't cancel for itself, and the bug this
  // guards: it ran out of the iframe and scrolled the page. Chromium's touch emulation showed it;
  // this engine can't drag, so it checks the cancel that stopped it.
  test('every touch in the cart is cancelled, until Exit', async ({ page }) => {
    await loaded(page);
    await start(page);
    expect(await cancelled(page, 'cart', 'touchmove')).toBe(false);
    await enter(page);

    for (const type of ['touchstart', 'touchmove', 'gesturestart']) {
      expect(await cancelled(page, 'cart', type), `${type} in the cart`).toBe(true);
    }
    expect(await cancelled(page, 'page', 'touchmove')).toBe(true);
    // Or Exit could never be tapped
    expect(await cancelled(page, 'page', 'touchstart')).toBe(false);

    await exit(page).tap();
    await expect(exit(page)).toHaveCount(0);
    expect(await cancelled(page, 'cart', 'touchmove')).toBe(false);
    expect(await cancelled(page, 'page', 'touchmove')).toBe(false);
  });

  test('the cart keeps running with the page hidden', async ({ page }) => {
    await loaded(page);
    await start(page);
    await enter(page);
    const before = await frames(page);
    await expect.poll(() => frames(page)).toBeGreaterThan(before + 10);
  });
});

test.describe('the CRT filter', () => {
  const choose = (page: Page, choice: 'on' | 'off') =>
    page.addInitScript((choice) => localStorage.setItem('pico-crt', choice), choice);

  test('chosen on the handheld, it sits on the game and not the whole overlay', async ({ page }) => {
    await choose(page, 'on');
    await loaded(page);
    await start(page);
    // On the handheld too, where it's the same filter, so the screen's own stays off
    await expect.poll(async () => (await look(page)).filter?.width).toBeGreaterThan(0);
    const before = await look(page);
    expect(before.filter).toEqual(before.game);
    expect(before.handheldFilter).toBe('none');
    await enter(page);

    await expect
      .poll(async () => {
        const { filter, game } = await look(page);
        return game.width !== before.game.width && filter?.width === game.width;
      })
      .toBe(true);
    const over = await look(page);
    expect(over.filter).toEqual(over.game);
    expect(over.handheldFilter).toBe('none');

    await exit(page).tap();
    await expect.poll(async () => (await look(page)).filter?.width).toBe(before.game.width);
    const after = await look(page);
    expect(after.filter).toEqual(after.game);
    expect(after.handheldFilter).toBe('none');
  });

  test('it follows the game when the phone turns', async ({ page }) => {
    await choose(page, 'on');
    await loaded(page);
    await start(page);
    await enter(page);

    const { width, height } = devices['iPhone 15 landscape'].viewport;
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await look(page)).screen).toEqual({ x: 0, y: 0, width, height });
    await expect
      .poll(async () => {
        const { filter, game } = await look(page);
        return filter?.width === game.width && filter.x === game.x && filter.y === game.y && game.x > 0;
      })
      .toBe(true);
  });

  test('left off on the handheld, the overlay has none', async ({ page }) => {
    await choose(page, 'off');
    await loaded(page);
    await start(page);
    await enter(page);
    await expect.poll(async () => (await look(page)).controller).toBe('table');
    expect((await look(page)).filter).toBeUndefined();
  });
});
