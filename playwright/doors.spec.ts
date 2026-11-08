// Gem-in-Eye's doors, in a real browser against the real export.
//
// carts/gemini.p8 (the hub) and carts/gemini_dungeon.p8 hand the run to each other with
// load(), and nothing else in either suite runs one: tests/cart-bundle.test.ts checks that the
// export carries both carts, not that a door gets you between them. A load() naming a cart the
// export doesn't hold, or a cart crashing as it arrives, would pass everything else. There are
// two ways home, walking out and dying, and they are separate code paths, so each has a test.
//
// Unlike the other files, this one starts the cart and plays it. Each dungeon door is beside
// where you arrive, so holding one direction is enough. PICO-8's web runtime logs every cart it runs
// (`run_cart current_filename: <cart>.p8`) just after the param that load() handed it
// (`param_str_pending: ...`), so the switches and the run they carry are read off the console.
// If a PICO-8 update stops logging that, this fails rather than passing.
//
// Input races the doors. Whatever changes while a cart is loading is lost: a key released then
// stays held in the next cart, and one pressed then never arrives. A keyboard-driven version
// passed about seven runs in ten. So the knight is steered through `pico8_buttons`, the
// export's button state, which the runtime takes up when it changes. It is one number, so the
// first change a cart sees replaces anything stale, and the walk keeps changing it, on and off,
// until a door takes him. (A player can hit the same race by letting go of a key mid-load.)
//
// The hub's third door, up into gem-in-eye's shop, loads nothing: the shop is a scene inside the
// hub. So its test can't read the console, and watches the screen for the shop's backdrop.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readLabelPng } from '../scripts/cart-label.ts';

// The order of load()'s param, read from the hub's Lua as gpio-protocol.test.ts reads its own
const hub = readFileSync(new URL('../carts/gemini.p8', import.meta.url), 'utf8');
const carry = /^carry = split"([^"]+)"/m.exec(hub)![1]!.split(',');

// Player 1's bits in pico8_buttons, as btn() numbers them
const LEFT = 1 << 0;
const RIGHT = 1 << 1;
const UP = 1 << 2;
const O = 1 << 4;

type Run = { cart: string; param: string[] };

/** Every cart the runtime starts, in order, with the param it was handed. */
function watchRuns(page: Page): Run[] {
  const runs: Run[] = [];
  let param: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    const pending = /param_str_pending: (\S*)/.exec(text);
    if (pending) param = pending[1]!.split(',');
    const run = /run_cart current_filename: (\w+)\.p8/.exec(text);
    if (run) runs.push({ cart: run[1]!, param });
  });
  return runs;
}

const value = (run: Run, key: string): string | undefined => run.param[carry.indexOf(key)];

/** Hold player 1's buttons, as a bitfield; 0 lets go of everything. */
const hold = (page: Page, buttons: number) =>
  page.evaluate((b) => {
    const cart = (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!;
    (cart as unknown as { pico8_buttons: number[] }).pico8_buttons[0] = b;
  }, buttons);

// The shop draws its backdrop, the hub's sprites 128-255, over the top half of the screen. Its
// left shelves are compared, which gem-in-eye never covers, so art edits don't break this. PICO-8
// leaves the sheet's trailing blank rows out of the file, hence the padding
const gfx = /^__gfx__\n([\s\S]*?)^__/m.exec(hub)![1]!.split('\n');
const backdrop = (x: number, y: number) => (gfx[64 + y] ?? '').padEnd(128, '0')[x];

/** How much of the screen's top-left 32 x 64 shows the shop's backdrop, from 0 to 1. */
async function backdropShare(page: Page): Promise<number> {
  const url = await page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) =>
      (frame.contentDocument!.getElementById('canvas') as HTMLCanvasElement).toDataURL(),
    );
  const screen = readLabelPng(Buffer.from(url.split(',')[1]!, 'base64'));
  let same = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) if (screen[y * 128 + x] === backdrop(x, y)) same++;
  return same / (32 * 64);
}

// The candles flicker, a few of those pixels, so the shop shows a little under 1
const inShop = async (page: Page) => (await backdropShare(page)) > 0.95;

/** Press `buttons`, on and off as pressUntil does, for `ms` or until `seen` says so. */
async function pressFor(page: Page, buttons: number, ms: number, seen = async () => false): Promise<boolean> {
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      await hold(page, buttons);
      await page.waitForTimeout(150);
      await hold(page, 0);
      await page.waitForTimeout(50);
      if (await seen()) return true;
    }
    return false;
  } finally {
    await hold(page, 0);
  }
}

