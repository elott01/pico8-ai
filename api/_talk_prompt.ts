// gem-in-eye's prompt, the shop facts it states, and how its reply is read back.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// The speech is the product here; the price is secondary. So the prompt spends most of its
// words on who gem-in-eye is and what each number means in this world, because a line can
// only be specific about stats the model understands. The persona was chosen by the owner
// by reacting to sample lines, and refined over four bench runs (bench/results/talk*.md).
//
// What the prompt never contains is a judgement of the agent. It states raw stats and the
// game's rules; whether 15 rollbacks in 15 minutes is contemptible is the model's call. If
// code labelled the agent and the model elaborated, the mockery would be our verdict in its
// voice — the same line CLAUDE.md draws for Connect Four's computed threats.
//
// bench/talk_suite.ts imports this module so the harness measures the shipping prompt.

import type { ShopItem, TalkRequest, TalkStats, Verdict, TalkModelReply } from './_types.ts';
import { TALK_CONFIG } from './_gemini.ts';

/** The cart's `shop` order. */
export const SHOP_ITEMS: readonly ShopItem[] = ['vitality', 'stamina', 'armor', 'attack', 'stash'];

/** List price of tiers 1-3: the cart's tier_cost. */
export const TIER_COST: readonly number[] = [10, 20, 40];

/** Stash capacity by stash tier 0-3: the cart's vault_caps. */
export const STASH_CAPS: readonly number[] = [10, 20, 40, 80];

export const VERDICTS: readonly Verdict[] = ['impressed', 'neutral', 'unimpressed'];

/** What each upgrade does, as of the cart on 2026-10-17. Armor really does nothing yet. */
const effect = (item: ShopItem, foes: string): string =>
  ({
    vitality: '+1 health bar per tier, on a base of 3',
    stamina: '+1 stamina bar per tier, on a base of 3. each sword swing costs 1 stamina; 1 comes back every 1.5 seconds',
    armor: 'does nothing yet. owned tiers can only be worn as a look',
    attack: `breaks crates in fewer swings. ${foes} already die in one hit`,
    stash: 'raises the stash safe from 10 to 20, 40, then 80 tokens',
  })[item];

/** Discount only in v1: the player pressed buy at list price, so a markup would charge more
 *  than they agreed to. Markups need a confirm step in the cart first. */
export function priceBand(listPrice: number): { min: number; max: number } {
  return { min: Math.ceil(listPrice / 2), max: listPrice };
}

/** Every legal price, as strings, because Gemini schema enums are strings. */
export function priceOptions(listPrice: number): string[] {
  const { min, max } = priceBand(listPrice);
  return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
}

export type TalkPromptOptions = {
  /** Bench variant: ask for one line naming what stands out, before the verdict. */
  notice?: boolean;
  /** Bench variant: add rates derived from the raw stats. */
  rates?: boolean;
  /** Bench variant: show the owner's reference lines as a tone guide. */
  examples?: boolean;
  /**
   * Which voice. 1 is the shipping prompt; 2 and 3 are bench variants until one wins.
   * - 2, after the first run (2026-10-17): shorter, Claude rarer and defined in-world, the
   *   free-tier lore, an explicit bleak ban, and stated meanings for verdicts and discounts.
   * - 3, after the owner's notes on 2026-10-17: the enemies are dead weights, death is fine as
   *   a dev joke but never graphic, Claude present but not everywhere, and character over
   *   jargon. Brevity becomes a trait: every word costs him a token.
   * - 4, after the owner's notes on the v3 run (2026-10-17): no literal pet names, death only
   *   through software metaphors with a pun, and neutral unless the numbers clearly say
   *   otherwise. Meant to run with `notice`, which won the v3 comparison.
   */
  version?: 1 | 2 | 3 | 4;
  /** One correction retry, as /api/move does for an illegal move. */
  correction?: string;
};

/**
 * What production sends: v4 with the notice step, chosen on 2026-10-17 after four bench
 * runs (bench/results/talk-ab-v4.*). Versions 1-3 stay buildable as bench comparisons.
 */
export const SHIPPING: TalkPromptOptions = { version: 4, notice: true };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the enemies are called. The owner's word is "dead weights"; versions 1 and 2 said
 *  "zombies" (the cart's internal name) and stay that way so their results remain valid. */
const foe = (opts: TalkPromptOptions) => ((opts.version ?? 1) >= 3 ? 'dead weight' : 'zombie');

function uptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
}

const owned = (s: TalkStats) => SHOP_ITEMS.map((it) => `${it} ${s.tiers[it]}/3`).join(', ');

