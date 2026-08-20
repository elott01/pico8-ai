// Connect Four's board geometry, the facts its prompt states, and the prompt itself.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// This is the `facts+threats` variant, chosen by measurement rather than taste:
// bench/results/ab-connect_four.json has it at 86% against a 71% control over 42 calls,
// and ab-connect_four-parity.log records the threat-parity variant that lost at 57%.
// bench/connect_four.ts imports from here, so the harness measures the shipping prompt
// rather than a copy that would drift.
//
// The board arrives row-major from the top-left, exactly as the cart publishes it — see
// docs/gpio-protocol.md.

import type { Board } from './_types.ts';
import { GENERATION_CONFIG } from './_gemini.ts';

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

/** Board index of a (row-from-top, column) pair. */
export const at = (row: number, col: number) => row * COLS + col;

/** The cell a disc dropped in `col` would land on, or null if the column is full. */
export function landing(board: Board, col: number): number | null {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;
  for (let row = ROWS - 1; row >= 0; row--) {
    const i = at(row, col);
    if (board[i] === 0) return i;
  }
  return null;
}

export const legalColumns = (board: Board): number[] =>
  Array.from({ length: COLS }, (_, c) => c).filter((c) => landing(board, c) !== null);

export const isLegalColumn = (board: Board, col: number): boolean => landing(board, col) !== null;

const DIRS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
] as const;

/**
 * Every line of four on the board: 24 horizontal, 21 vertical, 12 of each diagonal = 69.
 *
 * The cart deliberately does NOT enumerate these — gravity guarantees any new four passes
 * through the disc just played, so scanning outward from it is cheaper there. Here the
 * question is different: every line that is one disc short matters, including ones the
 * last move had nothing to do with.
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
  /** Reachable this turn, or does it need discs stacked under it first? */
  playable: boolean;
};

/**
 * Lines where `player` has three of four and the fourth is empty.
 *
 * Facts, not a decision. Stating that a line is one disc short and where the gap is takes
 * the benchmark's one reproducible failure from 1/3 to 3/3 — the model was identifying a
 * horizontal line by the last column *containing* it rather than the column that
 * *completes* it ("the opponent has three in a row at column 3, so I must block them",
 * where column 3 was occupied and the disc landed a row high).
 *
 * What is deliberately NOT computed is which move to play. Deciding that a playable gap of
 * your own means "win now" and the opponent's means "block now" is the inference left to
 * the model, the same split perception.ts draws for tic-tac-toe.
 */
export function threats(board: Board, player: 1 | 2): Threat[] {
  const seen = new Set<number>();
  const out: Threat[] = [];
  for (const win of WINDOWS) {
    const mine = win.filter((i) => board[i] === player).length;
    const empty = win.filter((i) => board[i] === 0);
    if (mine !== 3 || empty.length !== 1) continue;

    const gap = empty[0];
    if (seen.has(gap)) continue; // two lines can share a completing square
    seen.add(gap);

    out.push({
      gap,
      col: gap % COLS,
      row: ROWS - Math.floor(gap / COLS),
      playable: landing(board, gap % COLS) === gap,
    });
  }
  return out.sort((a, b) => a.col - b.col);
}

/** The board as the prompt shows it: six rows, top first. */
export function render(board: Board): string {
  const glyph = ['.', 'h', 'a'];
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => glyph[board[at(r, c)]]).join(''),
  ).join('\n');
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

/**
 * `withThreats` exists only so bench/ can still run the losing control against the
 * shipping prompt. Production always passes true.
 */
export function buildConnectFourPrompt(
  board: Board,
  opts: { correction?: string; withThreats?: boolean } = {},
): string {
  const withThreats = opts.withThreats ?? true;
  const heights = Array.from({ length: COLS }, (_, c) => {
    const cell = landing(board, c);
    return cell === null ? 'FULL' : String(ROWS - Math.floor(cell / COLS));
  });

  const facts = [
    'BOARD (top row first, bottom row last). "." empty, "h" opponent, "a" you:',
    render(board),
    '',
    `Columns are numbered 0-6 left to right. Legal columns: [${legalColumns(board).join(',')}]`,
    `If you drop in each column, your disc lands on row: ${heights
      .map((h, c) => `${c}→${h}`)
      .join(' ')}   (row 1 = bottom, row 6 = top)`,
  ];

  if (withThreats) {
    const describe = (t: Threat) =>
      `column ${t.col} (row ${t.row}, ${t.playable ? 'reachable THIS TURN' : 'not reachable yet — needs discs under it first'})`;
    const mine = threats(board, 2);
    const theirs = threats(board, 1);
    facts.push(
      '',
      'LINES ONE DISC FROM FOUR — the gap that would complete each:',
      `  yours:    ${mine.length ? mine.map(describe).join('; ') : 'none'}`,
      `  opponent: ${theirs.length ? theirs.map(describe).join('; ') : 'none'}`,
    );
  }

  return [
    'You are playing Connect Four as player 2 (you are "a"). The opponent is "h" and moved first.',
    'Four in a row wins — horizontally, vertically, or on either diagonal.',
    '',
    ...facts,
    '',
    PRIORITY,
    opts.correction ? `\nIMPORTANT: ${opts.correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"reasoning": "<one short sentence naming the rule you applied>",',
    '"move": <column>, "commentary": "<one playful sentence, max 12 words>"}.',
    // `commentary` stays last so flavour text can never condition the move — the same
    // load-bearing key order as the tic-tac-toe prompt.
  ].join('\n');
}

/**
 * The move enum is what makes an illegal column unrepresentable: it took illegal moves from
 * 3/27 to 0/27 in the tic-tac-toe A/B and held at 0/42 across both Connect Four runs. Gemini
 * enums are strings, so the reply's `move` arrives as "0".."6" and is parsed back.
 */
export function connectFourConfig(board: Board): Record<string, unknown> {
  return {
    ...GENERATION_CONFIG,
    responseSchema: {
      type: 'OBJECT',
      propertyOrdering: ['reasoning', 'move', 'commentary'],
      properties: {
        reasoning: { type: 'STRING' },
        move: { type: 'STRING', enum: legalColumns(board).map(String) },
        commentary: { type: 'STRING' },
      },
      required: ['reasoning', 'move', 'commentary'],
    },
  };
}
