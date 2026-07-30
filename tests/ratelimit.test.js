// Rate-limiter units, driven with an injected clock so window boundaries are exact
// rather than wall-clock dependent. No KV env is set here, so this exercises the
// in-memory store — which is also the fail-open path.

process.env.GEMINI_MAX_CALLS_PER_MIN = '6';
process.env.GEMINI_MAX_CALLS_PER_DAY = '10';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { checkRateLimit, reserveGeminiCall, QuotaError } = await import('../api/_ratelimit.js');

const IP_MAX = 40;
const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const from = (ip) => ({ headers: { 'x-real-ip': ip } });

describe('per-IP limit', () => {
  it('allows up to the cap, then limits', async () => {
    const req = from('10.0.0.1');
    let last;
    for (let i = 0; i < IP_MAX; i++) last = await checkRateLimit(req, T0);
    assert.equal(last.limited, false);

    const over = await checkRateLimit(req, T0);
    assert.equal(over.limited, true);
    assert.ok(over.retryAfter > 0 && over.retryAfter <= 600, `retryAfter=${over.retryAfter}`);
  });

  it('counts each IP separately', async () => {
    assert.equal((await checkRateLimit(from('10.0.0.2'), T0)).limited, false);
  });

  it('resets once the window rolls over', async () => {
    const req = from('10.0.0.3');
    for (let i = 0; i <= IP_MAX; i++) await checkRateLimit(req, T0);
    assert.equal((await checkRateLimit(req, T0)).limited, true);
    assert.equal((await checkRateLimit(req, T0 + 600_000)).limited, false);
  });

  it('falls back to the in-memory store when KV is unconfigured', async () => {
    assert.equal((await checkRateLimit(from('10.0.0.4'), T0)).store, 'mem');
  });
});

// Each test below uses its own day bucket so the daily counter cannot leak between them.
describe('global Gemini-call cap', () => {
  it('allows the per-minute budget, then throws QuotaError', async () => {
    const t = T0 + 1 * DAY;
    for (let i = 0; i < 6; i++) await reserveGeminiCall(t);
    await assert.rejects(() => reserveGeminiCall(t), QuotaError);
  });

  it('rolls over into the next minute', async () => {
    const t = T0 + 2 * DAY;
    for (let i = 0; i < 6; i++) await reserveGeminiCall(t);
    await assert.rejects(() => reserveGeminiCall(t), QuotaError);
    await reserveGeminiCall(t + MINUTE);
  });

  it('reports a retryAfter inside the current minute', async () => {
    const t = T0 + 3 * DAY;
    for (let i = 0; i < 6; i++) await reserveGeminiCall(t);
    await assert.rejects(
      () => reserveGeminiCall(t),
      (e) => e instanceof QuotaError && e.retryAfter > 0 && e.retryAfter <= 60,
    );
  });

  // Not redundant with the minute cap: 6/min sustained is ~8.6k calls/day.
  it('enforces the daily cap independently of the minute cap', async () => {
    const t = T0 + 4 * DAY;
    for (let i = 0; i < 10; i++) await reserveGeminiCall(t + i * MINUTE); // 1/min never trips the minute cap
    await assert.rejects(() => reserveGeminiCall(t + 10 * MINUTE), QuotaError);
  });
});

describe('privacy', () => {
  it('never logs a raw IP', async () => {
    const seen = [];
    const original = console.log;
    console.log = (...args) => seen.push(args.join(' '));
    try {
      await checkRateLimit(from('203.0.113.55'), T0 + 5 * DAY);
    } finally {
      console.log = original;
    }
    assert.ok(!seen.some((line) => line.includes('203.0.113.55')));
  });
});