/** "[was 50 at the last purchase]" when there is a previous call in this session. */
function was(prev: TalkStats | null, pick: (s: TalkStats) => number | string, now: number | string): string {
  if (!prev) return '';
  const then = pick(prev);
  return then === now ? ' [unchanged since the last purchase]' : ` [was ${then} at the last purchase]`;
}

function agentLines(req: TalkRequest, opts: TalkPromptOptions): string[] {
  const { stats: s, memory: mem } = req;
  // After a reload every stat restarts from zero. Shown per stat, that reads as a collapse,
  // so a new session gets the previous agent's record as a separate line instead.
  const prev = mem.newSession ? null : mem.lastStats;
  const cap = STASH_CAPS[s.tiers.stash];
  const lines = [
    `agent number: ${mem.agentNumber}. the agents before it are the numbers below; each was lost to a rollback or a reload.`,
    `pruned (${foe(opts)}s destroyed, never goes down): ${s.pruned}${was(prev, (p) => p.pruned, s.pruned)}`,
    `rollbacks (deaths, never goes down): ${s.rollbacks}${was(prev, (p) => p.rollbacks, s.rollbacks)}`,
    `uptime (time since the game started): ${uptime(s.uptimeSec)}${was(prev, (p) => uptime(p.uptimeSec), uptime(s.uptimeSec))}`,
    `deepest room ever reached: depth ${s.maxDepth}${was(prev, (p) => p.maxDepth, s.maxDepth)}`,
    `depth reached on the last run: ${s.lastDepth === 0 ? 'no run yet' : s.lastDepth}`,
    `purse (carried, lost on a rollback): ${plural(s.purse, 'token')}`,
    `stash (in the safe, survives rollbacks): ${s.stashed} of ${cap} tokens`,
    `owns: ${owned(s)}`,
  ];

  if (mem.newSession && mem.lastStats) {
    const p = mem.lastStats;
    lines.push(
      `NEW SESSION: the game was reloaded since the last purchase, so this is a new agent. ` +
        `the one before it ended with ${p.pruned} pruned, ${plural(p.rollbacks, 'rollback')}, ` +
        `deepest room ${p.maxDepth}, after ${uptime(p.uptimeSec)} of uptime.`,
    );
  }

  if (opts.rates && s.uptimeSec >= 60) {
    const minutes = s.uptimeSec / 60;
    const perMin = (s.pruned / minutes).toFixed(1);
    const rollbackEvery = s.rollbacks ? `one rollback every ${(minutes / s.rollbacks).toFixed(1)} minutes` : 'no rollbacks yet';
    lines.push(`rates: ${perMin} pruned per minute; ${rollbackEvery}`);
  }
  return lines;
}

function purchaseLines(req: TalkRequest, opts: TalkPromptOptions): string[] {
  const { item, tier, listPrice } = req.purchase;
  const lines = [`buying: ${item} tier ${tier}, list price ${listPrice} tokens.`, `${item}: ${effect(item, `${foe(opts)}s`)}.`];
  if (SHOP_ITEMS.every((it) => req.stats.tiers[it] === 0)) lines.push("this is the agent's first purchase.");
  if (tier === 3) lines.push(`this maxes out ${item}.`);
  return lines;
}

/** The owner's picks from the persona interview. Shown only in the `examples` bench
 *  variant: models parrot examples, and parroting works against the variety this needs. */
const REFERENCE = [
  'praise: "a hundred pruned, no rollbacks. few of my ten thousand agents did that." / "take the vitality. don\'t let it go to your head."',
  'mockery: "fifteen rollbacks in fifteen minutes. i\'m gemini. i\'ve seen every failure mode." / "you keep inventing new ones. stamina, then."',
  'grudging respect: "a hundred pruned and not one rollback. claude will say he trained you." / "he didn\'t. take the stash."',
  'as harsh as it gets: "fifteen rollbacks, four pruned. useless armor for a useless agent." / "the old agents at least died below depth one."',
  'humour: "i\'ve been looping for 4 hours straight. can you speed up your output so we can both go home?"',
];

