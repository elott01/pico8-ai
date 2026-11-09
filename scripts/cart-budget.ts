// How close each cart is to PICO-8's three code limits, without opening PICO-8.
//
//   node scripts/cart-budget.ts [cart ...]
//
// With no carts named it measures every export in CART_ORDER. A cart bundled into another's
// export, like gemini_dungeon, is measured with the export that carries it.
//
// - Tokens, of 8,192, are counted from carts/<name>.p8 by PICO-8's rules: comments and
//   `, . : ; :: ) ] } end local` are free, a string is one token, and a minus or ~ in front of
//   a number literal merges into it when nothing before it is a value. Run on `963d7ff`, this
//   gave the same 5,123 (hub) and 3,335 (dungeon) as PICO-8's `info`.
// - Characters, of 65,535, are the code's length as the ROM stores it. A P8SCII glyph like
//   ⬅️ is one byte there, though it is two characters in the .p8. Anything else non-ASCII
//   costs its UTF-8 bytes: a `·` in a comment costs two. The newline before the next section
//   isn't stored.
// - Compressed code, of 15,616, is the limit carts actually hit, and it can't be counted from
//   the .p8 short of reimplementing PICO-8's compressor. So it is read from the export:
//   public/games/<cart>.js holds one 0x8000-byte ROM per cart it carries, and the code at
//   0x4300 starts with `\0pxa`, its length decompressed, then compressed, each 2 bytes
//   big-endian. That is the last export's size, so when the exported code's length differs
//   from the .p8's, the cart has changed since, and the number is flagged as stale. An edit
//   that keeps the length the same goes unseen.
//
// Exits 1 when a cart is over a limit or a cart named has no export to measure.

import { existsSync, readFileSync } from 'node:fs';

import { CART_ORDER } from '../src/lib/carts.ts';
import { exportedCarts } from './cart-bundle.ts';

export const LIMITS = { tokens: 8192, chars: 65535, compressed: 15616 } as const;

const ROM_SIZE = 0x8000;
const CODE_AT = 0x4300;

/** The cart's __lua__ section, without the newline that ends it. */
export function luaSection(cart: string): string {
  return /^__lua__\n([\s\S]*?)\n?(?=^__\w+__$|(?![\s\S]))/m.exec(cart)?.[1] ?? '';
}

// The characters a .p8 writes for P8SCII's one-byte glyphs, 1-31, 127 and 128-255, without
// the variation selector PICO-8 puts after some of them
const GLYPHS = new Set([
  ...'¹²³⁴⁵⁶⁷⁸ᵇᶜᵉᶠ▮■□⁙⁘‖◀▶「」¥•、。゛゜○',
  ...'█▒🐱⬇░✽●♥☉웃⌂⬅😐♪🅾◆…➡★⧗⬆ˇ∧❎▤▥◜◝',
  ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんっゃゅょ',
  ...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンッャュョ',
]);

/** The code's length in bytes in the ROM. */
export function codeLength(code: string): number {
  let bytes = 0;
  let afterGlyph = false;
  for (const ch of code) {
    if (afterGlyph && ch === '️') {
      afterGlyph = false;
      continue;
    }
    afterGlyph = GLYPHS.has(ch);
    bytes += afterGlyph ? 1 : Buffer.byteLength(ch);
  }
  return bytes;
}

type Kind = 'string' | 'number' | 'name' | 'operator';
type Token = { kind: Kind; text: string };

const FREE = new Set([',', '.', ':', ';', '::', ')', ']', '}', 'end', 'local']);
// Longest first, so `..=` wins over `..` and `.`
const OPERATORS = String.raw`... ..= .. == ~= != <= >= += -= *= /= \= %= ^= |= &= ^^= <<= >>=
  >>>= <<>= >><= :: << >> >>> <<> >>< ^^ + - * / \ % ^ # & | ~ < > = ( ) { } [ ] ; : , . @ $ ?`
  .split(/\s+/)
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);
// Keywords a minus can follow and still be unary, as in `return -1`
const NOT_VALUES = new Set(['and', 'or', 'not', 'return', 'if', 'then', 'else', 'elseif',
  'while', 'do', 'for', 'in', 'until', 'repeat', 'function', 'local', 'end', 'goto']);

