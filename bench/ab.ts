// A/B across prompt/decoding variants on a fixed position suite.
//
//   node bench/ab.ts                              # tic-tac-toe, 4 runs per position per variant
//   node bench/ab.ts --suite connect_four
//   node bench/ab.ts --suite connect_four --runs 3 --variants facts,facts+parity
//   node bench/ab.ts --suite connect_four --label parity   # keeps its own results file
//   node bench/ab.ts --suite connect_four --dry            # print prompts, spend nothing
//
// Answers, before either change gets built:
//   1. Does a schema enum actually eliminate illegal moves?
//   2. Does a prompt change cost accuracy on positions that currently pass?
//   3. What does it cost in tokens and latency?
//
// One runner, two suites. The loop, the HTTP-200-only scoring rule and the report are
// shared deliberately: a second copy of them would drift, which is exactly how
// baseline.ts ended up reporting a p95 of 11s for a prompt ab.ts measured at 5.5s.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Cell } from '../api/_types.ts';
import { buildPrompt } from '../api/_prompt.ts';
import { POSITIONS, truth } from './positions.ts';
import { VARIANTS as TTT_VARIANTS } from './variants.ts';
import { C4_POSITIONS, C4_VARIANTS, isLegal as c4IsLegal } from './connect_four.ts';
import { apiKey, callGemini, mean, pct, sleep, MODEL } from './_shared.ts';

// Both games put their board on the wire as the same flat array of cells, so the runner
// never needs to know which shape it is holding — only the suite does.
type AnyBoard = Cell[];

type SuiteVariant = {
  name: string;
  describe: string;
  prompt(board: AnyBoard): string;
  config(board: AnyBoard): Record<string, unknown>;
  /** Does this variant ask the model to emit its own win/block analysis? */
  emitsAnalysis: boolean;
};

type Suite = {
  id: string;
  /** What a move value names, for the report. */
  moveUnit: string;
  positions: { name: string; board: AnyBoard; expect: number[] }[];
  variants: SuiteVariant[];
  isLegal(board: AnyBoard, move: number): boolean;
  /** Ground truth for the model's own analysis fields, where a variant emits them. */
  analysis?(board: AnyBoard): { winMove: number | null; blockMove: number | null };
};

const SUITES: Record<string, Suite> = {
  tic_tac_toe: {
    id: 'tic_tac_toe',
    moveUnit: 'cell',
    positions: POSITIONS,
    // The tic-tac-toe variants default to the production prompt; normalising here keeps
    // that default out of the shared loop.
    variants: TTT_VARIANTS.map((v) => ({
      name: v.name,
      describe: v.describe,
      prompt: (b: AnyBoard) => (v.prompt ? v.prompt(b) : buildPrompt(b)),
      config: v.config,
      emitsAnalysis: v.emitsAnalysis,
    })),
    isLegal: (board, move) => truth(board).legalCells.includes(move),
    analysis: (board) => {
      const t = truth(board);
      return { winMove: t.winMove, blockMove: t.blockMove };
    },
  },
  connect_four: {
    id: 'connect_four',
    moveUnit: 'column',
    positions: C4_POSITIONS,
    variants: C4_VARIANTS.map((v) => ({
      name: v.name,
      describe: v.describe,
      prompt: v.prompt,
      config: v.config,
      // Both Connect Four variants answer with reasoning + move only; there are no
      // structured win/block fields to grade, so winMove accuracy reports n/a.
      emitsAnalysis: false,
    })),
    isLegal: c4IsLegal,
  },
};

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const SUITE_ID = arg('--suite') ?? 'tic_tac_toe';
const suite = SUITES[SUITE_ID];
if (!suite) {
  throw new Error(`unknown --suite "${SUITE_ID}"; try ${Object.keys(SUITES).join(' or ')}`);
}

const RUNS = Number(arg('--runs') ?? 4);
const GAP_MS = Number(arg('--gap') ?? 3000);