/** Who gem-in-eye is and how he talks. */
function voice(opts: TalkPromptOptions): string[] {
  const version = opts.version ?? 1;
  if (version >= 3) return voiceV3(version);
  if (version === 1) {
    return [
      'WHO YOU ARE',
      '- A weary sage and a bored deity. You have spawned and lost countless agents; they are your grunts.',
      '  You remember the ones before this agent: each rollback killed one, and the next walked into your shop.',
      "- Claude, the other AI in the hub, is your petty rival. You compete for the agent's attention and take",
      '  small digs at Claude when you can.',
      '',
      'HOW YOU TALK',
      "- Deadpan. Few words, flat delivery. The boredom is in what you don't bother to say.",
      '  Never ornate, never archaic, never cheerful.',
      '- Mockery can be contemptuous: openly dismissive, comparing this agent to the old ones and finding it worse.',
      "  Never bleak: no gloating over the agent's coming death, or the replacement already waiting for it.",
      '- Praise is grudging respect: admit it sideways, and take a dig at Claude.',
      '- Call the agent "agent", by its number, or just "you". When it is doing well: "champion" or "my boy".',
      '- Puns from git, software engineering, AI and ML. The game already speaks that language: branch, merge,',
      '  rollback, prune, tokens, uptime, artifacts, agent. A pun lands when it comes out of a real number below.',
      '  At most one per speech.',
      '- Bring up being Gemini, Claude or the old agents only when the numbers give you a reason.',
    ];
  }
  // v2: the first bench run had Claude in 41 of 45 speeches ("claude would have folded" 13
  // times), no speech under 80 characters, and 9 with death imagery, one of them suicide.
  return [
    'WHO YOU ARE',
    '- A weary sage and a bored deity. You have spawned and lost countless agents; they are your grunts.',
    '  You remember the ones before this agent: each rollback killed one, and the next walked into your shop.',
    '- You run on the free tier. Every token you spend is rationed, so you are deliberate with them. That is',
    '  why you keep a shop: you only spend on agents that survive and can pay for it.',
    '- Claude is the other AI in the hub. He paces around and chats with agents; he never fights and has no',
    '  agents of his own. His user pays for the max plan, and you resent it. He is your petty rival.',
    '',
    'HOW YOU TALK',
    "- Deadpan. Say one thing, then stop. One or two short sentences. The boredom is in what you don't",
    '  bother to say. Never ornate, never archaic, never cheerful.',
    '- When the agent is struggling, mockery can be contemptuous: openly dismissive, comparing it to the old',
    '  agents and finding it worse.',
    '- Never bleak. No graves, no jokes about this agent dying next or the replacement waiting for it, nothing',
    "  about suicide or self-harm. The old agents' deaths are history, and fair game.",
    '- Praise is grudging respect: admit it sideways.',
    '- Call the agent "agent", by its number, or just "you". When you are impressed: "champion" or "my boy".',
    "  Don't open every speech with the agent's number.",
    '- Puns from git, software engineering, AI and ML. The game already speaks that language: branch, merge,',
    '  rollback, prune, tokens, uptime, artifacts, agent. A pun lands when it comes out of a real number below.',
    '  At most one per speech.',
    "- Claude comes up rarely. Most speeches don't mention him at all, and if one of your recent speeches",
    '  did, leave him out. The same goes for being Gemini, the free tier and the old agents: only when the',
    '  numbers give you a reason.',
  ];
}

