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

/** Which way the cross is tipped: [1 toward Up, -1 toward Down; 1 toward Right, -1 toward Left]. */
const tipped = (page: Page) =>
  page
    .getByRole('group', { name: 'Cart buttons' })
    .locator('[class*="cross"]')
    .evaluate((el) => {
      const { m13, m23 } = new DOMMatrix(getComputedStyle(el).transform);
      const sign = (n: number) => (n > 0.01 ? 1 : n < -0.01 ? -1 : 0);
      return [sign(m23), sign(-m13)];
    });

/**
 * How far the D-pad's dark base shows below the plastic at a point on the cross, measured from
 * its centre, so the thickness of the lip there. Negative shows above it. ::before is the bar
 * across, ::after the upright.
 */
const lipAt = (page: Page, bar: '::before' | '::after', x: number, y: number) =>
  page
    .getByRole('group', { name: 'Cart buttons' })
    .locator('[class*="dpad"]')
    .evaluate(
      (dpad, { bar, x, y }) => {
        const drawnY = (transform: string) => new DOMMatrix(transform).transformPoint({ x, y }).y;
        const cross = dpad.querySelector('[class*="cross"]')!;
        return drawnY(getComputedStyle(dpad, bar).transform) - drawnY(getComputedStyle(cross).transform);
      },
      { bar, x, y },
    );

