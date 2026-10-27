// The speech pipeline's contract with the cart: what the server pages must print in
// carts/gemini.p8 exactly as paged. A page that wraps to a fourth line in the cart collides
// with the shop shelf's arrow, and nothing at runtime would notice — the box just overflows.
//
// The box geometry is parsed out of the .p8 rather than trusted, the same way
// gpio-protocol.test.ts treats the GPIO constants: _talk_text.ts holds a hand-maintained
// copy, and this is the check that the copy still matches.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BOX_CHARS, PAGE_LINES, MAX_PAGES, PAGE_BYTES, cleanSpeech, wrapText, paginate } from '../api/_talk_text.ts';

const lua = readFileSync(new URL('../carts/gemini.p8', import.meta.url), 'utf8');

function num(name: string): number {
  const m = lua.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'));
  assert.ok(m, `could not parse ${name} from carts/gemini.p8 — the Lua moved, so this parser needs updating`);
  return Number(m[1]);
}

describe('box geometry matches the cart', () => {
  it('BOX_CHARS is the cart box_chars', () => {
    assert.match(lua, /^box_chars\s*=\s*\(box_max_w - box_pad \* 2\) \\ char_w/m, 'box_chars is no longer derived the same way');
    assert.equal(BOX_CHARS, Math.floor((num('box_max_w') - num('box_pad') * 2) / num('char_w')));
  });

  it('PAGE_LINES is the cart page_lines', () => {
    assert.equal(PAGE_LINES, num('page_lines'));
  });

  it('a full page fits one GPIO handshake', () => {
    // 3 lines of 27 plus the 2 spaces that join them
    assert.ok(PAGE_LINES * BOX_CHARS + (PAGE_LINES - 1) <= PAGE_BYTES);
  });
});

describe('wrapText is the cart wrap_text', () => {
  it('fills lines greedily on spaces', () => {
    assert.deepEqual(wrapText('forty pruned. not one rollback.'), ['forty pruned. not one', 'rollback.']);
  });

  it('allows a line of exactly 27, and wraps at 28', () => {
    assert.deepEqual(wrapText('aaaaaaaaaaaaa bbbbbbbbbbbbb'), ['aaaaaaaaaaaaa bbbbbbbbbbbbb']);
    assert.deepEqual(wrapText('aaaaaaaaaaaaa bbbbbbbbbbbbbb'), ['aaaaaaaaaaaaa', 'bbbbbbbbbbbbbb']);
  });

  it('never splits a word, even one longer than a line', () => {
    // The cart's behaviour, ported as-is. cleanSpeech is what keeps such words out.
    assert.deepEqual(wrapText('x '.concat('y'.repeat(30))), ['x', 'y'.repeat(30)]);
  });

  it('collapses runs of spaces, as the Lua does', () => {
    assert.deepEqual(wrapText('  a   b  '), ['a b']);
  });

  it('returns no lines for empty text', () => {
    assert.deepEqual(wrapText(''), []);
  });
});

describe('cleanSpeech', () => {
  it('lowercases, because uppercase ASCII prints in the alternate font', () => {
    assert.equal(cleanSpeech('Agent 4012, You AGAIN.'), 'agent 4012, you again.');
  });

  it('maps typographic punctuation to ASCII instead of dropping it', () => {
    assert.equal(cleanSpeech('don’t — “really”…'), `don't - "really"...`);
  });

  it('drops the cart arrow_char, emoji and anything else outside printable ASCII', () => {
    assert.equal(cleanSpeech('up ^ there 🧙 now'), 'up there now');
  });

  it('strips accents rather than losing the letter', () => {
    assert.equal(cleanSpeech('café naïve'), 'cafe naive');
  });

  it('turns newlines and tabs into single spaces', () => {
    assert.equal(cleanSpeech('one\n\ttwo   three'), 'one two three');
  });

  it('splits a word longer than a line, so the box cannot overflow', () => {
    const cleaned = cleanSpeech('z'.repeat(30));
    assert.equal(cleaned, `${'z'.repeat(27)} zzz`);
    for (const line of wrapText(cleaned)) assert.ok(line.length <= BOX_CHARS);
  });
});

describe('paginate', () => {
  it('keeps a short speech on one page', () => {
    assert.deepEqual(paginate('fifteen rollbacks. stamina, then.'), {
      pages: ['fifteen rollbacks. stamina, then.'],
      cut: false,
    });
  });

  it('starts a new page every 3 lines', () => {
    const lines = ['aaaa', 'bbbb', 'cccc', 'dddd'].map((w) => `${w} ${'x'.repeat(22)}`);
    const { pages, cut } = paginate(lines.join(' '));
    assert.equal(cut, false);
    assert.equal(pages.length, 2);
    assert.deepEqual(wrapText(pages[1]), [lines[3]]);
  });

  it(`cuts past ${MAX_PAGES} pages, preferring a sentence end`, () => {
    const sentence = 'the branch is long and the agent is short of breath.'; // 2 lines
    const { pages, cut } = paginate(Array(8).fill(sentence).join(' '));
    assert.equal(cut, true);
    assert.ok(pages.length <= MAX_PAGES);
    assert.ok(pages.at(-1)!.endsWith('.'), `cut mid-sentence: "${pages.at(-1)}"`);
  });

  it('falls back to a whole-word cut when there is no sentence end', () => {
    const { pages, cut } = paginate(Array(60).fill('loop').join(' '));
    assert.equal(cut, true);
    assert.equal(pages.length, MAX_PAGES);
    assert.ok(pages.every((p) => p.split(' ').every((w) => w === 'loop')));
  });

  it('returns no pages for an empty speech', () => {
    assert.deepEqual(paginate(''), { pages: [], cut: false });
  });

  it('every page re-wraps in the cart to at most 3 lines and fits one handshake', () => {
    // Deterministic pseudo-random words of mixed length, including some that must be split.
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
    for (let trial = 0; trial < 300; trial++) {
      const speech = Array.from({ length: 1 + rand(60) }, () => 'w'.repeat(1 + rand(rand(10) === 0 ? 35 : 10))).join(' ');
      const { pages } = paginate(cleanSpeech(speech));
      assert.ok(pages.length <= MAX_PAGES);
      for (const page of pages) {
        assert.ok(page.length <= PAGE_BYTES, `page of ${page.length} bytes`);
        const lines = wrapText(page);
        assert.ok(lines.length <= PAGE_LINES, `page wraps to ${lines.length} lines in the cart`);
        for (const line of lines) assert.ok(line.length <= BOX_CHARS);
      }
    }
  });
});
