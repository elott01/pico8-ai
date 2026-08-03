// The browser-side client. Every failure mode must stay distinguishable so the UI can
// say "rate limited" rather than showing a random move that looks like a broken AI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getAiTurn } from '../src/lib/ai.ts';
import type { AiTurn } from '../src/lib/ai.ts';
import type { Board } from '../src/lib/gpio.ts';

const BOARD: Board = Array(9).fill(0);

// getAiTurn only reads status/ok/json/headers.get, so the stub implements just those and
// is cast once here rather than constructing a real Response in every test.
const asResponse = (r: unknown) => r as Response;

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  asResponse({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  });

// AiTurn hides variant-specific fields behind `reason`, so a test that wants retryAfter
// or commentary has to say which variant it expects — and fails loudly if it guessed wrong.
function rateLimited(t: AiTurn) {
  assert.equal(t.reason, 'rate-limited');
  return t as Extract<AiTurn, { reason: 'rate-limited' }>;
}

function succeeded(t: AiTurn) {
  assert.equal(t.reason, null);
  return t as Extract<AiTurn, { reason: null }>;
}

describe('getAiTurn', () => {
  it('passes a successful turn through with reason null', async () => {
    globalThis.fetch = async () => reply(200, { move: 4, commentary: 'hi' });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, null);
    assert.equal(turn.move, 4);
    assert.equal(succeeded(turn).commentary, 'hi');
  });

  it('reports a 429 as rate-limited, preferring the body retryAfter', async () => {
    globalThis.fetch = async () =>
      reply(429, { move: null, rateLimited: true, retryAfter: 120 }, { 'retry-after': '30' });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, 'rate-limited');
    assert.equal(rateLimited(turn).retryAfter, 120);
  });

  it('falls back to the Retry-After header when the 429 body is unreadable', async () => {
    globalThis.fetch = async () =>
      asResponse({
        status: 429,
        ok: false,
        json: async () => {
          throw new Error('not json');
        },
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '45' : null) },
      });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, 'rate-limited', 'must not be misreported as a generic error');
    assert.equal(rateLimited(turn).retryAfter, 45);
  });

  it('defaults the backoff when a 429 carries no hint', async () => {
    globalThis.fetch = async () => reply(429, {});
    assert.equal(rateLimited(await getAiTurn(BOARD)).retryAfter, 60);
  });

  it('reports an abort as a timeout', async () => {
    globalThis.fetch = ((_url: RequestInfo | URL, opts?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // getAiTurn always passes a signal — exercising that is the point of this test.
        opts!.signal!.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })) as typeof globalThis.fetch;
    assert.equal((await getAiTurn(BOARD, 20)).reason, 'timeout');
  });

  it('reports network failures and non-OK responses as errors', async () => {
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    assert.equal((await getAiTurn(BOARD)).reason, 'error');

    globalThis.fetch = async () => reply(500, {});
    assert.equal((await getAiTurn(BOARD)).reason, 'error');

    globalThis.fetch = async () => reply(403, { error: 'forbidden' });
    assert.equal((await getAiTurn(BOARD)).reason, 'error');
  });

  it('always resolves to an object, so callers can read .reason', async () => {
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    const turn = await getAiTurn(BOARD);
    assert.ok(turn && typeof turn === 'object');
  });
});
