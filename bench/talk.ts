// gem-in-eye's dialogue bench: the shipping prompt (and any A/B variants) across fixed stat
// fixtures, several runs each, scored on HTTP 200 samples only.
//
//   node bench/talk.ts                                # `current` only, 5 runs per fixture
//   node bench/talk.ts --variants current,notice      # an A/B
//   node bench/talk.ts --fixtures flawless,flailing --runs 3
//   node bench/talk.ts --label persona-v1             # keeps its own results files
//   node bench/talk.ts --dry                          # print a prompt, spend nothing
//
// SPENDS GEMINI QUOTA: fixtures x variants x runs calls. The default is 9 x 1 x 5 = 45.
//
// Repeated runs are the point here, not noise to average away: the speech must not come out
// the same twice, so variety is measured within each fixture. Writes two files — the JSON
// record, and a markdown file of every speech, because reading them is the actual review.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cleanSpeech, paginate } from '../api/_talk_text.ts';
import { parseTalkReply, priceBand } from '../api/_talk_prompt.ts';
import {
  TALK_FIXTURES,
  TALK_VARIANTS,
  variantPrompt,
  variantConfig,
  expectedKeys,
  similarity,
  NEAR_DUPLICATE,
  isSpecific,
  mentionsPrice,
  mentionsClaude,
  isGraphic,
  isLiteralDeath,
  saysZombie,
  usesStockPhrase,
  opensWithNumber,
  usesEndearment,
  repeatedPhrases,
  SHORT,
} from './talk_suite.ts';
import { apiKey, callGemini, mean, pct, sleep, MODEL } from './_shared.ts';

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const RUNS = Number(arg('--runs') ?? 5);
// 5s keeps under the free tier's 15 requests a minute, as in ab.ts: Google queues the
// excess rather than rejecting it, and the queueing would be reported as latency.
const GAP_MS = Number(arg('--gap') ?? 5000);

// Unlike ab.ts the default is the control alone: a dialogue run needs repeats to measure
// variety, so every extra variant multiplies a cost that is already 45 calls.
const WANTED_V = (arg('--variants') ?? 'current').split(',');
const WANTED_F = arg('--fixtures')?.split(',') ?? null;

const VARIANTS = TALK_VARIANTS.filter((v) => WANTED_V.includes(v.name));
const FIXTURES = WANTED_F ? TALK_FIXTURES.filter((f) => WANTED_F.includes(f.name)) : TALK_FIXTURES;
if (VARIANTS.length !== WANTED_V.length) {
  throw new Error(`unknown variant in "${WANTED_V.join(',')}"; have ${TALK_VARIANTS.map((v) => v.name).join(', ')}`);
}
if (!FIXTURES.length || (WANTED_F && FIXTURES.length !== WANTED_F.length)) {
  throw new Error(`unknown fixture in "${WANTED_F?.join(',')}"; have ${TALK_FIXTURES.map((f) => f.name).join(', ')}`);
}

const total = VARIANTS.length * FIXTURES.length * RUNS;

if (process.argv.includes('--dry')) {
  const f = FIXTURES[0];
  console.log(`DRY RUN — no calls made. Would cost ${total} calls.\n`);
  console.log(`fixtures: ${FIXTURES.map((x) => x.name).join(', ')}\n`);
  for (const v of VARIANTS) {
    console.log('='.repeat(100));
    console.log(`${v.name} — ${v.describe}   [fixture: ${f.name}]`);
    console.log(`config: ${JSON.stringify(variantConfig(v, f))}`);
    console.log('-'.repeat(100));
    console.log(variantPrompt(v, f));
    console.log();
  }
  process.exit(0);
}

type Sample = {
  variant: string;
  fixture: string;
  run: number;
  status: number;
  attempts: number;
  ms: number;
  outputTokens: number | null;
  parseError: boolean;
  keyOrder: string[];
  keyOrderOk: boolean;
  notice: string | null;
  verdict: string | null;
  verdictOk: boolean | null;
  listPrice: number;
  price: number | null;
  /** The model's speech exactly as returned, before cleaning. */
  rawSpeech: string | null;
  /** What the cart would print: cleaned, wrapped and paged. */
  pages: string[];
  chars: number;
  cut: boolean;
  /** Cleaning changed more than case and spacing: the prompt's format rules were missed. */
  neededCleaning: boolean;
  specific: boolean | null;
  mentionsPrice: boolean | null;
  /** Highest similarity to the speeches in the fixture's memory, null if it has none. */
  memorySimilarity: number | null;
  claude: boolean;
  graphic: boolean;
  literalDeath: boolean;
  zombie: boolean;
  stock: boolean;
  opensWithNumber: boolean;
  endearment: boolean;
};

