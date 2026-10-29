// The site's favicon is gem-in-eye's head, drawn from carts/gemini.p8 rather than kept as a
// picture of its own, which would quietly stop matching him the first time he is redrawn.
// This writes the two files index.html links:
//   - public/favicon.svg, one path per colour, sharp at any size;
//   - public/favicon.ico, a single 32x32 PNG, for browsers without SVG icons and for the
//     /favicon.ico every browser requests unprompted.
//
//   node scripts/favicon.ts
//
// tests/favicon.test.ts fails until both match the cart, so after redrawing the head, run it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
export const CART = join(ROOT, 'carts', 'gemini.p8');
export const SVG = join(ROOT, 'public', 'favicon.svg');
export const ICO = join(ROOT, 'public', 'favicon.ico');

// Sprite 76, 4x4 sprites: sheet_x, sheet_y in the cart's draw_wizard().
const SHEET_X = 96;
const SHEET_Y = 32;
const SIDE = 32;
// He sits on a black tile, as in the shop, because his beard is near-white and vanishes
// against a light tab strip. The tile's corners are cut in steps this many pixels deep.
const CORNER = 3;

// The 16 standard colours. The sprite sheet holds no others.
const PALETTE = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
];

/** A palette index, or null where the tile's corners are cut away. */
type Pixel = number | null;

/** The head as SIDE*SIDE pixels, row by row. */
export function head(cart: string): Pixel[] {
  const lines = cart.split('\n');
  const start = lines.indexOf('__gfx__');
  if (start === -1) throw new Error('the cart has no __gfx__ section');
  const pixels: Pixel[] = [];
  for (let y = 0; y < SIDE; y++) {
    // PICO-8 drops trailing all-zero rows, so a missing row is zeros
    const row = lines[start + 1 + SHEET_Y + y] ?? '';
    const sheetRow = /^[0-9a-f]{128}$/.test(row) ? row : '0'.repeat(128);
    for (let x = 0; x < SIDE; x++) {
      const colour = parseInt(sheetRow[SHEET_X + x]!, 16);
      const corner = Math.min(x, SIDE - 1 - x) + Math.min(y, SIDE - 1 - y) < CORNER;
      pixels.push(corner && colour === 0 ? null : colour);
    }
  }
  return pixels;
}

/** An SVG path covering every pixel `inside` accepts, one rectangle per run along a row. */
function cover(pixels: Pixel[], inside: (pixel: Pixel) => boolean): string {
  let d = '';
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (!inside(pixels[y * SIDE + x]!)) continue;
      const from = x;
      while (x + 1 < SIDE && inside(pixels[y * SIDE + x + 1]!)) x++;
      const w = x - from + 1;
      d += `M${from} ${y}h${w}v1h-${w}z`;
    }
  }
  return d;
}

const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

export function faviconSvg(cart: string): string {
  const pixels = head(cart);
  const colours = [...new Set(pixels)].filter((c): c is number => c !== null && c !== 0).sort((a, b) => a - b);
  // the whole tile first, so a seam between two colours shows black, not the tab behind
  const layers: [number, string][] = [
    [0, cover(pixels, (c) => c !== null)],
    ...colours.map((colour): [number, string] => [colour, cover(pixels, (c) => c === colour)]),
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}" shape-rendering="crispEdges">`,
    ...layers.map(([colour, d]) => `  <path fill="${hex(PALETTE[colour]!)}" d="${d}"/>`),
    '</svg>',
    '',
  ].join('\n');
}

/** The head as a SIDE*SIDE RGBA PNG, transparent where the corners are cut. */
function headPng(pixels: Pixel[]): Buffer {
  // Each scanline is a filter byte (0, none) followed by RGBA quads.
  const stride = 1 + SIDE * 4;
  const raw = Buffer.alloc(SIDE * stride);
  pixels.forEach((colour, i) => {
    if (colour === null) return;
    const at = Math.floor(i / SIDE) * stride + 1 + (i % SIDE) * 4;
    raw.writeUIntBE(PALETTE[colour]!, at, 3);
    raw[at + 3] = 0xff;
  });

  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); // compression, filter and interlace bytes stay 0
  header.writeUInt32BE(SIDE, 0);
  header.writeUInt32BE(SIDE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An .ico holding one PNG, which every browser that reads .ico accepts. */
export function faviconIco(cart: string): Buffer {
  const png = headPng(head(cart));
  // ICONDIR, then one ICONDIRENTRY. Colour count and the reserved bytes stay 0
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // images
  header[6] = SIDE; // width
  header[7] = SIDE; // height
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18); // where the PNG starts
  return Buffer.concat([header, png]);
}

if (import.meta.main) {
  const cart = readFileSync(CART, 'utf8');
  writeFileSync(SVG, faviconSvg(cart));
  writeFileSync(ICO, faviconIco(cart));
  console.log("public/favicon.svg, public/favicon.ico: gem-in-eye's head, from carts/gemini.p8");
}
