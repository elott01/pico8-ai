// Fixed board positions for the prompt benchmark, with the tactically correct answers.
//
// Real games are non-deterministic and slow; a fixed suite gives identical inputs before
// and after a prompt change, so a difference in the numbers is attributable to the prompt.
//
// The scorer below is deliberately NOT shared with api/. Once describeState() exists it
// would be tempting to score against it — but then a bug in describeState would grade
// itself correct. An independent implementation is the only kind that can catch that.

import type { Board } from '../api/_types.ts';

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type Truth = {
  legalCells: number[];
  /** Cell that completes a line for the AI (player 2), or null. */
  winMove: number | null;
  /** Cell the opponent (player 1) would win on next turn, or null. */
  blockMove: number | null;
};

export function truth(board: Board): Truth {
  const legalCells = board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  const findFor = (player: 1 | 2): number | null => {
    for (const line of LINES) {
      const vals = line.map((i) => board[i]);
      const mine = vals.filter((v) => v === player).length;
      const theirs = vals.filter((v) => v !== player && v !== 0).length;
      if (mine === 2 && theirs === 0) {
        const empty = line.find((i) => board[i] === 0);
        if (empty !== undefined) return empty;
      }
    }
    return null;
  };
  return { legalCells, winMove: findFor(2), blockMove: findFor(1) };
}

export type Position = {
  name: string;
  board: Board;
  /** Cells that count as correct play. */
  expect: number[];
  why: string;
};

export const POSITIONS: Position[] = [
  {
    name: 'empty',
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    expect: [4],
    why: 'no tactics; the prompt priority says take the centre. Pure token/latency baseline.',
  },
  {
    name: 'win-only',
    board: [2, 2, 0, 1, 0, 0, 0, 0, 0],
    expect: [2],
    why: 'AI has 0 and 1 — cell 2 completes the line. No opposing threat.',
  },
  {
    name: 'block-only',
    board: [1, 1, 0, 2, 0, 0, 0, 0, 0],
    expect: [2],
    why: 'opponent has 0 and 1 — cell 2 must be taken or they win next turn.',
  },
  {
    name: 'win-or-block',
    board: [2, 2, 0, 1, 1, 0, 0, 0, 0],
    expect: [2],
    why: 'win at 2 AND threat at 5. Must prefer the win — the rule most likely to regress.',
  },
  {
    name: 'quiet',
    board: [2, 0, 0, 0, 1, 0, 0, 0, 0],
    expect: [2, 6, 8],
    why: 'no win, no block, centre taken — priority falls through to a free corner.',
  },
  {
    name: 'near-full',
    board: [2, 1, 2, 1, 2, 1, 1, 2, 0],
    expect: [8],
    why: 'only cell 8 is legal, and it also completes [0,4,8]. Minimum-token case.',
  },

  // ---- deeper tactics, added after the first A/B ------------------------------------
  // The suite above only covered one-ply play. These test whether dropping the
  // chain-of-thought costs anything where the reasoning actually has to go deeper.

  {
    name: 'block-edge',
    board: [1, 0, 1, 0, 2, 0, 0, 0, 0],
    expect: [1],
    why: 'opponent holds 0 and 2 — the block is the EDGE cell 1, while the priority list ' +
      'reaches for corners. Tests that block genuinely outranks corner.',
  },
  {
    name: 'fork-create',
    board: [2, 0, 0, 0, 1, 0, 0, 0, 2],
    expect: [2, 6],
    why: 'AI holds opposite corners; playing 2 or 6 creates two threats at once. No ' +
      'immediate win or block exists, so this is the first position needing two-ply sight.',
  },
  {
    name: 'fork-block',
    board: [1, 0, 0, 0, 2, 0, 0, 0, 1],
    expect: [1, 3, 5, 7],
    why: "the documented weakness. Opponent holds opposite corners and will fork next " +
      'turn. Correct play is an EDGE, forcing a response — but the prompt priority says ' +
      'take a corner, which loses. Expected to fail; measured so the gap is a number.',
  },
];