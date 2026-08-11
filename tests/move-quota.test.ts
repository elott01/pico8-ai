// The global cap, exercised end-to-end through the handler. Because it is global rather
// than per-IP, it is the layer that actually protects the project-wide free-tier quota.

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_CALLS_PER_MIN = '2';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asResponse, mockReq, mockRes, rateLimitedBody } from './_mocks.ts';

const { default: handler } = await import('../api/move.ts');

const HOST = 'pico8-ai.vercel.app';
let geminiCalls = 0;

globalThis.fetch = (async () => {
  geminiCalls++;
  return asResponse({
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
  });
}) as typeof globalThis.fetch;

let seq = 0;
async function call() {
  const { res, out } = mockRes();
  // A fresh IP every time, so only the GLOBAL cap can be responsible for a 429.
  const req = mockReq({
    headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': `quota-${seq++}` },
    body: { board: Array(9).fill(0) },
  });
  await handler(req, res);
  return out;
}

describe('global Gemini-call cap', () => {
  it('serves up to the cap, then 429s regardless of IP', async () => {
    assert.equal((await call()).code, 200);
    assert.equal((await call()).code, 200);
    assert.equal(geminiCalls, 2);

    const capped = await call();
    assert.equal(capped.code, 429, 'a different IP must not bypass a global cap');

    const body = rateLimitedBody(capped.body);
    assert.equal(body.rateLimited, true);
    assert.equal(body.move, null);
    assert.equal(geminiCalls, 2, 'no Gemini call may leak once capped');

    const retryAfter = Number(capped.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 60, `retryAfter=${retryAfter}`);
  });
});