/** How wide a control is drawn, once any transforms are applied. */
const drawnWidth = (page: Page, name: string) =>
  control(page, name).evaluate((el) => el.getBoundingClientRect().width);

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

  // The rules match the arms as direct children of the cross, and fail with no error otherwise.
  test('a held arm tips the whole cross, and two tip it to the corner between them', async ({ page }) => {
    await loaded(page);
    const arms = [
      ['Up', [1, 0]],
      ['Down', [-1, 0]],
      ['Left', [0, -1]],
      ['Right', [0, 1]],
    ] as const;
    for (const [name, way] of arms) {
      await finger(page, name, 'pointerdown', 1);
      await expect.poll(() => tipped(page), `${name} down`).toEqual(way);
      await finger(page, name, 'pointerup', 1);
      await expect.poll(() => tipped(page), `${name} up`).toEqual([0, 0]);
    }

    await finger(page, 'Up', 'pointerdown', 1);
    await finger(page, 'Left', 'pointerdown', 2);
    await expect.poll(() => tipped(page)).toEqual([1, -1]);
  });

  // The lip is how far the plastic stands out of the shell. A press the other way round, with
  // the shadow opening on the arm going in, is what a base left standing still gave.
  test('the lip closes on the side pressed in, and opens on the side that rises', async ({ page }) => {
    await loaded(page);
    await expect.poll(() => lipAt(page, '::after', 0, 66)).toBeCloseTo(4, 0);

    const press = async (name: string, read: () => Promise<number>, check: (lip: number) => boolean) => {
      await finger(page, name, 'pointerdown', 1);
      await expect.poll(async () => check(await read()), name).toBe(true);
      await finger(page, name, 'pointerup', 1);
      await expect.poll(() => tipped(page)).toEqual([0, 0]);
    };
    const bottomTip = () => lipAt(page, '::after', 0, 66);
    const topTip = () => lipAt(page, '::after', 0, -66);
    const leftTip = () => lipAt(page, '::before', -66, 22);
    const rightTip = () => lipAt(page, '::before', 66, 22);

    await press('Down', bottomTip, (lip) => lip < 1);
    await press('Down', topTip, (lip) => lip < -3);
    await press('Up', bottomTip, (lip) => lip > 7);
    await press('Left', leftTip, (lip) => lip < 1);
    await press('Left', rightTip, (lip) => lip > 7);
    await press('Right', rightTip, (lip) => lip < 1);
    await press('Right', leftTip, (lip) => lip > 7);
  });

  // From layout, not a picture: WebKit's screenshots paint 3D flat, though its layout is right.
  test('the cross tips in depth: the held arm narrows away, the far one widens toward you', async ({ page }) => {
    await loaded(page);
    await finger(page, 'Up', 'pointerdown', 1);
    await expect
      .poll(async () => (await drawnWidth(page, 'Down')) - (await drawnWidth(page, 'Up')))
      .toBeGreaterThan(1);
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

// The lettering's P line says CLICK SCREEN while keys don't reach the cart, and blinks when one
// meant for it lands on the page. Both lines are always in the DOM, stacked so the row keeps its
// size, so these check what's visible rather than what's there.
test.describe("the keyboard's way in", () => {
  test.skip(({ isMobile }) => !!isMobile, 'no keyboard');

  const hint = (page: Page) => page.getByText('CLICK SCREEN', { exact: true });
  const pause = (page: Page) => page.getByText('P · PAUSE MENU', { exact: true });

  /** Connect Four's page held back, as a server slower than the local one would. */
  const slowConnectFour = (page: Page, ms: number) =>
    page.route('**/games/connect_four.html', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    });

  /** A person's click: held a moment, long enough for a focus change to be seen. */
  async function pressLikeAPerson(page: Page, name: string | RegExp) {
    await page.getByRole('button', { name }).hover();
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
  }

  /** Every line the lettering shows from now on, in order, caught at each change to the page. */
  async function recordLettering(page: Page) {
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { lettering: string[] }).lettering = seen;
      const read = () => {
        const pause = [...document.querySelectorAll('span')].find((s) => s.textContent === 'P · PAUSE MENU');
        const now = pause && getComputedStyle(pause).visibility === 'visible' ? 'P · PAUSE MENU' : 'CLICK SCREEN';
        if (seen.at(-1) !== now) seen.push(now);
      };
      new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true });
      read();
    });
    return () => page.evaluate(() => (window as unknown as { lettering: string[] }).lettering);
  }

  test('the lettering says to click the screen until the cart has the keyboard', async ({ page }) => {
    await loaded(page);
    await expect(hint(page)).toBeVisible();
    await expect(pause(page)).toBeHidden();

    await page.locator('iframe').click();
    await expect(pause(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();

    // The page's left gutter: a click on nothing in particular still takes the keyboard
    await page.mouse.click(4, 300);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await expect(hint(page)).toBeVisible();
  });

  // Held down and let go off the button, so it's never clicked: Eject and Fullscreen would hand
  // focus on themselves, and this is about the press.
  test("the handheld's buttons leave the keyboard in the cart", async ({ page }) => {
    await loaded(page);
    await page.locator('iframe').click();
    await expect(pause(page)).toBeVisible();

    for (const name of ['Eject', 'Fullscreen', 'CRT']) {
      await page.getByRole('button', { name, exact: true }).hover();
      await page.mouse.down();
      expect(await page.evaluate(() => document.activeElement?.tagName), name).toBe('IFRAME');
      await expect(pause(page), name).toBeVisible();
      await page.mouse.move(4, 300);
      await page.mouse.up();
    }
  });

  test('the CRT button, clicked, still leaves the keyboard in the cart', async ({ page }) => {
    await loaded(page);
    await page.locator('iframe').click();
    await expect(pause(page)).toBeVisible();

    const crt = page.getByRole('button', { name: 'CRT', exact: true });
    const before = await crt.getAttribute('aria-pressed');
    await crt.click();
    await expect(crt).not.toHaveAttribute('aria-pressed', before!);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    await expect(pause(page)).toBeVisible();
  });

  // The card takes focus as it's pressed, and the next cart takes a moment to load. The hint
  // once followed POWER, so it showed for the press, went while the cart loaded, and came back.
  test('switching carts changes the lettering once, with no flicker while the next loads', async ({ page }) => {
    await slowConnectFour(page, 500);
    await loaded(page);
    await page.locator('iframe').click();
    await expect(pause(page)).toBeVisible();
    const seen = await recordLettering(page);

    await pressLikeAPerson(page, /Connect Four/);
    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
    await expect(control(page, 'Left')).toBeEnabled();
    expect(await seen()).toEqual(['P · PAUSE MENU', 'CLICK SCREEN']);
  });

  test('ejecting leaves the lettering alone, and the next cart changes it once', async ({ page }) => {
    await slowConnectFour(page, 500);
    await loaded(page);
    await page.locator('iframe').click();
    await expect(pause(page)).toBeVisible();
    const seen = await recordLettering(page);

    await pressLikeAPerson(page, 'Eject');
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(await seen()).toEqual(['P · PAUSE MENU']);

    await pressLikeAPerson(page, /Connect Four/);
    await expect(control(page, 'Left')).toBeEnabled();
    expect(await seen()).toEqual(['P · PAUSE MENU', 'CLICK SCREEN']);
  });

  test("a cart's key pressed on the page blinks the hint, and each one blinks it again", async ({ page }) => {
    await loaded(page);
    // Neither a key the cart ignores nor a shortcut
    await page.keyboard.press('a');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await expect(hint(page)).not.toHaveClass(/missed/);

    await page.keyboard.press('ArrowLeft');
    await expect(hint(page)).toHaveClass(/missed/);

    // A fresh element is a restarted animation
    await hint(page).evaluate((el) => (el.dataset.seen = '1'));
    await page.keyboard.press('p');
    await expect(hint(page)).not.toHaveAttribute('data-seen');
    await expect(hint(page)).toHaveClass(/missed/);
  });

  test('keys that reach the cart blink nothing', async ({ page }) => {
    await loaded(page);
    await page.locator('iframe').focus();
    await expect(pause(page)).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    await expect(hint(page)).not.toHaveClass(/missed/);
  });

  // The cart keeps focus through a click that doesn't move it, and WebKit sends no blur from
  // the iframe that's taken away, so the hint has to come back with the switch, not the load.
  test('changing carts puts the hint back while the next one loads', async ({ page }) => {
    await slowConnectFour(page, 1000);
    await loaded(page);
    await page.locator('iframe').focus();
    await expect(pause(page)).toBeVisible();

    await page.getByRole('button', { name: /Connect Four/ }).dispatchEvent('click');
    await expect(hint(page)).toBeVisible();
    await expect(control(page, 'Left')).toBeDisabled();
    await expect(control(page, 'Left')).toBeEnabled();
    await expect(hint(page)).toBeVisible();
  });
});

test('on a touch screen the lettering never asks for a click', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'needs a touch-enabled context');
  await loaded(page);
  await expect(page.getByText('P · PAUSE MENU', { exact: true })).toBeVisible();
  await expect(page.getByText('CLICK SCREEN', { exact: true })).toBeHidden();
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
