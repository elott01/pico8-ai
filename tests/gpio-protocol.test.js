// The cart's Lua constants are a hand-maintained copy of src/lib/gpio.js, and nothing at
// runtime checks they agree — a mismatch just makes the AI silently stop working. This
// suite is that check: it parses the constants back out of the .p8 source and asserts
// they still line up with the JS the page uses.
//
// The cart declares two of its offsets implicitly (the board window is a loop bound, and
// NO_MOVE is whatever falls outside the range update_ai accepts), so those are parsed from
// the statements that encode them rather than from a named constant.
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
  IDX_BOARD,
  IDX_MOVE,
  NO_MOVE,
  readBoard,
} from '../src/lib/gpio.js';

const CART = 'carts/tic_tac_toe.p8';
const lua = readFileSync(new URL(`../${CART}`, import.meta.url), 'utf8');

const GPIO_BYTES = 128; // 0x5f80..0x5fff
const CELLS = 9;

// Parsing, not evaluating: a regex miss means the Lua moved, which must fail loudly rather
// than yield undefined and let an assertion pass vacuously.
function parse(re, label) {
  const m = lua.match(re);
  assert.ok(m, `could not parse ${label} from ${CART} — the Lua was reformatted, so this test's parser needs updating (not necessarily a protocol break)`);
  return m.slice(1).map(Number);
}

describe('named constants agree with gpio.js', () => {
  const [status] = parse(/^gp_status\s*=\s*(\d+)/m, 'gp_status');
  const [move] = parse(/^gp_move\s*=\s*(\d+)/m, 'gp_move');
  const [idle, request, thinking, ready] = parse(
    /^st_idle,\s*st_request,\s*st_thinking,\s*st_ready\s*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/m,
    'the st_* status values',
  );

  const pairs = {
    'gp_status / IDX_STATUS': [status, IDX_STATUS],
    'gp_move / IDX_MOVE': [move, IDX_MOVE],
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
  it('orders the states so the cart\'s `status >= st_thinking` ack test holds', () => {
    assert.ok(thinking > request && ready > request, 'ack states must sort above st_request');
    assert.ok(request > idle, 'st_request must sort above st_idle');
  });
});

describe('board window', () => {
  // request_web_move publishes the board as `for i=1,9 do poke(gpio+i, board[i]) end`, so
  // the loop bounds are where IDX_BOARD actually lives on the cart side.
  const [from, to] = parse(
    /for\s+i\s*=\s*(\d+)\s*,\s*(\d+)\s+do\s+poke\(gpio\s*\+\s*i,\s*board\[i\]\)/,
    'the board-publishing loop in request_web_move',
  );

  it('starts at IDX_BOARD', () => assert.equal(from, IDX_BOARD));

  it('publishes all nine cells', () => assert.equal(to - from + 1, CELLS));

  it('is read back by gpio.js from the same offsets', () => {
    // Bytes the cart would have poked, over an otherwise-zeroed GPIO block.
    const gpio = new Array(GPIO_BYTES).fill(0);
    const cells = [1, 2, 0, 0, 1, 2, 2, 0, 1];
    for (let i = 0; i < CELLS; i++) gpio[from + i] = cells[i];

    assert.deepEqual(readBoard(gpio), cells);
  });
});

describe('move byte', () => {
  // update_ai guards the page's answer with `m >= 0 and m <= 8`; anything outside that
  // range is what makes the cart fall back to its own minimax.
  const [lo, hi] = parse(
    /m\s*>=\s*(\d+)\s+and\s+m\s*<=\s*(\d+)/,
    'the accepted move range in update_ai',
  );

  it('accepts exactly the nine cell indices', () => {
    assert.equal(lo, 0, 'the page writes 0-based cells');
    assert.equal(hi - lo + 1, CELLS);
  });

  it('rejects NO_MOVE, so the sentinel reaches the minimax fallback', () => {
    assert.ok(NO_MOVE < lo || NO_MOVE > hi, `NO_MOVE (${NO_MOVE}) must fall outside ${lo}..${hi}`);
  });

  it('fits in a byte', () => assert.ok(NO_MOVE >= 0 && NO_MOVE <= 255));
});

describe('layout', () => {
  const board = Array.from({ length: CELLS }, (_, i) => IDX_BOARD + i);

  it('does not overlap the status byte with the board', () => {
    assert.ok(!board.includes(IDX_STATUS));
  });

  it('does not overlap the move byte with the board', () => {
    assert.ok(!board.includes(IDX_MOVE));
  });

  it('keeps the status and move bytes distinct', () => {
    assert.notEqual(IDX_STATUS, IDX_MOVE);
  });

  it('fits inside the 128-byte GPIO block', () => {
    const highest = Math.max(IDX_STATUS, IDX_MOVE, ...board);
    assert.ok(highest < GPIO_BYTES, `byte ${highest} is past the ${GPIO_BYTES}-byte block`);
  });

  it('maps the cart to the GPIO block PICO-8 actually exposes', () => {
    const [base] = parse(/^gpio\s*=\s*(0x[0-9a-f]+)/m, 'the gpio base address');
    assert.equal(base, 0x5f80);
  });
});
