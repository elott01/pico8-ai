// Gem-in-Eye's doors, in a real browser against the real export.
//
// carts/gemini.p8 (the hub) and carts/gemini_dungeon.p8 hand the run to each other with
// load(), and nothing else in either suite runs one: tests/cart-bundle.test.ts checks that the
// export carries both carts, not that a door gets you between them. A load() naming a cart the
// export doesn't hold, or a cart crashing as it arrives, would pass everything else.
//
// Unlike the other files, this one starts the cart and plays it. Each door is beside where you
// arrive, so holding one direction is enough. PICO-8's web runtime logs every cart it runs
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

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The order of load()'s param, read from the hub's Lua as gpio-protocol.test.ts reads its own
const hub = readFileSync(new URL('../carts/gemini.p8', import.meta.url), 'utf8');
const carry = /^carry = split"([^"]+)"/m.exec(hub)![1]!.split(',');

// Player 1's bits in pico8_buttons, as btn() numbers them
const LEFT = 1 << 0;
const RIGHT = 1 << 1;

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

/** Walk one way until the runtime starts `cart`, which means the knight took a door. */
async function walkInto(page: Page, runs: Run[], direction: number, cart: string): Promise<Run> {
  const before = runs.length;
  const arrived = () => runs.slice(before).find((r) => r.cart === cart);
  const deadline = Date.now() + 15_000;
  try {
    // 150ms held is about 4 pixels; a door is under 8 from where you arrive
    while (!arrived()) {
      if (Date.now() > deadline) throw new Error(`walking with button ${direction} never loaded ${cart}.p8`);
      await hold(page, direction);
      await page.waitForTimeout(150);
      await hold(page, 0);
      await page.waitForTimeout(50);
    }
  } finally {
    await hold(page, 0);
  }
  return arrived()!;
}

test.describe('gem-in-eye doors', () => {
  // The touch project runs the same WebKit as the webkit project, so it would add nothing
  test.skip(({ isMobile }) => !!isMobile, 'duplicate engine coverage — see the webkit project');

  test('the knight walks into the dungeon, home, and back in, carrying the run', async ({ page }) => {
    test.setTimeout(60_000);
    const runs = watchRuns(page);
    await page.goto('/');
    await page.getByRole('button', { name: /Gem-in-Eye/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
    // The export waits for a click before it starts
    await page.frameLocator('iframe').locator('#p8_start_button').click();
    await expect
      .poll(() => runs.map((r) => r.cart), { message: 'the hub never booted', timeout: 20_000 })
      .toContain('gemini');

    // The dungeon door is on the hub's left; the way home is on the dungeon's right
    const down = await walkInto(page, runs, LEFT, 'gemini_dungeon');
    const home = await walkInto(page, runs, RIGHT, 'gemini');
    const again = await walkInto(page, runs, LEFT, 'gemini_dungeon');

    // Entering the dungeon starts a run at depth 1. The dungeon hands that home, and the hub,
    // reloaded from scratch, hands it back down, so the run survived both directions
    expect(value(down, 'max_depth')).toBe('0');
    expect(value(home, 'max_depth')).toBe('1');
    expect(value(again, 'max_depth')).toBe('1');
    // time() restarts with each cart, so uptime only grows if every load carried it
    expect(Number(value(again, 'up'))).toBeGreaterThan(Number(value(down, 'up')));
  });
});