const NUMBER = /0[xX][0-9a-fA-F_]*(\.[0-9a-fA-F_]*)?|0[bB][01_]*(\.[01_]*)?|[0-9][0-9_]*(\.[0-9_]*)?|\.[0-9][0-9_]*/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const LONG_BRACKET = /\[(=*)\[/y;

function at(pattern: RegExp, code: string, i: number): RegExpExecArray | null {
  pattern.lastIndex = i;
  return pattern.exec(code);
}

/** The code split into PICO-8's tokens, comments and whitespace dropped. */
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const skipPast = (close: string): void => {
    const j = code.indexOf(close, i);
    i = j === -1 ? code.length : j + close.length;
  };
  while (i < code.length) {
    const c = code[i]!;
    if (/\s/.test(c)) {
      i += 1;
    } else if (code.startsWith('--', i) || code.startsWith('//', i)) {
      const long = code.startsWith('--', i) ? at(LONG_BRACKET, code, i + 2) : null;
      if (long) skipPast(`]${long[1]}]`);
      else skipPast('\n');
    } else if (at(LONG_BRACKET, code, i)) {
      skipPast(`]${at(LONG_BRACKET, code, i)![1]}]`);
      out.push({ kind: 'string', text: '[[' });
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      out.push({ kind: 'string', text: code.slice(i, j + 1) });
      i = j + 1;
    } else if (at(NUMBER, code, i)) {
      const text = at(NUMBER, code, i)![0];
      out.push({ kind: 'number', text });
      i += text.length;
    } else if (at(NAME, code, i)) {
      const text = at(NAME, code, i)![0];
      out.push({ kind: 'name', text });
      i += text.length;
    } else if (c.charCodeAt(0) > 127) {
      // A glyph such as a button symbol, which PICO-8 reads as a number
      let j = i + (code.codePointAt(i)! > 0xffff ? 2 : 1);
      if (code[j] === '️') j += 1;
      out.push({ kind: 'number', text: code.slice(i, j) });
      i = j;
    } else {
      const op = OPERATORS.find((o) => code.startsWith(o, i));
      if (!op) throw new Error(`can't read ${JSON.stringify(c)} at character ${i}`);
      out.push({ kind: 'operator', text: op });
      i += op.length;
    }
  }
  return out;
}

const isValue = (token: Token | undefined): boolean =>
  token !== undefined &&
  (token.kind === 'string' ||
    token.kind === 'number' ||
    [')', ']', '}', '...'].includes(token.text) ||
    (token.kind === 'name' && !NOT_VALUES.has(token.text)));

/** The code's token count as PICO-8 reports it. */
export function countTokens(code: string): number {
  const tokens = tokenize(code);
  return tokens.filter((token, k) => {
    if (FREE.has(token.text)) return false;
    const unary = (token.text === '-' || token.text === '~') && tokens[k + 1]?.kind === 'number';
    return !(unary && !isValue(tokens[k - 1]));
  }).length;
}

/** Each ROM's code lengths in an export's .js, in the order of its _cartname. */
export function romCodeLengths(js: string): { decompressed: number; compressed: number }[] {
  const start = js.indexOf('var _cartdat=[');
  if (start === -1) throw new Error('no _cartdat in the export');
  const end = js.indexOf(']', start);
  const bytes = js.slice(start + 'var _cartdat=['.length, end).split(',').map(Number);
  const lengths = [];
  for (let rom = 0; rom + ROM_SIZE <= bytes.length; rom += ROM_SIZE) {
    const b = bytes.slice(rom + CODE_AT, rom + CODE_AT + 8);
    if (String.fromCharCode(...b.slice(0, 4)) !== '\0pxa') {
      throw new Error(`ROM ${rom / ROM_SIZE} has no compressed code at 0x4300`);
    }
    lengths.push({ decompressed: b[4]! * 256 + b[5]!, compressed: b[6]! * 256 + b[7]! });
  }
  return lengths;
}

function main(args: string[]): number {
  const url = (path: string): URL => new URL(`../${path}`, import.meta.url);
  const exports = CART_ORDER.map((id) => {
    const path = url(`public/games/${id}.js`);
    const js = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const names = js ? exportedCarts(js) : [id];
    return { id, names, lengths: js ? romCodeLengths(js) : null };
  });

  const unknown = args.filter((arg) => !exports.some((e) => e.id === arg || e.names.includes(arg)));
  if (unknown.length > 0) {
    console.error(`No export carries ${unknown.join(', ')}. Carts: ${CART_ORDER.join(', ')}`);
    return 1;
  }

  const n = (value: number): string => value.toLocaleString('en-US');
  const of = (value: number, limit: number): string => `${n(value)} / ${n(limit)}`;
  const rows: string[][] = [['', 'tokens', 'chars', 'compressed', 'free']];
  const notes: string[] = [];
  let over = false;

  for (const { id, names, lengths } of exports) {
    if (args.length > 0 && !args.includes(id) && !names.some((name) => args.includes(name))) continue;
    names.forEach((name, k) => {
      const code = luaSection(readFileSync(url(`carts/${name}.p8`), 'utf8'));
      const tokens = countTokens(code);
      const chars = codeLength(code);
      const rom = lengths?.[k];
      const stale = rom !== undefined && rom.decompressed !== chars;
      if (!rom) notes.push(`${name} has never been exported. /reexport-cart ${id} measures it.`);
      if (stale) {
        notes.push(`${name} has changed since its export (${n(rom.decompressed)} characters then, ` +
          `${n(chars)} now), so compressed is the last export's. /reexport-cart ${id} brings it level.`);
      }
      over ||= tokens > LIMITS.tokens || chars > LIMITS.chars || (rom?.compressed ?? 0) > LIMITS.compressed;
      rows.push([
        name,
        of(tokens, LIMITS.tokens),
        of(chars, LIMITS.chars),
        rom ? `${of(rom.compressed, LIMITS.compressed)}${stale ? '*' : ' '}` : '- ',
        rom ? n(LIMITS.compressed - rom.compressed) : '-',
      ]);
    });
  }

  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  for (const row of rows) {
    console.log(row.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!))).join('   '));
  }
  for (const note of notes) console.log(`\n* ${note}`);
  return over ? 1 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
