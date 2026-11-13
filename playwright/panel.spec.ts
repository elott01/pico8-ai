// The Gemini panel before its first card: each cart's own intro, which stays through the
// first "Gemini is thinking…" without its action, and goes when the first card lands.
//
// The words live in src/lib/carts.ts and are restated here by hand. A spec that imported them
// would move with them, and each one is a promise about what that cart's card shows.
//
// No Gemini key needed: /api/move is stubbed in the page, and the request is staged by
// writing pico8_gpio directly, as cart-switch.spec.ts does.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const panel = (page: Page) => page.locator('aside');

/** Make the cart ask for a move without playing one. See cart-switch.spec.ts. */
async function stageCartRequest(page: Page) {
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

test('each cart opens the panel with its own intro', async ({ page }) => {
  // Along the shelf, from Gem-in-Eye, which the page starts with
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveAttribute('src', /gemini/);
  await expect(panel(page)).toContainText('Buy something in the shop.');
  // The talk card's own headings, so the first real card is recognisable
  await expect(panel(page)).toContainText('noticed:');
  await expect(panel(page)).toContainText('what he was shown:');
  await expect(panel(page)).not.toContainText('reasoning:');

  await page.getByRole('button', { name: /Connect Four/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
  await expect(panel(page)).toContainText('Drop your first piece.');
  await expect(panel(page)).toContainText('in one sentence of its own');
  await expect(panel(page)).toContainText('picks a full column');
  await expect(panel(page)).not.toContainText('what he was shown:');

  await page.getByRole('button', { name: /Tic-Tac-Toe/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);
  await expect(panel(page)).toContainText('Make your first move.');
  await expect(panel(page)).toContainText('Gemini plays O');
  await expect(panel(page)).toContainText('reasoning:');
  await expect(panel(page)).toContainText('picks a taken cell');
  await expect(panel(page)).not.toContainText('in one sentence of its own');
});

test('the intro stays through the first think without its action, and goes with the first card', async ({
  page,
}) => {
  await page.route('**/api/move', async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ move: 4, winMove: null, blockMove: null, lines: [], commentary: 'FIRST-CARD' }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Tic-Tac-Toe/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);
  await stageCartRequest(page);

  await expect(panel(page).getByRole('status')).toHaveText('Gemini is thinking…');
  await expect(panel(page)).toContainText('Gemini plays O');
  // Done by now, so no longer an instruction
  await expect(panel(page)).not.toContainText('Make your first move.');

  await expect(panel(page)).toContainText('FIRST-CARD');
  await expect(panel(page)).not.toContainText('Gemini plays O');
});
