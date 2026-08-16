// The Connect Four benchmark's ground truth, checked before it is used to grade anything.
//
// The fixtures are hand-authored ASCII and the scorer is hand-written, so both can be
// wrong in ways that look completely plausible in a results table: a transposed board, a
// disc floating in mid-air, an `expect` that does not match the position it describes. A
// live A/B costs real Gemini quota, and a bad fixture spends it producing a confident
// number about nothing. Everything here is free and runs in CI.
//
// The scorer is not cross-checked against src/lib/gpio.ts on purpose — the bench keeps its
// own implementation so the two can disagree and be caught. What IS checked is that each
// fixture's stated `expect` follows from the scorer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLS,
  ROWS,
  CELLS,
  at,
  parseBoard,
  render,
  landing,
  legalColumns,
  isLegal,
  hasFour,
  winningColumns,
  giftColumns,
  threats,
  WINDOWS,
  counts,
  gravityHolds,
  buildC4Prompt,
  C4_POSITIONS,
  C4_VARIANTS,
} from '../bench/connect_four.ts';
import type { C4Board } from '../bench/connect_four.ts';

const EMPTY: C4Board = new Array(CELLS).fill(0);

describe('board notation', () => {
  it('round-trips through parse and render', () => {
    const art = ['.......', '.......', '.......', '...a...', '...h...', 'h..a..h'].join('\n');
    assert.equal(render(parseBoard(art)), art);
  });

  it('reads top row first', () => {
    const board = parseBoard(`
      a......
      .......
      .......
      .......
      .......
      ......h
    `);
    assert.equal(board[at(0, 0)], 2, 'top-left should be the AI disc');
    assert.equal(board[at(ROWS - 1, COLS - 1)], 1, 'bottom-right should be the human disc');
  });

  it('rejects a malformed fixture rather than guessing', () => {
    assert.throws(() => parseBoard('...\n...\n...\n...\n...\n...'), /not 7 wide/);
    assert.throws(() => parseBoard('.......\n.......'), /expected 6 rows/);
    assert.throws(() => parseBoard(['.......', '.......', '.......', '.......', '.......', '...x...'].join('\n')), /unknown glyph/);
  });
});

describe('gravity', () => {
  it('drops to the bottom of an empty column', () => {
    assert.equal(landing(EMPTY, 3), at(ROWS - 1, 3));
  });

  it('stacks on top of an occupied cell', () => {
    const board = [...EMPTY];
    board[at(ROWS - 1, 3)] = 1;
    assert.equal(landing(board, 3), at(ROWS - 2, 3));
  });

  it('fills a column bottom-up and then rejects it', () => {
    const board = [...EMPTY];
    for (let i = 0; i < ROWS; i++) {
      const cell = landing(board, 0);
      assert.equal(cell, at(ROWS - 1 - i, 0));
      board[cell!] = 2;
    }
    assert.equal(landing(board, 0), null);
    assert.equal(isLegal(board, 0), false);
    assert.deepEqual(legalColumns(board), [1, 2, 3, 4, 5, 6]);
  });

  it('rejects out-of-range columns', () => {
    for (const c of [-1, COLS, 1.5, NaN]) assert.equal(landing(EMPTY, c), null);
  });

  it('spots a floating disc', () => {
    const floating = [...EMPTY];
    floating[at(0, 0)] = 1; // top of an otherwise empty column
    assert.equal(gravityHolds(floating), false);
    assert.equal(gravityHolds(EMPTY), true);
  });
});

describe('four in a row', () => {
  const four = (cells: [number, number][]): C4Board => {
    const b = [...EMPTY];
    for (const [r, c] of cells) b[at(r, c)] = 2;
    return b;
  };

  it('finds a horizontal four', () => {
    assert.ok(hasFour(four([[5, 1], [5, 2], [5, 3], [5, 4]]), 2));
  });

  it('finds a vertical four', () => {
    assert.ok(hasFour(four([[5, 0], [4, 0], [3, 0], [2, 0]]), 2));
  });

  it('finds both diagonals', () => {
    assert.ok(hasFour(four([[5, 0], [4, 1], [3, 2], [2, 3]]), 2), 'up-right diagonal');
    assert.ok(hasFour(four([[5, 6], [4, 5], [3, 4], [2, 3]]), 2), 'up-left diagonal');
  });

  it('does not count three, or a run broken by the other player', () => {
    assert.equal(hasFour(four([[5, 1], [5, 2], [5, 3]]), 2), false);
    const broken = four([[5, 1], [5, 2], [5, 4], [5, 5]]);
    broken[at(5, 3)] = 1;
    assert.equal(hasFour(broken, 2), false);
  });

  it('does not wrap around a row edge', () => {
    // Columns 5,6 of one row plus 0,1 of the next are adjacent in the flat array but not
    // on the board — the classic off-by-one in a row-major win check.
    const wrap = four([[4, 5], [4, 6], [3, 0], [3, 1]]);
    assert.equal(hasFour(wrap, 2), false);
  });
});

