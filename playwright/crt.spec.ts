// The CRT filter: a WebGL shader (src/lib/crt.ts) that draws the game again, over it, inside the
// cart's page (CrtScreen.tsx), with the old CSS overlay over PICO-8's poster and wherever there's
// no WebGL.
//
// The shader can fail without a sound. A context it can't use leaves its canvas transparent, and
// the CSS filter behind it goes on looking like a CRT filter, which is how StrictMode's second
// mount once left it the fallback for good. So these read the shader's own picture, out of its
// drawing buffer, where a screenshot would pass the fallback too.

import { test, expect, type Page } from '@playwright/test';
import { BUTTON } from '../src/lib/buttons.ts';

const choose = (page: Page, choice: 'on' | 'off') =>
  page.addInitScript((choice) => localStorage.setItem('pico-crt', choice), choice);

/** Where the filter is, how big the shader drew, and what else is filtering the screen. */
const filter = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument!;
    const tube = doc.querySelector<HTMLCanvasElement>('.crt-screen');
    const box = (r: DOMRect | undefined) => r && { x: r.x, y: r.y, width: r.width, height: r.height };
    return {
      box: box(tube?.getBoundingClientRect()),
      game: box(doc.getElementById('canvas')?.getBoundingClientRect())!,
      // The canvas's own size, which only the shader sets: 300 until it first draws
      drawn: tube?.width ?? 0,
      fallback: tube ? getComputedStyle(tube).backgroundImage : 'none',
      // The handheld's own filter, for PICO-8's poster
      screenFilter: getComputedStyle(frame.parentElement!, '::after').content,
      // The window the game shows through, on the page, in device pixels
      screen: frame.parentElement!.getBoundingClientRect().width * devicePixelRatio,
    };
  });

/**
 * The shader's picture, as its brightest pixel and a fingerprint, read from its drawing buffer.
 * CrtScreen's loop asked for the next frame before this did, so by the time this runs in it the
 * shader has drawn, and the browser hasn't yet presented and cleared the buffer. A lost context
 * reads as black.
 */
const picture = (page: Page) =>
  page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    const tube = frame.contentDocument!.querySelector<HTMLCanvasElement>('.crt-screen')!;
    const gl = tube.getContext('webgl')!;
    return new Promise<{ brightest: number; print: number }>((resolve) =>
      frame.contentWindow!.requestAnimationFrame(() => {
        const data = new Uint8Array(tube.width * tube.height * 4);
        gl.readPixels(0, 0, tube.width, tube.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        let brightest = 0;
        let print = 0;
        for (let i = 0; i < data.length; i += 4) {
          const value = data[i] + data[i + 1] + data[i + 2];
          brightest = Math.max(brightest, value);
          print = (print * 31 + value) % 1_000_000_007;
        }
        resolve({ brightest, print });
      }),
    );
  });

// The game's white, through the shader, is about 735 of 765. Black is 0.
const LIT = 600;

/** Press the cart's play button and wait until it's running. */
async function start(page: Page) {
  await page.frameLocator('iframe').locator('#p8_start_button').click();
  await expect
    .poll(() =>
      page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
        const win = frame.contentWindow as Window & { pico8_state?: { frame_number?: number } };
        return win.pico8_state?.frame_number ?? 0;
      }),
    )
    .toBeGreaterThan(30);
}

