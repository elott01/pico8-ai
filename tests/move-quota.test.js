// The global cap, exercised end-to-end through the handler. Because it is global rather
// than per-IP, it is the layer that actually protects the project-wide free-tier quota.

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_CALLS_PER_MIN = '2';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { default: handler } = await import('../api/move.js');

const HOST = 'pico8-ai.vercel.app';
let geminiCalls = 0;

globalThis.fetch = async () => {
  geminiCalls++;
  return {
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
                  legalCells: [0],
                  move: 0,
                  commentary: 'x',
                }),
              },
            ],
          },
        },
      ],
    }),
  };
};

let seq = 0;
async function call() {
  const out = { headers: {} };
  const res = {
    setHeader(k, v) {
      out.headers[k.toLowerCase()] = v;
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
  // A fresh IP every time, so only the GLOBAL cap can be responsible for a 429.
  await handler(
    {
      method: 'POST',
      headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': `quota-${seq++}` },
      body: { board: Array(9).fill(0) },
    },
    res,
  );
  return out;
}

describe('global Gemini-call cap', () => {
  it('serves up to the cap, then 429s regardless of IP', async () => {
    assert.equal((await call()).code, 200);
    assert.equal((await call()).code, 200);
    assert.equal(geminiCalls, 2);

    const capped = await call();
    assert.equal(capped.code, 429, 'a different IP must not bypass a global cap');
    assert.equal(capped.body.rateLimited, true);
    assert.equal(capped.body.move, null);
    assert.equal(geminiCalls, 2, 'no Gemini call may leak once capped');

    const retryAfter = Number(capped.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 60, `retryAfter=${retryAfter}`);
  });
});