// --variants facts,facts+parity  — narrow the comparison once a variant is ruled out.
const WANTED = arg('--variants')?.split(',') ?? null;

type Sample = {
  variant: string;
  position: string;
  ms: number;
  outputTokens: number | null;
  move: number | null;
  legal: boolean;
  correct: boolean;
  /** The model's own stated reason, where the variant asks for one. Not scored — but
   *  without it a wrong move only says WHAT was played, and the interesting question on a
   *  miss is always why. */
  reasoning: string | null;
  winMoveCorrect: boolean | null;
  blockMoveCorrect: boolean | null;
  commentaryLast: boolean | null;
  parseError: boolean;
  status: number;
  attempts: number;
};

const VARIANTS = WANTED ? suite.variants.filter((v) => WANTED.includes(v.name)) : suite.variants;
if (!VARIANTS.length) throw new Error(`no variants matched: ${WANTED?.join(',')}`);

// --dry prints what would be sent and exits before the first call. A live run costs
// positions x variants x runs of a limited free-tier quota, and the most expensive mistake
// is discovering a malformed prompt or an empty enum halfway through paying for one.
if (process.argv.includes('--dry')) {
  const pos = suite.positions[0];
  console.log(`DRY RUN [${suite.id}] — no calls made. Would cost ${VARIANTS.length * suite.positions.length * RUNS} calls.\n`);
  console.log(`positions: ${suite.positions.map((p) => p.name).join(', ')}\n`);
  for (const v of VARIANTS) {
    console.log('='.repeat(90));
    console.log(`${v.name} — ${v.describe}`);
    console.log(`config: ${JSON.stringify(v.config(pos.board))}`);
    console.log('-'.repeat(90));
    console.log(v.prompt(pos.board));
    console.log();
  }
  process.exit(0);
}

const key = apiKey();
const samples: Sample[] = [];
const total = VARIANTS.length * suite.positions.length * RUNS;
let n = 0;

console.log(
  `A/B [${suite.id}] — ${VARIANTS.length} variants x ${suite.positions.length} positions x ${RUNS} runs = ${total} calls\n`,
);
for (const v of VARIANTS) console.log(`  ${v.name.padEnd(14)} ${v.describe}`);
console.log();