/**
 * Press `buttons`, on and off, until the runtime starts `cart`. With a direction, that means
 * the knight walked through a door.
 */
async function pressUntil(page: Page, runs: Run[], buttons: number, cart: string, timeout = 15_000): Promise<Run> {
  const before = runs.length;
  const arrived = () => runs.slice(before).find((r) => r.cart === cart);
  const deadline = Date.now() + timeout;
  try {
    // 150ms held is about 4 pixels; a door is under 8 from where you arrive
    while (!arrived()) {
      if (Date.now() > deadline) throw new Error(`pressing button ${buttons} never loaded ${cart}.p8`);
      await hold(page, buttons);
      await page.waitForTimeout(150);
      await hold(page, 0);
      await page.waitForTimeout(50);
    }
  } finally {
    await hold(page, 0);
  }
  return arrived()!;
}

/** Open Gem-in-Eye, start it, and wait for the hub. Returns the runs as they come in. */
async function startHub(page: Page): Promise<Run[]> {
  const runs = watchRuns(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Gem-in-Eye/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
  // The export waits for a click before it starts
  await page.frameLocator('iframe').locator('#p8_start_button').click();
  await expect
    .poll(() => runs.map((r) => r.cart), { message: 'the hub never booted', timeout: 20_000 })
    .toContain('gemini');
  return runs;
}

test.describe('gem-in-eye doors', () => {
  // The touch project runs the same WebKit as the webkit project, so it would add nothing
  test.skip(({ isMobile }) => !!isMobile, 'duplicate engine coverage — see the webkit project');

  test('the knight walks into the dungeon, home, and back in, carrying the run', async ({ page }) => {
    test.setTimeout(60_000);
    const runs = await startHub(page);

    // The dungeon door is on the hub's left; the way home is on the dungeon's right
    const down = await pressUntil(page, runs, LEFT, 'gemini_dungeon');
    const home = await pressUntil(page, runs, RIGHT, 'gemini');
    const again = await pressUntil(page, runs, LEFT, 'gemini_dungeon');

    // Entering the dungeon starts a run at depth 1. The dungeon hands that home, and the hub,
    // reloaded from scratch, hands it back down, so the run survived both directions
    expect(value(down, 'max_depth')).toBe('0');
    expect(value(home, 'max_depth')).toBe('1');
    expect(value(again, 'max_depth')).toBe('1');
    // time() restarts with each cart, so uptime only grows if every load carried it
    expect(Number(value(again, 'up'))).toBeGreaterThan(Number(value(down, 'up')));
  });

  test('dying in the dungeon rolls back to the hub, which carries the rollback', async ({ page }) => {
    test.setTimeout(90_000);
    const runs = await startHub(page);
    await pressUntil(page, runs, LEFT, 'gemini_dungeon');

    // The knight stands still. Depth 1 wakes one dead weight at least 40px off, which walks over
    // and takes his three hearts in a few seconds. 🅾️ does nothing while he's alive, so it's
    // pressed from the start and rolls back as soon as he dies. With no direction held, only
    // dying can load the hub
    const rollback = await pressUntil(page, runs, O, 'gemini', 45_000);
    const again = await pressUntil(page, runs, LEFT, 'gemini_dungeon');

    expect(value(rollback, 'rollbacks')).toBe('1');
    // a rollback refills him, and drops the purse (empty here: he never picked a token up)
    expect(value(rollback, 'health')).toBe(value(rollback, 'health_max'));
    expect(value(rollback, 'tokens')).toBe('0');
    // the hub, reloaded from scratch, hands the count back down
    expect(value(again, 'rollbacks')).toBe('1');
  });

  test('the knight walks up through the shop door to gem-in-eye, and back out under it', async ({ page }) => {
    test.setTimeout(60_000);
    await startHub(page);

    // The shop's door is in the middle of the top wall, and a door only takes him when he's lined
    // up with it. So he climbs the left wall first, then holds up and right together: he slides
    // along the top wall, and in the frame he reaches the door's column, up takes him in
    await pressFor(page, UP, 4_000);
    expect(await pressFor(page, UP | RIGHT, 15_000, () => inShop(page)), 'the shop never opened').toBe(true);

    // 🅾️ leaves, and puts him a tile below the door, so up takes him straight back in
    await pressFor(page, O, 200);
    await expect.poll(() => backdropShare(page), { message: 'the shop never closed' }).toBeLessThan(0.6);
    expect(await pressFor(page, UP, 10_000, () => inShop(page)), 'the door didn’t take him back in').toBe(true);
  });
});
