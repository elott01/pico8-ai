// POWER comes on when the cart's page loads, however late React gets round to its effects.
//
// The bug this guards: Pico8Game reset the cart's status to 'loading' in a passive effect, which
// runs after paint, and the iframe's onLoad set 'ready'. When the cart's page loaded first, the
// reset landed on top of 'ready' and nothing set it back: the game was drawn on the screen, and
// POWER, the handheld's buttons and both poll loops stayed off for good. Only WebKit in CI was
// slow enough to lose that race, about one load in three, so it read as flaky tests.
//
// Here it's lost every time, not by chance: React's scheduler, which runs passive effects, posts
// to itself through MessageChannel, and the top page's messages are held back a second. The cart's
// page is a separate window with its own MessageChannel, so PICO-8 isn't slowed.

import { test, expect } from '@playwright/test';

const HELD_MS = 1000;

test('POWER comes on even when the cart loads before React runs its effects', async ({ page }) => {
  await page.addInitScript((held) => {
    if (window !== window.top) return;
    const Channel = window.MessageChannel;
    window.MessageChannel = class extends Channel {
      constructor() {
        super();
        const deliver = (port: MessagePort) => {
          const post = port.postMessage.bind(port);
          port.postMessage = ((...args: Parameters<MessagePort['postMessage']>) =>
            void setTimeout(() => post(...args), held)) as MessagePort['postMessage'];
        };
        deliver(this.port1);
        deliver(this.port2);
      }
    };
  }, HELD_MS);

  await page.goto('/');
  // Wait until the cart's page has loaded, which is before React's held-back effects have run.
  // Its own page, not the blank one an iframe holds before it.
  await expect
    .poll(() =>
      page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
        const doc = frame.contentDocument;
        return doc?.location.pathname.startsWith('/games/') && doc.readyState === 'complete';
      }),
    )
    .toBe(true);
  // Then past the hold, so the reset has had its chance to land on top
  await page.waitForTimeout(HELD_MS * 2);

  await expect(page.getByRole('button', { name: 'Eject' })).toBeEnabled();
});
