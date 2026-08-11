// The Gemini call path: the illegal-move retry, and the fact that a single request can
// burn several API calls — which is why the global cap counts calls, not requests.

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_CALLS_PER_MIN = '999'; // the cap itself is covered in move-quota.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { default: handler } = await import('../api/move.ts');

const HOST = 'pico8-ai.vercel.app';

// A well-formed Gemini response; `fields` overrides the parts the test cares about.
const geminiReply = (fields) => ({
  status: 200,
  ok: true,
  json: async () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                lines: [],
                winMove: null,
                blockMove: null,
                legalCells: [],
                commentary: 'x',
                ...fields,
              }),
            },
          ],
        },
      },
    ],
  }),
});

let seq = 0;
async function call(board) {
  const out = {};
  const res = {
    setHeader() {
      return this;
    },
    status(code) {
      out.code = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
  await handler(
    {
      method: 'POST',
      headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': `gemini-${seq++}` },
      body: { board },
    },
    res,
  );
  return out;
}

describe('illegal-move retry', () => {
  it('retries once with a correction when the model names an occupied cell', async () => {
    const board = [0, 0, 0, 0, 1, 0, 0, 0, 0]; // cell 4 is taken
    const prompts = [];
    globalThis.fetch = async (_url, opts) => {
      prompts.push(JSON.parse(opts.body).contents[0].parts[0].text);
      return geminiReply({ move: prompts.length === 1 ? 4 : 0 });
    };

    const res = await call(board);

    assert.equal(prompts.length, 2, 'should call Gemini exactly twice');
    assert.match(prompts[1], /IMPORTANT:/, 'the retry prompt should carry the correction');
    assert.equal(res.body.move, 0, 'the corrected, legal move is returned');
    assert.equal(res.code, 200);
  });

  it('does not retry when the model returned no move at all', async () => {
    // A 503 storm leaves no cell to correct, so "that cell was illegal" is nonsense and
    // would only double the load on an API that is already failing.
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { status: 503, ok: false, json: async () => ({}) };
    };

    const res = await call(Array(9).fill(0));

    assert.equal(calls, 3, 'three transient retries, not six');
    assert.equal(res.code, 200, 'still answers, so the game stays playable');
    assert.ok(!Number.isInteger(res.body.move), 'no usable move; the cart falls back');
  });
});
