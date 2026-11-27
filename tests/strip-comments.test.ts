// scripts/export-cart.ts exports copies of the carts with their comments stripped. A mistake
// here ships a broken game, and no test runs the stripped Lua, so these check that nothing but
// comments goes: first case by case, then on every cart in carts/.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { luaSection, tokenize } from '../scripts/cart-budget.ts';
import { stripCart, stripComments } from '../scripts/strip-comments.ts';

describe('stripComments', () => {
  it('drops whole-line and trailing comments, and the blank lines left behind', () => {
    assert.equal(stripComments('-- a\nx = 1 -- b\n\n\t-- c\ny = 2\n'), 'x = 1\ny = 2');
  });

  it("drops PICO-8's // comments and tab markers", () => {
    assert.equal(stripComments('x = 1 // a\n-->8\ny = 2'), 'x = 1\ny = 2');
  });

  it('leaves a comment inside a string alone', () => {
    assert.equal(stripComments('s = "a -- b" -- c'), 's = "a -- b"');
    assert.equal(stripComments("s = 'http://x'"), "s = 'http://x'");
    assert.equal(stripComments('s = "it\\"s -- here" -- c'), 's = "it\\"s -- here"');
  });

  it('drops block comments, of any level', () => {
    assert.equal(stripComments('x = 1 --[[ a ]] y = 2'), 'x = 1   y = 2');
    assert.equal(stripComments('--[==[ a ]] b\n]==] x = 1'), ' x = 1');
  });

  it('keeps two lines of code apart when a block comment between them spans lines', () => {
    assert.equal(stripComments('if (a) b = 1 --[[\n]] c = 2'), 'if (a) b = 1\n c = 2');
  });

  it('keeps a long string whole, blank lines and all', () => {
    const s = 's = [[one -- not a comment\n\n  two]]';
    assert.equal(stripComments(`${s} -- c\n`), s);
    assert.equal(stripComments('s = [=[a ]] -- b]=] -- c'), 's = [=[a ]] -- b]=]');
  });

  it('keeps indentation and button glyphs', () => {
    assert.equal(stripComments('\tif btnp(🅾️) then -- go\n\tend'), '\tif btnp(🅾️) then\n\tend');
  });

  it('takes a comment with no newline after it', () => {
    assert.equal(stripComments('x = 1\n-- the end'), 'x = 1');
  });
});

describe('stripCart', () => {
  const carts = new URL('../carts/', import.meta.url);

  it('changes only the code section', () => {
    const cart = 'pico-8 cartridge\nversion 43\n__lua__\n-- a\nx = 1\n\n__gfx__\n--00\n__label__\n--11\n';
    assert.equal(stripCart(cart), 'pico-8 cartridge\nversion 43\n__lua__\nx = 1\n__gfx__\n--00\n__label__\n--11\n');
  });

  for (const file of readdirSync(carts).filter((name) => name.endsWith('.p8'))) {
    it(`leaves ${file} the same code and the same everything else`, () => {
      const cart = readFileSync(new URL(file, carts), 'utf8');
      const stripped = stripCart(cart);
      const code = luaSection(cart);
      assert.deepEqual(tokenize(luaSection(stripped)), tokenize(code));

      // Every line of code is still a line of its own, in the same order
      const codeLines = (lua: string): string[] =>
        lua.split('\n').filter((line) => tokenize(line).length > 0).map((line) => JSON.stringify(tokenize(line)));
      assert.deepEqual(codeLines(luaSection(stripped)), codeLines(code));

      const around = (p8: string): string[] => p8.split(luaSection(p8));
      assert.equal(around(cart).length, 2);
      assert.deepEqual(around(stripped), around(cart));
      assert.ok(stripped.length < cart.length, 'nothing was stripped');
    });
  }
});
