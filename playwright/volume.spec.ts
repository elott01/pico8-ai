// The handheld's volume slider. It's a gain the page puts between PICO-8 and the speakers
// (src/lib/volume.ts), so the sound checks here listen to what reaches the speakers, while
// tic-tac-toe plays the sound its cursor makes. The routing on its own is tests/volume.test.ts.

import { test, expect, type Page } from '@playwright/test';
import { BUTTON } from '../src/lib/buttons.ts';
import { BOOT_MS } from './_ci.ts';

type CartWindow = Window & {
  pico8_buttons: number[];
  pico8_state?: { frame_number?: number };
  pico8_audio_context?: BaseAudioContext & { heard?: AnalyserNode };
};

test.skip(({ isMobile }) => !!isMobile, 'a phone’s shell has no slider: it has volume buttons on its side');
// Full size, so the whole handheld is in the window to be clicked
test.beforeEach(({ page }) => page.setViewportSize({ width: 1400, height: 1200 }));

const slider = (page: Page) => page.getByRole('slider', { name: 'Volume' });

/**
 * Hears what reaches the speakers: every connection to a destination in the cart's page is
 * copied to an analyser on its context. This is in place before the page's own routing, which
 * wraps it, so it hears the slider's gain. Were that gain missing, or put in too late, it would
 * hear PICO-8 at full volume.
 *
 * It goes into every frame but the page itself, at the iframe's first, blank document: Chromium
 * keeps that window for the cart's page and doesn't run this again there, while WebKit runs it
 * for both, so it marks the prototype it has wrapped.
 */
const listen = (page: Page) =>
  page.addInitScript(() => {
    type Listening = { listening?: boolean };
    if (window === window.top || (AudioNode.prototype as Listening).listening) return;
    (AudioNode.prototype as Listening).listening = true;
    type Connect = (this: AudioNode, to: AudioNode | AudioParam, ...rest: number[]) => AudioNode | void;
    const connect = AudioNode.prototype.connect as Connect;
    AudioNode.prototype.connect = function (this: AudioNode, to: AudioNode | AudioParam, ...rest: number[]) {
      if (to instanceof AudioDestinationNode) {
        const context = this.context as BaseAudioContext & { heard?: AnalyserNode };
        context.heard ??= context.createAnalyser();
        connect.call(this, context.heard);
      }
      return connect.call(this, to, ...rest);
    } as AudioNode['connect'];
  });

/** Put tic-tac-toe in place of Gem-in-Eye, which the page starts with and has no sound yet. */
async function insertTicTacToe(page: Page) {
  await page.getByRole('button', { name: /Tic-Tac-Toe/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /tic_tac_toe/);
}

/** Press the cart's play button and wait until it's running. */
async function start(page: Page) {
  await page.frameLocator('iframe').locator('#p8_start_button').click();
  await expect
    .poll(() =>
      page.locator('iframe').evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as CartWindow).pico8_state?.frame_number ?? 0),
      { timeout: BOOT_MS },
    )
    .toBeGreaterThan(30);
}

/** The loudest sample to reach the speakers in the 800ms after a press of `button`, or -1 if
 *  nothing has been connected to them yet. */
const loudest = (page: Page, button: number) =>
  page.locator('iframe').evaluate(
    (frame: HTMLIFrameElement, button: number) =>
      new Promise<number>((resolve) => {
        const win = frame.contentWindow as CartWindow;
        const heard = win.pico8_audio_context?.heard;
        if (!heard) return resolve(-1);
        const samples = new Float32Array(heard.fftSize);
        let peak = 0;
        win.pico8_buttons[0] = button;
        setTimeout(() => (win.pico8_buttons[0] = 0), 120);
        const listening = setInterval(() => {
          heard.getFloatTimeDomainData(samples);
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        }, 10);
        setTimeout(() => {
          clearInterval(listening);
          resolve(peak);
        }, 800);
      }),
    button,
  );

/** Moves tic-tac-toe's cursor, right and left in turn so that every press moves it, and says
 *  how loud its sound came out. */
function cursor(page: Page) {
  let right = false;
  return () => loudest(page, (right = !right) ? BUTTON.right : BUTTON.left);
}

/** Where on the page the nub's middle is at `percent`, and the slot's middle line. */
async function along(page: Page, percent: number) {
  const slot = (await page.locator('[class*="volumeSlot"]').boundingBox())!;
  const nub = (await page.locator('[class*="volumeNub"]').boundingBox())!;
  return { x: slot.x + nub.width / 2 + ((slot.width - nub.width) * percent) / 100, y: slot.y + slot.height / 2 };
}

/** Silence: the speakers are connected, and nothing reached them. */
async function silent(move: () => Promise<number>) {
  const peak = await move();
  expect(peak).toBeGreaterThanOrEqual(0);
  expect(peak).toBeLessThan(0.001);
}

/** Click the slot at `percent`, as a mouse would, and give the gain a moment to ease there. */
async function point(page: Page, percent: number) {
  const { x, y } = await along(page, percent);
  await page.mouse.click(x, y);
  await expect(slider(page)).toHaveValue(String(percent));
  await page.waitForTimeout(200);
}

test('the keys move it a step at a time, and the setting is kept', async ({ page }) => {
  await page.goto('/');
  await slider(page).focus();
  await expect(slider(page)).toHaveValue('100');

  await page.keyboard.press('Home');
  await expect(slider(page)).toHaveValue('0');
  const slot = (await page.locator('[class*="volumeSlot"]').boundingBox())!;
  const nub = page.locator('[class*="volumeNub"]');
  expect((await nub.boundingBox())!.x).toBeCloseTo(slot.x, 0);

  await page.keyboard.press('ArrowRight');
  await expect(slider(page)).toHaveValue('5');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', '5%');

  await page.reload();
  await expect(slider(page)).toHaveValue('5');
});

test('a drag moves it, and leaves the keyboard in the cart', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Eject' })).toBeEnabled();
  await page.locator('iframe').click();

  const from = await along(page, 100);
  const to = await along(page, 50);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect(slider(page)).toHaveValue('50');
  const slot = (await page.locator('[class*="volumeSlot"]').boundingBox())!;
  const nub = (await page.locator('[class*="volumeNub"]').boundingBox())!;
  expect(nub.x + nub.width / 2).toBeCloseTo(slot.x + slot.width / 2, 0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
});

test('it turns the cart’s sound down, and off at 0', async ({ page }) => {
  await listen(page);
  await page.goto('/');
  await insertTicTacToe(page);
  await start(page);
  const move = cursor(page);

  let full = 0;
  await expect.poll(async () => (full = await move()), { timeout: 15_000 }).toBeGreaterThan(0.05);

  // Half way is a quarter of the amplitude (gainFor)
  await point(page, 50);
  const half = (await move()) / full;
  expect(half).toBeGreaterThan(0.15);
  expect(half).toBeLessThan(0.35);

  await point(page, 0);
  await silent(move);
});

test('a cart starts at the level it was left at', async ({ page }) => {
  await listen(page);
  await page.addInitScript(() => localStorage.setItem('pico-volume', '0'));
  await page.goto('/');
  await expect(slider(page)).toHaveValue('0');
  await insertTicTacToe(page);
  await start(page);
  const move = cursor(page);

  // Silent while the cart plays its sound, which turned up, is heard
  for (let i = 0; i < 3; i++) await silent(move);
  await point(page, 100);
  await expect.poll(move, { timeout: 15_000 }).toBeGreaterThan(0.05);
});
