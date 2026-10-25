// A cart's label lives in three places, and this moves it between them:
//   - the .p8's __label__ section, 128 rows of colour digits, the only full-colour copy;
//   - the poster behind the play button in the exported .html, the same picture at half
//     brightness, which every visitor sees before the cart starts;
//   - a PNG, for looking at a capture without opening PICO-8.
//
//   node scripts/cart-label.ts png     <cart.p8> <out.png> [scale]
//   node scripts/cart-label.ts check   <cart.p8> <export.html>
//   node scripts/cart-label.ts restore <cart.p8> <export.html>
//
// `restore` writes the poster back into the .p8, for a poster that went live from a label
// nobody saved. Halving keeps all 32 palette colours distinct, so the round trip is exact.
// tests/cart-labels.test.ts runs the same check as `check` on every cart.
//
// Exits 2 when the cart has no label or a blank one, meaning "capture one first", and 1 for
// anything else that goes wrong, including a poster that doesn't match.

import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export const SIZE = 128;

// The 16 standard colours as digits 0-f, then the 16 extended ones (128-143) as g-v.
const PALETTE = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
  0x291814, 0x111d35, 0x422136, 0x125359, 0x742f29, 0x49333b, 0xa28879, 0xf3ef7d,
  0xbe1250, 0xff6c24, 0xa8e72e, 0x00b543, 0x065ab5, 0x754665, 0xff6e59, 0xff9d81,
];
// The poster's colours: every channel shifted right by one.
const DIMMED = PALETTE.map((rgb) => (rgb >> 1) & 0x7f7f7f);
const SECTION = /^__\w+__$/;

export const isBlank = (label: string): boolean => /^0+$/.test(label);

export const countDifferences = (a: string, b: string): number =>
  [...a].filter((digit, i) => digit !== b[i]).length;

/** The label as SIZE*SIZE colour digits, or null if the cart has no __label__ section. */
export function readLabel(cart: string): string | null {
  const lines = cart.split('\n');
  const start = lines.indexOf('__label__');
  if (start === -1) return null;
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION.test(line)) break;
    if (line !== '') rows.push(line);
  }
  const rowPattern = new RegExp(`^[0-9a-v]{${SIZE}}$`);
  if (rows.length !== SIZE || !rows.every((row) => rowPattern.test(row))) {
    throw new Error(`__label__ is not ${SIZE} rows of ${SIZE} colour digits`);
  }
  return rows.join('');
}

/** The cart with its __label__ replaced, or added where PICO-8 itself puts one. */
export function withLabel(cart: string, label: string): string {
  const lines = cart.split('\n');
  const rows = Array.from({ length: SIZE }, (_, y) => label.slice(y * SIZE, (y + 1) * SIZE));
  // PICO-8 ends this one section with a blank line.
  const section = ['__label__', ...rows, ''];
  const start = lines.indexOf('__label__');
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !SECTION.test(lines[end]!)) end++;
    lines.splice(start, end - start, ...section);
  } else {
    // After __gfx__ and before everything else, as PICO-8 orders them.
    let at = lines.findIndex((line) => /^__(gff|map|sfx|music)__$/.test(line));
    if (at === -1) at = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    lines.splice(at, 0, ...section);
  }
  return lines.join('\n');
}

// PNG's five scanline filters, each predicting a byte from neighbours already decoded.
function predict(filter: number, left: number, up: number, corner: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - corner;
      const [pl, pu, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
      return pl <= pu && pl <= pc ? left : pu <= pc ? up : corner;
    }
    default:
      throw new Error(`unknown PNG filter type ${filter}`);
  }
}

