// Claude's skills live in four places across two carts, and a gap in any of them fails only in
// play. The shared section of both carts names them and prices them in stamina; skill_names'
// order is each skill's id, which `skills` and `skill` carry across load(). The hub sells them,
// one skill_shop row each, with icons in sprites 20 on. The dungeon runs them, from skill_fx,
// keyed by name.
//
// - A skill with no skill_fx entry is sold, then calls nil when 🅾️ fires it and stops the cart.
// - A skill with no cost compares nil with a number in the dungeon's dispatch, which stops it
//   too. One with no shop row stops the hub as its menu opens.
// - A skill sharing another's effect, as a stub would, does nothing or the wrong thing.
// - A skill with no icon shows a blank on the shelf.
//
// Like gpio-protocol.test.ts, this parses the Lua rather than running it, and a regex miss fails
// loudly: it means the Lua was reformatted and this file's parsers need updating.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { luaSection } from '../scripts/cart-budget.ts';
import { firstSpriteTab, sharedSection } from '../scripts/cart-bundle.ts';

const read = (cart: string): string => readFileSync(new URL(`../carts/${cart}.p8`, import.meta.url), 'utf8');
const hub = read('gemini');
const dungeon = read('gemini_dungeon');

function match(text: string, re: RegExp, what: string): RegExpMatchArray {
  const m = text.match(re);
  assert.ok(m, `could not parse ${what}; the Lua was reformatted, so this test's parser needs updating`);
  return m;
}

// Both carts share these lines byte for byte (cart-bundle.test.ts), so either will do
const shared = sharedSection(hub) ?? '';
const names = match(shared, /^skill_names = split"([^"]+)"/m, 'skill_names')[1]!.split(',');
const costs = match(shared, /^skill_costs = split"([^"]+)"/m, 'skill_costs')[1]!.split(',').map(Number);

/** The entries of a table constructor that starts a line, `name = {` to the `}` alone on a line. */
function tableBody(lua: string, name: string): string {
  return match(lua, new RegExp(`^${name} = \\{\\n([\\s\\S]*?)^\\}`, 'm'), `the ${name} table`)[1]!;
}

describe("Claude's skills", () => {
  it('has names to sell', () => {
    assert.ok(names.length > 0);
    assert.equal(new Set(names).size, names.length, `a name is listed twice in skill_names: ${names.join(', ')}`);
  });

  it('costs every skill 1 to 3 stamina', () => {
    assert.equal(costs.length, names.length, `skill_costs has ${costs.length} costs for ${names.length} skills`);
    // 1-3 is the plan's rule. A fresh agent's bar is 3, so more could never fire on a first run
    costs.forEach((cost, k) =>
      assert.ok(Number.isInteger(cost) && cost >= 1 && cost <= 3, `${names[k]} costs ${cost} stamina`),
    );
  });

  it('gives every skill an effect of its own in the dungeon', () => {
    const body = tableBody(luaSection(dungeon), 'skill_fx');
    const entries = [...body.matchAll(/^\t(?:\["([^"]+)"\]|(\w+)) = (\w+),?$/gm)].map((m) => ({
      name: m[1] ?? m[2]!,
      fn: m[3]!,
    }));
    assert.equal(
      entries.length,
      body.split('\n').filter((line) => line.trim() !== '').length,
      'a skill_fx line is in a form this parser does not read',
    );
    assert.deepEqual(entries.map((e) => e.name).sort(), [...names].sort(), 'skill_fx and skill_names list different skills');
    const fns = entries.map((e) => e.fn);
    assert.equal(new Set(fns).size, fns.length, `two skills share an effect: ${fns.join(', ')}`);
    for (const { name, fn } of entries) {
      assert.match(luaSection(dungeon), new RegExp(`^function ${fn}\\(`, 'm'), `${name}'s effect ${fn} is not defined`);
    }
  });

  it('sells every skill in the hub', () => {
    const rows = [...tableBody(luaSection(hub), 'skill_shop').matchAll(/^\t\{(\d+), "/gm)];
    assert.equal(rows.length, names.length, `skill_shop has ${rows.length} rows for ${names.length} skills`);
    for (const [k, row] of rows.entries()) assert.ok(Number(row[1]) > 0, `${names[k]} is free`);
  });

  it('draws every skill an icon, in sprites 20 on', () => {
    const sheet = firstSpriteTab(hub);
    names.forEach((name, k) => {
      const n = 20 + k;
      const pixels = sheet.slice((n >> 4) * 8, (n >> 4) * 8 + 8).map((row) => row.slice((n % 16) * 8, (n % 16) * 8 + 8));
      assert.ok(pixels.some((row) => /[^0]/.test(row)), `${name}'s icon, sprite ${n}, is blank`);
    });
  });
});