test.describe('the CRT filter', () => {
  test('the screen filters the poster, then the shader takes the game, at the screen\'s own pixels', async ({
    page,
    isMobile,
  }) => {
    // Below the full-size handheld the game doesn't fill the screen's window; overlay.spec.ts
    // covers where it sits there.
    test.skip(!!isMobile, 'the game fills the window only on the wide layouts');
    await choose(page, 'on');
    await page.goto('/');
    await expect(page.frameLocator('iframe').locator('#p8_start_button')).toBeVisible();
    expect((await filter(page)).screenFilter).not.toBe('none');

    await start(page);
    // Device pixels, through the handheld's transform on a short window and the screen's density
    await expect.poll(async () => { const f = await filter(page); return f.drawn === f.screen; }).toBe(true);
    const { box, game, screenFilter } = await filter(page);
    expect(box!.width).toBe(game.width);
    expect(Math.abs(box!.x - game.x)).toBeLessThan(0.5);
    expect(Math.abs(box!.y - game.y)).toBeLessThan(0.5);
    // One filter, not two
    expect(screenFilter).toBe('none');
    await expect(page.frameLocator('iframe').locator('.crt-screen')).toHaveCSS('pointer-events', 'none');
  });

  test('it draws the game as it plays', async ({ page }) => {
    await choose(page, 'on');
    await page.goto('/');
    await start(page);
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);
    const before = await picture(page);

    // Tic-tac-toe's cursor, moved through the export's own input hook
    await page.locator('iframe').evaluate((frame: HTMLIFrameElement, right: number) => {
      const win = frame.contentWindow as Window & { pico8_buttons: number[] };
      win.pico8_buttons[0] = right;
      setTimeout(() => (win.pico8_buttons[0] = 0), 150);
    }, BUTTON.right);
    await expect.poll(async () => (await picture(page)).print).not.toBe(before.print);
  });

  test('with no WebGL, the CSS filter covers the game instead, and only once', async ({ page }) => {
    // In every frame, so the cart's page too, where the shader's canvas is
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
        return args[0] === 'webgl' ? null : (real as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof real;
    });
    await choose(page, 'on');
    await page.goto('/');
    await start(page);

    await expect.poll(async () => (await filter(page)).box?.width).toBeGreaterThan(0);
    const { box, game, drawn, fallback, screenFilter } = await filter(page);
    expect(box!.width).toBe(game.width);
    expect(drawn).toBe(300); // never drawn on
    expect(fallback).toContain('repeating-linear-gradient');
    expect(screenFilter).toBe('none');
  });

  test('a lost context comes back, as a phone takes one from a page in the background', async ({ page }) => {
    await choose(page, 'on');
    await page.goto('/');
    await start(page);
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);

    type Losable = Window & { lose?: WEBGL_lose_context | null };
    // The extension has to be taken while the context is alive: a lost one hands out nothing
    await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
      const tube = frame.contentDocument!.querySelector<HTMLCanvasElement>('.crt-screen')!;
      const lose = tube.getContext('webgl')!.getExtension('WEBGL_lose_context');
      (frame.contentWindow as Losable).lose = lose;
      lose!.loseContext();
    });
    await expect.poll(async () => (await picture(page)).brightest).toBe(0);
    // The fallback shows meanwhile, through the empty canvas
    expect((await filter(page)).fallback).toContain('repeating-linear-gradient');

    await page.locator('iframe').evaluate((frame: HTMLIFrameElement) =>
      (frame.contentWindow as Losable).lose!.restoreContext(),
    );
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);
  });

  test('the CRT button takes it off and puts it back, and a cart switch carries it', async ({ page }) => {
    const crt = page.getByRole('button', { name: 'CRT' });
    const tube = page.frameLocator('iframe').locator('.crt-screen');
    await choose(page, 'on');
    await page.goto('/');
    await start(page);
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);

    await crt.click();
    await expect(crt).toHaveAttribute('aria-pressed', 'false');
    await expect(tube).toHaveCount(0);
    expect((await filter(page)).screenFilter).toBe('none');

    await crt.click();
    await expect(tube).toHaveCount(1);
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);

    await page.getByRole('button', { name: /Connect Four/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /connect_four/);
    await start(page);
    await expect.poll(async () => (await picture(page)).brightest).toBeGreaterThan(LIT);
  });

  // The look itself, on made-up pictures through the module alone, which the dev server serves as
  // it does the page. Each pair of numbers was measured against the shipped shader and a version
  // that should fail: one blurred across (a spot of 0.36, the first shader's), one whose lines
  // were loosened until they all but closed (reaching 0.5 and 0.6). At 1024, 8 to a game pixel.
  test('pixels stay pixels, and every row is a scanline', async ({ page }) => {
    await page.goto('/');
    // A URL on the dev server, typed as the module it serves
    const look = await page.evaluate(async (url) => {
      const { createCrt } = (await import(url)) as typeof import('../src/lib/crt.ts');
      const size = 1024;
      const across = size / 128;
      const draw = (paint: (ctx: CanvasRenderingContext2D) => void) => {
        const game = document.createElement('canvas');
        game.width = game.height = 128;
        paint(game.getContext('2d')!);
        const tube = document.createElement('canvas');
        createCrt(tube)!(game, size);
        const gl = tube.getContext('webgl')!;
        const data = new Uint8Array(size * size * 4);
        // Before this task ends, so the buffer still holds what was drawn
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return (x: number, y: number) => data[(y * size + x) * 4] + data[(y * size + x) * 4 + 1] + data[(y * size + x) * 4 + 2];
      };

      // White and black columns a pixel wide, the gap between the strokes of PICO-8's font
      const columns = draw((ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#fff1e8';
        for (let x = 0; x < 128; x += 2) ctx.fillRect(x, 0, 1, 128);
      });
      let white = 0;
      let black = 0;
      for (let row = 32; row < 96; row++) {
        const y = Math.floor((row + 0.5) * across);
        for (let column = 32; column < 96; column++) {
          const value = columns(Math.floor((column + 0.5) * across), y);
          if (column % 2 === 0) white += value;
          else black += value;
        }
      }

      // A flat field of Connect Four's board, the most light grey any cart draws
      const field = draw((ctx) => {
        ctx.fillStyle = '#c2c3c7';
        ctx.fillRect(0, 0, 128, 128);
      });
      const rows = Array.from({ length: size }, (_, y) => {
        let sum = 0;
        for (let x = 0; x < size; x++) sum += field(x, y);
        return sum;
      });
      let line = 0;
      let gap = 0;
      for (let row = 32; row < 96; row++) {
        const span = rows.slice(row * across, (row + 1) * across);
        line += Math.max(...span);
        gap += Math.min(...span);
      }
      return { blackColumns: black / white, gaps: gap / line };
    }, '/src/lib/crt.ts');

    // 0.19 shipped, 0.39 blurred
    expect(look.blackColumns).toBeLessThan(0.28);
    // 0.70 shipped, 0.99 loosened
    expect(look.gaps).toBeLessThan(0.85);
  });
});
