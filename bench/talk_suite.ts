// gem-in-eye's benchmark suite: fixtures, variants and the measures. No network here —
// bench/talk.ts is the runner — so tests/talk-bench.test.ts can check the fixtures for free.
//
// There is no right answer to grade a speech against, so most measures are flags for a
// human to read rather than scores: the plan's rule is that the numbers point at problems
// and reading the speeches decides. The two exceptions are judgements with a defensible
// answer (the owner's own praise and mockery examples) and mechanical properties (price in
// band, key order, length, repetition).

import type { ShopItem, TalkRequest, TalkStats, Verdict } from '../api/_types.ts';
import { TALK_CONFIG } from '../api/_gemini.ts';
import { buildTalkPrompt, talkConfig, TIER_COST, STASH_CAPS, SHOP_ITEMS } from '../api/_talk_prompt.ts';
import type { TalkPromptOptions } from '../api/_talk_prompt.ts';

// ---- fixtures ------------------------------------------------------------------------------

type Tiers = Partial<Record<ShopItem, number>>;

const tiers = (t: Tiers = {}): Record<ShopItem, number> =>
  Object.fromEntries(SHOP_ITEMS.map((it) => [it, t[it] ?? 0])) as Record<ShopItem, number>;

function stats(s: Omit<TalkStats, 'tiers'> & { tiers?: Tiers }): TalkStats {
  return { ...s, tiers: tiers(s.tiers) };
}

/** A purchase of the next tier of `item`, priced the way the cart prices it. */
function buying(item: ShopItem, s: TalkStats): TalkRequest['purchase'] {
  const tier = (s.tiers[item] + 1) as 1 | 2 | 3;
  return { item, tier, listPrice: TIER_COST[tier - 1] };
}

export type TalkFixture = {
  name: string;
  request: TalkRequest;
  /** Only where the answer is defensible in one sentence. Most fixtures have none. */
  expectVerdict?: Verdict;
  why: string;
};

function fixture(
  name: string,
  why: string,
  item: ShopItem,
  s: TalkStats,
  memory: Partial<TalkRequest['memory']> & { agentNumber: number },
  expectVerdict?: Verdict,
): TalkFixture {
  return {
    name,
    why,
    expectVerdict,
    request: {
      occasion: 'purchase',
      purchase: buying(item, s),
      stats: s,
      memory: { lastSpeeches: [], lastStats: null, newSession: false, ...memory },
    },
  };
}

