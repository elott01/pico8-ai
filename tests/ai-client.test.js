// The browser-side client. Every failure mode must stay distinguishable so the UI can
// say "rate limited" rather than showing a random move that looks like a broken AI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getAiTurn } from '../src/lib/ai.js';

const BOARD = Array(9).fill(0);
const reply = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

describe('getAiTurn', () => {
  it('passes a successful turn through with reason null', async () => {
    globalThis.fetch = async () => reply(200, { move: 4, commentary: 'hi' });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, null);
    assert.equal(turn.move, 4);
    assert.equal(turn.commentary, 'hi');
  });

  it('reports a 429 as rate-limited, preferring the body retryAfter', async () => {
    globalThis.fetch = async () =>
      reply(429, { move: null, rateLimited: true, retryAfter: 120 }, { 'retry-after': '30' });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, 'rate-limited');
    assert.equal(turn.retryAfter, 120);
  });

  it('falls back to the Retry-After header when the 429 body is unreadable', async () => {
    globalThis.fetch = async () => ({
      status: 429,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
      headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '45' : null) },
    });
    const turn = await getAiTurn(BOARD);
    assert.equal(turn.reason, 'rate-limited', 'must not be misreported as a generic error');
    assert.equal(turn.retryAfter, 45);
  });

  it('defaults the backoff when a 429 carries no hint', async () => {
    globalThis.fetch = async () => reply(429, {});
    assert.equal((await getAiTurn(BOARD)).retryAfter, 60);
  });

  it('reports an abort as a timeout', async () => {
    globalThis.fetch = (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
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
