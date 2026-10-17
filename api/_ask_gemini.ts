// The Gemini call both endpoints make: one prompt in, one JSON reply out, under the retry,
// quota and deadline rules that keep a free-tier key honest. Underscore-prefixed so Vercel
// treats it as a helper rather than a route.
//
// Extracted from move.ts when /api/talk arrived, so the two endpoints share one copy of
// these rules instead of two that drift. Each rule below was learned from a real failure;
// the comments that explain them moved here with the code.

import type { VercelRequest } from '@vercel/node';
import { reserveGeminiCall, QuotaError, firstHeader } from './_ratelimit.ts';
import { GEMINI_URL } from './_gemini.ts';

// The page's abort, in src/lib/ai.ts for moves. Duplicated rather than imported because
// api/ must not depend on src/ — but the two have to agree, or the TOO-LATE marker lies
// about which requests the player actually saw. See the timeout budget chain in CLAUDE.md:
// this must stay below the carts' ai_max_frames (450 frames ≈ 15s).
export const CLIENT_ABORT_MS = 12_000;

/** Mutable per-request tally, so the handler can report what a slow request actually spent. */
export type CallStats = { calls: number; geminiMs: number };

/** Only the sliver of Gemini's response this code reads. */
type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type Ask = {
  prompt: string;
  /** generationConfig, schema included. Built per request by the caller. */
  config: Record<string, unknown>;
  stats: CallStats;
  /** When the request arrived, for the deadline. */
  started: number;
  /** Log prefix, so each endpoint's lines stay greppable as its own. */
  tag: string;
};

/**
 * Ask Gemini for a JSON reply. Throws QuotaError on an upstream 429, and a plain Error if
 * the reply cannot be parsed; a missing candidate parses as `{}`, which callers read as "the
 * model answered with nothing usable".
 */
export async function askGemini({ prompt, config, stats, started, tag }: Ask): Promise<Record<string, unknown>> {
  // The handlers guard this, but the fetch header needs a string, not string | undefined.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  let data: GeminiResponse | undefined;
  let callStart = Date.now();
  // Attempts and backoff have to fit inside the client's request timeout alongside
  // generation and a possible correction retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    // Attempts are capped by a DEADLINE, not just a count. Google has been observed holding
    // a request for 18-24s and then answering 503; retrying after that pushed the function
    // past 30s and spent quota on an answer the client abandoned at CLIENT_ABORT_MS. A
    // retry is only worth making if its result can still be read.
    if (attempt > 0 && Date.now() - started >= CLIENT_ABORT_MS) {
      console.log(
        `[${tag}] giving up after ${Date.now() - started}ms — past the client's ${CLIENT_ABORT_MS}ms budget, a retry cannot be read`,
      );
      break;
    }
    await reserveGeminiCall(); // inside the loop: the quota cap counts calls, not requests
    callStart = Date.now();
    stats.calls++;
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: config }),
    });
    data = (await r.json()) as GeminiResponse;

    // 429 and 503 are NOT the same failure and must not share a retry path.
    //
    // 503 is transient overload: waiting helps. 429 means we are over Google's own rate
    // limit, where retrying is both pointless and harmful — three attempts plus backoff
    // turns an instant, honest "rate limited" into a ~2s+ request that eats the client's
    // budget and surfaces as a *timeout* instead. Failing fast here keeps the cause
    // visible, and lets the page pause properly via its Retry-After handling.
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after')) || 60;
      console.log(`[${tag}] gemini 429 (upstream quota) after ${Date.now() - callStart}ms; not retrying`);
      throw new QuotaError(retryAfter);
    }
    if (r.status !== 503) {
      stats.geminiMs += Date.now() - callStart;
      break;
    }
    stats.geminiMs += Date.now() - callStart;
    console.log(`[${tag}] gemini 503 (attempt ${attempt + 1}) after ${Date.now() - callStart}ms, retrying…`);
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.log(`[${tag}] unparseable response body:`, JSON.stringify(data));
    throw new Error('could not parse model response');
  }
}

// Matching Origin's host against the request's own Host works unchanged on localhost,
// preview deploys and custom domains — no allowlist to keep in sync. A missing Origin
// means a non-browser client, since browsers always send it on POST.
//
// A speed bump, not security: Origin is trivially forged outside a browser. The rate
// limits in _ratelimit.ts are the real control.
export function isSameOrigin(req: VercelRequest): boolean {
  const origin = firstHeader(req.headers?.origin);
  if (!origin) return false;

  // x-forwarded-host is what the user actually hit when Vercel's proxy is in front.
  const hosts = [firstHeader(req.headers['x-forwarded-host']), firstHeader(req.headers.host)].filter(
    (h): h is string => Boolean(h),
  );
  try {
    return hosts.includes(new URL(origin).host);
  } catch {
    return false; // malformed Origin
  }
}
