// A/B across prompt/decoding variants on the fixed position suite.
//
//   node bench/ab.ts            # 4 runs per position per variant (72 calls)
//   node bench/ab.ts --runs 6
//
// Answers three questions before either change gets built:
//   1. Does a schema enum actually eliminate illegal moves?
//   2. Does it cost accuracy on positions that currently pass?
//   3. Does keeping `lines` in the response drag the token count back up?

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildPrompt } from '../api/_prompt.ts';
import { POSITIONS, truth } from './positions.ts';
import { VARIANTS as ALL_VARIANTS } from './variants.ts';
import { apiKey, callGemini, mean, pct, sleep, MODEL } from './_shared.ts';

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 4;
const gapArg = process.argv.indexOf('--gap');
const GAP_MS = gapArg > -1 ? Number(process.argv[gapArg + 1]) : 3000;

// --variants current,schema-min  — narrow the comparison once a variant is ruled out.
const variantsArg = process.argv.indexOf('--variants');
const WANTED = variantsArg > -1 ? process.argv[variantsArg + 1].split(',') : null;

type Sample = {
  variant: string;
  position: string;
  ms: number;
  outputTokens: number | null;
  move: number | null;
  legal: boolean;
  correct: boolean;
  winMoveCorrect: boolean | null;
  blockMoveCorrect: boolean | null;
  commentaryLast: boolean | null;
  parseError: boolean;
  status: number;
  attempts: number;
};

const VARIANTS = WANTED ? ALL_VARIANTS.filter((v) => WANTED.includes(v.name)) : ALL_VARIANTS;
if (!VARIANTS.length) throw new Error(`no variants matched: ${WANTED?.join(',')}`);

const key = apiKey();
const samples: Sample[] = [];
const total = VARIANTS.length * POSITIONS.length * RUNS;
let n = 0;

console.log(`A/B — ${VARIANTS.length} variants x ${POSITIONS.length} positions x ${RUNS} runs = ${total} calls\n`);
for (const v of VARIANTS) console.log(`  ${v.name.padEnd(12)} ${v.describe}`);
console.log();

for (const variant of VARIANTS) {
  for (const pos of POSITIONS) {
    const t = truth(pos.board);
    for (let i = 0; i < RUNS; i++) {
      if (n++) await sleep(GAP_MS);
      const promptText = variant.prompt ? variant.prompt(pos.board) : buildPrompt(pos.board);
      const call = await callGemini(key, promptText, variant.config(pos.board));
      const raw = call.reply?.move;
      const move = raw === undefined || raw === null ? null : Number(raw);
      const parsed = Number.isInteger(move) ? (move as number) : null;

      samples.push({
        variant: variant.name,
        position: pos.name,
        ms: call.ms,
        outputTokens: call.outputTokens,
        move: parsed,
        legal: parsed !== null && t.legalCells.includes(parsed),
        correct: parsed !== null && pos.expect.includes(parsed),
        winMoveCorrect: variant.emitsAnalysis ? (call.reply?.winMove ?? null) === t.winMove : null,
        blockMoveCorrect: variant.emitsAnalysis ? (call.reply?.blockMove ?? null) === t.blockMove : null,
        commentaryLast: call.keyOrder.length ? call.keyOrder[call.keyOrder.length - 1] === 'commentary' : null,
        parseError: call.reply === null,
        status: call.status,
        attempts: call.attempts,
      });

      process.stdout.write(
        `  [${String(n).padStart(3)}/${total}] ${variant.name.padEnd(12)} ${pos.name.padEnd(13)} ` +
          `${String(call.ms).padStart(6)}ms tok=${String(call.outputTokens ?? '?').padStart(4)} ` +
          `move=${parsed ?? '-'} ${parsed !== null && t.legalCells.includes(parsed) ? '   ' : 'ILL'} ` +
          `${parsed !== null && pos.expect.includes(parsed) ? 'ok' : 'MISS'}` +
          `${call.status !== 200 ? ` http=${call.status}` : ''}\n`,
      );
    }
  }
}

// ---- summary ------------------------------------------------------------------------

// Metrics are computed over HTTP 200 samples ONLY. A 429 is the rate limiter talking,
// not the model; scoring it as a wrong answer once turned a rate-limited run into a
// confident-looking table that was 53% noise.
const rows = VARIANTS.map((v) => {
  const s = samples.filter((x) => x.variant === v.name && x.status === 200);
  const ms = s.map((x) => x.ms);
  const analysis = s.filter((x) => x.winMoveCorrect !== null);
  return {
    variant: v.name,
    calls: s.length,
    p50: pct(ms, 50),
    p95: pct(ms, 95),
    meanTokens: Math.round(mean(s.map((x) => x.outputTokens ?? 0))),
    illegal: s.filter((x) => !x.legal).length,
    accuracy: s.filter((x) => x.correct).length / s.length,
    winMoveAccuracy: analysis.length ? analysis.filter((x) => x.winMoveCorrect).length / analysis.length : null,
    commentaryLastAlways: s.every((x) => x.commentaryLast !== false),
    parseErrors: s.filter((x) => x.parseError).length,
  };
});

const valid = samples.filter((x) => x.status === 200).length;
const validity = valid / samples.length;
const TRUSTWORTHY = 0.9;

console.log(`\nvalid samples: ${valid}/${samples.length} (${(validity * 100).toFixed(0)}%)`);
if (validity < TRUSTWORTHY) {
  console.log('\n' + '!'.repeat(88));
  console.log(`RESULTS NOT TRUSTWORTHY — ${samples.length - valid} calls failed (rate limit / overload).`);
  console.log('Numbers below are computed over the survivors and may be badly skewed.');
  console.log('Re-run with a larger --gap, or wait for the quota window to reset.');
  console.log('!'.repeat(88));
}

console.log('\n' + '='.repeat(88));
console.log('variant       p50     p95    tokens  illegal  accuracy  winMove  cmtLast  parseErr');
console.log('-'.repeat(88));
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(12)} ${String(r.p50).padStart(5)}ms ${String(r.p95).padStart(6)}ms ` +
      `${String(r.meanTokens).padStart(6)} ${String(r.illegal).padStart(8)} ` +
      `${(r.accuracy * 100).toFixed(0).padStart(8)}% ` +
      `${(r.winMoveAccuracy === null ? '  n/a' : `${(r.winMoveAccuracy * 100).toFixed(0)}%`).padStart(8)} ` +
      `${String(r.commentaryLastAlways).padStart(8)} ${String(r.parseErrors).padStart(9)}`,
  );
}
console.log('='.repeat(88));

// Per-position accuracy, so a regression on one board is not hidden by the average.
console.log('\naccuracy by position');
console.log('position       ' + VARIANTS.map((v) => v.name.padStart(13)).join(''));
for (const p of POSITIONS) {
  const cells = VARIANTS.map((v) => {
    const s = samples.filter((x) => x.variant === v.name && x.position === p.name && x.status === 200);
    if (!s.length) return 'no data'.padStart(13);
    return `${((s.filter((x) => x.correct).length / s.length) * 100).toFixed(0)}% (n=${s.length})`.padStart(13);
  });
  console.log(p.name.padEnd(15) + cells.join(''));
}

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('ab.json', dir), JSON.stringify({ model: MODEL, runs: RUNS, valid, total: samples.length, trustworthy: validity >= TRUSTWORTHY, rows, samples }, null, 2));
console.log('\nwrote bench/results/ab.json');