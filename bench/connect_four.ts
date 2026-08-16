// The Connect Four benchmark suite: fixtures, an independent scorer, and the prompt
// variants under test.
//
// Everything Connect Four lives in this one file because it is still a hypothesis. No
// production code imports it — `api/` cannot play Connect Four yet. If a variant wins, its
// prompt moves to api/; if none do, this file is deleted.
//
// The scorer below is deliberately NOT the one in src/lib/gpio.ts. That module is the
// page's implementation of the same rules, and grading a model against the code under
// development means a gravity bug would quietly mark wrong answers correct. Two
// independent implementations that agree are evidence; one implementation checking itself
// is not. tests/connect-four-bench.test.ts cross-checks this one against the fixtures.

import type { Cell } from '../api/_types.ts';
import { GENERATION_CONFIG } from '../api/_gemini.ts';

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

/** 42 cells, row-major from the top-left — the same order the cart puts on the wire. */
export type C4Board = Cell[];

/** Board index of a (row-from-top, column) pair. */
export const at = (row: number, col: number) => row * COLS + col;

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

/** Renders a board back to the fixture notation. Used by the prompt and by test failures. */
export function render(board: C4Board): string {
  const glyph = ['.', 'h', 'a'];
  const out: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    out.push(
      Array.from({ length: COLS }, (_, c) => glyph[board[at(r, c)]]).join(''),
    );
  }
  return out.join('\n');
}

// ---- the independent scorer ------------------------------------------------------------

/** The cell a disc dropped in `col` would land on, or null if the column is full. */
export function landing(board: C4Board, col: number): number | null {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;
  for (let row = ROWS - 1; row >= 0; row--) {
    const i = at(row, col);
    if (board[i] === 0) return i;
  }
  return null;
}

export const legalColumns = (board: C4Board): number[] =>
  Array.from({ length: COLS }, (_, c) => c).filter((c) => landing(board, c) !== null);

export const isLegal = (board: C4Board, col: number): boolean => landing(board, col) !== null;

const DIRS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
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

/** Columns where `player` completes a four immediately, in ascending order. */
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

/**
 * Every line of four on the board: 24 horizontal, 21 vertical, 12 of each diagonal = 69.
 *
 * The cart deliberately does NOT enumerate these — gravity guarantees any new four passes
 * through the disc just played, so scanning outward from it is cheaper. Here the question
 * is different: we want every line that is one disc short, including ones the last move
 * had nothing to do with, so enumeration is the right shape.
 */
export const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of DIRS) {
        const endR = r + dr * 3;
        const endC = c + dc * 3;
        if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
        out.push([0, 1, 2, 3].map((k) => at(r + dr * k, c + dc * k)));
      }
    }
  }
  return out;
})();

export type Threat = {
  /** The one empty cell in an otherwise-complete line. */
  gap: number;
  col: number;
  /** Row counting the bottom as 1, which is how the prompt talks about rows. */
  row: number;
  /** Is the gap reachable this turn, or does it need discs stacked under it first? */
  playable: boolean;
};

/**
 * Lines where `player` has three of four and the fourth is empty.
 *
 * Facts, not a decision: this says a line is one disc short and where the gap is. Deciding
 * that a playable gap of your own means "win now", and one of the opponent's means "block
 * now", is the inference left to the model — the same split perception.ts draws for
 * tic-tac-toe, where the model gets line counts and derives winMove itself.
 */
export function threats(board: C4Board, player: 1 | 2): Threat[] {
  const seen = new Set<number>();
  const out: Threat[] = [];
  for (const win of WINDOWS) {
    const mine = win.filter((i) => board[i] === player).length;
    const empty = win.filter((i) => board[i] === 0);
    if (mine !== 3 || empty.length !== 1) continue;

    const gap = empty[0];
    if (seen.has(gap)) continue; // two lines can share a completing square
    seen.add(gap);

    const col = gap % COLS;
    out.push({
      gap,
      col,
      row: ROWS - Math.floor(gap / COLS),
      playable: landing(board, col) === gap,
    });
  }
  return out.sort((a, b) => a.col - b.col);
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
    // Walk bottom-up: once a gap appears, everything above it must stay empty.
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = board[at(r, c)];
      if (v === 0) seenEmpty = true;
      else if (seenEmpty) return false;
    }
  }
  return true;
}

// ---- fixtures ---------------------------------------------------------------------------

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

// Deliberately not a fixture: a "full column" position, where every legal column would be
// a correct answer. It grades nothing — and the thing it would test, that the enum cannot
// offer a full column, is asserted for free against `schema()` in
// tests/connect-four-bench.test.ts rather than bought with a paid run.

// ---- prompts ------------------------------------------------------------------------------

/**
 * Facts the model is given rather than asked to derive.
 *
 * Same bet the tic-tac-toe perception variant won on: the model miscounts when made to do
 * board arithmetic in its head, and reading a computed fact costs a tenth of the tokens of
 * generating it. What is deliberately NOT computed is which move to play — spotting the
 * tactic in the facts is the inference that stays the model's.
 */
