// Each cart's Lua constants are a hand-maintained copy of src/lib/gpio.ts, and nothing at
// runtime checks they agree — a mismatch just makes the AI silently stop working. This
// suite is that check: it parses the constants back out of the .p8 sources and asserts
// they still line up with the PROTOCOLS entry the page uses.
//
// Both carts are covered. The shared handshake (status byte, st_* values, GPIO base, move
// byte) is asserted identically for each; the board window differs enough between them —
// tic-tac-toe pokes a flat 1..9 loop, Connect Four pokes a row-major transform of a
// column-major table — that each cart brings its own parser for that one part.
//
// Some offsets are declared implicitly on the cart side (the board window is a loop bound,
// and NO_MOVE is whatever falls outside the range update_ai accepts), so those are parsed
// from the statements that encode them rather than from a named constant.
//
// A failure here means one of two things: the protocol genuinely diverged, or the Lua was
// reformatted and a parser below needs updating. The parse errors say which.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ST_IDLE,
  ST_REQUEST,
  ST_THINKING,
  ST_READY,
  IDX_STATUS,
  NO_MOVE,
  PROTOCOLS,
  TALK_PROTOCOLS,
  readBoard,
  landingCell,
  isLegalMove,
  readTalkCall,
  writeTalkPage,
  readTalkBack,
} from '../src/lib/gpio.ts';
import type { Board, BoardCartId, CartId, Protocol, TalkCartId } from '../src/lib/gpio.ts';

const GPIO_BYTES = 128; // 0x5f80..0x5fff

const source = (cart: CartId) =>
  readFileSync(new URL(`../carts/${cart}.p8`, import.meta.url), 'utf8');

// Parsing, not evaluating: a regex miss means the Lua moved, which must fail loudly rather
// than yield undefined and let an assertion pass vacuously.
function parser(cart: CartId) {
  const lua = source(cart);
  return (re: RegExp, label: string) => {
    const m = lua.match(re);
    assert.ok(
      m,
      `could not parse ${label} from carts/${cart}.p8 — the Lua was reformatted, so this test's parser needs updating (not necessarily a protocol break)`,
    );
    return m.slice(1).map(Number);
  };
}

/**
 * Where the cart's board window starts, and how many bytes it spans.
 *
 * Split per cart because the two publish their boards with structurally different loops.
 * Both return the same thing so the shared assertions below do not care which ran.
 */
