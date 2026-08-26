// Keyboard access to the cart switcher.
//
// This file exists because of a specific bug: every control was reachable in Chromium and
// completely unreachable in Safari. WebKit leaves buttons and links out of the tab order
// unless macOS keyboard navigation is enabled, so Tab cycled the iframe and body only. An
// explicit tabIndex={0} — which looks redundant on a <button> and is the obvious thing to
// delete — is what fixes it. These run against both engines so removing it fails CI rather
// than shipping a mouse-only page to half the visitors.

import { test, expect } from '@playwright/test';

const cards = '[aria-label="Choose a cart"] button';

/** What currently has focus, as something readable in a failure message. */
const focused = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return 'null';
    if (a.tagName === 'IFRAME') return 'IFRAME';
    return `${a.tagName}:${(a.textContent || '').trim().slice(0, 20)}`;
  });

test.describe('keyboard', () => {
  // Skipped on the touch project because it is the SAME WebKit engine as the `webkit`
  // project — tab order would be identical, so it would cost runtime for no new coverage.
  // Not because keyboards are impossible on mobile.
  test.skip(({ isMobile }) => !!isMobile, 'duplicate engine coverage — see the webkit project');

  test('Tab reaches both cart cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(cards)).toHaveCount(2);

    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.push(await focused(page));
    }

    // Not asserting exact positions — the theme toggle's button count is not this file's
    // business. What matters is that both cards are in the order at all.
    expect(seen.join(' | ')).toContain('Tic-Tac-Toe');
    expect(seen.join(' | ')).toContain('Connect Four');
  });

  test('a focused card shows a visible focus ring', async ({ page }) => {
    await page.goto('/');
    const ttt = page.getByRole('button', { name: /Tic-Tac-Toe/ });
    await ttt.focus();

    const ring = await ttt.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    // Focus that moves invisibly is indistinguishable from a keyboard that does nothing —
    // the exact symptom this project mistook for a broken switcher.
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThan(0);
  });

  test('Enter on a focused card switches the cart', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);

    await page.getByRole('button', { name: /Connect Four/ }).focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
    await expect(page.getByRole('button', { name: /Connect Four/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the loaded cart is announced to assistive tech', async ({ page }) => {
    await page.goto('/');
    // The game area swaps underneath the buttons, which is silent without a live region.
    await page.getByRole('button', { name: /Connect Four/ }).click();
    await expect(page.locator('[role="status"]')).toHaveText(/Connect Four/);
  });
});