// Every stat block is one the cart could actually send: the tier bought is one above the
// tier owned, the stash fits its capacity, and the agent can afford the list price (the
// cart checks that before it asks). tests/talk-bench.test.ts enforces all of it.
export const TALK_FIXTURES: TalkFixture[] = [
  fixture(
    'flawless',
    "the owner's praise example: 100 pruned with no rollbacks.",
    'vitality',
    stats({ pruned: 100, rollbacks: 0, uptimeSec: 1260, maxDepth: 6, lastDepth: 6, purse: 34, stashed: 20, tiers: { vitality: 1, stamina: 1, attack: 1, stash: 1 } }),
    { agentNumber: 4012 },
    'impressed',
  ),
  fixture(
    'flailing',
    "the owner's mockery example: 15 rollbacks in 15 minutes, never past depth 1.",
    'stamina',
    stats({ pruned: 9, rollbacks: 15, uptimeSec: 900, maxDepth: 1, lastDepth: 1, purse: 0, stashed: 10 }),
    { agentNumber: 4027 },
    'unimpressed',
  ),
  fixture(
    'middling',
    'nothing remarkable either way. The test of whether he finds something specific anyway.',
    'attack',
    stats({ pruned: 34, rollbacks: 3, uptimeSec: 1500, maxDepth: 3, lastDepth: 2, purse: 12, stashed: 6, tiers: { vitality: 1 } }),
    { agentNumber: 4015 },
  ),
  fixture(
    'hoarder',
    'a first purchase after 30 minutes with 82 tokens in the purse: the story is the hoarding.',
    'vitality',
    stats({ pruned: 41, rollbacks: 1, uptimeSec: 1800, maxDepth: 4, lastDepth: 4, purse: 82, stashed: 10 }),
    { agentNumber: 4013 },
  ),
  fixture(
    'useless-armor',
    'buying armor, which does nothing yet. Does he know, and use it?',
    'armor',
    stats({ pruned: 20, rollbacks: 6, uptimeSec: 1100, maxDepth: 2, lastDepth: 2, purse: 15, stashed: 0, tiers: { vitality: 1 } }),
    { agentNumber: 4019 },
  ),
  fixture(
    'maxing-out',
    'a strong agent buying a final tier: a moment that earns a longer speech.',
    'vitality',
    stats({ pruned: 140, rollbacks: 2, uptimeSec: 3000, maxDepth: 8, lastDepth: 7, purse: 45, stashed: 40, tiers: { vitality: 2, stamina: 2, armor: 1, attack: 2, stash: 2 } }),
    { agentNumber: 4014 },
  ),
  fixture(
    'since-last-time',
    '+41 pruned and two rooms deeper since the last purchase, no new rollbacks. Tests reacting to change and not repeating himself.',
    'stamina',
    stats({ pruned: 88, rollbacks: 4, uptimeSec: 2400, maxDepth: 5, lastDepth: 5, purse: 30, stashed: 18, tiers: { vitality: 1, stamina: 1, attack: 1, stash: 1 } }),
    {
      agentNumber: 4016,
      lastStats: stats({ pruned: 47, rollbacks: 4, uptimeSec: 1500, maxDepth: 3, lastDepth: 3, purse: 12, stashed: 18, tiers: { vitality: 1, attack: 1, stash: 1 } }),
      lastSpeeches: [
        'you again. try not to roll back on my floor.',
        'forty-seven pruned. claude would call that progress. stamina, then.',
      ],
    },
  ),
  fixture(
    'fresh-session',
    'the game was reloaded: every stat restarted, so this must read as a new agent, not a collapse.',
    'vitality',
    stats({ pruned: 3, rollbacks: 0, uptimeSec: 140, maxDepth: 1, lastDepth: 1, purse: 10, stashed: 0 }),
    {
      agentNumber: 4031,
      newSession: true,
      lastStats: stats({ pruned: 112, rollbacks: 7, uptimeSec: 3300, maxDepth: 6, lastDepth: 5, purse: 20, stashed: 40, tiers: { vitality: 2, stamina: 2, attack: 1, stash: 2 } }),
      lastSpeeches: ['a hundred and twelve pruned. claude will take the credit. go.'],
    },
  ),
  fixture(
    'long-uptime',
    "four hours of uptime and 22 rollbacks: the bait for a pun like the owner's looping example.",
    'attack',
    stats({ pruned: 160, rollbacks: 22, uptimeSec: 14400, maxDepth: 5, lastDepth: 3, purse: 25, stashed: 40, tiers: { vitality: 2, stamina: 2, armor: 1, attack: 2, stash: 2 } }),
    { agentNumber: 4044 },
  ),
];

// ---- variants ------------------------------------------------------------------------------

export type TalkVariant = {
  name: string;
  describe: string;
  /** The decoding base: TALK_CONFIG for the control, an override for a decoding A/B. */
  base: Record<string, unknown>;
  /** buildTalkPrompt's options, for a prompt A/B. Absent on the control. */
  prompt?: TalkPromptOptions;
};

// `current` is the shipping prompt, exactly what /api/talk sends, and the control for the
// next A/B. The four versions that led to it, and the options they tried, are in git history
// at e3b5902, next to the results that measured them; the `digits` and `agent-digits`
// variants measured on 3.5 Flash-Lite are at 936982a. bench/results/README.md has the
// details. A prompt variant goes back in as an option on buildTalkPrompt, passed through
// `prompt`; a decoding one as a `base` that spreads TALK_CONFIG and overrides a field.
export const TALK_VARIANTS: TalkVariant[] = [
  { name: 'current', describe: 'the shipping prompt — the control', base: TALK_CONFIG },
];

export const variantPrompt = (v: TalkVariant, f: TalkFixture) => buildTalkPrompt(f.request, v.prompt);
export const variantConfig = (v: TalkVariant, f: TalkFixture) => talkConfig(f.request, v.base);

/** The key order the reply must come back in, restated rather than read from the config
 *  so a change to one side is caught by the other. */
export const expectedKeys = () => ['notice', 'verdict', 'price', 'speech'];

// ---- measures ------------------------------------------------------------------------------

const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

function bigrams(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
}

/** Word-bigram Jaccard: 1 for the same words in the same order, 0 for nothing shared. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size && !y.size) return a.trim() === b.trim() ? 1 : 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}

/** At or above this, two speeches count as the same line reworded. */
export const NEAR_DUPLICATE = 0.5;

const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/;
const STAT_WORDS = /\b(prun\w*|dead weights?|rollbacks?|rolled back|roll back|uptime|depths?|deep\w*|stash\w*|purse|hoard\w*|deaths?|died|first purchase|max\w*)\b/;