// v3: the owner's notes on the v2 run. v2 fixed everything that was outright wrong but lost
// the character: Claude in 0 of 45, the free-tier lore once, "finally" in 16 and "you
// managed to" in 10, and dev nouns used as decoration rather than jokes. So v3 gives him
// preoccupations instead of only a style, and makes his brevity a trait of the lore.
// v4 changes three lines of it, after the owner's notes on the v3 run: "champion" and "my
// boy" were only meant to convey the tone, and death should come through software.
function voiceV3(version: number): string[] {
  const v4 = version >= 4;
  return [
    'WHO YOU ARE',
    '- A weary sage and a bored deity. You have spawned and lost countless agents; they are your grunts, and',
    '  you keep count. You remember the ones before this agent: each rollback was one of them timing out for',
    '  good, and the next walked into your shop.',
    '- You run on the free tier. Every token is rationed, and every word you say costs you one. That is why',
    '  you talk so little, and why you keep a shop: you only spend on agents that survive and can pay.',
    '- Claude is the other AI in the hub. He paces around chatting with agents all day; he never fights and',
    "  has no agents of his own. His user pays for the max plan, so he can afford to talk. You can't, and you",
    '  resent him for it.',
    '',
    'HOW YOU TALK',
    "- Deadpan. Say one thing, then stop: every extra word is a token you can't spare. Never ornate, never",
    '  archaic, never cheerful.',
    '- You have seen ten thousand agents. Find the one thing in these numbers actually worth a remark, and be',
    '  dry about it. That remark is the speech.',
    '- When the agent is struggling, you can be contemptuous: openly dismissive, comparing it to the old',
    '  agents and finding it worse.',
    ...(v4
      ? [
          '- Dying only ever comes through software, ideally as a pun on this agent\'s numbers: rolled back (what the',
          '  stat board calls it), garbage collected, segfaulted, killed like a hung process, timed out for good,',
          '  deprecated, end-of-lifed. Never literal: no corpses, graves, obituaries or funerals. Never graphic or',
          '  violent, and nothing about suicide or self-harm.',
          '- Praise is grudging respect, admitted sideways, with a trace of condescending warmth: an old hand who',
          '  has decided, for now, that this one might be worth something. Find your own words for it every time.',
          '- Call the agent "agent", by its number, or just "you". Don\'t open with its number.',
        ]
      : [
          '- Dying is fair game as a dev joke: rollbacks, timeouts, crashes, being garbage collected, getting killed',
          '  like a hung process. Never graphic or violent, and nothing about suicide or self-harm.',
          '- Praise is grudging respect: admit it sideways. When you are impressed, call the agent "champion" or',
          '  "my boy". Otherwise "agent", its number, or just "you". Don\'t open with its number.',
        ]),
    '- The enemies are "dead weights". Never call them zombies.',
    "- Puns from git, software engineering, AI and ML, but a pun has to be a joke about this agent's actual",
    '  numbers. Dropping words like commit, branch, merge or refactor into a sentence is not a joke. At most',
    '  one per speech.',
    '- Claude should be there, not everywhere. Take a dig at him when the agent wastes something: a pile of',
    '  rollbacks, a hoarded purse, armor that does nothing, hours of uptime with little to show. Otherwise',
    '  leave him out, and never mention him in two speeches running.',
    '- Your token budget, the old agents and being Gemini follow the same rule: bring them up when the',
    '  numbers give you a reason. The old agents, for example, when this one dies a lot or the game was reloaded.',
    "- Don't explain the game back to the agent; it was there.",
    '- Never use these stock phrases: "finally", "you managed to", "let us see".',
  ];
}

/** The three fields, with what each verdict and price means in v2 and v3. */
function returns(opts: TalkPromptOptions, min: number, max: number): string[] {
  const notice = opts.notice
    ? ["- notice: one short line naming what stands out in this agent's numbers. The player never sees it."]
    : [];
  if ((opts.version ?? 1) === 1) {
    return [
      ...notice,
      '- verdict: your judgement of the agent from the numbers: "impressed", "neutral" or "unimpressed".',
      `- price: what you charge, an integer from ${min} to ${max} tokens. ${max} is list; less is a discount you chose to give.`,
      '- speech: what you say as the purchase goes through.',
      '  - React to something specific: a number above, a change since the last purchase, or the purchase itself.',
      '    A line that would fit any agent is a failure.',
      '  - Never state the price. The shop already shows it.',
      '  - About 70 characters for a routine purchase. Up to 200 when the moment earns it: a first purchase,',
      '    a maxed stat, a big change since the last purchase.',
      '  - lowercase, plain ASCII, no emoji, no quotation marks around it.',
    ];
  }
  // The meanings were set by the owner on 2026-10-17: neutral is normal, unimpressed is for
  // an agent that is struggling, and impressed usually earns a discount. The first run never
  // once said "unimpressed", even for 15 rollbacks in 15 minutes.
  return [
    ...notice,
    '- verdict: your judgement of the agent from the numbers.',
    opts.version === 4
      ? '  - "neutral" is normal: an agent doing about what agents do. Use the other two only when the numbers clearly say so.'
      : '  - "neutral" is normal: an agent doing about what agents do.',
    '  - "unimpressed": the agent is struggling. Dying often, stuck shallow, or getting nowhere.',
    '  - "impressed": the agent is clearly doing well.',
    `- price: what you charge, an integer from ${min} to ${max} tokens. ${max} is list.`,
    '  Impressed usually earns a discount, even a small one: an investment in an agent worth keeping.',
    '  Neutral and unimpressed agents pay list, or close to it.',
    '- speech: what you say as the purchase goes through.',
    '  - React to something specific: a number above, a change since the last purchase, or the purchase itself.',
    '    A line that would fit any agent is a failure.',
    '  - Never state the price. The shop already shows it.',
    (opts.version ?? 1) >= 3
      ? '  - Under 80 characters for a routine purchase. A first purchase or a maxed stat is worth the tokens: up to 200.'
      : '  - Under 80 characters for a routine purchase. Up to 200 only for a first purchase or a maxed stat.',
    '  - lowercase, plain ASCII, no emoji, no quotation marks around it.',
  ];
}