const key = apiKey();
const samples: Sample[] = [];
let n = 0;

console.log(`talk bench — ${VARIANTS.length} variants x ${FIXTURES.length} fixtures x ${RUNS} runs = ${total} calls\n`);
for (const v of VARIANTS) console.log(`  ${v.name.padEnd(10)} ${v.describe}`);
console.log();

for (const v of VARIANTS) {
  for (const f of FIXTURES) {
    const list = f.request.purchase.listPrice;
    for (let run = 1; run <= RUNS; run++) {
      if (n++) await sleep(GAP_MS);
      const call = await callGemini(key, variantPrompt(v, f), variantConfig(v, f));
      const parsed = parseTalkReply(call.reply, list);
      const clean = parsed.speech ? cleanSpeech(parsed.speech) : '';
      const { pages, cut } = paginate(clean);
      const speech = pages.join(' ');
      const memory = f.request.memory.lastSpeeches;

      const sample: Sample = {
        variant: v.name,
        fixture: f.name,
        run,
        status: call.status,
        attempts: call.attempts,
        ms: call.ms,
        outputTokens: call.outputTokens,
        parseError: call.reply === null,
        keyOrder: call.keyOrder,
        keyOrderOk: call.keyOrder.join() === expectedKeys(v).join(),
        notice: typeof call.reply?.notice === 'string' ? call.reply.notice : null,
        verdict: parsed.verdict,
        verdictOk: f.expectVerdict ? parsed.verdict === f.expectVerdict : null,
        listPrice: list,
        price: parsed.price,
        rawSpeech: parsed.speech,
        pages,
        chars: speech.length,
        cut,
        neededCleaning: !!parsed.speech && parsed.speech.toLowerCase().replace(/\s+/g, ' ').trim() !== clean,
        specific: speech ? isSpecific(speech, f) : null,
        mentionsPrice: speech ? mentionsPrice(speech, parsed.price) : null,
        memorySimilarity: speech && memory.length ? Math.max(...memory.map((m) => similarity(speech, m))) : null,
        claude: mentionsClaude(speech),
        graphic: isGraphic(speech),
        literalDeath: isLiteralDeath(speech),
        zombie: saysZombie(speech),
        stock: usesStockPhrase(speech),
        opensWithNumber: opensWithNumber(speech),
        endearment: usesEndearment(speech),
      };
      samples.push(sample);

      process.stdout.write(
        `  [${String(n).padStart(3)}/${total}] ${v.name.padEnd(9)} ${f.name.padEnd(16)} ` +
          `${String(call.ms).padStart(6)}ms ${(parsed.verdict ?? '-').padEnd(11)} ` +
          `${String(parsed.price ?? '-').padStart(2)}/${list} p=${pages.length}` +
          `${call.status !== 200 ? ` http=${call.status}` : ''}  ${speech.slice(0, 60)}\n`,
      );
    }
  }
}

// ---- summary ---------------------------------------------------------------------------

// HTTP 200 only, as in ab.ts: a 429 is the rate limiter talking, not the model.
const ok = samples.filter((s) => s.status === 200);
const rate = (xs: Sample[], pick: (s: Sample) => boolean | null) => {
  const scored = xs.filter((s) => pick(s) !== null);
  return scored.length ? scored.filter((s) => pick(s)).length / scored.length : null;
};
const fmt = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
const discount = (xs: Sample[], verdict: string) => {
  const d = xs.filter((s) => s.verdict === verdict && s.price !== null).map((s) => 1 - s.price! / s.listPrice);
  return d.length ? mean(d) : null;
};

