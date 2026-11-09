// scripts/cart-budget.ts measures a cart against PICO-8's limits without PICO-8. Its token
// count was checked against PICO-8's own `info` at 963d7ff; these pin the rules that made it
// agree, so a change to the lexer can't drift from them unnoticed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CART_ORDER } from '../src/lib/carts.ts';
import { exportedCarts } from '../scripts/cart-bundle.ts';
import { codeLength, countTokens, LIMITS, luaSection, romCodeLengths } from '../scripts/cart-budget.ts';

describe('countTokens', () => {
  it('leaves out , . : ; :: ) ] } end and local', () => {
    assert.equal(countTokens('local a = t.x:f(1, 2) end'), 8); // a = t x f ( 1 2
    assert.equal(countTokens('::top:: goto top'), 3);
    assert.equal(countTokens('a = {1; 2}[1]'), 7); // a = { 1 2 [ 1
  });

  it('counts a string as one token, however long', () => {
    assert.equal(countTokens('print("a b c d")'), 3);
    assert.equal(countTokens('s = [[one\ntwo]]'), 3);
    assert.equal(countTokens("s = 'it\\'s'"), 3);
  });

  it('merges a minus or ~ into the number after it, unless a value comes before', () => {
    assert.equal(countTokens('a = -1'), 3);
    assert.equal(countTokens('a = ~1'), 3);
    assert.equal(countTokens('return -1'), 2);
    assert.equal(countTokens('a = b - 1'), 5);
    assert.equal(countTokens('a = f() - 1'), 6); // a = f ( - 1
    assert.equal(countTokens('a = -b'), 4);
  });

  it('skips comments, short and long', () => {
    assert.equal(countTokens('-- a b c\n--[[ d\ne ]] x = 1 // f g'), 3);
    assert.equal(countTokens('--[==[ ]] still a comment ]==] x'), 1);
  });

  it('reads a glyph as a number', () => {
    assert.equal(countTokens('btn(⬅️)'), 3);
    assert.equal(countTokens('btnp(❎)'), 3);
  });
});

describe('codeLength', () => {
  it('counts a P8SCII glyph as one byte, with or without its selector', () => {
    assert.equal(codeLength('🅾️'), 1);
    assert.equal(codeLength('❎'), 1);
    assert.equal(codeLength('btn(⬅️)'), 6);
  });

  it('counts anything else non-ASCII as its UTF-8 bytes', () => {
    assert.equal(codeLength('a·b'), 4);
  });
});

describe('luaSection', () => {
  it('leaves out the newline before the next section', () => {
    assert.equal(luaSection('__lua__\na=1\n\n__gfx__\n0000\n'), 'a=1\n');
    assert.equal(luaSection('__lua__\na=1\n'), 'a=1');
  });
});

describe('romCodeLengths', () => {
  for (const id of CART_ORDER) {
    it(`reads one compressed size per cart in ${id}'s export`, () => {
      const js = readFileSync(new URL(`../public/games/${id}.js`, import.meta.url), 'utf8');
      const lengths = romCodeLengths(js);
      assert.equal(lengths.length, exportedCarts(js).length);
      for (const { decompressed, compressed } of lengths) {
        assert.ok(compressed > 0 && compressed <= LIMITS.compressed, `compressed ${compressed}`);
        assert.ok(decompressed > compressed, `decompressed ${decompressed}`);
      }
    });
  }
});