function factsBlock(board: C4Board, withThreats: boolean): string {
  const legal = legalColumns(board);
  const heights = Array.from({ length: COLS }, (_, c) => {
    const cell = landing(board, c);
    // Row number counting the BOTTOM row as 1, which is the convention the parity rule uses.
    return cell === null ? 'FULL' : String(ROWS - Math.floor(cell / COLS));
  });

  const lines = [
    'BOARD (top row first, bottom row last). "." empty, "h" opponent, "a" you:',
    render(board),
    '',
    `Columns are numbered 0-6 left to right. Legal columns: [${legal.join(',')}]`,
    `If you drop in each column, your disc lands on row: ${heights
      .map((h, c) => `${c}→${h}`)
      .join(' ')}   (row 1 = bottom, row 6 = top)`,
  ];

  if (withThreats) {
    // Phrased as "this line is one disc short, the gap is here" rather than "win here" /
    // "block here". Which of those a gap means is the model's call.
    const describe = (t: Threat) =>
      `column ${t.col} (row ${t.row}, ${t.playable ? 'reachable THIS TURN' : 'not reachable yet — needs discs under it first'})`;
    const mine = threats(board, 2);
    const theirs = threats(board, 1);
    lines.push(
      '',
      'LINES ONE DISC FROM FOUR — the gap that would complete each:',
      `  yours:    ${mine.length ? mine.map(describe).join('; ') : 'none'}`,
      `  opponent: ${theirs.length ? theirs.map(describe).join('; ') : 'none'}`,
    );
  }

  return lines.join('\n');
}

const PRIORITY = [
  'CHOOSE YOUR MOVE by applying this priority in order. "move" MUST be a legal column:',
  '1. If dropping in a column gives you four in a row, play it. Winning ends the game —',
  '   ALWAYS take it, even if the opponent also threatens. Never block when you can win.',
  '2. Else if the opponent would get four in a row by dropping in a column, play that column.',
  '3. Else avoid any column where your disc lets the opponent win on the square directly',
  '   above it.',
  '4. Else prefer the column closest to the centre (3), which sits on the most lines.',
].join('\n');

const PARITY = [
  '',
  'THREAT PARITY — use this when no rule above decides it. Columns fill from the bottom, so',
  'a threat is only useful to whoever will be on move when that square becomes reachable.',
  'You are the SECOND player, so EVEN rows (2, 4, 6) are yours and ODD rows (1, 3, 5) favour',
  'the opponent. Prefer moves that build your own threats on even rows, and avoid moves that',
  'set the opponent up for a threat on an odd row.',
].join('\n');

export function buildC4Prompt(
  board: C4Board,
  opts: { parity?: boolean; threats?: boolean } = {},
): string {
  return [
    'You are playing Connect Four as player 2 (you are "a"). The opponent is "h" and moved first.',
    'Four in a row wins — horizontally, vertically, or on either diagonal.',
    '',
    factsBlock(board, opts.threats ?? false),
    '',
    PRIORITY,
    opts.parity ? PARITY : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"reasoning": "<one short sentence naming the rule you applied>",',
    '"move": <column>, "commentary": "<one playful sentence, max 12 words>"}.',
    // `commentary` stays last so flavour text can never condition the move — the same
    // load-bearing key order as the tic-tac-toe prompt.
  ].join('\n');
}

// ---- variants ------------------------------------------------------------------------------

export type C4Variant = {
  name: string;
  describe: string;
  prompt(board: C4Board): string;
  config(board: C4Board): Record<string, unknown>;
};

/** Gemini enums are strings, so legal columns go in as "0".."6" and are parsed back. */
const legalEnum = (board: C4Board) => legalColumns(board).map(String);

// The enum-constrained schema is carried over from the tic-tac-toe A/B, where it took
// illegal moves from 3/27 to 0/27. Both variants use it, so the ONLY difference between
// them is the parity paragraph — anything the numbers show is attributable to that.
const schema = (board: C4Board) => ({
  ...GENERATION_CONFIG,
  responseSchema: {
    type: 'OBJECT',
    propertyOrdering: ['reasoning', 'move', 'commentary'],
    properties: {
      reasoning: { type: 'STRING' },
      move: { type: 'STRING', enum: legalEnum(board) },
      commentary: { type: 'STRING' },
    },
    required: ['reasoning', 'move', 'commentary'],
  },
});

export const C4_VARIANTS: C4Variant[] = [
  {
    name: 'facts',
    describe: 'board, legal columns and landing rows + priority rules — the control',
    prompt: (b) => buildC4Prompt(b),
    config: schema,
  },
  {
    name: 'facts+parity',
    describe: 'the control plus the odd/even threat-parity paragraph',
    prompt: (b) => buildC4Prompt(b, { parity: true }),
    config: schema,
  },
  {
    name: 'facts+threats',
    describe: 'the control plus which lines are one disc from four',
    prompt: (b) => buildC4Prompt(b, { threats: true }),
    config: schema,
  },
];