const rows = VARIANTS.map((v) => {
  const s = ok.filter((x) => x.variant === v.name);
  const ms = s.map((x) => x.ms);
  return {
    variant: v.name,
    calls: s.length,
    p50: pct(ms, 50),
    p95: pct(ms, 95),
    meanTokens: Math.round(mean(s.map((x) => x.outputTokens ?? 0))),
    parseErrors: s.filter((x) => x.parseError).length,
    keyOrderAlways: s.every((x) => x.keyOrderOk),
    priceInBand: rate(s, (x) => (x.parseError ? null : x.price !== null)),
    verdictSanity: rate(s, (x) => x.verdictOk),
    specific: rate(s, (x) => x.specific),
    mentionsPrice: s.filter((x) => x.mentionsPrice).length,
    memoryRepeats: s.filter((x) => (x.memorySimilarity ?? 0) >= NEAR_DUPLICATE).length,
    neededCleaning: s.filter((x) => x.neededCleaning).length,
    cutRate: rate(s, (x) => (x.pages.length ? x.cut : null)),
    meanPages: Number(mean(s.filter((x) => x.pages.length).map((x) => x.pages.length)).toFixed(2)),
    meanChars: Math.round(mean(s.filter((x) => x.chars).map((x) => x.chars))),
    discountImpressed: discount(s, 'impressed'),
    discountUnimpressed: discount(s, 'unimpressed'),
    short: rate(s, (x) => (x.chars ? x.chars < SHORT : null)),
    claude: rate(s, (x) => (x.chars ? x.claude : null)),
    graphic: s.filter((x) => x.graphic).length,
    literalDeath: s.filter((x) => x.literalDeath).length,
    zombie: s.filter((x) => x.zombie).length,
    stock: rate(s, (x) => (x.chars ? x.stock : null)),
    opensWithNumber: rate(s, (x) => (x.chars ? x.opensWithNumber : null)),
    endearmentWhenImpressed: rate(s.filter((x) => x.verdict === 'impressed'), (x) => x.endearment),
    verdicts: Object.fromEntries(['impressed', 'neutral', 'unimpressed'].map((k) => [k, s.filter((x) => x.verdict === k).length])),
    repeatedPhrases: repeatedPhrases(s.map((x) => x.pages.join(' ')).filter(Boolean)),
  };
});

/** Distinct speeches and reworded repeats within one fixture: the variety measure. */
function variety(xs: Sample[]) {
  const speeches = xs.map((x) => x.pages.join(' ')).filter(Boolean);
  let nearPairs = 0;
  for (let i = 0; i < speeches.length; i++) {
    for (let j = i + 1; j < speeches.length; j++) if (similarity(speeches[i], speeches[j]) >= NEAR_DUPLICATE) nearPairs++;
  }
  return { n: speeches.length, distinct: new Set(speeches).size, nearPairs };
}

const byFixture = VARIANTS.flatMap((v) =>
  FIXTURES.map((f) => {
    const s = ok.filter((x) => x.variant === v.name && x.fixture === f.name);
    const verdicts: Record<string, number> = {};
    for (const x of s) verdicts[x.verdict ?? 'none'] = (verdicts[x.verdict ?? 'none'] ?? 0) + 1;
    const priced = s.filter((x) => x.price !== null);
    return {
      variant: v.name,
      fixture: f.name,
      ...variety(s),
      verdicts,
      expectVerdict: f.expectVerdict ?? null,
      meanPriceOfList: priced.length ? Number(mean(priced.map((x) => x.price! / x.listPrice)).toFixed(2)) : null,
      meanPages: Number(mean(s.filter((x) => x.pages.length).map((x) => x.pages.length)).toFixed(2)),
    };
  }),
);

const valid = ok.length;
const validity = samples.length ? valid / samples.length : 0;
const TRUSTWORTHY = 0.9;

console.log(`\nvalid samples: ${valid}/${samples.length} (${(validity * 100).toFixed(0)}%)`);
if (validity < TRUSTWORTHY) {
  console.log('\n' + '!'.repeat(88));
  console.log(`RESULTS NOT TRUSTWORTHY — ${samples.length - valid} calls failed (rate limit / overload).`);
  console.log('Re-run with a larger --gap, or wait for the quota window to reset.');
  console.log('!'.repeat(88));
}

