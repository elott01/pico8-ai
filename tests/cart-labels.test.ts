// PICO-8's HTML export embeds the cart's label, at half brightness, as the poster behind the
// play button, so every visitor sees it before the cart starts. An export made from PICO-8's
// menu takes whatever label is in memory, saved or not, so a poster can go live that the .p8
// never got, and nothing else notices. That is how Gem-in-Eye's poster came to show a shop
// backdrop its saved label didn't have. This suite checks each live poster against the cart
// it was exported from, and that rewriting a label keeps the file in PICO-8's own layout.
//
// A poster failure means one of two things. The label changed and the cart wasn't
// re-exported: run `node scripts/export-cart.ts <cart>`. Or an export went out with an
// unsaved label: if the live poster is the one to keep, `node scripts/cart-label.ts restore`
// writes it back into the .p8.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CART_ORDER } from '../src/lib/carts.ts';
import { SIZE, countDifferences, isBlank, readLabel, readPoster, withLabel } from '../scripts/cart-label.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sections = (cart: string): string[] => cart.split('\n').filter((line) => /^__\w+__$/.test(line));

describe('cart labels', () => {
  for (const id of CART_ORDER) {
    describe(id, () => {
      const cart = read(`carts/${id}.p8`);

      it('has a saved label, which PICO-8 -export requires', () => {
        const label = readLabel(cart);
        assert.ok(label !== null, `carts/${id}.p8 has no __label__; capture one with Ctrl-7, then save`);
        assert.ok(!isBlank(label), `carts/${id}.p8 has a blank label`);
      });

      it('is what the live poster shows', () => {
        const label = readLabel(cart) ?? '';
        const changed = countDifferences(readPoster(read(`public/games/${id}.html`)), label);
        assert.equal(changed, 0, `public/games/${id}.html's poster differs from the label in ${changed} pixels`);
      });

      it('survives being rewritten byte for byte', () => {
        assert.equal(withLabel(cart, readLabel(cart) ?? ''), cart);
      });
    });
  }

  it('is added after __gfx__ and before the sections PICO-8 writes after it', () => {
    const label = '7'.repeat(SIZE * SIZE);
    const cart = withLabel('__lua__\nx = 1\n\n__gfx__\n0000\n__sfx__\n0000\n', label);
    assert.deepEqual(sections(cart), ['__lua__', '__gfx__', '__label__', '__sfx__']);
    assert.equal(readLabel(cart), label);
  });
});
