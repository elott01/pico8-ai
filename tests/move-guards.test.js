// Guards on /api/move that run before any Gemini call: method, origin, per-IP limit.
// No GEMINI_API_KEY is set — these all short-circuit before the key is needed, and an
// intentionally invalid board means a request that passes every guard lands on 400,
// which proves it got through without making a network call.

delete process.env.GEMINI_API_KEY;

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { default: handler } = await import('../api/move.js');

const HOST = 'pico8-ai.vercel.app';
const SAME_ORIGIN = { host: HOST, origin: `https://${HOST}` };

function mockRes() {
  const out = { headers: {} };
  return {
    out,
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
}

let seq = 0;
async function call(headers, { method = 'POST', body = { board: 'not-a-board' } } = {}) {
  const res = mockRes();
  // Unique IP per call so the per-IP limiter only interferes where a test wants it to.
  await handler({ method, headers: { 'x-real-ip': `guard-${seq++}`, ...headers }, body }, res);
  return res.out;
}

describe('method guard', () => {
  it('rejects anything but POST', async () => {
    assert.equal((await call(SAME_ORIGIN, { method: 'GET' })).code, 405);
  });
});

describe('origin guard', () => {
  const rejected = {
    'a missing Origin (curl or a script)': { host: HOST },
    'a foreign Origin': { host: HOST, origin: 'https://evil.example.com' },
    'a lookalike host': { host: HOST, origin: `https://${HOST}.evil.com` },
    'a malformed Origin': { host: HOST, origin: 'not-a-url' },
    'a null Origin (sandboxed iframe)': { host: HOST, origin: 'null' },
    'a different port on the same host': { host: 'localhost:3000', origin: 'http://localhost:5173' },
  };
  for (const [label, headers] of Object.entries(rejected)) {
    it(`rejects ${label}`, async () => {
      assert.equal((await call(headers)).code, 403);
    });
  }

  const allowed = {
    production: SAME_ORIGIN,
    'vercel dev on localhost': { host: 'localhost:3000', origin: 'http://localhost:3000' },
    'a proxied request (x-forwarded-host)': {
      host: 'internal.vercel',
      'x-forwarded-host': HOST,
      origin: `https://${HOST}`,
    },
    'a custom domain': { host: 'play.example.dev', origin: 'https://play.example.dev' },
  };
  for (const [label, headers] of Object.entries(allowed)) {
    it(`allows ${label}`, async () => {
      assert.equal((await call(headers)).code, 400); // reached board validation, no network call
    });
  }
});

describe('per-IP limit', () => {
  const headers = { ...SAME_ORIGIN, 'x-real-ip': '198.51.100.1' };

  it('returns 429 with Retry-After once the cap is exceeded', async () => {
    let last;
    for (let i = 0; i < 41; i++) last = await call(headers);
    assert.equal(last.code, 429);
    assert.equal(last.body.rateLimited, true);
    assert.equal(last.body.move, null);
    assert.ok(Number(last.headers['retry-after']) > 0);
  });

  it('runs the origin guard first, so dropping Origin cannot reset the count', async () => {
    assert.equal((await call({ host: HOST, 'x-real-ip': '198.51.100.1' })).code, 403);
  });
});
