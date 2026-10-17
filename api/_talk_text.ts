// Turning gem-in-eye's speech into something carts/gemini.p8 can print.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// The server cleans and pages every speech before returning it, so the panel shows exactly
// what the cart prints and bench/ measures exactly what ships. The cart spends no tokens on
// any of this: it receives one page per GPIO handshake and prints it as it comes.
//
// The box geometry below is a hand-maintained copy of the cart's. wrapText is a
// line-for-line port of the cart's wrap_text, because a page that fits here but wraps to a
// fourth line in the cart collides with the shop shelf's arrow. tests/talk-text.test.ts
// parses the constants back out of the .p8 to catch drift.

/** (box_max_w 116 - box_pad 4 * 2) \ char_w 4 in the cart: characters per dialog line. */
export const BOX_CHARS = 27;

/** The cart's page_lines. The shelf's position leaves room for a 3-line box, no more. */
export const PAGE_LINES = 3;

/** A speech is cut to this many pages; the prompt asks for far less. */
export const MAX_PAGES = 3;

/** GPIO bytes 28-127 carry one page. A full page is 3 lines plus 2 joining spaces, 83. */
export const PAGE_BYTES = 100;

const TYPOGRAPHIC: [RegExp, string][] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
];

/**
 * Lowercase printable ASCII, single-spaced, with no word longer than a line.
 *
 * - Uppercase ASCII renders in PICO-8's alternate font, so everything is lowercased.
 * - `^` is the cart's arrow_char: it would print as an up arrow, not a caret.
 * - Typographic punctuation is mapped before non-ASCII is dropped, so a curly apostrophe
 *   survives as `'` instead of vanishing out of "don't".
 * - The cart's wrap never splits a word, so a word longer than a line would run past the
 *   box edge. Splitting it here turns it into two words the cart can wrap.
 */
export function cleanSpeech(raw: string): string {
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // é -> e, before ASCII-only
  for (const [re, to] of TYPOGRAPHIC) s = s.replace(re, to);
  s = s
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\^/g, '')
    .replace(/[^\x20-\x7e]/g, '');
  return s
    .split(' ')
    .flatMap((word) => word.match(new RegExp(`.{1,${BOX_CHARS}}`, 'g')) ?? [])
    .join(' ')
    .trim();
}

/**
 * The cart's wrap_text, line for line: greedy, splits on spaces only, never splits a word.
 * Only ever called on cleaned text, so characters and bytes are the same thing, as they
 * are for Lua's `#`.
 */
export function wrapText(str: string, maxc = BOX_CHARS): string[] {
  const lines: string[] = [];
  let ln = '';
  let word = '';
  for (let i = 0; i <= str.length; i++) {
    const c = i < str.length ? str[i] : ' ';
    if (c === ' ') {
      if (word.length > 0) {
        if (ln.length === 0) ln = word;
        else if (ln.length + 1 + word.length <= maxc) ln = `${ln} ${word}`;
        else {
          lines.push(ln);
          ln = word;
        }
        word = '';
      }
    } else {
      word += c;
    }
  }
  if (ln.length > 0) lines.push(ln);
  return lines;
}

export type Paged = {
  /** Each page is its lines joined by single spaces. Re-wrapping a page in the cart gives
   *  back the same lines, because greedy wrapping restarts identically at a line break. */
  pages: string[];
  /** The speech ran past MAX_PAGES and was shortened. */
  cut: boolean;
};

/**
 * Split cleaned speech into 3-line pages, at most MAX_PAGES of them.
 *
 * Past the limit, the speech is cut at the last sentence end that keeps at least half of
 * what fits, and otherwise at the last whole word. A speech that stops mid-thought reads
 * as a bug; one that stops a sentence early reads as deadpan.
 */
export function paginate(clean: string): Paged {
  let lines = wrapText(clean);
  const maxLines = PAGE_LINES * MAX_PAGES;
  const cut = lines.length > maxLines;

  if (cut) {
    let kept = lines.slice(0, maxLines).join(' ');
    let lastEnd = -1;
    for (const m of kept.matchAll(/[.!?](?= |$)/g)) lastEnd = m.index;
    if (lastEnd >= kept.length / 2) kept = kept.slice(0, lastEnd + 1);
    lines = wrapText(kept);
  }

  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += PAGE_LINES) {
    pages.push(lines.slice(i, i + PAGE_LINES).join(' '));
  }
  return { pages, cut };
}
