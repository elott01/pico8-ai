// The handheld's D-pad and O/X keys. They press the cart's buttons through pico8_buttons[0],
// the export's hook for on-page controls, and on a touch screen they are the controls: PICO-8's
// own touch layout is kept from switching on.

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
