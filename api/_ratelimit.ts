// Rate limiting for /api/move. Underscore-prefixed so Vercel treats it as a helper
// rather than a route.
//
// Two independent limits: per-IP stops one visitor looping the endpoint, and a global
// cap protects the project-wide Gemini quota from traffic spread across many IPs, which
// the per-IP limit cannot see. Both are fixed-window counters.
//
// Counters live in a KV/Redis store when configured, because module state does not
// survive the per-request reload that `vercel dev` and cold starts cause — an in-memory
// Map there resets before it can count. Any KV failure falls back to that Map: a limiter
// outage must degrade to weak limiting, never to a broken game.

import { createHash } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

const IP_WINDOW_SEC = 10 * 60;
// Sized for Connect Four, not tic-tac-toe: a game is 15-20 AI turns, so 40 is ~2 games
// back to back. This is also what limits a single abuser (~240/hour), which is why the
// per-minute cap below does not have to.
const IP_MAX = 40;

// Caps on actual Gemini calls, not /api/move requests — one request can issue several
// via retries. Env-tunable against the real quota in AI Studio.
//
// 12 was sized for tic-tac-toe, where ~4 AI turns per game cannot reach it. Connect Four
// is 15-20 turns and a brisk player produces 12-20 calls a minute alone, so a single
// legitimate player was tripping the cap mid-game — observed as "13/12 calls this minute"
// on the third game of a sitting.
//
// Raising this does NOT increase total spend: CALLS_PER_DAY is the budget guard and is
// unchanged. This one only shapes bursts.
//
// MUST stay below Google's own RPM for the key, which for the free tier on
// gemini-3.1-flash-lite is **15** (AI Studio → Rate Limit). Going above it does not fail
// loudly: Google queues the excess rather than rejecting it, so requests still succeed with
// ~100% success rate while latency collapses. Measured directly — paced at 10/min the p50
// was 1.5s; bursting to 15-20/min during live play the p50 was 8s with a 21s outlier, and
// not one upstream 429 was logged either time.
//
// So this cap is not really about our budget, it is the thing that keeps us inside Google's
// quality-of-service. 12 leaves room for the extra calls a 503 retry can issue within the
// same minute. Raise it only alongside a paid key with a higher RPM.
const CALLS_PER_MIN = Number(process.env.GEMINI_MAX_CALLS_PER_MIN) || 12;
const CALLS_PER_DAY = Number(process.env.GEMINI_MAX_CALLS_PER_DAY) || 800;

/** Which counter answered — 'kv' when the shared store is live, 'mem' when it fell open
 *  to the per-instance Map (in which case the global cap is no longer global). */
export type Store = 'kv' | 'mem';

// Discriminated on `limited`, so `retryAfter` is reachable only on the branch that
// actually has one — callers cannot forget to check before reading it.
export type RateLimitResult =
  | { limited: false; store: Store }
  | { limited: true; retryAfter: number; store: Store };

export class QuotaError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super('global Gemini quota reached');
    this.name = 'QuotaError';
    this.retryAfter = retryAfter;
  }
}

export async function checkRateLimit(req: VercelRequest, now = Date.now()): Promise<RateLimitResult> {
  const id = clientKey(req);
  const r = await hitWindow('rl:ip', id, IP_WINDOW_SEC, now);
  if (r.count > IP_MAX) return { limited: true, retryAfter: r.retryAfter, store: r.store };
  return { limited: false, store: r.store };
}

// Reserve one Gemini call against the minute and day windows. Async because the store
// may be remote.
export async function reserveGeminiCall(now = Date.now()): Promise<void> {
  const minute = await hitWindow('rl:gl:min', 'all', 60, now);
  if (minute.count > CALLS_PER_MIN) {
    console.log(`[ratelimit] global cap: ${minute.count}/${CALLS_PER_MIN} calls this minute (${minute.store})`);
    throw new QuotaError(minute.retryAfter);
  }
  const day = await hitWindow('rl:gl:day', 'all', 86400, now);
  if (day.count > CALLS_PER_DAY) {
    console.log(`[ratelimit] global cap: ${day.count}/${CALLS_PER_DAY} calls today (${day.store})`);
    throw new QuotaError(day.retryAfter);
  }
}

type Window = { count: number; store: Store; retryAfter: number };

// Bucketing by wall-clock means the key itself changes each window, so expiry is just
// cleanup rather than the mechanism.
async function hitWindow(prefix: string, id: string, windowSec: number, now: number): Promise<Window> {
  const bucket = Math.floor(now / (windowSec * 1000));
  const key = `${prefix}:${id}:${bucket}`;
  const ttl = windowSec + 5; // grace, so the key outlives the window it counts
  const retryAfter = Math.ceil(((bucket + 1) * windowSec * 1000 - now) / 1000);

  let count = await kvIncr(key, ttl);
  let store: Store = 'kv';
  if (count === null) {
    count = memIncr(key, ttl * 1000, now); // KV absent or failing: fail open to memory
    store = 'mem';
  }
  return { count, store, retryAfter };
}

// Vercel KV and Upstash expose the same REST API under different env var names.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// EXPIRE ... NX, not a plain EXPIRE: refreshing the TTL on every increment would push
// the window out indefinitely under sustained load and the counter would never reset.
// Returns null on any failure so the caller fails open.
async function kvIncr(key: string, ttlSeconds: number): Promise<number | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(ttlSeconds), 'NX'],
      ]),
      signal: AbortSignal.timeout(800), // a slow store must not eat the client's timeout budget
    });
    if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
    const out = (await res.json()) as { result?: unknown }[]; // [{ result: <count> }, { result: 0|1 }]
    const count = out?.[0]?.result;
    return typeof count === 'number' ? count : null;
  } catch (e) {
    console.warn('[ratelimit] KV error, failing open to memory:', errorMessage(e));
    return null;
  }
}

const mem = new Map<string, { count: number; expiresAt: number }>();

function memIncr(key: string, ttlMs: number, now: number): number {
  if (mem.size > 1000) {
    for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
  }
  const entry = mem.get(key);
  if (!entry || entry.expiresAt <= now) {
    mem.set(key, { count: 1, expiresAt: now + ttlMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// Hashed because the raw IP is personal data and only its identity is ever needed.
// x-real-ip comes from Vercel's proxy; x-forwarded-for is only a fallback because a
// client can prepend its own value, making the leftmost entry untrustworthy. Rotating
// IPs defeats this either way — which is why the global cap is a separate layer.
function clientKey(req: VercelRequest): string {
  const fwd = req.headers?.['x-forwarded-for'];
  const ip =
    firstHeader(req.headers?.['x-real-ip']) ||
    (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') ||
    'unknown'; // one shared bucket, rather than a free pass
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}

/** Node exposes repeated headers as an array; only the first value is ever meaningful here. */
export function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** `catch` binds `unknown`, and a thrown non-Error must not crash the handler. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
