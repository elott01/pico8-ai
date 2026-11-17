// PICO-8's touch controller, traded to match the handheld (src/lib/controller.ts): the buttons'
// bits, and finding the two circles in the controller's picture. The picture is read here from
// every export, since a new PICO-8 could redraw it, and the trade would then quietly not happen.
// playwright/overlay.spec.ts taps the traded controller for real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { findCircles, tradeOX } from '../src/lib/controller.ts';
import { BUTTON } from '../src/lib/buttons.ts';

describe('tradeOX', () => {
  it('trades O and X', () => {
    assert.equal(tradeOX(BUTTON.o), BUTTON.x);
    assert.equal(tradeOX(BUTTON.x), BUTTON.o);
    assert.equal(tradeOX(BUTTON.o | BUTTON.x), BUTTON.o | BUTTON.x);
  });

  it('leaves every other button alone', () => {
    const others = BUTTON.left | BUTTON.up | BUTTON.pause;
    assert.equal(tradeOX(others), others);
    assert.equal(tradeOX(others | BUTTON.o), others | BUTTON.x);
    assert.equal(tradeOX(0), 0);
  });
});

/** A picture's alpha, drawn as PICO-8 draws the controller: a bar, then two rings. */
function picture(rings: { x: number; y: number; r: number }[], bar = true) {
  const width = 300;
  const height = 350;
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBar = bar && y >= 9 && y <= 30 && x >= 175 && x <= 235;
      const onRing = rings.some((c) => Math.abs(Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) - (c.r - 2)) < 2);
      if (onBar || onRing) alpha[y * width + x] = 255;
    }
  }
  return { alpha, width, height };
}

describe('findCircles', () => {
  const O = { x: 205, y: 150, r: 52 };
  const X = { x: 94, y: 254, r: 52 };

  it('finds the upper-right circle and the lower-left one', () => {
    const { alpha, width, height } = picture([O, X]);
    const found = findCircles(alpha, width, height);
    assert.ok(found);
    const [upper, lower] = found;
    assert.ok(Math.abs(upper.x - O.x) <= 1 && Math.abs(upper.y - O.y) <= 1, JSON.stringify(upper));
    assert.ok(Math.abs(lower.x - X.x) <= 1 && Math.abs(lower.y - X.y) <= 1, JSON.stringify(lower));
  });

  it('gives up on a picture laid out some other way', () => {
    const cases = {
      'one circle': picture([O]),
      'no bar above them': picture([O, X], false),
      'the upper one on the left': picture([
        { ...O, x: 94 },
        { ...X, x: 205 },
      ]),
      'two sizes': picture([O, { ...X, r: 40 }]),
    };
    for (const [name, { alpha, width, height }] of Object.entries(cases)) {
      assert.equal(findCircles(alpha, width, height), null, name);
    }
  });
});

/** An 8-bit RGBA PNG's alpha, unfiltered. The only form the export's controller comes in. */
function pngAlpha(png: Buffer) {
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IHDR') header = png.subarray(at + 8, at + 8 + length);
    if (type === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  assert.ok(header && header[8] === 8 && header[9] === 6 && header[12] === 0, 'an 8-bit RGBA PNG');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4]! : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter]!;
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i]! + predicted) & 0xff;
    }
  }
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = out[i * 4 + 3]!;
  return { alpha, width, height };
}

describe("every export's controller", () => {
  const exports = readdirSync('public/games').filter((file) => file.endsWith('.html'));

  for (const file of exports) {
    // The picture spans the corner, 6 of PICO-8's units across and 7 down, 50px to the unit. Its
    // handler reads a touch as O where (h - y) > (w - x) * 0.8 from that corner, and X the other
    // way round, so each circle has to sit on its own side for the trade to put them right.
    it(`${file}: has the two circles, O upper-right and X lower-left`, () => {
      const html = readFileSync(`public/games/${file}`, 'utf8');
      const at = html.indexOf('controls_right_panel');
      const match = html.slice(at).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
      assert.ok(at >= 0 && match, 'the export has the controller picture');
      const { alpha, width, height } = pngAlpha(Buffer.from(match[1]!, 'base64'));

      const found = findCircles(alpha, width, height);
      assert.ok(found, 'the circles are found');
      const [upper, lower] = found;
      const fromCorner = (c: { x: number; y: number }) => ({ across: width - c.x, up: height - c.y });
      const o = fromCorner(upper);
      const x = fromCorner(lower);
      assert.ok(o.up > o.across * 0.8 && !(o.across > o.up * 0.8), 'the upper circle is read as O');
      assert.ok(x.across > x.up * 0.8 && !(x.up > x.across * 0.8), 'the lower circle is read as X');
    });
  }
});