console.log('\n' + '='.repeat(118));
console.log('variant      p50    tokens keyOrd inBand verdict specific saysPrice memRepeat cleaned  cut pages chars  disc(imp/unimp)');
console.log('-'.repeat(118));
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(10)} ${String(r.p50).padStart(6)}ms ${String(r.meanTokens).padStart(6)} ` +
      `${String(r.keyOrderAlways).padStart(6)} ${fmt(r.priceInBand).padStart(6)} ${fmt(r.verdictSanity).padStart(7)} ` +
      `${fmt(r.specific).padStart(8)} ${String(r.mentionsPrice).padStart(9)} ${String(r.memoryRepeats).padStart(9)} ` +
      `${String(r.neededCleaning).padStart(7)} ${fmt(r.cutRate).padStart(4)} ${String(r.meanPages).padStart(5)} ` +
      `${String(r.meanChars).padStart(5)}  ${fmt(r.discountImpressed)}/${fmt(r.discountUnimpressed)}`,
  );
}
console.log('='.repeat(118));

console.log('\nvoice: short = under ' + SHORT + ' chars; litDeath = said literally, not through software; endear = "champion"/"my boy"');
console.log('variant       short  claude graphic litDeath zombie  stock  opensNum  endear  verdicts (imp/neu/unimp)');
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(12)} ${fmt(r.short).padStart(6)} ${fmt(r.claude).padStart(7)} ${String(r.graphic).padStart(7)} ` +
      `${String(r.literalDeath).padStart(8)}` +
      `${String(r.zombie).padStart(6)} ${fmt(r.stock).padStart(6)}` +
      `${fmt(r.opensWithNumber).padStart(9)} ${fmt(r.endearmentWhenImpressed).padStart(7)}  ` +
      `${r.verdicts.impressed}/${r.verdicts.neutral}/${r.verdicts.unimpressed}`,
  );
}
for (const r of rows) {
  console.log(`  ${r.variant} — phrases repeated across speeches: ${r.repeatedPhrases.map(([g, c]) => `"${g}" x${c}`).join(', ') || 'none'}`);
}

console.log('\nby fixture: distinct/n, reworded pairs, verdicts');
for (const b of byFixture) {
  const verdicts = Object.entries(b.verdicts).map(([k, c]) => `${k} ${c}`).join(', ');
  console.log(
    `  ${b.variant.padEnd(10)} ${b.fixture.padEnd(16)} ${String(b.distinct).padStart(2)}/${b.n}  ` +
      `near-dup pairs ${String(b.nearPairs).padStart(2)}  ${verdicts}${b.expectVerdict ? `  (expect ${b.expectVerdict})` : ''}`,
  );
}

// ---- files ---------------------------------------------------------------------------------

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const label = arg('--label');
const base = `talk${label ? `-${label}` : ''}`;
if (existsSync(new URL(`${base}.json`, dir))) {
  console.log(`\nNOTE: replacing the existing bench/results/${base}.json and .md. Pass --label <name> to keep both.`);
}

writeFileSync(
  new URL(`${base}.json`, dir),
  JSON.stringify(
    { suite: 'talk', model: MODEL, runs: RUNS, gapMs: GAP_MS, valid, total: samples.length, trustworthy: validity >= TRUSTWORTHY, rows, byFixture, samples },
    null,
    2,
  ),
);

// The review copy: every speech as the cart would page it, grouped the way it is judged.
const md: string[] = [
  `# talk bench${label ? `: ${label}` : ''}`,
  '',
  `${MODEL} · ${RUNS} runs per fixture · ${valid}/${samples.length} valid · generated by \`node bench/talk.ts\`. ` +
    'Pages are separated by " / ". A price is shown against list.',
];
for (const v of VARIANTS) {
  md.push('', `## ${v.name}`, '', v.describe);
  for (const f of FIXTURES) {
    const { min, max } = priceBand(f.request.purchase.listPrice);
    md.push('', `### ${f.name}`, '', `${f.why} Buying ${f.request.purchase.item} ${f.request.purchase.tier}; price band ${min}-${max}.`, '');
    for (const s of ok.filter((x) => x.variant === v.name && x.fixture === f.name)) {
      const flags = [s.cut && 'cut', s.mentionsPrice && 'says price', (s.memorySimilarity ?? 0) >= NEAR_DUPLICATE && 'repeats memory', s.graphic && 'graphic?', s.literalDeath && 'literal death', s.zombie && 'zombie']
        .filter(Boolean)
        .join(', ');
      md.push(
        `- **${s.verdict ?? 'no verdict'}**, ${s.price ?? '-'}/${s.listPrice}: ${s.pages.length ? s.pages.join(' / ') : '*(no speech)*'}` +
          `${s.notice ? ` *(notice: ${s.notice})*` : ''}${flags ? ` **[${flags}]**` : ''}`,
      );
    }
  }
}
writeFileSync(new URL(`${base}.md`, dir), md.join('\n') + '\n');
console.log(`\nwrote bench/results/${base}.json and ${base}.md`);