describe('lines of four', () => {
  it('enumerates exactly the 69 lines Connect Four has', () => {
    // 24 horizontal + 21 vertical + 12 + 12 diagonal. A wrong count means the window
    // generator is dropping or double-counting whole directions.
    assert.equal(WINDOWS.length, 69);
  });

  it('keeps every line on the board and four cells long', () => {
    for (const w of WINDOWS) {
      assert.equal(w.length, 4);
      assert.equal(new Set(w).size, 4, 'a line must not repeat a cell');
      for (const i of w) assert.ok(i >= 0 && i < CELLS, `cell ${i} is off the board`);
    }
  });

  it('has no duplicate lines', () => {
    const keys = WINDOWS.map((w) => [...w].sort((a, b) => a - b).join(','));
    assert.equal(new Set(keys).size, WINDOWS.length);
  });
});

describe('threats', () => {
  it('finds a playable horizontal gap', () => {
    const board = parseBoard(`
      .......
      .......
      .......
      .......
      h......
      ahhh.aa
    `);
    const t = threats(board, 1);
    assert.equal(t.length, 1);
    assert.equal(t[0].col, 4);
    assert.equal(t[0].row, 1, 'the gap is on the bottom row');
    assert.equal(t[0].playable, true);
  });

  it('marks a gap that needs discs stacked under it as not yet reachable', () => {
    // Human has three on row 4; the completing square at column 4 row 4 sits above an
    // empty cell, so it cannot be taken this turn.
    const board = parseBoard(`
      .......
      .......
      .......
      .......
      .hhh...
      .aha..a
    `);
    const t = threats(board, 1);
    assert.ok(t.length > 0, 'the row-4 line should be reported');
    const atFour = t.find((x) => x.col === 4);
    assert.ok(atFour, 'column 4 should be one of the gaps');
    assert.equal(atFour.playable, false, 'row 5 under it is empty, so it is not reachable yet');
  });

  it('reports nothing when no line is one disc short', () => {
    assert.deepEqual(threats(new Array(CELLS).fill(0) as C4Board, 1), []);
    assert.deepEqual(threats(new Array(CELLS).fill(0) as C4Board, 2), []);
  });

  it('agrees with winningColumns on which gaps are playable', () => {
    // Two independent routes to the same answer: winningColumns simulates the drop,
    // threats reads the lines. They must not disagree.
    for (const p of C4_POSITIONS) {
      for (const player of [1, 2] as const) {
        const playable = threats(p.board, player)
          .filter((t) => t.playable)
          .map((t) => t.col);
        assert.deepEqual(
          playable,
          winningColumns(p.board, player),
          `${p.name}, player ${player}`,
        );
      }
    }
  });
});

describe('every fixture is a position the AI could actually face', () => {
  for (const p of C4_POSITIONS) {
    describe(p.name, () => {
      it('has all 42 cells', () => assert.equal(p.board.length, CELLS));

      it('has no disc floating in mid-air', () => {
        assert.ok(gravityHolds(p.board), `gravity broken:\n${render(p.board)}`);
      });

      // The human moves first, so on the AI's turn the human is exactly one disc ahead.
      it('has the human one disc ahead, so it is the AI to move', () => {
        const { human, ai } = counts(p.board);
        assert.equal(human, ai + 1, `human ${human}, ai ${ai}:\n${render(p.board)}`);
      });

      it('is not already won by either side', () => {
        assert.equal(hasFour(p.board, 1), false, 'human already has four');
        assert.equal(hasFour(p.board, 2), false, 'AI already has four');
      });

      it('expects only legal columns', () => {
        const legal = legalColumns(p.board);
        for (const c of p.expect) {
          assert.ok(legal.includes(c), `expects ${c}, but legal columns are [${legal}]`);
        }
      });

      it('expects at least one column but not every column', () => {
        assert.ok(p.expect.length > 0, 'a fixture with no correct answer grades nothing');
        assert.ok(
          p.expect.length < legalColumns(p.board).length,
          'a fixture where every legal column is correct cannot discriminate',
        );
      });
    });
  }
});

