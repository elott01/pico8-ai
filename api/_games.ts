// What /api/move needs to know that differs per cart, in one table.
//
// The endpoint itself stays game-agnostic: rate limiting, the same-origin check, the
// illegal-move retry and the error handling are identical for every cart, and none of them
// should acquire an `if (game === ...)`. Adding a third cart should mean adding an entry
// here and a PROTOCOLS entry in src/lib/gpio.ts, and touching move.ts not at all.

import type { Board, GameId, ModelReply, MoveSuccess } from './_types.ts';
import { buildPrompt } from './_prompt.ts';
import { GENERATION_CONFIG } from './_gemini.ts';
import {
  CELLS as C4_CELLS,
  buildConnectFourPrompt,
  connectFourConfig,
  isLegalColumn,
  legalColumns,
} from './_connect_four.ts';

export type GameSpec = {
  id: GameId;
  /** How many board cells this cart sends. The board is rejected if it disagrees. */
  cells: number;
  /** What a move value names, used in the correction text and the 400 message. */
  moveUnit: 'cell' | 'column';
  buildPrompt(board: Board, correction?: string): string;
  /** Per-board, because Connect Four's schema enumerates the legal columns. */
  config(board: Board): Record<string, unknown>;
  /** The model's raw `move`, normalised to a number. Connect Four's arrives as a string. */
  parseMove(raw: unknown): number | null;
  legalMoves(board: Board): number[];
  isLegalMove(board: Board, move: number): boolean;
  /** The analysis fields this game returns. Games must not send each other's. */
  analysis(reply: ModelReply): Omit<MoveSuccess, 'move'>;
};

const asNumber = (raw: unknown): number | null => {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

const ticTacToe: GameSpec = {
  id: 'tic_tac_toe',
  cells: 9,
  moveUnit: 'cell',
  buildPrompt,
  config: () => GENERATION_CONFIG,
  parseMove: asNumber,
  legalMoves: (board) => board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0),
  isLegalMove: (board, move) => move >= 0 && move < 9 && board[move] === 0,
  // The structured line-by-line analysis IS this game's reasoning, so there is no
  // `reasoning` string to send.
  analysis: (reply) => ({
    winMove: reply.winMove ?? null,
    blockMove: reply.blockMove ?? null,
    lines: reply.lines ?? [],
    commentary: reply.commentary ?? null,
  }),
};

const connectFour: GameSpec = {
  id: 'connect_four',
  cells: C4_CELLS,
  moveUnit: 'column',
  buildPrompt: (board, correction) => buildConnectFourPrompt(board, { correction }),
  config: connectFourConfig,
  parseMove: asNumber,
  legalMoves: legalColumns,
  isLegalMove: isLegalColumn,
  // No `lines` — 69 of them would be a wall of JSON the panel cannot use, and the model
  // is not asked to produce them. One sentence is the whole account.
  analysis: (reply) => ({
    reasoning: reply.reasoning ?? null,
    commentary: reply.commentary ?? null,
  }),
};

export const GAMES: Record<GameId, GameSpec> = {
  tic_tac_toe: ticTacToe,
  connect_four: connectFour,
};

export const DEFAULT_GAME: GameId = 'tic_tac_toe';

export const isGameId = (v: unknown): v is GameId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(GAMES, v);
