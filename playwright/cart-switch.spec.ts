// Switching carts while a turn is in flight.
//
// The bug this guards: `clearInterval` stops future poll ticks but cannot cancel one already
// suspended at an `await`. That tick still holds the OLD cart's gpio, protocol and game, so
// on resume it appended the cart-you-just-left's final turn into the new cart's empty panel —
// a phantom turn #1 carrying the previous game's commentary.
//
// No Gemini key needed. `/api/move` is stubbed in the page, which also makes the timing
// deterministic instead of hostage to a model whose p95 has been measured at 14s.
//
// Timing matters here: without the fix the phantom does NOT appear immediately. The stale
// tick spends the stubbed delay, then a further ~3.5s in readCartPlayedMove polling the
// unmounted iframe, before it appends. A "switch and glance" check clears this wrongly.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const PHANTOM = 'PHANTOM-STALE-TURN';
const MOVE_DELAY = 2000;
const cards = '[aria-label="Choose a cart"] button';

/** Make /api/move answer slowly, with a move tagged so a leak is unmistakable. */
async function stubSlowModel(page: Page) {
  await page.route('**/api/move', async (route) => {
    await new Promise((r) => setTimeout(r, MOVE_DELAY));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        move: 4,
        winMove: null,
        blockMove: null,
        lines: [],
        commentary: PHANTOM,
      }),
    });
  });
}

/**
 * Make the cart ask for a move without playing one.
 *
 * The iframe is same-origin — that is how the page reads pico8_gpio at all — so a request
 * can be staged by writing the status byte directly. Beats driving the actual game, which
 * would need a click-to-start and real input.
 */
async function stageCartRequest(page: Page) {
  // The runtime defines pico8_gpio as it boots; the iframe's `src` landing does not mean it
  // exists yet. Without this the staging throws on a fast machine and reads as a flake.
  await page.waitForFunction(
    () =>
      !!(document.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow
        ?.pico8_gpio,
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    const g = (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!
      .pico8_gpio!;
    for (let i = 1; i <= 9; i++) g[i] = 0;
    g[1] = 1; // one human mark, so it looks like a real mid-game position
    g[0] = 1; // ST_REQUEST
  });
}

test.describe('switching carts mid-turn', () => {
  test('a turn in flight never lands in the new cart\'s panel', async ({ page }) => {
    await stubSlowModel(page);
    await page.goto('/');
    await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);

    await stageCartRequest(page);
    // The poll loop runs every 100ms; wait for it to pick the request up and ack it.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!
              .pico8_gpio![0],
        ),
      )
      .toBe(2); // ST_THINKING — the page has taken the turn and is awaiting the model

    await page.locator(`${cards}:not([aria-pressed="true"])`).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);

    // Past the stubbed delay AND the read-back timeout, which is when it used to appear.
    await page.waitForTimeout(MOVE_DELAY + 4000);

    await expect(page.locator('aside')).not.toContainText(PHANTOM);
    await expect(page.locator('aside')).toContainText("Waiting for the AI's first move");
  });

  test('switching clears the previous cart\'s turn history', async ({ page }) => {
    await page.route('**/api/move', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ move: 4, lines: [], commentary: 'first cart turn' }),
      }),
    );
    await page.goto('/');
    await stageCartRequest(page);
    await expect(page.locator('aside')).toContainText('first cart turn');

    await page.locator(`${cards}:not([aria-pressed="true"])`).click();
    // Analysis from the previous cart would be rendered against the wrong board shape.
    await expect(page.locator('aside')).not.toContainText('first cart turn');
  });
});
