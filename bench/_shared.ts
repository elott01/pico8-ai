// Shared plumbing for the bench runners. Underscore-prefixed to match the api/ convention
// for "helper, not an entry point".

import { readFileSync } from 'node:fs';
import { MODEL, GEMINI_URL } from '../api/_gemini.ts';

// Re-exported so the runners import the model id from one place. It comes from api/, not
// from here, so the harness cannot benchmark a different model than production serves.
export { MODEL };
const ENDPOINT = GEMINI_URL;

/**
 * Prefers the environment, falls back to .env.local.
 *
 * The env var comes first so the key can be supplied without writing it to disk; the file
 * fallback keeps a bare `npm run bench` working, since .env.local is where `vercel dev`
 * already reads it from and is gitignored.
 */
export function apiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  let env: string;
  try {
    env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    throw new Error('GEMINI_API_KEY is unset and .env.local could not be read');
  }
  const key = env.match(/GEMINI_API_KEY\s*=\s*"?([^"\n\r]+)"?/)?.[1]?.trim();
  if (!key) throw new Error('GEMINI_API_KEY not found in .env.local');
  return key;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export type Call = {
  ms: number;
  status: number;
  /** Parsed JSON body of the model's reply, or null if it did not parse. */
  reply: Record<string, unknown> | null;
  outputTokens: number | null;
  /** Key order as it appeared in the raw text — the `commentary` last rule is load-bearing. */
  keyOrder: string[];
  /** How many HTTP attempts it took. >1 means a transient failure was retried. */
  attempts: number;
};

/**
 * One measured call, retrying transient failures.
 *
 * 429/503 are rate limiting and overload, not model behaviour. An earlier run counted
 * them as wrong answers and produced a plausible-looking table from 53% garbage — so
 * they are retried here, and anything still failing is excluded from metrics upstream
 * rather than scored.
 *
 * `ms` measures only the attempt that succeeded; backoff waits are not latency.
 */
export async function callGemini(
  key: string,
  prompt: string,
  generationConfig: Record<string, unknown>,
  opts: { maxAttempts?: number; backoffMs?: number } = {},
): Promise<Call> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const backoffMs = opts.backoffMs ?? 6000;
  let last: Call | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t = Date.now();
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
    });
    const ms = Date.now() - t;
    const data = (await r.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { candidatesTokenCount?: number };
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let reply: Record<string, unknown> | null = null;
    let keyOrder: string[] = [];
    try {
      reply = JSON.parse(text) as Record<string, unknown>;
      // Object key order in JS preserves insertion order for string keys, which mirrors
      // the order the model generated them.
      keyOrder = Object.keys(reply);
    } catch {
      /* left null; counted as a parse error */
    }

    last = {
      ms,
      status: r.status,
      reply,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
      keyOrder,
      attempts: attempt,
    };

    if (r.status === 200) return last;
    if (r.status !== 429 && r.status !== 503) return last; // only transient failures are worth retrying
    if (attempt < maxAttempts) await sleep(backoffMs * attempt); // linear backoff
  }

  return last as Call;
}