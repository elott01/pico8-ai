// Prompt benchmark. Calls Gemini directly with the *real* buildPrompt, so the numbers
// isolate the prompt rather than the rate limiter, KV, or Vercel cold starts.
//
//   node bench/baseline.ts before          # writes bench/results/before.json
//   node bench/baseline.ts after --runs 5
//
// Reads GEMINI_API_KEY from .env.local. Costs POSITIONS x runs Gemini calls (default 18).

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildPrompt } from '../api/_prompt.ts';
import type { ModelReply } from '../api/_types.ts';
import { POSITIONS, truth } from './positions.ts';

const label = process.argv[2] ?? 'run';
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 3;

// Calls run back to back at ~5s each, which sits close to the free tier's per-minute
// ceiling. A short gap keeps throttling (503/429) out of the latency data — those would
// otherwise show up as "slow calls" and corrupt the very number being measured.
const gapArg = process.argv.indexOf('--gap');
const GAP_MS = gapArg > -1 ? Number(process.argv[gapArg + 1]) : 750;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const MODEL = 'gemini-3.1-flash-lite';
// Not named URL — that would shadow the global constructor used for the file paths below.
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function apiKey(): string {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const key = env.match(/GEMINI_API_KEY\s*=\s*"?([^"\n\r]+)"?/)?.[1]?.trim();
  if (!key) throw new Error('GEMINI_API_KEY not found in .env.local');
  return key;
}

type Sample = {
  position: string;
  ms: number;
  outputTokens: number | null;
  move: number | null;
  correct: boolean;
  /** Did the model's own winMove/blockMove match reality? The thing perception should fix. */
  winMoveCorrect: boolean;
  blockMoveCorrect: boolean;
  parseError: boolean;
};

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function one(key: string, board: (typeof POSITIONS)[number]['board']) {
  const t = Date.now();
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(board) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  const ms = Date.now() - t;
  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { candidatesTokenCount?: number };
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let reply: ModelReply | null = null;
  try {
    reply = JSON.parse(text) as ModelReply;
  } catch {
    /* left null; counted as a parse error */
  }
  return { ms, reply, outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null, status: r.status };
}

const key = apiKey();
const samples: Sample[] = [];

console.log(`benchmark "${label}" — ${POSITIONS.length} positions x ${RUNS} runs\n`);

for (const pos of POSITIONS) {
  const t = truth(pos.board);
  for (let i = 0; i < RUNS; i++) {
    if (samples.length) await sleep(GAP_MS);
    const { ms, reply, outputTokens, status } = await one(key, pos.board);
    const move = typeof reply?.move === 'number' ? reply.move : null;
    samples.push({
      position: pos.name,
      ms,
      outputTokens,
      move,
      correct: move !== null && pos.expect.includes(move),
      winMoveCorrect: (reply?.winMove ?? null) === t.winMove,
      blockMoveCorrect: (reply?.blockMove ?? null) === t.blockMove,
      parseError: reply === null,
    });
    process.stdout.write(
      `  ${pos.name.padEnd(13)} run ${i + 1}/${RUNS}  ${String(ms).padStart(5)}ms  ` +
        `tok=${String(outputTokens ?? '?').padStart(4)}  move=${move ?? '-'}  ` +
        `${move !== null && pos.expect.includes(move) ? 'ok' : 'MISS'}` +
        `${status !== 200 ? `  http=${status}` : ''}\n`,
    );
  }
}

// ---- summary ----------------------------------------------------------------------

const byPosition = POSITIONS.map((p) => {
  const s = samples.filter((x) => x.position === p.name);
  return {
    position: p.name,
    accuracy: s.filter((x) => x.correct).length / s.length,
    meanMs: Math.round(mean(s.map((x) => x.ms))),
    meanTokens: Math.round(mean(s.map((x) => x.outputTokens ?? 0))),
  };
});

const allMs = samples.map((x) => x.ms);
const summary = {
  label,
  when: new Date().toISOString(),
  model: MODEL,
  runs: RUNS,
  positions: POSITIONS.length,
  totalCalls: samples.length,
  latency: { p50: pct(allMs, 50), p95: pct(allMs, 95), mean: Math.round(mean(allMs)) },
  outputTokens: { mean: Math.round(mean(samples.map((x) => x.outputTokens ?? 0))) },
  accuracy: samples.filter((x) => x.correct).length / samples.length,
  winMoveAccuracy: samples.filter((x) => x.winMoveCorrect).length / samples.length,
  blockMoveAccuracy: samples.filter((x) => x.blockMoveCorrect).length / samples.length,
  parseErrors: samples.filter((x) => x.parseError).length,
  byPosition,
};

console.log('\n' + '-'.repeat(64));
console.log(`latency        p50 ${summary.latency.p50}ms   p95 ${summary.latency.p95}ms   mean ${summary.latency.mean}ms`);
console.log(`output tokens  mean ${summary.outputTokens.mean}`);
console.log(`move accuracy  ${(summary.accuracy * 100).toFixed(0)}%  (${samples.filter((x) => x.correct).length}/${samples.length})`);
console.log(`winMove right  ${(summary.winMoveAccuracy * 100).toFixed(0)}%   blockMove right ${(summary.blockMoveAccuracy * 100).toFixed(0)}%`);
console.log(`parse errors   ${summary.parseErrors}`);
console.log('-'.repeat(64));
for (const p of byPosition) {
  console.log(`  ${p.position.padEnd(13)} acc ${(p.accuracy * 100).toFixed(0).padStart(3)}%  ${String(p.meanMs).padStart(5)}ms  ${String(p.meanTokens).padStart(4)} tok`);
}

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`${label}.json`, dir), JSON.stringify({ summary, samples }, null, 2));
console.log(`\nwrote bench/results/${label}.json`);