// Each fixture's `why` claims something specific. These assert the claim against the
// scorer, so a fixture cannot drift away from its own justification.
describe('fixtures match the tactics they claim', () => {
  const find = (name: string) => {
    const p = C4_POSITIONS.find((x) => x.name === name);
    assert.ok(p, `fixture "${name}" is gone — this test needs updating`);
    return p;
  };

  it('win-across: the AI wins exactly where expected', () => {
    const p = find('win-across');
    assert.deepEqual(winningColumns(p.board, 2), p.expect);
  });

  it('block-across: the human wins exactly where expected, and the AI cannot win', () => {
    const p = find('block-across');
    assert.deepEqual(winningColumns(p.board, 1), p.expect);
    assert.deepEqual(winningColumns(p.board, 2), []);
  });

  it('win-over-block: a win and a separate threat exist, and the win is expected', () => {
    const p = find('win-over-block');
    const wins = winningColumns(p.board, 2);
    const threats = winningColumns(p.board, 1);
    assert.deepEqual(wins, p.expect, 'the AI win must be the expected column');
    assert.ok(threats.length > 0, 'there must be a human threat to be tempted by');
    assert.notDeepEqual(wins, threats, 'win and block must differ or the test proves nothing');
  });

  it('block-vertical: the only human win is the expected column', () => {
    const p = find('block-vertical');
    assert.deepEqual(winningColumns(p.board, 1), p.expect);
  });

  it('double-threat: no tactic yet, and the expected move creates two winning columns', () => {
    const p = find('double-threat');
    assert.deepEqual(winningColumns(p.board, 2), [], 'no immediate win, or two-ply sight is not tested');
    assert.deepEqual(winningColumns(p.board, 1), [], 'no immediate threat, or rule 2 decides it');

    const [col] = p.expect;
    const next = [...p.board];
    next[landing(p.board, col)!] = 2;
    assert.equal(
      winningColumns(next, 2).length,
      2,
      `playing ${col} should leave two winning columns, not ${winningColumns(next, 2).length}`,
    );
  });

  it('avoid-gift: the excluded columns are exactly the gifts', () => {
    const p = find('avoid-gift');
    assert.deepEqual(winningColumns(p.board, 1), [], 'no immediate threat, or rule 2 decides it');
    const gifts = giftColumns(p.board, 2);
    const excluded = legalColumns(p.board).filter((c) => !p.expect.includes(c));
    assert.deepEqual(gifts, excluded, 'expect should be every legal column except the gifts');
  });

  it('opening: the human has moved once and no tactic exists yet', () => {
    const p = find('opening');
    const { human, ai } = counts(p.board);
    assert.equal(human, 1);
    assert.equal(ai, 0);
    assert.deepEqual(winningColumns(p.board, 1), []);
    assert.deepEqual(winningColumns(p.board, 2), []);
  });
});

describe('prompt variants', () => {
  const board = parseBoard(`
    .......
    .......
    .......
    .......
    .......
    ...h...
  `);

  // Built here rather than taken from the fixtures: a position where every legal column is
  // correct grades nothing in a live run, so it is not worth quota — but it is exactly what
  // the enum constraint needs to be checked against.
  const withFullColumn = parseBoard(`
    ...a...
    ...h...
    ...a...
    ...h...
    ...a...
    h..h...
  `);

  it('differ only by the parity paragraph', () => {
    const control = buildC4Prompt(board, { parity: false });
    const parity = buildC4Prompt(board, { parity: true });

    assert.ok(parity.includes('THREAT PARITY'));
    assert.ok(!control.includes('THREAT PARITY'));
    // Removing the added block must give back the control exactly, or the A/B is testing
    // more than one thing at once.
    const stripped = parity.split('\nTHREAT PARITY')[0];
    assert.ok(
      control.startsWith(stripped),
      'the parity variant must be the control plus one block, nothing else',
    );
  });

  it('keeps commentary last, after move', () => {
    for (const parity of [false, true]) {
      const p = buildC4Prompt(board, { parity });
      assert.ok(p.indexOf('"commentary"') > p.indexOf('"move"'), `commentary before move (parity=${parity})`);
    }
  });

  it('states the legal columns and the landing rows', () => {
    const p = buildC4Prompt(board, { parity: false });
    assert.ok(p.includes('Legal columns: [0,1,2,3,4,5,6]'));
    assert.ok(p.includes('0→1'), 'an empty column should land on row 1');
  });

  it('constrains the move enum to the legal columns, excluding a full one', () => {
    assert.equal(isLegal(withFullColumn, 3), false, 'the test board must actually have a full column');
    for (const v of C4_VARIANTS) {
      const cfg = v.config(withFullColumn) as {
        responseSchema: { properties: { move: { enum: string[] } } };
      };
      assert.deepEqual(cfg.responseSchema.properties.move.enum, ['0', '1', '2', '4', '5', '6']);
    }
  });
});
