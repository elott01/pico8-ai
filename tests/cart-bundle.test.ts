// Gem-in-Eye is two carts. carts/gemini.p8 load()s carts/gemini_dungeon.p8 and back, and one
// export carries both in public/games/gemini.js. Each way this can break is silent until a
// player walks through the door:
//
// - The export leaves a cart out, as one made from PICO-8's menu with a plain `export
//   gemini.html` would. The hub still boots, and the dungeon door then loads nothing. Fix:
//   `/reexport-cart gemini`, which bundles every cart the code loads by name.
// - The `-- >> shared` sections drift. They hold `carry`, whose order is the format of the
//   param the carts hand each other, so a key added on one side shifts every value after it.
//   Fix: copy the edited section into the other cart.
// - Sprites 0-63 drift. The shared code draws the knight and the hud from them, so a sprite
//   edited in one sheet changes him between rooms. Fix: copy the edit into the other sheet.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { CART_ORDER } from '../src/lib/carts.ts';
import { bundledCarts, exportedCarts, firstSpriteTab, sharedSection } from '../scripts/cart-bundle.ts';

const url = (path: string): URL => new URL(`../${path}`, import.meta.url);
const exists = (id: string): boolean => existsSync(url(`carts/${id}.p8`));
const readCart = (id: string): string => readFileSync(url(`carts/${id}.p8`), 'utf8');

describe('cart bundles', () => {
  for (const id of CART_ORDER) {
    describe(id, () => {
      const cart = readCart(id);
      const bundle = bundledCarts(id, (other) => (exists(other) ? readCart(other) : ''));

      it('loads only carts that are in carts/', () => {
        const missing = bundle.filter((other) => !exists(other)).map((other) => `${other}.p8`);
        assert.deepEqual(missing, [], `carts/${id}.p8 loads ${missing.join(', ')}, missing from carts/`);
      });

      it('carries every cart it loads in its export', () => {
        const carried = exportedCarts(readFileSync(url(`public/games/${id}.js`), 'utf8'));
        assert.deepEqual(
          [...carried].sort(),
          [id, ...bundle].sort(),
          `public/games/${id}.js carries ${carried.join(', ')}; run /reexport-cart ${id}`,
        );
      });

      for (const other of bundle.filter(exists)) {
        it(`shares its -- >> shared section with ${other}.p8 byte for byte`, () => {
          const mine = sharedSection(cart);
          assert.ok(mine !== null, `carts/${id}.p8 loads another cart but has no -- >> shared section`);
          assert.ok(
            mine === sharedSection(readCart(other)),
            `the -- >> shared sections of carts/${id}.p8 and carts/${other}.p8 differ; copy the edited one over`,
          );
        });

        it(`draws the same sprites 0-63 as ${other}.p8`, () => {
          assert.deepEqual(
            firstSpriteTab(readCart(other)),
            firstSpriteTab(cart),
            `sprites 0-63 of carts/${id}.p8 and carts/${other}.p8 differ; copy the edited ones over`,
          );
        });
      }
    });
  }
});
