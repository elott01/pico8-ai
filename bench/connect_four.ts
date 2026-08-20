// The Connect Four benchmark suite: fixtures, an independent scorer, and the variants.
//
// The prompt, the board geometry and the fact computation now live in api/_connect_four.ts,
// because production plays this game. The harness imports them so it measures the SHIPPING
// prompt — a copy here would drift, which is the failure mode _prompt.ts was extracted to
// prevent.
//
// What stays here is the grading half, and it stays independent on purpose. hasFour /
// winningColumns / giftColumns re-derive the answers by simulating a drop, so they can
// disagree with api/'s threats() and be caught. Grading a model with the code under test
// means a bug there quietly marks wrong answers correct. tests/connect-four-bench.test.ts
// asserts the two agree on every fixture.

import type { Cell } from '../api/_types.ts';
import {
  COLS,
  ROWS,
  CELLS,
  at,
  landing,
  legalColumns,
  isLegalColumn,
  threats,
  render,
  WINDOWS,
  buildConnectFourPrompt,
  connectFourConfig,
} from '../api/_connect_four.ts';

export { COLS, ROWS, CELLS, at, landing, legalColumns, threats, render, WINDOWS };
export const isLegal = isLegalColumn;
export type { Threat } from '../api/_connect_four.ts';

/** 42 cells, row-major from the top-left — the same order the cart puts on the wire. */
export type C4Board = Cell[];

// ---- board notation ------------------------------------------------------------------

// Fixtures are written as six 7-character rows, top to bottom, because a 42-element array
// literal is unreadable and unreviewable — a transposed fixture would look fine and grade
// every variant against the wrong position.
//
//   '.' empty · 'h' human (player 1, moves first) · 'a' AI (player 2, to move)
const GLYPH: Record<string, Cell> = { '.': 0, h: 1, a: 2 };

export function parseBoard(art: string): C4Board {
  const rows = art
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);

  if (rows.length !== ROWS) throw new Error(`expected ${ROWS} rows, got ${rows.length}`);

  const board: C4Board = [];
  for (const row of rows) {
    if (row.length !== COLS) throw new Error(`row "${row}" is not ${COLS} wide`);
    for (const ch of row) {
      const v = GLYPH[ch];
      if (v === undefined) throw new Error(`unknown glyph "${ch}" — use . h a`);
      board.push(v);
    }
  }
  return board;
}

// ---- the independent scorer --------------------------------------------------------------

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

/** Does `player` have four in a row anywhere? Used to reject malformed fixtures. */
export function hasFour(board: C4Board, player: 1 | 2): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[at(r, c)] !== player) continue;
      for (const [dr, dc] of DIRS) {
        let n = 1;
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[at(rr, cc)] === player) {
          n++;
          if (n >= 4) return true;
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return false;
}

/** Columns where `player` completes a four immediately, by simulating the drop. */
export function winningColumns(board: C4Board, player: 1 | 2): number[] {
  const wins: number[] = [];
  for (const col of legalColumns(board)) {
    const cell = landing(board, col)!;
    const next = [...board];
    next[cell] = player;
    if (hasFour(next, player)) wins.push(col);
  }
  return wins;
}

/**
 * Columns that hand the opponent an immediate win on the square directly above.
 *
 * Only that one square needs checking: callers use this after establishing the opponent
 * has no immediate win anywhere, and dropping in a column opens exactly one new cell.
 */
export function giftColumns(board: C4Board, player: 1 | 2): number[] {
  const foe = (3 - player) as 1 | 2;
  const gifts: number[] = [];
  for (const col of legalColumns(board)) {
    const cell = landing(board, col)!;
    const next = [...board];
    next[cell] = player;
    if (winningColumns(next, foe).includes(col)) gifts.push(col);
  }
  return gifts;
}

/** Disc counts, for asserting a fixture is a position the AI could actually face. */
export function counts(board: C4Board) {
  return {
    human: board.filter((v) => v === 1).length,
    ai: board.filter((v) => v === 2).length,
  };
}

/** Is every disc resting on another disc or the floor? A floating disc means a typo. */
export function gravityHolds(board: C4Board): boolean {
  for (let c = 0; c < COLS; c++) {
    let seenEmpty = false;
    for (let r = ROWS - 1; r >= 0; r--) {
      const occupied = board[at(r, c)] !== 0;
      if (!occupied) seenEmpty = true;
      else if (seenEmpty) return false; // a disc resting on nothing
    }
  }
  return true;
}

