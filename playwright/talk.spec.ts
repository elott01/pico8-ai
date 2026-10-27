// gem-in-eye's talk loop, in a real browser against the real exported cart.
//
// No Gemini key and no `vercel dev`: /api/talk is stubbed in the page, and the test plays the
// cart's side of the handshake by writing GPIO directly — the iframe is same-origin, which is
// how the page reads pico8_gpio at all. The cart itself is never started, so nothing else
// writes those bytes. Offsets are restated by hand, as gpio-protocol.test.ts does against
// the Lua: a test that imported them would move with them.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The reply bytes and status values the assertions read (src/lib/gpio.ts, TALK_PROTOCOLS.gemini).
// The staging below writes its bytes inline, commented, because it runs inside the page.
const VERDICT = 24, PRICE = 25, FLAGS = 26, LEN = 27, TEXT = 28;
const IDLE = 0, THINKING = 2, READY = 3;

const gpioReady = (page: Page) =>
  page.waitForFunction(
    () => !!(document.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow?.pico8_gpio,
    undefined,
    { timeout: 15_000 },
  );

/** Run `fn` against the cart's GPIO array inside the page. */
const onGpio = <T,>(page: Page, fn: (g: number[], arg: unknown) => T, arg?: unknown) =>
  page.evaluate(
    ([src, a]) => {
      const g = (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!.pico8_gpio!;
      return new Function('g', 'arg', `return (${src})(g, arg)`)(g, a) as T;
    },
    [fn.toString(), arg] as const,
  );

const status = (page: Page) => onGpio(page, (g) => g[0]);

/** What the page wrote back: one page of reply. */
const reply = (page: Page) =>
  onGpio(page, (g, o) => {
    const at = o as number[];
    const [verdict, price, flags, len, text] = at;
    return { verdict: g[verdict], price: g[price], flags: g[flags], text: String.fromCharCode(...g.slice(text, text + g[len])) };
  }, [VERDICT, PRICE, FLAGS, LEN, TEXT]);

/** The cart's purchase request: 300 pruned, 8 rollbacks, 562s, buying attack 1 at list 10. */
async function stagePurchase(page: Page) {
  await onGpio(page, (g) => {
    for (let i = 1; i < 128; i++) g[i] = 0;
    g[1] = 300 & 0xff; g[2] = 300 >> 8; // pruned, 16-bit low byte first
    g[3] = 8; // rollbacks
    g[5] = 562 & 0xff; g[6] = 562 >> 8; // uptime
    g[7] = 3; g[8] = 1; g[9] = 1; g[10] = 10; // max depth, last depth, purse, stash
    g[11] = 1; g[12] = 1; // vitality 1, stamina 1
    g[16] = 2; g[17] = 4; g[18] = 1; g[19] = 10; // purchase: attack, tier 1, list 10
    g[0] = 1; // ST_REQUEST, last: payload before status
  });
}

test.describe('gem-in-eye talk loop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.getByRole('button', { name: /Gem-in-Eye/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
    await gpioReady(page);
  });

  test('a purchase gets page 1, later pages come from memory, and the panel shows the speech', async ({ page }) => {
    const calls: Record<string, unknown>[] = [];
    await page.route('**/api/talk', async (route) => {
      calls.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ verdict: 'impressed', price: 8, pages: ['page one.', 'page two.'], notice: 'zero waste.' }),
      });
    });

    await stagePurchase(page);
    await expect.poll(() => status(page)).toBe(READY);
    expect(await reply(page)).toEqual({ verdict: 1, price: 8, flags: 1, text: 'page one.' });

    // The request carried the stats decoded from the cart's bytes, and a fresh agent number.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      occasion: 'purchase',
      purchase: { item: 'attack', tier: 1, listPrice: 10 },
      stats: { pruned: 300, rollbacks: 8, uptimeSec: 562, maxDepth: 3, lastDepth: 1, purse: 1, stashed: 10 },
      memory: { lastSpeeches: [], lastStats: null, newSession: false },
    });

    // The cart's side: charge the quote, keep the speech, return to idle.
    await onGpio(page, (g) => { g[25] = 8; g[0] = 0; });
    await expect(page.locator('aside')).toContainText('page one. page two.');
    await expect(page.locator('aside')).toContainText('impressed');
    await expect(page.locator('aside')).toContainText('8/10 tokens');

    // Page 2: the cart asks again with occasion 3, and the page answers without a call.
    await onGpio(page, (g) => { g[16] = 3; g[0] = 1; });
    await expect.poll(() => status(page)).toBe(READY);
    expect(await reply(page)).toMatchObject({ flags: 0, text: 'page two.' });
    expect(calls).toHaveLength(1);

    // Remembered, for the next purchase's prompt.
    const memory = await page.evaluate(() => JSON.parse(localStorage.getItem('pico-ai:memory')!));
    expect(memory.speakers['gem-in-eye'].lastSpeeches).toEqual(['page one. page two.']);
  });

  test('a failed call answers with the fallback, and the panel says so', async ({ page }) => {
    await page.route('**/api/talk', (route) => route.fulfill({ status: 500, body: '{}' }));

    await stagePurchase(page);
    await expect.poll(() => status(page)).toBe(READY);
    // An empty page with no quote: the cart sells at list with its own line.
    expect(await reply(page)).toEqual({ verdict: 0, price: 0, flags: 0, text: '' });

    await onGpio(page, (g) => { g[25] = 10; g[27] = 0; g[0] = 0; });
    await expect(page.locator('aside')).toContainText('Model unavailable');
    await expect(page.locator('aside')).not.toContainText('impressed');

    const memory = await page.evaluate(() => JSON.parse(localStorage.getItem('pico-ai:memory')!));
    expect(memory.speakers['gem-in-eye'].lastSpeeches).toEqual([]);
  });

  test('a reply that arrives after the cart stopped waiting is dropped, not written', async ({ page }) => {
    await page.route('**/api/talk', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ verdict: 'neutral', price: 10, pages: ['too late.'], notice: null }),
      });
    });

    await stagePurchase(page);
    await expect.poll(() => status(page)).toBe(THINKING);
    // The cart gives up while the request is out: it sells at list, writes its read-back,
    // and returns to idle.
    await onGpio(page, (g) => { g[25] = 10; g[27] = 0; g[0] = 0; });

    await expect(page.locator('aside')).toContainText('after the cart stopped waiting');
    expect(await status(page)).toBe(IDLE);
    expect((await reply(page)).text).toBe('');
  });
});
