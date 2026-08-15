// Prompt benchmark. Calls Gemini directly with the *real* buildPrompt, so the numbers
// isolate the prompt rather than the rate limiter, KV, or Vercel cold starts.
//
//   node bench/baseline.ts before          # writes bench/results/before.json
//   node bench/baseline.ts after --runs 5
//
// Reads GEMINI_API_KEY from .env.local. Costs POSITIONS x runs Gemini calls (default 27).
//
// Transport and methodology are shared with ab.ts through _shared.ts — same retry on
// 429/503, same "score HTTP 200 only" rule, same default gap. That sharing is the point:
// both runners write into results/, and numbers gathered under different throttling
// discipline cannot be compared. See results/README.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildPrompt } from '../api/_prompt.ts';
import { GENERATION_CONFIG } from '../api/_gemini.ts';
import { POSITIONS, truth } from './positions.ts';
import { apiKey, callGemini, mean, pct, sleep, MODEL } from './_shared.ts';

const label = process.argv[2] ?? 'run';
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 3;

// Matches ab.ts. The old 750ms default sat right under the free tier's per-minute ceiling,
// so throttled calls landed in the latency data as "slow calls" and corrupted the very
// number being measured — the pre-fix results/before.json reports a p95 of 11023ms for the
// same prompt and model that ab.ts measures at 5494ms.
const gapArg = process.argv.indexOf('--gap');
const GAP_MS = gapArg > -1 ? Number(process.argv[gapArg + 1]) : 3000;

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
  status: number;
  attempts: number;
};

const key = apiKey();
const samples: Sample[] = [];

console.log(`benchmark "${label}" — ${POSITIONS.length} positions x ${RUNS} runs\n`);

for (const pos of POSITIONS) {
  const t = truth(pos.board);
  for (let i = 0; i < RUNS; i++) {
    if (samples.length) await sleep(GAP_MS);
    const call = await callGemini(key, buildPrompt(pos.board), GENERATION_CONFIG);
    const raw = call.reply?.move;
    const move = typeof raw === 'number' && Number.isInteger(raw) ? raw : null;

    samples.push({
      position: pos.name,
      ms: call.ms,
      outputTokens: call.outputTokens,
      move,
      correct: move !== null && pos.expect.includes(move),
      winMoveCorrect: (call.reply?.winMove ?? null) === t.winMove,
      blockMoveCorrect: (call.reply?.blockMove ?? null) === t.blockMove,
      parseError: call.reply === null,
      status: call.status,
      attempts: call.attempts,
    });

    process.stdout.write(
      `  ${pos.name.padEnd(13)} run ${i + 1}/${RUNS}  ${String(call.ms).padStart(5)}ms  ` +
        `tok=${String(call.outputTokens ?? '?').padStart(4)}  move=${move ?? '-'}  ` +
        `${move !== null && pos.expect.includes(move) ? 'ok' : 'MISS'}` +
        `${call.status !== 200 ? `  http=${call.status}` : ''}\n`,
    );
  }
}

// ---- summary ----------------------------------------------------------------------

// Metrics are computed over HTTP 200 samples ONLY, exactly as ab.ts does. A 429 is the
// rate limiter talking, not the model; scoring it as a wrong answer once turned a
// rate-limited run into a confident-looking table that was 53% noise.
const scored = samples.filter((x) => x.status === 200);
const valid = scored.length;
const validity = samples.length ? valid / samples.length : 0;
const TRUSTWORTHY = 0.9;

const share = (predicate: (x: Sample) => boolean) =>
  valid ? scored.filter(predicate).length / valid : 0;

const byPosition = POSITIONS.map((p) => {
  const s = scored.filter((x) => x.position === p.name);
  return {
    position: p.name,
    calls: s.length,
    accuracy: s.length ? s.filter((x) => x.correct).length / s.length : null,
    meanMs: s.length ? Math.round(mean(s.map((x) => x.ms))) : null,
    meanTokens: s.length ? Math.round(mean(s.map((x) => x.outputTokens ?? 0))) : null,
  };
});

const allMs = scored.map((x) => x.ms);
const summary = {
  label,
  when: new Date().toISOString(),
  model: MODEL,
  runs: RUNS,
  gapMs: GAP_MS,
  positions: POSITIONS.length,
  totalCalls: samples.length,
  valid,
  trustworthy: validity >= TRUSTWORTHY,
  latency: { p50: pct(allMs, 50), p95: pct(allMs, 95), mean: Math.round(mean(allMs)) },
  outputTokens: { mean: Math.round(mean(scored.map((x) => x.outputTokens ?? 0))) },
  accuracy: share((x) => x.correct),
  winMoveAccuracy: share((x) => x.winMoveCorrect),
  blockMoveAccuracy: share((x) => x.blockMoveCorrect),
  parseErrors: scored.filter((x) => x.parseError).length,
  byPosition,
};

console.log(`\nvalid samples: ${valid}/${samples.length} (${(validity * 100).toFixed(0)}%)`);
if (validity < TRUSTWORTHY) {
  console.log('\n' + '!'.repeat(88));
  console.log(`RESULTS NOT TRUSTWORTHY — ${samples.length - valid} calls failed (rate limit / overload).`);
  console.log('Numbers below are computed over the survivors and may be badly skewed.');
  console.log('Re-run with a larger --gap, or wait for the quota window to reset.');
  console.log('!'.repeat(88));
}

console.log('\n' + '-'.repeat(64));
console.log(`latency        p50 ${summary.latency.p50}ms   p95 ${summary.latency.p95}ms   mean ${summary.latency.mean}ms`);
console.log(`output tokens  mean ${summary.outputTokens.mean}`);
console.log(`move accuracy  ${(summary.accuracy * 100).toFixed(0)}%  (${scored.filter((x) => x.correct).length}/${valid})`);
console.log(`winMove right  ${(summary.winMoveAccuracy * 100).toFixed(0)}%   blockMove right ${(summary.blockMoveAccuracy * 100).toFixed(0)}%`);
console.log(`parse errors   ${summary.parseErrors}`);
console.log('-'.repeat(64));
for (const p of byPosition) {
  if (p.accuracy === null) {
    console.log(`  ${p.position.padEnd(13)} no data`);
    continue;
  }
  console.log(`  ${p.position.padEnd(13)} acc ${(p.accuracy * 100).toFixed(0).padStart(3)}%  ${String(p.meanMs).padStart(5)}ms  ${String(p.meanTokens).padStart(4)} tok`);
}

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`${label}.json`, dir), JSON.stringify({ summary, samples }, null, 2));
console.log(`\nwrote bench/results/${label}.json`);
