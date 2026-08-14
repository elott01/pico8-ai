// The prompt/decoding configurations being compared.
//
// The question is whether constraining `move` with a response-schema enum fixes the
// legality failure, and what it costs. The baseline model computes legalCells correctly
// and then plays a cell it excluded — so this is a decoding constraint problem, not a
// perception one, and these variants isolate that.

import type { Board } from '../api/_types.ts';
import { truth } from './positions.ts';
import { buildPerceptionPrompt } from './perception.ts';

export type Variant = {
  name: string;
  describe: string;
  /** generationConfig for this board. Schema enums depend on the board's legal cells. */
  config(board: Board): Record<string, unknown>;
  /** Does this variant ask the model to emit its own analysis? */
  emitsAnalysis: boolean;
  /** Override the prompt. Defaults to the production buildPrompt. */
  prompt?: (board: Board) => string;
};

const BASE = { temperature: 0.1, responseMimeType: 'application/json' };

/** Gemini enums are strings, so legal cells go in as "0".."8" and are parsed back. */
const legalEnum = (board: Board) => truth(board).legalCells.map(String);

export const VARIANTS: Variant[] = [
  {
    name: 'current',
    describe: 'production prompt, no schema — the control',
    emitsAnalysis: true,
    config: () => ({ ...BASE }),
  },
  {
    name: 'schema-full',
    describe: 'same prompt + schema; move constrained to legal cells, analysis retained',
    emitsAnalysis: true,
    config: (board) => ({
      ...BASE,
      responseSchema: {
        type: 'OBJECT',
        // Mirrors the current key order exactly. `commentary` MUST stay last — above
        // `move` it would let flavour text steer the game.
        propertyOrdering: ['lines', 'winMove', 'blockMove', 'legalCells', 'move', 'commentary'],
        properties: {
          lines: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              propertyOrdering: ['line', 'values', 'twos', 'ones', 'emptyCells'],
              properties: {
                line: { type: 'ARRAY', items: { type: 'INTEGER' } },
                values: { type: 'ARRAY', items: { type: 'INTEGER' } },
                twos: { type: 'INTEGER' },
                ones: { type: 'INTEGER' },
                emptyCells: { type: 'ARRAY', items: { type: 'INTEGER' } },
              },
              required: ['line', 'values', 'twos', 'ones', 'emptyCells'],
            },
          },
          winMove: { type: 'INTEGER', nullable: true },
          blockMove: { type: 'INTEGER', nullable: true },
          legalCells: { type: 'ARRAY', items: { type: 'INTEGER' } },
          move: { type: 'STRING', enum: legalEnum(board) },
          commentary: { type: 'STRING' },
        },
        required: ['lines', 'winMove', 'blockMove', 'legalCells', 'move', 'commentary'],
      },
    }),
  },
  {
    name: 'schema-min',
    describe: 'same prompt + schema, analysis dropped — tests whether the CoT is load-bearing',
    emitsAnalysis: false,
    config: (board) => ({
      ...BASE,
      responseSchema: {
        type: 'OBJECT',
        propertyOrdering: ['move', 'commentary'],
        properties: {
          move: { type: 'STRING', enum: legalEnum(board) },
          commentary: { type: 'STRING' },
        },
        required: ['move', 'commentary'],
      },
    }),
  },
  {
    name: 'perception',
    describe: 'facts computed in code and READ by the model; short reasoning + enum move',
    emitsAnalysis: false,
    prompt: (board) => buildPerceptionPrompt(board),
    config: (board) => ({
      ...BASE,
      responseSchema: {
        type: 'OBJECT',
        // reasoning before move so the move is conditioned on it; commentary last so
        // flavour text never is.
        propertyOrdering: ['reasoning', 'move', 'commentary'],
        properties: {
          reasoning: { type: 'STRING' },
          move: { type: 'STRING', enum: legalEnum(board) },
          commentary: { type: 'STRING' },
        },
        required: ['reasoning', 'move', 'commentary'],
      },
    }),
  },
];
