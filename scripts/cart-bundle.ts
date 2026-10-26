// Which carts an export has to bundle, and what the bundled carts must share.
//
// A cart switches to another with load("<name>.p8"), and on the site that only works if the
// other cart is inside the same export. Reading the names out of the code, rather than keeping
// a list, means an export can't drift from what the cart actually loads.
// scripts/export-cart.ts bundles them; tests/cart-bundle.test.ts checks the result.

const LUA = /__lua__\n([\s\S]*?)(?:\n__\w+__\n|$)/;
const SECTION = /^__\w+__$/;

/** The cart's code with comments removed, so a cart named in a comment isn't bundled. */
function code(cart: string): string {
  const lua = LUA.exec(cart)?.[1] ?? '';
  return lua.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--.*$/gm, '');
}

/** Ids of the carts this cart names in a string literal, like go("gemini_dungeon.p8"). */
export function cartsNamedBy(cart: string): string[] {
  const ids = [...code(cart).matchAll(/["'](\w+)\.p8["']/g)].map((m) => m[1]!);
  return [...new Set(ids)];
}

/**
 * Ids of every cart an export of `id` has to carry besides `id` itself: the carts it loads,
 * the carts those load, and so on. A cart loading back the one that loaded it is no addition.
 */
export function bundledCarts(id: string, readCart: (id: string) => string): string[] {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const next of cartsNamedBy(readCart(queue.shift()!))) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].filter((other) => other !== id);
}

/** The carts an export's .js holds, from the list PICO-8 writes into it. */
export function exportedCarts(js: string): string[] {
  const list = /var _cartname=\[([^\]]*)\]/.exec(js)?.[1] ?? '';
  return [...list.matchAll(/[`'"](\w+)\.p8[`'"]/g)].map((m) => m[1]!);
}

/** The code between `-- >> shared` and `-- << shared`, or null if the cart has none. */
export function sharedSection(cart: string): string | null {
  const lua = LUA.exec(cart)?.[1] ?? '';
  const start = lua.indexOf('-- >> shared');
  const end = lua.indexOf('-- << shared');
  return start === -1 || end < start ? null : lua.slice(start, end);
}

/** Sprites 0-63, the first tab of the sheet: the gfx rows 0-31 as PICO-8 saved them. */
export function firstSpriteTab(cart: string): string[] {
  const lines = cart.split('\n');
  const start = lines.indexOf('__gfx__');
  const rows: string[] = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    if (SECTION.test(line) || rows.length === 32) break;
    rows.push(line);
  }
  // PICO-8 drops trailing all-zero rows, so a short sheet is zeros after its last row
  while (rows.length < 32) rows.push('0'.repeat(128));
  return rows;
}