for (const variant of VARIANTS) {
  for (const pos of suite.positions) {
    const truthFor = suite.analysis?.(pos.board) ?? null;
    for (let i = 0; i < RUNS; i++) {
      if (n++) await sleep(GAP_MS);
      const call = await callGemini(key, variant.prompt(pos.board), variant.config(pos.board));
      const raw = call.reply?.move;
      const move = raw === undefined || raw === null ? null : Number(raw);
      const parsed = Number.isInteger(move) ? (move as number) : null;
      const legal = parsed !== null && suite.isLegal(pos.board, parsed);

      samples.push({
        variant: variant.name,
        position: pos.name,
        ms: call.ms,
        outputTokens: call.outputTokens,
        move: parsed,
        legal,
        correct: parsed !== null && pos.expect.includes(parsed),
        reasoning: typeof call.reply?.reasoning === 'string' ? call.reply.reasoning : null,
        winMoveCorrect:
          variant.emitsAnalysis && truthFor ? (call.reply?.winMove ?? null) === truthFor.winMove : null,
        blockMoveCorrect:
          variant.emitsAnalysis && truthFor ? (call.reply?.blockMove ?? null) === truthFor.blockMove : null,
        commentaryLast: call.keyOrder.length ? call.keyOrder[call.keyOrder.length - 1] === 'commentary' : null,
        parseError: call.reply === null,
        status: call.status,
        attempts: call.attempts,
      });

      process.stdout.write(
        `  [${String(n).padStart(3)}/${total}] ${variant.name.padEnd(14)} ${pos.name.padEnd(15)} ` +
          `${String(call.ms).padStart(6)}ms tok=${String(call.outputTokens ?? '?').padStart(4)} ` +
          `${suite.moveUnit}=${parsed ?? '-'} ${legal ? '   ' : 'ILL'} ` +
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
  const analysed = s.filter((x) => x.winMoveCorrect !== null);
  return {
    variant: v.name,
    calls: s.length,
    p50: pct(ms, 50),
    p95: pct(ms, 95),
    meanTokens: Math.round(mean(s.map((x) => x.outputTokens ?? 0))),
    illegal: s.filter((x) => !x.legal).length,
    accuracy: s.length ? s.filter((x) => x.correct).length / s.length : 0,
    winMoveAccuracy: analysed.length ? analysed.filter((x) => x.winMoveCorrect).length / analysed.length : null,
    commentaryLastAlways: s.every((x) => x.commentaryLast !== false),
    parseErrors: s.filter((x) => x.parseError).length,
  };
});

const valid = samples.filter((x) => x.status === 200).length;
const validity = samples.length ? valid / samples.length : 0;
const TRUSTWORTHY = 0.9;

console.log(`\nvalid samples: ${valid}/${samples.length} (${(validity * 100).toFixed(0)}%)`);
if (validity < TRUSTWORTHY) {
  console.log('\n' + '!'.repeat(88));
  console.log(`RESULTS NOT TRUSTWORTHY — ${samples.length - valid} calls failed (rate limit / overload).`);
  console.log('Numbers below are computed over the survivors and may be badly skewed.');
  console.log('Re-run with a larger --gap, or wait for the quota window to reset.');
  console.log('!'.repeat(88));
}

console.log('\n' + '='.repeat(90));
console.log('variant         p50     p95    tokens  illegal  accuracy  winMove  cmtLast  parseErr');
console.log('-'.repeat(90));
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(14)} ${String(r.p50).padStart(5)}ms ${String(r.p95).padStart(6)}ms ` +
      `${String(r.meanTokens).padStart(6)} ${String(r.illegal).padStart(8)} ` +
      `${(r.accuracy * 100).toFixed(0).padStart(8)}% ` +
      `${(r.winMoveAccuracy === null ? '  n/a' : `${(r.winMoveAccuracy * 100).toFixed(0)}%`).padStart(8)} ` +
      `${String(r.commentaryLastAlways).padStart(8)} ${String(r.parseErrors).padStart(9)}`,
  );
}
console.log('='.repeat(90));

// Per-position accuracy, so a regression on one board is not hidden by the average.
console.log('\naccuracy by position');
console.log('position         ' + VARIANTS.map((v) => v.name.padStart(15)).join(''));
for (const p of suite.positions) {
  const cells = VARIANTS.map((v) => {
    const s = samples.filter((x) => x.variant === v.name && x.position === p.name && x.status === 200);
    if (!s.length) return 'no data'.padStart(15);
    return `${((s.filter((x) => x.correct).length / s.length) * 100).toFixed(0)}% (n=${s.length})`.padStart(15);
  });
  console.log(p.name.padEnd(17) + cells.join(''));
}

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });

// One file per suite, plus an optional --label, because two runs of the same suite with
// DIFFERENT variant sets are different measurements and must not silently replace one
// another. That already cost a real result: an unlabelled parity run was overwritten by
// the next run and survives only as a console log. tic-tac-toe keeps writing ab.json
// unlabelled so its existing record is not orphaned.
const label = arg('--label');
const file =
  suite.id === 'tic_tac_toe' && !label
    ? 'ab.json'
    : `ab-${suite.id}${label ? `-${label}` : ''}.json`;
if (existsSync(new URL(file, dir))) {
  console.log(`\nNOTE: replacing the existing bench/results/${file}. Pass --label <name> to keep both.`);
}
writeFileSync(
  new URL(file, dir),
  JSON.stringify(
    { suite: suite.id, model: MODEL, runs: RUNS, gapMs: GAP_MS, valid, total: samples.length, trustworthy: validity >= TRUSTWORTHY, rows, samples },
    null,
    2,
  ),
);
console.log(`\nwrote bench/results/${file}`);
