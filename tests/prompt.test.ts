// The prompt's *structure*, which CLAUDE.md calls load-bearing and nothing enforced until
// now. These do not check that the prompt is good — only Gemini can answer that, and
// bench/ is where it gets measured. They check the properties that fail silently: a
// reordered key list still typechecks, still builds, still returns plausible moves, and
// quietly plays worse.
//
// The winning lines and the key order are restated here by hand rather than imported from
// the module under test. A shared constant would let both sides move together, which is
// exactly the regression this file exists to catch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../api/_prompt.ts';
import type { Board } from '../api/_types.ts';

const EMPTY: Board = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const MIDGAME: Board = [2, 2, 0, 1, 1, 0, 0, 0, 0];

/** The documented output order. `commentary` last is the rule that matters most. */
const KEY_ORDER = ['lines', 'winMove', 'blockMove', 'legalCells', 'move', 'commentary'];

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** The trailing schema line, where the model is told what order to emit keys in. */
function responseSpec(prompt: string): string {
  const marker = 'keys in this exact order:';
  const at = prompt.indexOf(marker);
  assert.notEqual(at, -1, 'prompt no longer states an explicit key order');
  return prompt.slice(at + marker.length);
}

describe('buildPrompt key order', () => {
  it('lists the response keys in the documented order', () => {
    const spec = responseSpec(buildPrompt(EMPTY));
    const positions = KEY_ORDER.map((key) => {
      const at = spec.indexOf(`"${key}"`);
      assert.notEqual(at, -1, `"${key}" missing from the response spec`);
      return at;
    });

    for (let i = 1; i < positions.length; i++) {
      assert.ok(
        positions[i] > positions[i - 1],
        `"${KEY_ORDER[i]}" must come after "${KEY_ORDER[i - 1]}" — JSON generates in order, ` +
          'so each field is conditioned on the ones above it',
      );
    }
  });

  it('keeps commentary last, after move', () => {
    // Above `move`, flavour text starts steering the game — the failure this rule prevents.
    const spec = responseSpec(buildPrompt(MIDGAME));
    assert.ok(
      spec.indexOf('"commentary"') > spec.indexOf('"move"'),
      'commentary must be generated after the move it comments on',
    );
    assert.equal(
      KEY_ORDER[KEY_ORDER.length - 1],
      'commentary',
      'this test is only meaningful while commentary is documented as the last key',
    );
  });

  it('walks the derivation steps in ascending order', () => {
    const prompt = buildPrompt(MIDGAME);
    const steps = [1, 2, 3, 4, 5, 6].map((n) => {
      const at = prompt.indexOf(`STEP ${n}`);
      assert.notEqual(at, -1, `STEP ${n} missing`);
      return at;
    });
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i] > steps[i - 1], `STEP ${i + 1} appears before STEP ${i}`);
    }
  });
});

describe('buildPrompt content', () => {
  it('embeds the board exactly as JSON', () => {
    assert.ok(buildPrompt(MIDGAME).includes(JSON.stringify(MIDGAME)));
  });

  it('lists all 8 winning lines', () => {
    const prompt = buildPrompt(EMPTY);
    for (const line of LINES) {
      assert.ok(prompt.includes(`[${line.join(',')}]`), `winning line [${line}] missing`);
    }
  });

  it('appends a correction only when one is given', () => {
    const correction = 'Cell 3 is NOT empty.';
    assert.ok(buildPrompt(MIDGAME, correction).includes(correction));
    assert.ok(!buildPrompt(MIDGAME).includes('IMPORTANT:'));
  });

  it('puts the correction after the steps, so it overrides rather than seeds them', () => {
    const prompt = buildPrompt(MIDGAME, 'Cell 3 is NOT empty.');
    assert.ok(prompt.indexOf('IMPORTANT:') > prompt.indexOf('STEP 6'));
  });
});
