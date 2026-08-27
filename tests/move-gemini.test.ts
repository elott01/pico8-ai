// The Gemini call path: the illegal-move retry, and the fact that a single request can
// burn several API calls — which is why the global cap counts calls, not requests.

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_CALLS_PER_MIN = '999'; // the cap itself is covered in move-quota.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asResponse, mockReq, mockRes, successBody } from './_mocks.ts';
import type { Captured } from './_mocks.ts';

const { default: handler } = await import('../api/move.ts');

const HOST = 'pico8-ai.vercel.app';

// A well-formed Gemini response; `fields` overrides the parts the test cares about.
const geminiReply = (fields: Record<string, unknown>) =>
  asResponse({
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
async function call(board: unknown) {
  const { res, out } = mockRes();
  const req = mockReq({
    headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': `gemini-${seq++}` },
    body: { board },
  });
  await handler(req, res);
  return out;
}

describe('illegal-move retry', () => {
  it('retries once with a correction when the model names an occupied cell', async () => {
    const board = [0, 0, 0, 0, 1, 0, 0, 0, 0]; // cell 4 is taken
    const prompts: string[] = [];
    globalThis.fetch = (async (_url: RequestInfo | URL, opts?: RequestInit) => {
      const sent = JSON.parse(String(opts?.body)) as {
        contents: { parts: { text: string }[] }[];
      };
      prompts.push(sent.contents[0].parts[0].text);
      return geminiReply({ move: prompts.length === 1 ? 4 : 0 });
    }) as typeof globalThis.fetch;

    const res = await call(board);

    assert.equal(prompts.length, 2, 'should call Gemini exactly twice');
    assert.match(prompts[1], /IMPORTANT:/, 'the retry prompt should carry the correction');
    assert.equal(successBody(res.body).move, 0, 'the corrected, legal move is returned');
    assert.equal(res.code, 200);
  });

  it('does not retry an upstream 429, and reports it as a rate limit', async () => {
    // 429 and 503 must not share a retry path. Retrying a quota error is pointless, and
    // three attempts plus backoff turn an instant honest "rate limited" into a multi-second
    // request that can blow the client's 10s abort and read as a *timeout* instead — the
    // wrong cause shown to the player, and the cart's fallback labelled wrongly with it.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return asResponse({
        status: 429,
        ok: false,
        json: async () => ({}),
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '30' : null) },
      });
    }) as typeof globalThis.fetch;

    const res = await call(Array(9).fill(0));

    assert.equal(calls, 1, 'an upstream quota error must not be retried');
    assert.equal(res.code, 429, 'the player should see a rate limit, not a slow failure');
    const body = res.body as { rateLimited?: boolean; retryAfter?: number };
    assert.equal(body.rateLimited, true);
    assert.equal(body.retryAfter, 30, "Google's own Retry-After should be honoured");
  });

  it('does not retry when the model returned no move at all', async () => {
    // A 503 storm leaves no cell to correct, so "that cell was illegal" is nonsense and
    // would only double the load on an API that is already failing.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return asResponse({ status: 503, ok: false, json: async () => ({}) });
    }) as typeof globalThis.fetch;

    const res = await call(Array(9).fill(0));

    assert.equal(calls, 3, 'three transient retries, not six');
    assert.equal(res.code, 200, 'still answers, so the game stays playable');
    assert.ok(!Number.isInteger(successBody(res.body).move), 'no usable move; the cart falls back');
  });
});

// The retry loop is bounded by a DEADLINE as well as an attempt count. Gemini has been
// observed holding a request for 18-24s and then answering 503; a retry after that arrives
// long after getAiTurn aborted at 12s, so it spends a second Gemini call and holds the
// function open for an answer nobody can read.
//
// Time is stubbed rather than waited out — the real thing takes 12 seconds to reproduce,
// which is not a test anyone will keep running.
describe('client-deadline cutoff', () => {
  /** Runs `fn` with Date.now() under our control; each Gemini call advances it by `stepMs`. */
  async function withClock(stepMs: number, fn: () => Promise<Captured>) {
    const realNow = Date.now;
    let clock = realNow.call(Date);
    Date.now = () => clock;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      clock += stepMs; // the call itself took this long
      return asResponse({ status: 503, ok: false, json: async () => ({}) });
    }) as typeof globalThis.fetch;
    try {
      return { res: await fn(), calls: () => calls };
    } finally {
      Date.now = realNow;
    }
  }

  it('stops retrying once a slow failure has eaten the client budget', async () => {
    // Two 9s calls put the elapsed time past the 12s abort, so the third must not fire.
    const { res, calls } = await withClock(9000, () => call(Array(9).fill(0)));

    assert.equal(calls(), 2, 'the third attempt is unreadable by the client and must be skipped');
    assert.equal(res.code, 200, 'the turn still answers, so the cart falls back and play continues');
    assert.equal(successBody(res.body).move, null);
  });

  it('still uses every attempt when the failures are fast', async () => {
    // The guard must not shorten the normal 503 path — the case retries exist for.
    const { calls } = await withClock(100, () => call(Array(9).fill(0)));
    assert.equal(calls(), 3);
  });
});