const boardWindow: Record<BoardCartId, (p: ReturnType<typeof parser>) => { from: number; cells: number }> = {
  // request_web_move publishes as `for i=1,9 do poke(gpio+i, board[i]) end`, so the loop
  // bounds are where the board actually lives on the cart side.
  tic_tac_toe(parse) {
    const [from, to] = parse(
      /for\s+i\s*=\s*(\d+)\s*,\s*(\d+)\s+do\s+poke\(gpio\s*\+\s*i,\s*board\[i\]\)/,
      'the board-publishing loop in request_web_move',
    );
    return { from, cells: to - from + 1 };
  },

  // publish_board pokes `gpio + 1 + rt*cols + (c-1)`, so the base offset is that literal 1
  // and the span is the board's own dimensions, declared as `cols, rows = 7, 6`.
  connect_four(parse) {
    const [from] = parse(
      /poke\(gpio\s*\+\s*(\d+)\s*\+\s*rt\s*\*\s*cols\s*\+\s*\(c\s*-\s*1\)/,
      'the base offset in publish_board',
    );
    const [cols, rows] = parse(/^cols,\s*rows\s*=\s*(\d+),\s*(\d+)/m, 'the cols, rows declaration');
    return { from, cells: cols * rows };
  },
};

/** A board with `cells` distinct-ish values, used to prove readBoard reads the right window. */
function sampleCells(n: number): Board {
  return Array.from({ length: n }, (_, i) => (i % 3) as 0 | 1 | 2);
}

for (const id of Object.keys(PROTOCOLS) as BoardCartId[]) {
  const p: Protocol = PROTOCOLS[id];
  const parse = parser(id);

  describe(`${id}: named constants agree with gpio.ts`, () => {
    const [status] = parse(/^gp_status\s*=\s*(\d+)/m, 'gp_status');
    const [move] = parse(/^gp_move\s*=\s*(\d+)/m, 'gp_move');
    const [idle, request, thinking, ready] = parse(
      /^st_idle,\s*st_request,\s*st_thinking,\s*st_ready\s*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/m,
      'the st_* status values',
    );

    const pairs = {
      'gp_status / IDX_STATUS': [status, IDX_STATUS],
      'gp_move / idxMove': [move, p.idxMove],
      'st_idle / ST_IDLE': [idle, ST_IDLE],
      'st_request / ST_REQUEST': [request, ST_REQUEST],
      'st_thinking / ST_THINKING': [thinking, ST_THINKING],
      'st_ready / ST_READY': [ready, ST_READY],
    };
    for (const [label, [cart, js]] of Object.entries(pairs)) {
      it(`matches on ${label}`, () => assert.equal(cart, js));
    }

    // The page acks by writing ST_THINKING and the cart tests `status >= st_thinking`, so
    // the two "page is working" states have to sort above the two the cart writes.
    it("orders the states so the cart's `status >= st_thinking` ack test holds", () => {
      assert.ok(thinking > request && ready > request, 'ack states must sort above st_request');
      assert.ok(request > idle, 'st_request must sort above st_idle');
    });

    it('maps the cart to the GPIO block PICO-8 actually exposes', () => {
      const [base] = parse(/^gpio\s*=\s*(0x[0-9a-f]+)/m, 'the gpio base address');
      assert.equal(base, 0x5f80);
    });
  });

  describe(`${id}: board window`, () => {
    const { from, cells } = boardWindow[id](parse);

    it('starts at idxBoard', () => assert.equal(from, p.idxBoard));

    it(`publishes all ${p.cells} cells`, () => assert.equal(cells, p.cells));

    it('is described by cols x rows', () => assert.equal(p.cols * p.rows, p.cells));

    it('is read back by gpio.ts from the same offsets', () => {
      // Bytes the cart would have poked, over an otherwise-zeroed GPIO block.
      const gpio = new Array(GPIO_BYTES).fill(0);
      const cellValues = sampleCells(p.cells);
      for (let i = 0; i < p.cells; i++) gpio[from + i] = cellValues[i];

      assert.deepEqual(readBoard(gpio, p), cellValues);
    });

    it('does not read past its own window', () => {
      // A byte just outside the window must not leak into the board — this is what would
      // break first if idxBoard or cells drifted.
      const gpio = new Array(GPIO_BYTES).fill(0);
      gpio[from + p.cells] = 2;
      assert.deepEqual(readBoard(gpio, p), new Array(p.cells).fill(0));
    });
  });

  describe(`${id}: move byte`, () => {
    // update_ai guards the page's answer with `m >= 0 and m <= N`; anything outside that
    // range is what makes the cart fall back to its own opponent.
    const [lo, hi] = parse(
      /m\s*>=\s*(\d+)\s+and\s+m\s*<=\s*(\d+)/,
      'the accepted move range in update_ai',
    );

    it('accepts from 0, because the page writes 0-based moves', () => assert.equal(lo, 0));

    it(`accepts exactly the ${p.maxMove + 1} ${p.moveUnit}s the page may send`, () => {
      assert.equal(hi, p.maxMove);
    });

    it('rejects NO_MOVE, so the sentinel reaches the fallback', () => {
      assert.ok(NO_MOVE < lo || NO_MOVE > hi, `NO_MOVE (${NO_MOVE}) must fall outside ${lo}..${hi}`);
    });

    it('fits in a byte', () => assert.ok(NO_MOVE >= 0 && NO_MOVE <= 255));
  });

  describe(`${id}: layout`, () => {
    const board = Array.from({ length: p.cells }, (_, i) => p.idxBoard + i);

    it('does not overlap the status byte with the board', () => {
      assert.ok(!board.includes(IDX_STATUS));
    });

    it('does not overlap the move byte with the board', () => {
      assert.ok(!board.includes(p.idxMove));
    });

    it('keeps the status and move bytes distinct', () => {
      assert.notEqual(IDX_STATUS, p.idxMove);
    });

    it('fits inside the 128-byte GPIO block', () => {
      const highest = Math.max(IDX_STATUS, p.idxMove, ...board);
      assert.ok(highest < GPIO_BYTES, `byte ${highest} is past the ${GPIO_BYTES}-byte block`);
    });
  });

  describe(`${id}: move legality`, () => {
    const empty: Board = new Array(p.cells).fill(0);

    it('accepts every move on an empty board', () => {
      for (let m = 0; m <= p.maxMove; m++) {
        assert.ok(isLegalMove(empty, m, p), `${m} should be legal on an empty board`);
      }
    });

    it('rejects out-of-range and non-integer moves', () => {
      for (const m of [-1, p.maxMove + 1, 1.5, NO_MOVE, NaN]) {
        assert.equal(isLegalMove(empty, m, p), false, `${m} must not be playable`);
      }
    });

    it('lands every move inside the board', () => {
      for (let m = 0; m <= p.maxMove; m++) {
        const cell = landingCell(empty, m, p);
        assert.ok(cell !== null && cell >= 0 && cell < p.cells, `${m} landed outside the board`);
      }
    });
  });
}

// Gravity is the one rule the page has to model itself: the cart reports the column it
// played, not the cell, so a wrong landing calculation would ring the wrong square on
// every Connect Four turn while looking perfectly plausible.
describe('connect_four: gravity', () => {
  const p = PROTOCOLS.connect_four;
  const empty: Board = new Array(p.cells).fill(0);
  /** Board index of (row from top, column). */
  const at = (row: number, col: number) => row * p.cols + col;

  it('drops to the bottom row of an empty column', () => {
    assert.equal(landingCell(empty, 3, p), at(p.rows - 1, 3));
  });

  it('stacks on top of an occupied cell', () => {
    const board = [...empty];
    board[at(p.rows - 1, 3)] = 1;
    assert.equal(landingCell(board, 3, p), at(p.rows - 2, 3));
  });

  it('fills a column bottom-up and then rejects it', () => {
    const board = [...empty];
    for (let i = 0; i < p.rows; i++) {
      const cell = landingCell(board, 0, p);
      assert.equal(cell, at(p.rows - 1 - i, 0), `disc ${i + 1} landed on the wrong row`);
      board[cell!] = 2;
    }
    assert.equal(landingCell(board, 0, p), null, 'a full column must be unplayable');
    assert.equal(isLegalMove(board, 0, p), false);
  });

  it('leaves neighbouring columns unaffected', () => {
    const board = [...empty];
    board[at(p.rows - 1, 3)] = 1;
    assert.equal(landingCell(board, 2, p), at(p.rows - 1, 2));
    assert.equal(landingCell(board, 4, p), at(p.rows - 1, 4));
  });
});

// Tic-tac-toe moves name the cell directly, so landingCell must be the identity on a legal
// cell — if it ever starts applying gravity, the panel would ring the wrong square.
describe('tic_tac_toe: moves name the cell they fill', () => {
  const p = PROTOCOLS.tic_tac_toe;
  const empty: Board = new Array(p.cells).fill(0);

  it('lands exactly on the requested cell', () => {
    for (let m = 0; m <= p.maxMove; m++) assert.equal(landingCell(empty, m, p), m);
  });

  it('rejects an occupied cell', () => {
    const board = [...empty];
    board[4] = 1;
    assert.equal(landingCell(board, 4, p), null);
    assert.equal(isLegalMove(board, 4, p), false);
  });
});

// ---- talk carts ------------------------------------------------------------------------
//
// gem-in-eye's shop speaks a different layout over the same handshake: the agent's record
// up, a page of speech down. Every offset is a named gp_* constant in the cart, parsed back
// here, because a drifted offset would not crash anything — the page would just read the
// stash as the purse and Gemini would talk about the wrong numbers.

for (const id of Object.keys(TALK_PROTOCOLS) as TalkCartId[]) {
  const p = TALK_PROTOCOLS[id];
  const parse = parser(id);
  const lua = source(id);

  describe(`${id}: talk constants agree with gpio.ts`, () => {
    const one = (name: string) => parse(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'), name)[0];

    const pairs: Record<string, [number, number]> = {
      'gp_status / IDX_STATUS': [one('gp_status'), IDX_STATUS],
      'gp_pruned / idxPruned': [one('gp_pruned'), p.idxPruned],
      'gp_rollbacks / idxRollbacks': [one('gp_rollbacks'), p.idxRollbacks],
      'gp_uptime / idxUptime': [one('gp_uptime'), p.idxUptime],
      'gp_max_depth / idxMaxDepth': [one('gp_max_depth'), p.idxMaxDepth],
      'gp_depth / idxDepth': [one('gp_depth'), p.idxDepth],
      'gp_purse / idxPurse': [one('gp_purse'), p.idxPurse],
      'gp_stash / idxStash': [one('gp_stash'), p.idxStash],
      'gp_tiers / idxTiers': [one('gp_tiers'), p.idxTiers],
      'gp_occasion / idxOccasion': [one('gp_occasion'), p.idxOccasion],
      'gp_item / idxItem': [one('gp_item'), p.idxItem],
      'gp_tier / idxTier': [one('gp_tier'), p.idxTier],
      'gp_list / idxList': [one('gp_list'), p.idxList],
      'gp_verdict / idxVerdict': [one('gp_verdict'), p.idxVerdict],
      'gp_price / idxPrice': [one('gp_price'), p.idxPrice],
      'gp_flags / idxFlags': [one('gp_flags'), p.idxFlags],
      'gp_len / idxLen': [one('gp_len'), p.idxLen],
      'gp_text / idxText': [one('gp_text'), p.idxText],
    };
    for (const [label, [cart, js]] of Object.entries(pairs)) {
      it(`matches on ${label}`, () => assert.equal(cart, js));
    }

    it('matches the occasion codes', () => {
      const [purchase, next] = parse(/^oc_purchase,\s*oc_next\s*=\s*(\d+),\s*(\d+)/m, 'oc_purchase, oc_next');
      assert.equal(purchase, p.occasionPurchase);
      assert.equal(next, p.occasionNext);
    });

    it('uses the same status values and GPIO base as the game carts', () => {
      const [idle, request, thinking, ready] = parse(
        /^st_idle,\s*st_request,\s*st_thinking,\s*st_ready\s*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/m,
        'the st_* status values',
      );
      assert.deepEqual([idle, request, thinking, ready], [ST_IDLE, ST_REQUEST, ST_THINKING, ST_READY]);
      assert.equal(parse(/^gpio\s*=\s*(0x[0-9a-f]+)/m, 'the gpio base address')[0], 0x5f80);
    });

    it("lists the items in the cart's shop order", () => {
      const names = [...lua.matchAll(/\{name = "(\w+)"/g)].map((m) => m[1]);
      assert.deepEqual(names, [...p.items]);
    });

    it('has a gem tint for every verdict the page can send', () => {
      const m = lua.match(/^gem_tints\s*=\s*\{(.*)\}/m);
      assert.ok(m, 'could not parse gem_tints');
      assert.equal((m[1].match(/split"/g) ?? []).length, p.verdicts.length);
    });

    // A tint that keeps the gem's own colours shows nothing, which is how unimpressed once
    // looked the same as no verdict at all
    it('gives every verdict its own gem colour, none of them the gem at rest', () => {
      const tints = [...lua.match(/^gem_tints\s*=\s*\{(.*)\}/m)![1]!.matchAll(/split"([\d,]+)"/g)].map((t) => t[1]);
      const art = lua.match(/pal\((\d+), t\[1\]\) pal\((\d+), t\[2\]\) pal\((\d+), t\[3\]\)/);
      assert.ok(art, 'could not parse the pal() calls that apply a tint');
      assert.equal(new Set(tints).size, tints.length, `two verdicts share a tint: ${tints.join(' / ')}`);
      assert.ok(!tints.includes(art.slice(1).join(',')), `a tint is the gem's own ${art.slice(1).join(',')}`);
    });
  });

  describe(`${id}: talk layout`, () => {
    const request = [
      [p.idxPruned, 2], [p.idxRollbacks, 2], [p.idxUptime, 2], [p.idxMaxDepth, 1], [p.idxDepth, 1],
      [p.idxPurse, 1], [p.idxStash, 1], [p.idxTiers, p.items.length], [p.idxOccasion, 1],
      [p.idxItem, 1], [p.idxTier, 1], [p.idxList, 1],
    ].flatMap(([at, n]) => Array.from({ length: n }, (_, i) => at + i));
    const reply = [p.idxVerdict, p.idxPrice, p.idxFlags, p.idxLen];

    it('never uses a byte twice', () => {
      const all = [IDX_STATUS, ...request, ...reply];
      assert.equal(new Set(all).size, all.length);
    });

    it('puts the text after every other field and runs it to the end of the block', () => {
      assert.ok(Math.max(IDX_STATUS, ...request, ...reply) < p.idxText);
      assert.equal(p.idxText + p.maxText, GPIO_BYTES);
    });

    it('has room for a full page: 3 lines of 27 plus 2 spaces', () => {
      assert.ok(p.maxText >= 83);
    });
  });

  describe(`${id}: reading and writing over GPIO`, () => {
    it('reads a purchase as the cart publishes it, 16-bit fields low byte first', () => {
      const gpio = new Array(GPIO_BYTES).fill(0);
      gpio[p.idxPruned] = 300 & 0xff; gpio[p.idxPruned + 1] = 300 >> 8;
      gpio[p.idxRollbacks] = 8;
      gpio[p.idxUptime] = 562 & 0xff; gpio[p.idxUptime + 1] = 562 >> 8;
      gpio[p.idxMaxDepth] = 3; gpio[p.idxDepth] = 1; gpio[p.idxPurse] = 1; gpio[p.idxStash] = 10;
      [1, 1, 0, 0, 0].forEach((t, i) => (gpio[p.idxTiers + i] = t));
      gpio[p.idxOccasion] = p.occasionPurchase;
      gpio[p.idxItem] = 4; gpio[p.idxTier] = 1; gpio[p.idxList] = 10;

      assert.deepEqual(readTalkCall(gpio, p), {
        occasion: 'purchase',
        item: 'attack',
        tier: 1,
        listPrice: 10,
        stats: {
          pruned: 300, rollbacks: 8, uptimeSec: 562, maxDepth: 3, lastDepth: 1, purse: 1, stashed: 10,
          tiers: { vitality: 1, stamina: 1, armor: 0, attack: 0, stash: 0 },
        },
      });
    });

    it('reads a continuation, and rejects an occasion it does not know', () => {
      const gpio = new Array(GPIO_BYTES).fill(0);
      gpio[p.idxOccasion] = p.occasionNext;
      assert.deepEqual(readTalkCall(gpio, p), { occasion: 'next' });
      gpio[p.idxOccasion] = 1; // reserved for a greeting, not served yet
      assert.equal(readTalkCall(gpio, p), null);
    });

    it('writes a page without touching the status byte, and clamps it to the block', () => {
      const gpio = new Array(GPIO_BYTES).fill(0);
      gpio[IDX_STATUS] = ST_THINKING;
      const n = writeTalkPage(gpio, p, { text: 'é' + 'x'.repeat(200), verdict: 'unimpressed', price: 8, more: true });

      assert.equal(gpio[IDX_STATUS], ST_THINKING, 'the caller flips status after the payload lands');
      assert.equal(n, p.maxText);
      assert.equal(gpio[p.idxLen], p.maxText);
      assert.equal(gpio[p.idxText], 'x'.charCodeAt(0), 'non-ASCII is dropped, not sent');
      assert.equal(gpio[p.idxVerdict], 3);
      assert.equal(gpio[p.idxPrice], 8);
      assert.equal(gpio[p.idxFlags], p.flagMore);
    });

    it('writes the fallback as an empty page with no quote and no verdict', () => {
      const gpio = new Array(GPIO_BYTES).fill(0);
      writeTalkPage(gpio, p, { text: '' });
      assert.deepEqual([gpio[p.idxVerdict], gpio[p.idxPrice], gpio[p.idxFlags], gpio[p.idxLen]], [0, 0, 0, 0]);
    });

    it("reads back what the cart charged and whether it printed the page's speech", () => {
      const gpio = new Array(GPIO_BYTES).fill(0);
      gpio[p.idxPrice] = 10;
      gpio[p.idxLen] = 0;
      assert.deepEqual(readTalkBack(gpio, p), { charged: 10, showedSpeech: false });
      gpio[p.idxLen] = 31;
      assert.equal(readTalkBack(gpio, p).showedSpeech, true);
    });
  });
}
