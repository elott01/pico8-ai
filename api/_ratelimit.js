// Rate limiting for /api/move. Underscore-prefixed so Vercel doesn't treat it as a
// route — it's a helper imported by move.js.
//
// Two independent limits:
//   • per-IP     — stops one visitor draining the quota in a loop
//   • global cap — protects the PROJECT-WIDE Gemini free-tier quota from traffic
//                  spread across many IPs (which the per-IP limit can't see)
//
// Both are fixed-window counters. The window state lives in a shared store so it
// survives the per-request module reload that `vercel dev` (and cold starts) cause —
// an in-memory Map resets every request there, so it can never actually count.
//
//   • If a KV/Redis REST store is configured (env below), counters live there and are
//     genuinely global across instances and durable across restarts.
//   • Otherwise they fall back to an in-memory Map. That's fine for local dev without
//     KV, and it's also the FAIL-OPEN path if KV errors: a limiter outage must never
//     take down the game, so we degrade to (weak, per-instance) limiting, never to a
//     hard failure.

import { createHash } from 'node:crypto';

// --- tunables ----------------------------------------------------------------------
const IP_WINDOW_SEC = 10 * 60; // per-IP window: 10 minutes
const IP_MAX = 40; // a game is ~5 requests, so ~8 games back-to-back

// Global caps on ACTUAL Gemini calls (not /api/move requests — one request can issue
// several calls via retries). Env-tunable; check real limits in AI Studio.
const CALLS_PER_MIN = Number(process.env.GEMINI_MAX_CALLS_PER_MIN) || 2;
const CALLS_PER_DAY = Number(process.env.GEMINI_MAX_CALLS_PER_DAY) || 800;

// TEMP DIAGNOSTIC — remove in step 8. Shows the caps actually in effect, so we can tell
// whether a .env.local override loaded or fell back to the defaults.
console.log(`[ratelimit] caps in effect: ${CALLS_PER_MIN}/min ${CALLS_PER_DAY}/day`);

export class QuotaError extends Error {
  constructor(retryAfter) {
    super('global Gemini quota reached');
    this.name = 'QuotaError';
    this.retryAfter = retryAfter;
  }
}

// --- public API --------------------------------------------------------------------

// Per-IP check, called once per request. Returns { limited, retryAfter, store }.
export async function checkRateLimit(req, now = Date.now()) {
  const id = clientKey(req);
  const r = await hitWindow('rl:ip', id, IP_WINDOW_SEC, IP_MAX, now);
  if (r.count > IP_MAX) return { limited: true, retryAfter: r.retryAfter, store: r.store };
  return { limited: false, store: r.store };
}

// Reserve ONE Gemini call against both the per-minute and per-day windows. Called
// immediately before each fetch (so retries count). Throws QuotaError -> 429 if either
// window is full. Async because the store may be remote.
export async function reserveGeminiCall(now = Date.now()) {
  const minute = await hitWindow('rl:gl:min', 'all', 60, CALLS_PER_MIN, now);
  // TEMP DIAGNOSTIC — remove in step 8. Shows the count climbing (or not) per call.
  console.log(`[ratelimit] gemini call ${minute.count}/${CALLS_PER_MIN} this minute (${minute.store})`);
  if (minute.count > CALLS_PER_MIN) {
    console.log(`[ratelimit] global cap: ${minute.count}/${CALLS_PER_MIN} calls this minute (${minute.store})`);
    throw new QuotaError(minute.retryAfter);
  }
  const day = await hitWindow('rl:gl:day', 'all', 86400, CALLS_PER_DAY, now);
  if (day.count > CALLS_PER_DAY) {
    console.log(`[ratelimit] global cap: ${day.count}/${CALLS_PER_DAY} calls today (${day.store})`);
    throw new QuotaError(day.retryAfter);
  }
}

// --- windowing ---------------------------------------------------------------------

// One fixed-window hit. Buckets by wall-clock so the key changes each window and the
// store's TTL just cleans up stragglers. Returns the post-increment count, the store
// used ('kv' | 'mem'), and seconds until this window ends.
async function hitWindow(prefix, id, windowSec, _max, now) {
  const bucket = Math.floor(now / (windowSec * 1000));
  const key = `${prefix}:${id}:${bucket}`;
  const ttl = windowSec + 5; // small grace so the key outlives the window it counts
  const retryAfter = Math.ceil(((bucket + 1) * windowSec * 1000 - now) / 1000);

  let count = await kvIncr(key, ttl);
  let store = 'kv';
  if (count === null) {
    count = memIncr(key, ttl * 1000, now); // KV absent or errored -> fail open to memory
    store = 'mem';
  }
  return { count, store, retryAfter };
}

// --- KV / Redis REST store ---------------------------------------------------------

// Vercel KV and Upstash Redis both expose the same REST API and name their env vars
// slightly differently; accept either. Absent -> not configured, caller uses memory.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// INCR the key and set its TTL only if it has none (EXPIRE ... NX), in one pipelined
// round trip. The NX matters: refreshing TTL on every increment would push the window
// out forever under sustained load and the counter would never reset. Returns the new
// count, or null if KV is unconfigured/unreachable/slow so the caller fails open.
async function kvIncr(key, ttlSeconds) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(ttlSeconds), 'NX'],
      ]),
      // Cap latency so a slow store can't eat the client's abort budget. On timeout we
      // fail open rather than delay the move.
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
    const out = await res.json(); // [{ result: <count> }, { result: 0|1 }]
    const count = out?.[0]?.result;
    return typeof count === 'number' ? count : null;
  } catch (e) {
    console.warn('[ratelimit] KV error, failing open to memory:', e.message);
    return null;
  }
}

// --- in-memory fallback ------------------------------------------------------------

const mem = new Map(); // key -> { count, expiresAt }

function memIncr(key, ttlMs, now) {
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

// --- client identity ---------------------------------------------------------------

// A stable per-client key. Hashed because the raw IP is personal data and we only ever
// need identity, never the value — nothing should log or store the address itself.
//
// x-real-ip is set by Vercel's proxy, so prefer it. x-forwarded-for is a fallback: a
// client can prepend their own value to it, so its leftmost entry is not trustworthy on
// its own. Either way a determined attacker can rotate IPs — which is exactly why the
// global cap is a separate, non-optional layer.
function clientKey(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  const ip =
    req.headers?.['x-real-ip'] ||
    (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') ||
    'unknown'; // one shared bucket rather than a free pass
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}