/** The poster as colour digits. PICO-8 writes it as an RGB PNG in the start button's CSS. */
export function readPoster(html: string): string {
  const match = /\.p8_start_button\{[^}]*?data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(html);
  if (!match) throw new Error('no poster image in .p8_start_button');
  const png = Buffer.from(match[1]!, 'base64');

  let header: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  // 8-bit RGB, not interlaced: the only form PICO-8 writes.
  if (
    !header ||
    header.readUInt32BE(0) !== SIZE ||
    header.readUInt32BE(4) !== SIZE ||
    header[8] !== 8 ||
    header[9] !== 2 ||
    header[12] !== 0
  ) {
    throw new Error(`the poster is not a ${SIZE}x${SIZE} 8-bit RGB PNG`);
  }

  const stride = SIZE * 3;
  const raw = inflateSync(Buffer.concat(data));
  const rgb = Buffer.alloc(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? rgb[y * stride + i - 3]! : 0;
      const up = y > 0 ? rgb[(y - 1) * stride + i]! : 0;
      const corner = y > 0 && i >= 3 ? rgb[(y - 1) * stride + i - 3]! : 0;
      rgb[y * stride + i] = (raw[y * (stride + 1) + 1 + i]! + predict(filter, left, up, corner)) & 0xff;
    }
  }

  let digits = '';
  for (let i = 0; i < SIZE * SIZE; i++) {
    const colour = DIMMED.indexOf(rgb.readUIntBE(i * 3, 3));
    if (colour === -1) {
      throw new Error(`poster pixel ${i % SIZE},${Math.floor(i / SIZE)} is not a dimmed palette colour`);
    }
    digits += colour.toString(32);
  }
  return digits;
}

/** The label as a full-colour PNG, scaled up nearest-neighbour. */
export function labelPng(label: string, scale: number): Buffer {
  // Each scanline is a filter byte (0, none) followed by RGB triples.
  const side = SIZE * scale;
  const stride = 1 + side * 3;
  const raw = Buffer.alloc(side * stride);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const digit = label[Math.floor(y / scale) * SIZE + Math.floor(x / scale)]!;
      raw.writeUIntBE(PALETTE[parseInt(digit, 32)]!, y * stride + 1 + x * 3, 3);
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); // compression, filter and interlace bytes stay 0
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

/** Runs a parser over a file, naming the file in any error it throws. */
function parse<T>(path: string, parser: (text: string) => T): T {
  try {
    return parser(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(1, `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireLabel(cartPath: string): string {
  const label = parse(cartPath, readLabel);
  if (label === null) {
    fail(2, `${cartPath} has no __label__ section. Capture one with Ctrl-7 in PICO-8, then save.`);
  }
  if (isBlank(label)) {
    fail(2, `${cartPath} has a blank label (all black). Capture one with Ctrl-7, then save.`);
  }
  return label;
}

function main([command, cartPath, target, scaleArg = '3']: string[]): void {
  const usage = 'usage: cart-label.ts png|check|restore <cart.p8> <out.png|export.html>';
  if (!cartPath || !target) fail(1, usage);

  if (command === 'png') {
    const scale = Number(scaleArg);
    if (!Number.isInteger(scale) || scale < 1) fail(1, 'scale must be a whole number of at least 1');
    const label = requireLabel(cartPath);
    writeFileSync(target, labelPng(label, scale));
    console.log(`${target}: ${SIZE * scale}x${SIZE * scale}, ${new Set(label).size} colours, from ${cartPath}`);
  } else if (command === 'check') {
    const label = requireLabel(cartPath);
    const changed = countDifferences(parse(target, readPoster), label);
    if (changed > 0) {
      fail(1, `${target}: the poster differs from ${cartPath}'s label in ${changed} of ${SIZE * SIZE} pixels`);
    }
    console.log(`${target}: the poster is ${cartPath}'s label`);
  } else if (command === 'restore') {
    const poster = parse(target, readPoster);
    if (isBlank(poster)) fail(1, `${target}: the poster is blank; refusing to write it as a label`);
    const old = parse(cartPath, readLabel);
    writeFileSync(cartPath, parse(cartPath, (cart) => withLabel(cart, poster)));
    console.log(
      old === null
        ? `${cartPath}: added a __label__ from ${target}'s poster`
        : `${cartPath}: replaced the __label__ from ${target}'s poster (${countDifferences(poster, old)} pixels changed)`,
    );
  } else {
    fail(1, usage);
  }
}

if (import.meta.main) main(process.argv.slice(2));