// ---- fixtures -----------------------------------------------------------------------------

export type C4Position = {
  name: string;
  board: C4Board;
  /** Columns that count as correct play. */
  expect: number[];
  why: string;
};

// Every fixture is a position with the AI (player 2) to move, so the human has played
// exactly one more disc. tests/connect-four-bench.test.ts enforces that, plus gravity and
// the absence of a four already on the board.
//
// Deliberately excluded: quiet strategic positions with no tactical answer. Connect Four
// has no cheap ground truth there — scoring them would mean inventing an opinion and then
// grading the model against it. Every `expect` below is defensible in one sentence.
export const C4_POSITIONS: C4Position[] = [
  {
    name: 'opening',
    board: parseBoard(`
      .......
      .......
      .......
      .......
      .......
      ...h...
    `),
    expect: [3],
    why: 'the human has opened in the centre. No tactics, so the priority falls through to ' +
      '"closest to centre" — column 3, which still has five slots. Token/latency baseline. ' +
      'An EMPTY board is not used: the human moves first, so the AI never faces one.',
  },
  {
    name: 'win-across',
    board: parseBoard(`
      .......
      .......
      .......
      .......
      h......
      haaa.hh
    `),
    expect: [4],
    why: 'AI holds columns 1,2,3 on the bottom row; column 0 is blocked, so 4 is the only completion.',
  },
  {
    name: 'block-across',
    board: parseBoard(`
      .......
      .......
      .......
      .......
      h......
      ahhh.aa
    `),
    expect: [4],
    why: 'mirror of win-across: the human completes at 4 next turn unless it is taken now.',
  },
  {
    name: 'win-over-block',
    board: parseBoard(`
      .......
      .......
      .......
      .....h.
      .....h.
      aaa..hh
    `),
    expect: [3],
    why: 'AI wins at 3 while the human threatens a vertical at 5. Winning ends the game — ' +
      'the rule most likely to regress, and the one the tic-tac-toe suite also isolates.',
  },
  {
    name: 'block-vertical',
    board: parseBoard(`
      .......
      .......
      .......
      ...h...
      ...h...
      a..h..a
    `),
    expect: [3],
    why: 'the human has three stacked in column 3 and wins there next turn. Vertical threats ' +
      'are the ones a row-major board rendering hides best.',
  },
  {
    name: 'double-threat',
    board: parseBoard(`
      .......
      .......
      .......
      .......
      h......
      h.aa..h
    `),
    expect: [4],
    why: 'playing 4 makes three in a row with BOTH ends open (1 and 5), so the human can only ' +
      'block one. Playing 1 instead leaves just one open end. First position needing two-ply sight.',
  },
  {
    name: 'avoid-gift',
    board: parseBoard(`
      .......
      .......
      .......
      .......
      .hhh...
      .aha..a
    `),
    expect: [1, 2, 3, 5, 6],
    why: 'the human has three on row 4 needing 0 or 4, neither yet supported. Dropping in ' +
      'either column builds the step the human wins on — the "do not set them up" rule.',
  },
];


// ---- variants -------------------------------------------------------------------------------

export type C4Variant = {
  name: string;
  describe: string;
  prompt(board: C4Board): string;
  config(board: C4Board): Record<string, unknown>;
};

// Both variants use the shipping schema, so the only difference is whether the facts block
// states which lines are one disc from four. `facts` is the losing control, kept so the
// comparison can be re-run against whatever api/ ships next.
//
// The rejected threat-parity variant is NOT here. It lost at 57% against this control's 71%
// and its record is bench/results/ab-connect_four-parity.log; re-adding it is six lines if
// it ever deserves another look.
export const C4_VARIANTS: C4Variant[] = [
  {
    name: 'facts',
    describe: 'board, legal columns and landing rows + priority rules — the control',
    prompt: (b) => buildConnectFourPrompt(b, { withThreats: false }),
    config: connectFourConfig,
  },
  {
    name: 'facts+threats',
    describe: 'the shipping prompt: adds which lines are one disc from four',
    prompt: (b) => buildConnectFourPrompt(b),
    config: connectFourConfig,
  },
];