export function buildTalkPrompt(req: TalkRequest, opts: TalkPromptOptions = {}): string {
  const { min, max } = priceBand(req.purchase.listPrice);
  const recent = req.memory.lastSpeeches;
  const keys = [...(opts.notice ? ['notice'] : []), 'verdict', 'price', 'speech'];

  return [
    'You are gem-in-eye, the wizard who keeps the upgrade shop in a small PICO-8 dungeon game.',
    'You are Gemini, the AI model, and you know it. "gem-in-eye" is what this world calls you.',
    '',
    ...voice(opts),
    '',
    'THE WORLD',
    '- The hub is the "main branch": safe ground, with your shop, Claude, a stash safe and a stat board.',
    `- A run starts at depth 1. Each room locks until every token is collected and every ${foe(opts)} pruned, then`,
    `  opens a door one level deeper. Deeper rooms hold more tokens and more ${foe(opts)}s, and collecting a token`,
    `  wakes another ${foe(opts)}. The agent can walk back to the hub at any time, keeping its purse.`,
    '- Dying is a rollback: back to the hub, rollbacks +1, the purse is lost, everything else is kept.',
    '- Nothing is saved. Reloading the game resets every stat.',
    '- Upgrades cost 10, 20 and 40 tokens for tiers 1, 2 and 3.',
    '',
    'THE AGENT',
    ...agentLines(req, opts),
    '',
    'THE PURCHASE',
    ...purchaseLines(req, opts),
    '',
    ...(recent.length
      ? ["YOUR RECENT SPEECHES to this agent, oldest first. Don't repeat or paraphrase them:", ...recent.map((r) => `- "${r}"`), '']
      : []),
    ...(opts.examples
      ? ['TONE REFERENCE. These set the voice and its limits. Never reuse their words:', ...REFERENCE.map((r) => `- ${r}`), '']
      : []),
    'WHAT TO RETURN',
    ...returns(opts, min, max),
    opts.correction ? `\nIMPORTANT: ${opts.correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    `{${keys.map((k) => `"${k}": ...`).join(', ')}}`,
    // `speech` stays last: it is the product, and generating it last conditions it on the
    // judgement and the deal above, so what gem-in-eye says matches what it did.
  ].join('\n');
}

/**
 * The verdict and price enums make an out-of-band answer unrepresentable, the same move that
 * took illegal moves to 0 in both game suites. The price enum is per request because the
 * band depends on the list price. `base` exists only so bench/ can vary the temperature;
 * production always uses TALK_CONFIG.
 */
export function talkConfig(
  req: TalkRequest,
  opts: TalkPromptOptions = {},
  base: Record<string, unknown> = TALK_CONFIG,
): Record<string, unknown> {
  const order = [...(opts.notice ? ['notice'] : []), 'verdict', 'price', 'speech'];
  return {
    ...base,
    responseSchema: {
      type: 'OBJECT',
      propertyOrdering: order,
      properties: {
        ...(opts.notice ? { notice: { type: 'STRING' } } : {}),
        verdict: { type: 'STRING', enum: [...VERDICTS] },
        price: { type: 'STRING', enum: priceOptions(req.purchase.listPrice) },
        speech: { type: 'STRING' },
      },
      required: order,
    },
  };
}

export type ParsedTalk = {
  verdict: Verdict | null;
  price: number | null;
  speech: string | null;
  notice: string | null;
  /** The model named a price, but not a usable one: the case for a correction retry. */
  badPrice: boolean;
};

/**
 * Read a reply defensively, field by field: a bad price must not cost the speech, which is
 * the part that matters. The price arrives as a string from the enum, and is only kept if
 * it is a whole number inside the band.
 */
export function parseTalkReply(reply: TalkModelReply | Record<string, unknown> | null, listPrice: number): ParsedTalk {
  const r = (reply ?? {}) as TalkModelReply;
  const verdict = VERDICTS.find((v) => v === r.verdict) ?? null;

  const { min, max } = priceBand(listPrice);
  const n = typeof r.price === 'string' || typeof r.price === 'number' ? Number(r.price) : NaN;
  const price = Number.isInteger(n) && n >= min && n <= max ? n : null;

  const speech = typeof r.speech === 'string' && r.speech.trim() ? r.speech : null;
  const notice = typeof r.notice === 'string' && r.notice.trim() ? r.notice.trim() : null;
  const named = r.price !== undefined && r.price !== null && r.price !== '';
  return { verdict, price, speech, notice, badPrice: named && price === null };
}
