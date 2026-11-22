// Exports a cart with PICO-8's command-line -export and copies both files into public/games/,
// then rewrites public/labels/<cart>.png, so the switcher's label can't fall behind the poster.
//
//   node scripts/export-cart.ts <cart>
//
// PICO-8 writes an export to the folder it was started in, not its carts folder, so it is
// started in a fresh temp folder, and the files are copied only once both exist. Its -home is
// a temp folder too, so a run never touches the user's own PICO-8 config. It exits 0 even when
// it refuses to export, so success is judged by the files, not its exit code.
//
// A cart that load()s others by name exports with them bundled into the one .js, as
// scripts/cart-bundle.ts reads them out of its code. Gem-in-Eye is two carts this way.
//
// What is exported is a copy of each cart without its comments (scripts/strip-comments.ts), which
// would otherwise use up PICO-8's compressed-code limit. If stripping changed anything else, it
// stops before PICO-8 runs.
//
// Exits 2 when the cart has no saved label, which -export requires, and 1 for any other
// failure. PICO8 overrides where the binary is looked for; the default is the macOS install.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { luaSection, tokenize } from './cart-budget.ts';
import { bundledCarts, exportedCarts } from './cart-bundle.ts';
import { labelPng, readLabel } from './cart-label.ts';
import { stripCart } from './strip-comments.ts';

const PICO8 = process.env.PICO8 ?? '/Applications/PICO-8.app/Contents/MacOS/pico8';
// A build that ignores -export opens the editor and never exits.
const TIMEOUT_MS = 60_000;
const ROOT = resolve(import.meta.dirname, '..');

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

const [cart] = process.argv.slice(2);
if (!cart || !/^\w+$/.test(cart)) fail(1, 'usage: export-cart.ts <cart id, e.g. tic_tac_toe>');
const cartPath = (id: string): string => join(ROOT, 'carts', `${id}.p8`);
const source = cartPath(cart);
if (!existsSync(source)) fail(1, `carts/${cart}.p8 does not exist`);
const bundle = bundledCarts(cart, (id) => {
  if (!existsSync(cartPath(id))) fail(1, `carts/${cart}.p8 loads ${id}.p8, but carts/${id}.p8 does not exist`);
  return readFileSync(cartPath(id), 'utf8');
});
if (!existsSync(PICO8)) fail(1, `PICO-8 is not at ${PICO8}; set PICO8 to its binary`);

const work = mkdtempSync(join(tmpdir(), 'export-cart-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const home = join(work, 'home');
const out = join(work, 'out');
mkdirSync(home);
mkdirSync(out);

// A bundled cart is named in the export command. Where PICO-8 looks for that name isn't
// documented, so it exports from the stripped copies in the work folder, which is at once
// PICO-8's current folder, its root_path and the exported cart's own folder.
for (const id of [cart, ...bundle]) {
  const original = readFileSync(cartPath(id), 'utf8');
  const stripped = stripCart(original);
  const tokens = (p8: string): string => JSON.stringify(tokenize(luaSection(p8)));
  if (tokens(stripped) !== tokens(original)) {
    fail(1, `stripping carts/${id}.p8's comments changed its code, so nothing was exported; see scripts/strip-comments.ts`);
  }
  writeFileSync(join(out, `${id}.p8`), stripped);
}
const main = join(out, `${cart}.p8`);
const rootPath = bundle.length > 0 ? ['-root_path', out] : [];
const command = [`${cart}.html`, ...bundle.map((id) => `${id}.p8`)].join(' ');

const run = spawnSync(PICO8, ['-home', home, ...rootPath, main, '-export', command], {
  cwd: out,
  encoding: 'utf8',
  timeout: TIMEOUT_MS,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
if (run.error) fail(1, `PICO-8 did not finish: ${run.error.message}\n${output}`);
if (/capture a label/i.test(output)) {
  fail(2, `PICO-8 refused: carts/${cart}.p8 has no saved label, which -export requires.`);
}

const files = [`${cart}.html`, `${cart}.js`];
const missing = files.filter((file) => !existsSync(join(out, file)));
if (missing.length > 0) fail(1, `PICO-8 did not write ${missing.join(' or ')}. It said:\n${output}`);
// Without its bundle the cart still boots, then its first load() finds nothing
const carried = exportedCarts(readFileSync(join(out, `${cart}.js`), 'utf8'));
const unbundled = [cart, ...bundle].filter((id) => !carried.includes(id));
if (unbundled.length > 0) {
  fail(1, `PICO-8's export left out ${unbundled.map((id) => `${id}.p8`).join(', ')}; nothing was copied. It said:\n${output}`);
}
for (const file of files) copyFileSync(join(out, file), join(ROOT, 'public', 'games', file));
// -export refuses a cart with no saved label, so by here there is one to draw.
const label = readLabel(readFileSync(source, 'utf8'))!;
writeFileSync(join(ROOT, 'public', 'labels', `${cart}.png`), labelPng(label, 1));
const extra = bundle.length > 0 ? `, with ${bundle.map((id) => `${id}.p8`).join(', ')} inside` : '';
console.log(
  `exported carts/${cart}.p8 to public/games/${cart}.html and ${cart}.js${extra}, ` +
    `and its label to public/labels/${cart}.png`,
);
