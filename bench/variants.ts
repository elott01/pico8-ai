// The prompt/decoding configurations being compared.
//
// The question is whether constraining `move` with a response-schema enum fixes the
// legality failure, and what it costs. The baseline model computes legalCells correctly
// and then plays a cell it excluded — so this is a decoding constraint problem, not a
// perception one, and these variants isolate that.

import type { Board } from '../api/_types.ts';
import { GENERATION_CONFIG } from '../api/_gemini.ts';
import { ticTacToeConfig } from '../api/_prompt.ts';
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

// Production's decoding settings, imported rather than restated — otherwise the `current`
// variant would drift away from the thing it is supposed to be the control for.
const BASE = { ...GENERATION_CONFIG };

/** Gemini enums are strings, so legal cells go in as "0".."8" and are parsed back. */
const legalEnum = (board: Board) => truth(board).legalCells.map(String);

export const VARIANTS: Variant[] = [
  {
    // No longer what production sends — api/ now ships the schema. Kept as the control so
    // the A/B that justified that change can be re-run against whatever ships next.
    name: 'current',
    describe: 'prompt with no schema — the pre-enum control',
    emitsAnalysis: true,
    config: () => ({ ...BASE }),
  },
  {
    name: 'schema-full',
    describe: 'same prompt + schema; move constrained to legal cells, analysis retained',
    emitsAnalysis: true,
    // Imported, not restated: this is the config api/ now ships, so the A/B measures the
    // real thing. A copy here could drift and quietly make the comparison meaningless.
    config: ticTacToeConfig,
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
