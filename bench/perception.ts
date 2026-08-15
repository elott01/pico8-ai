// The perception-layer prompt: code computes the board facts, the model reads them.
//
// Lives in bench/ rather than api/ because it is still a hypothesis. If it wins it moves
// to api/_prompt.ts; if it loses this file is deleted. No production code imports it.
//
// The priority rules below are copied VERBATIM from the production prompt's STEP 5. That
// is deliberate: the only variable under test is whether the model must *generate* the
// derivation or merely *read* it. Adding a fork rule here would change two things at once
// and make the result uninterpretable.

import type { Board } from '../api/_types.ts';
import { LINES } from './positions.ts';

export type StateFacts = {
  legalCells: number[];
  lines: { line: number[]; values: number[]; twos: number; ones: number; emptyCells: number[] }[];
};

/**
 * Facts only, never decisions. Deliberately does NOT compute winMove / blockMove / forks —
 * spotting those in the facts is the inference that stays the model's, and the whole point
 * of "minimal perception".
 */
export function describeState(board: Board): StateFacts {
  return {
    legalCells: board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0),
    lines: LINES.map((line) => {
      const values = line.map((i) => board[i]);
      return {
        line: [...line],
        values,
        twos: values.filter((v) => v === 2).length,
        ones: values.filter((v) => v === 1).length,
        emptyCells: line.filter((i) => board[i] === 0),
      };
    }),
  };
}

export function buildPerceptionPrompt(board: Board, correction?: string): string {
  const f = describeState(board);
  const lines = f.lines
    .map(
      (l) =>
        `  [${l.line.join(',')}] values ${l.values.join(',')} | twos ${l.twos} | ones ${l.ones} | empty [${l.emptyCells.join(',')}]`,
    )
    .join('\n');

  return [
    'You are playing tic-tac-toe as player 2 (you are "2").',
    'Board is a 9-element array, indices 0..8, row-major (0,1,2 = top row; 3,4,5 = middle; 6,7,8 = bottom).',
    `0 = empty, 1 = opponent, 2 = you. Current board: ${JSON.stringify(board)}.`,
    '',
    'BOARD FACTS — already computed for you. These are exact. Do NOT recompute them.',
    `legalCells: [${f.legalCells.join(',')}]`,
    'lines:',
    lines,
    '',
    'CHOOSE YOUR MOVE by applying this priority EXACTLY to the facts above.',
    '"move" MUST be one of legalCells:',
    '1. If a line has twos == 2 and ones == 0 and exactly one empty cell, play that cell.',
    '   (Winning ends the game — ALWAYS take it, even if the opponent also threatens.',
    '   Never block when you can win.)',
    '2. Else if a line has ones == 2 and twos == 0 and exactly one empty cell, play that cell.',
    '3. Else 4 (center) if 4 is in legalCells.',
    '4. Else a corner (0, 2, 6, or 8) that is in legalCells.',
    '5. Else any cell in legalCells.',
    correction ? `\nIMPORTANT: ${correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"reasoning": "<one short sentence naming the rule you applied>",',
    '"move": <index>, "commentary": "<one playful sentence, max 12 words>"}.',
    // `commentary` stays last so flavour text can never condition the move.
  ].join('\n');
}