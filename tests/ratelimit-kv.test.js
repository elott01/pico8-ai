// Exercises the KV path without a real Redis: KV env is set so the limiter takes the KV
// branch, and fetch is stubbed to emulate the Upstash pipeline REST API.

process.env.KV_REST_API_URL = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.GEMINI_MAX_CALLS_PER_MIN = '1000'; // keep the global cap out of the way

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const redis = new Map();
let mode = 'ok';
let lastPipeline = null;

globalThis.fetch = async (_url, opts) => {
  if (mode === 'throw') throw new Error('ECONNREFUSED');
  if (mode === 'timeout') {
    const e = new Error('timed out');
    e.name = 'TimeoutError';
    throw e;
  }
  if (mode === 'http500') return { ok: false, status: 500, json: async () => ({}) };

  lastPipeline = JSON.parse(opts.body);
  const results = lastPipeline.map(([cmd, key]) => {
    if (cmd !== 'INCR') return { result: 1 };
    const n = (redis.get(key) ?? 0) + 1;
    redis.set(key, n);
    return { result: n };
  });
  return { ok: true, status: 200, json: async () => results };
};

const { checkRateLimit, reserveGeminiCall } = await import('../api/_ratelimit.ts');

const T0 = 1_700_000_000_000;
const from = (ip) => ({ headers: { 'x-real-ip': ip } });

describe('KV-backed store', () => {
  beforeEach(() => {
    mode = 'ok';
  });

  it('uses KV when configured', async () => {
    assert.equal((await checkRateLimit(from('10.0.0.1'), T0)).store, 'kv');
  });

  it('pipelines INCR + EXPIRE NX so the window cannot be pushed out', async () => {
    await checkRateLimit(from('10.0.0.2'), T0);
    assert.equal(lastPipeline[0][0], 'INCR');
    assert.equal(lastPipeline[1][0], 'EXPIRE');
    assert.equal(lastPipeline[1][3], 'NX');
  });

  it('treats the shared count as authoritative across separate requests', async () => {
    // Distinct request objects, same IP -> one KV key. This is the behaviour an
    // in-memory counter in a per-request-fresh module could never provide.
    let last;
    for (let i = 0; i <= 40; i++) last = await checkRateLimit(from('10.0.0.3'), T0);
    assert.equal(last.limited, true);
    assert.equal(last.store, 'kv');
  });
});

describe('fail-open when KV is unavailable', () => {
  let warn;
  before(() => {
    warn = console.warn;
    console.warn = () => {}; // the fail-open path logs by design; keep test output clean
  });
  after(() => {
    console.warn = warn;
  });

  for (const failure of ['http500', 'throw', 'timeout']) {
    it(`allows the request on ${failure}, degrading to memory`, async () => {
      mode = failure;
      const r = await checkRateLimit(from(`fail-${failure}`), T0);
      assert.equal(r.limited, false);
      assert.equal(r.store, 'mem');
    });

    it(`does not block a Gemini call on ${failure}`, async () => {
      mode = failure;
      await reserveGeminiCall(T0); // must not throw
    });
  }
});
