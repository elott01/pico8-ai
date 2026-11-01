// The handheld's D-pad and O/X keys. They press the cart's buttons through pico8_buttons[0],
// the export's hook for on-page controls, and on a touch screen they are the controls: PICO-8's
// own touch layout is kept from switching on. They also move with the keyboard.

import { test, expect, type Page } from '@playwright/test';

const CONTROLS = [
  ['Up', 1 << 2],
  ['Down', 1 << 3],
  ['Left', 1 << 0],
  ['Right', 1 << 1],
  ['O button', 1 << 4],
  ['X button', 1 << 5],
] as const;

const control = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Player 1's button bits as the cart sees them. */
const held = (page: Page) =>
  page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) => frame.contentWindow!.pico8_buttons![0]);

/** Load the page and wait for the cart: the controls are disabled until it's up. */
async function loaded(page: Page) {
  await page.goto('/');
  await expect(control(page, 'Left')).toBeEnabled();
}

/** A pointer going down or up on a control, as a finger would; ids keep fingers apart. */
const finger = (page: Page, name: string, type: 'pointerdown' | 'pointerup', pointerId: number) =>
  control(page, name).dispatchEvent(type, { pointerId, button: 0, pointerType: 'touch', isPrimary: pointerId === 1 });

test.describe('the D-pad and keys', () => {
  // Mouse-driven; the touch project has its own test below
  test.skip(({ isMobile }) => !!isMobile, 'covered by the touch test');

  test('holding a control holds its button, and letting go releases it', async ({ page }) => {
    await loaded(page);
    for (const [name, bit] of CONTROLS) {
      await control(page, name).hover();
      await page.mouse.down();
      expect(await held(page), `${name} down`).toBe(bit);
      await page.mouse.up();
      expect(await held(page), `${name} up`).toBe(0);
    }
  });

  test('two held at once hold both', async ({ page }) => {
    await loaded(page);
    await finger(page, 'Left', 'pointerdown', 1);
    await finger(page, 'O button', 'pointerdown', 2);
    expect(await held(page)).toBe((1 << 0) | (1 << 4));
    await finger(page, 'Left', 'pointerup', 1);
    expect(await held(page)).toBe(1 << 4);
    await finger(page, 'O button', 'pointerup', 2);
    expect(await held(page)).toBe(0);
  });

  test('a press leaves focus in the cart, so its keys keep working', async ({ page }) => {
    await loaded(page);
    await page.locator('iframe').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

    await control(page, 'Right').hover();
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  });

  test('a press with no pointer, from a keyboard or screen reader, taps the button', async ({ page }) => {
    await loaded(page);
    // A click event with detail 0, which is what Enter, Space and screen readers send
    await control(page, 'X button').dispatchEvent('click');
    expect(await held(page)).toBe(1 << 5);
    await expect.poll(() => held(page)).toBe(0);
  });

  test('changing carts lets go of everything', async ({ page }) => {
    await loaded(page);
    await finger(page, 'Up', 'pointerdown', 1);
    await expect(control(page, 'Up')).toHaveClass(/held/);

    await page.getByRole('button', { name: /Connect Four/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
    await expect(control(page, 'Up')).not.toHaveClass(/held/);
    await expect(control(page, 'Left')).toBeEnabled();
    expect(await held(page)).toBe(0);
  });

  test('with the slot empty, the controls are disabled', async ({ page }) => {
    await loaded(page);
    await page.getByRole('button', { name: 'Eject' }).click();
    for (const [name] of CONTROLS) await expect(control(page, name)).toBeDisabled();
  });
});

// The keyboard goes straight to the cart, so here the controls only draw it. Which keys press
// which button was measured on running carts: every key below lands, and none of player 2's do.
test.describe('the keyboard', () => {
  test.skip(({ isMobile }) => !!isMobile, 'no keyboard');

  const KEYS = [
    ['ArrowUp', 'Up'],
    ['ArrowDown', 'Down'],
    ['ArrowLeft', 'Left'],
    ['ArrowRight', 'Right'],
    ['z', 'O button'],
    ['c', 'O button'],
    ['n', 'O button'],
    ['x', 'X button'],
    ['v', 'X button'],
    ['m', 'X button'],
  ] as const;

  /** Load the page with focus in the cart, where the keys go. */
  async function focused(page: Page) {
    await loaded(page);
    await page.locator('iframe').focus();
  }

  test('a held key draws its control pressed, and leaves the cart its own input', async ({ page }) => {
    await focused(page);
    for (const [key, name] of KEYS) {
      await page.keyboard.down(key);
      await expect(control(page, name), `${key} down`).toHaveClass(/held/);
      expect(await held(page), `${key} down`).toBe(0);
      await page.keyboard.up(key);
      await expect(control(page, name), `${key} up`).not.toHaveClass(/held/);
    }
  });

  test("player 2's keys draw nothing", async ({ page }) => {
    await focused(page);
    await page.keyboard.down('s');
    await page.keyboard.down('q');
    await page.waitForTimeout(100);
    for (const [name] of CONTROLS) await expect(control(page, name)).not.toHaveClass(/held/);
  });

  test('two keys on one control hold it until both are up', async ({ page }) => {
    await focused(page);
    await page.keyboard.down('z');
    await page.keyboard.down('c');
    await page.keyboard.up('z');
    await page.waitForTimeout(100);
    await expect(control(page, 'O button')).toHaveClass(/held/);
    await page.keyboard.up('c');
    await expect(control(page, 'O button')).not.toHaveClass(/held/);
  });

  test('a key and a click on one control hold it until both are up', async ({ page }) => {
    await focused(page);
    await page.keyboard.down('ArrowRight');
    await control(page, 'Right').hover();
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);
    await expect(control(page, 'Right')).toHaveClass(/held/);
    await page.keyboard.up('ArrowRight');
    await expect(control(page, 'Right')).not.toHaveClass(/held/);
  });

  test('a key pressed outside the cart draws nothing, since the cart never got it', async ({ page }) => {
    await loaded(page);
    await page.getByRole('button', { name: 'Eject' }).focus();
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await expect(control(page, 'Left')).not.toHaveClass(/held/);
  });

  test('focus leaving the cart lets go, since the release would go elsewhere', async ({ page }) => {
    await focused(page);
    await page.keyboard.down('ArrowUp');
    await expect(control(page, 'Up')).toHaveClass(/held/);
    await page.getByRole('button', { name: 'Eject' }).focus();
    await expect(control(page, 'Up')).not.toHaveClass(/held/);
  });

  // A click with focus staying in the cart, as a tap can on a tablet with a keyboard. A mouse
  // click would blur the cart first, and the test above would be all this checks.
  test('changing carts lets go of a held key', async ({ page }) => {
    await focused(page);
    await page.keyboard.down('ArrowUp');
    await expect(control(page, 'Up')).toHaveClass(/held/);

    await page.getByRole('button', { name: /Connect Four/ }).dispatchEvent('click');
    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
    await expect(control(page, 'Up')).not.toHaveClass(/held/);
  });

  test('a key held under Cmd draws nothing, since macOS never sends its release', async ({ page }) => {
    await focused(page);
    await page.keyboard.down('Meta');
    await page.keyboard.down('z');
    await page.waitForTimeout(100);
    await expect(control(page, 'O button')).not.toHaveClass(/held/);
  });
});

test('a tap on the cart starts it without PICO-8 switching to its touch layout', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'needs a touch-enabled context');
  await loaded(page);
  await page.frameLocator('iframe').locator('#p8_start_button').tap();

  // Started: the tap still clicked the play button
  await expect
    .poll(() =>
      page
        .locator('iframe')
        .evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.getElementById('canvas')!.offsetWidth),
    )
    .toBeGreaterThan(0);
  // But PICO-8 never saw the touch, so it kept its normal layout and drew no controller
  const touched = await page
    .locator('iframe')
    .evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as unknown as { p8_touch_detected: boolean }).p8_touch_detected);
  expect(touched).toBe(false);
});
