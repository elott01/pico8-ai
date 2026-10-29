// The favicon is gem-in-eye's head, generated from carts/gemini.p8 by scripts/favicon.ts.
// A failure here means the head was redrawn and the favicon wasn't: run
// `node scripts/favicon.ts`. The .ico is compared by its pixels, not its bytes, so a zlib
// that compresses differently doesn't fail it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { CART, ICO, SVG, faviconIco, faviconSvg } from '../scripts/favicon.ts';

const cart = readFileSync(CART, 'utf8');
const regenerate = 'regenerate it with node scripts/favicon.ts';

/** The .ico's header, then its PNG's decompressed scanlines. */
function decoded(ico: Buffer): Buffer {
  const start = ico.readUInt32LE(18);
  const data: Buffer[] = [];
  for (let at = start + 8; at < ico.length; ) {
    const length = ico.readUInt32BE(at);
    if (ico.toString('ascii', at + 4, at + 8) === 'IDAT') data.push(ico.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  // the entry's byte count (14-17) follows the compressed size, so it is left out
  return Buffer.concat([ico.subarray(0, 14), ico.subarray(18, start), inflateSync(Buffer.concat(data))]);
}

describe('favicon', () => {
  it("public/favicon.svg is gem-in-eye's head", () => {
    assert.equal(readFileSync(SVG, 'utf8'), faviconSvg(cart), `public/favicon.svg is stale; ${regenerate}`);
  });

  it("public/favicon.ico is gem-in-eye's head", () => {
    assert.ok(decoded(readFileSync(ICO)).equals(decoded(faviconIco(cart))), `public/favicon.ico is stale; ${regenerate}`);
  });

  it('is linked from index.html', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="32x32" \/>/);
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/);
  });
});
