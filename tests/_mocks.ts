// Shared fakes for the api/ handler tests. Underscore-prefixed and not a *.test.* file,
// so the runner's glob skips it.
//
// The handler wants real VercelRequest/VercelResponse objects, whose full surface is the
// whole of Node's IncomingMessage/ServerResponse. Implementing that would be noise, so
// each fake implements only the sliver the code under test touches and is cast once,
// here, rather than at a dozen call sites.

import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { MoveRateLimited, MoveSuccess } from '../api/_types.ts';

/** Everything the handler wrote to the response. */
export type Captured = {
  code?: number;
  body?: unknown;
  headers: Record<string, string>;
};

export function mockRes(): { res: VercelResponse; out: Captured } {
  const out: Captured = { headers: {} };
  const res = {
    setHeader(k: string, v: unknown) {
      out.headers[k.toLowerCase()] = String(v);
      return res;
    },
    status(code: number) {
      out.code = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, out };
}

export function mockReq(init: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): VercelRequest {
  return {
    method: init.method ?? 'POST',
    headers: init.headers ?? {},
    body: init.body,
  } as unknown as VercelRequest;
}

/** A fetch stub only implements what the code under test reads. Cast once at the edge. */
export const asResponse = (r: unknown) => r as Response;

// The response body is a union, so a test that wants `retryAfter` has to say which
// variant it expects — and fails loudly here if it guessed wrong.
export function rateLimitedBody(body: unknown): MoveRateLimited {
  const b = body as MoveRateLimited;
  assert.equal(b?.rateLimited, true, 'expected a rate-limited body');
  return b;
}

export function successBody(body: unknown): MoveSuccess {
  const b = body as MoveSuccess;
  assert.ok(b && typeof b === 'object' && 'move' in b, 'expected a MoveSuccess body');
  return b;
}