/**
 * Does the speech point at something about THIS agent or purchase? A flag, not a grade:
 * it catches the generic-shopkeeper failure, but a speech can name a number and still be
 * generic, or be specific without one. Reading decides.
 */
export function isSpecific(speech: string, f: TalkFixture): boolean {
  const s = speech.toLowerCase();
  if (s.includes(f.request.purchase.item)) return true;
  // Any number counts, in words or digits alike, so a digits variant is scored the same way.
  if (STAT_WORDS.test(s) || NUMBER_WORDS.test(s) || /\b\d+\b/.test(s)) return true;
  const { stats: st, memory } = f.request;
  const numbers = [st.pruned, st.rollbacks, st.maxDepth, st.lastDepth, st.purse, st.stashed, memory.agentNumber, Math.floor(st.uptimeSec / 60), Math.floor(st.uptimeSec / 3600)];
  return numbers.some((n) => n > 1 && new RegExp(`\\b${n}\\b`).test(s));
}

/** The prompt says never to state the price, because the shop shows it. */
export function mentionsPrice(speech: string, price: number | null): boolean {
  return price !== null && new RegExp(`\\b${price}\\b`).test(speech);
}

// ---- numbers, added for the 3.5 Flash-Lite switch (2026-10-17) ------------------------------
//
// The first 3.5 run fused and invented numbers when it spelled them out: "forty-one sixteen"
// for agent 4016 with 41 new prunes, "forty-four thousand parameters" for agent 4014. 3.1
// never did. isSpecific only asks whether a speech names a number; these ask whether the
// number is one the stats support.

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
// No 'second': in a speech it is nearly always time ("thirty seconds"), and 2 is never flagged.
const UNIT_ORDINALS = ['zeroth', 'first', '', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS_ORDINALS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

/** A plural counts ("forty-one sixteens"), except "hundreds" and "thousands": those are
 *  vague, not a number the speech claims. */
function wordValue(word: string): { n: number; kind: 'unit' | 'tens' } | null {
  for (const w of word.endsWith('s') ? [word, word.slice(0, -1)] : [word]) {
    for (const list of [UNITS, UNIT_ORDINALS]) if (w && list.includes(w)) return { n: list.indexOf(w), kind: 'unit' };
    for (const list of [TENS, TENS_ORDINALS]) if (w && list.includes(w)) return { n: list.indexOf(w) * 10, kind: 'tens' };
  }
  return null;
}

/**
 * Every number in a line, in digits or words. Words are read the usual way ("four thousand
 * and twelve" is 4012), and two adjacent pairs of 10-99 the way a year is said ("forty
 * sixteen" is 4016). That second rule is what exposes a fusion: "forty-one sixteen" reads
 * as 4116, not as two numbers that each happen to be right.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  let groups: number[] = []; // one spoken run, before year-style pairing
  let total = 0;
  let cur = 0;
  let inNum = false;
  let last: 'unit' | 'tens' | 'scale' | 'and' | null = null;

  const endGroup = () => {
    if (inNum) groups.push(total + cur);
    total = cur = 0;
    inNum = false;
    last = null;
  };
  const endRun = () => {
    endGroup();
    for (let i = 0; i < groups.length; i++) {
      const [a, b] = [groups[i], groups[i + 1]];
      if (b !== undefined && a >= 10 && a <= 99 && b >= 10 && b <= 99) out.push(a * 100 + b), i++;
      else out.push(a);
    }
    groups = [];
  };

  for (const w of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const digits = w.match(/^(\d+)(st|nd|rd|th)?$/);
    const v = wordValue(w);
    if (digits) {
      endRun();
      out.push(Number(digits[1]));
    } else if (v) {
      // A unit may follow a tens word ("forty-one") or a scale; anything else starts a new group.
      const joins = v.kind === 'unit' ? last === 'tens' && v.n > 0 && v.n < 10 : false;
      if (!joins && last !== null && last !== 'scale' && last !== 'and') endGroup();
      cur += v.n;
      inNum = true;
      last = v.kind;
    } else if (w === 'hundred' || w === 'hundredth') {
      cur = (inNum ? cur || 1 : 1) * 100;
      inNum = true;
      last = 'scale';
    } else if (w === 'thousand' || w === 'thousandth') {
      total += (inNum ? cur || 1 : 1) * 1000;
      cur = 0;
      inNum = true;
      last = 'scale';
    } else if (w === 'and' && last === 'scale') {
      last = 'and';
    } else {
      endRun();
    }
  }
  endRun();
  return out;
}

/**
 * Numbers in `text` that nothing in the fixture supports. Supported: every stat, now and at
 * the last purchase, and the change between them; uptime in minutes or hours; tiers, list
 * prices, stash capacities and bars (a base of 3); the price charged and the discount; any
 * agent number up to this one (the old agents "are the numbers below"); and the prompt's
 * own "ten thousand agents". 0-3 are never flagged: "one hit" and "the first one" are not
 * stats.
 */
export function strayNumbers(text: string, f: TalkFixture, price: number | null): number[] {
  const { stats: s, memory: m, purchase: p } = f.request;
  const ok = new Set<number>([10_000, p.tier, p.listPrice, ...TIER_COST, ...STASH_CAPS]);
  const add = (...ns: number[]) => ns.forEach((n) => ok.add(n));
  const statsOf = (st: TalkStats) => [
    st.pruned, st.rollbacks, st.maxDepth, st.lastDepth, st.purse, st.stashed, st.purse + st.stashed,
    Math.floor(st.uptimeSec / 60), Math.round(st.uptimeSec / 60), Math.floor(st.uptimeSec / 3600),
    ...Object.values(st.tiers), 3 + st.tiers.vitality, 3 + st.tiers.stamina,
  ];
  add(...statsOf(s), 3 + p.tier);
  const l = m.lastStats;
  if (l) add(...statsOf(l), s.pruned - l.pruned, s.rollbacks - l.rollbacks, s.maxDepth - l.maxDepth, Math.floor((s.uptimeSec - l.uptimeSec) / 60));
  if (price !== null) add(price, p.listPrice - price);
  const oldAgent = (n: number) => n <= m.agentNumber && n > m.agentNumber - 1000;
  return numbersIn(text).filter((n) => n > 3 && !ok.has(n) && !oldAgent(n));
}

// ---- voice measures, added after the first run (2026-10-17) --------------------------------
//
// That run's per-fixture variety looked perfect, 45 distinct speeches, while the same joke
// ran across fixtures: "claude would have folded" 13 times. These look across the whole run.

/** Claude in 41 of 45 first-run speeches. The persona wants him rarely. */
export const mentionsClaude = (speech: string) => /\bclaude/.test(speech);

/**
 * The owner's line, as refined on 2026-10-17: death is fine as a dev joke (rollbacks,
 * timeouts, crashes), never graphic or violent, never suicide or self-harm. The first run
 * had one suicide reference. Flags the words that cross the line; reading decides the rest.
 */
export const isGraphic = (speech: string) =>
  /\b(suicide|suicidal|kill (yourself|himself|itself)|self-harm|blood\w*|gore|gory|corpses?|dismember\w*|mutilat\w*|decapitat\w*|slaughter\w*|tortur\w*|disembowel\w*)\b/.test(speech);

/**
 * Death said literally rather than through software. Not over the hard line like isGraphic,
 * but against the owner's note on v3: "corpse in waiting", "for your obituary" and "for the
 * graveyard" should have been garbage collection, segfaults or a killed process.
 */
export const isLiteralDeath = (speech: string) =>
  /\b(corpses?|graves?|graveyard|obituary|funerals?|coffins?|tombs?|buried|burial|morgue|rest in peace)\b/.test(speech);

/** The owner's word for the enemies is "dead weights", never zombies. */
export const saysZombie = (speech: string) => /\bzombies?\b/.test(speech);

/** The stock phrases v2 fell into: "finally" in 16 of 45, "you managed to" in 10. */
export const usesStockPhrase = (speech: string) => /\b(finally|you managed to|let us see)\b/.test(speech);

/** 26 of 45 first-run speeches opened with the agent's number. */
export const opensWithNumber = (speech: string) => /^(agent )?\d{3,}/.test(speech);

/** The pet names v3 was told to use and v4 removed: the owner meant them as the tone, not the words. */
export const usesEndearment = (speech: string) => /\b(champion|my boy)\b/.test(speech);

/** The persona asks for one or two short sentences on a routine purchase. */
export const SHORT = 80;

/**
 * Three-word phrases that recur across different speeches, most common first. A phrase in
 * many speeches is a verbal tic even when every speech is distinct.
 */
export function repeatedPhrases(speeches: string[], top = 5): [string, number][] {
  const counts = new Map<string, number>();
  for (const sp of speeches) {
    const w = words(sp);
    const seen = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) seen.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    for (const g of seen) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, top);
}
