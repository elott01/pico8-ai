// Prompt construction for /api/move. Underscore-prefixed so Vercel treats it as a helper
// rather than a route.
//
// Extracted from move.ts so the benchmark harness can import the *real* prompt rather than
// keeping a copy — a duplicated prompt would drift, which is the same failure mode that let
// `emptyCell` vs `emptyCells` ship. This is also where `describeState` will land when the
// perception layer arrives.

import type { Board } from './_types.ts';

// Every derivation the model needs is an explicit output field, because it miscounts
// when asked to do the arithmetic in its head — it once emitted "[1,4,7]: 0,2,2" and
// still concluded no line had two 2s, missing the win.
//
// Key order is load-bearing: JSON generates in order, so each field is conditioned on
// the ones above it. `commentary` MUST stay last — above `move` it would let flavor
// text steer the game.
export function buildPrompt(board: Board, correction?: string): string {
  return [
    'You are playing tic-tac-toe as player 2 (you are "2").',
    'Board is a 9-element array, indices 0..8, row-major (0,1,2 = top row; 3,4,5 = middle; 6,7,8 = bottom).',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'The 8 winning lines: [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6].',
    '',
    'STEP 1 — "lines": for EACH of the 8 lines above, in order, emit an object:',
    '{"line": [a,b,c], "values": [va,vb,vc], "twos": <how many values equal 2>,',
    '"ones": <how many values equal 1>, "emptyCells": [<indices whose value is 0>]}.',
    'Count carefully. "twos" is literally how many of the three values are the number 2.',
    '',
    'STEP 2 — "winMove": scan your OWN "lines" output. If any line has twos == 2 and',
    'ones == 0 and exactly one emptyCell, set winMove to that empty cell index. Else null.',
    '',
    'STEP 3 — "blockMove": scan your OWN "lines" output. If any line has ones == 2 and',
    'twos == 0 and exactly one emptyCell, set blockMove to that empty cell index. Else null.',
    '',
    'STEP 4 — "legalCells": the list of every board index whose value is 0. These are the',
    'ONLY cells you may play. If winMove/blockMove are set they will appear in this list.',
    '',
    'STEP 5 — "move": apply this priority EXACTLY, and "move" MUST be one of legalCells:',
    '1. If winMove is not null, move = winMove. (Winning ends the game — ALWAYS take it,',
    '   even if blockMove is also set. Never block when you can win.)',
    '2. Else if blockMove is not null, move = blockMove.',
    '3. Else 4 (center) if 4 is in legalCells.',
    '4. Else a corner (0, 2, 6, or 8) that is in legalCells.',
    '5. Else any cell in legalCells.',
    '',
    'STEP 6 — "commentary": ONE short, playful sentence (max 12 words) addressed to your',
    'opponent about the move you just picked. Flavor only — it must NOT change "move".',
    correction ? `\nIMPORTANT: ${correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"lines": [...8 objects...], "winMove": <index|null>, "blockMove": <index|null>,',
    '"legalCells": [...], "move": <index>, "commentary": "<one sentence>"}.',
  ].join(' ');
}