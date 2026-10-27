// gem-in-eye's prompt, the shop facts it states, and how its reply is read back.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// The speech is the product here; the price is secondary. So the prompt spends most of its
// words on who gem-in-eye is and what each number means in this world, because a line can
// only be specific about stats the model understands. The persona was chosen by the owner
// by reacting to sample lines, and refined over four bench runs (bench/results/talk*.md).
// This is the fourth version; the first three are in git history at e3b5902, beside the
// results that measured them. One rule was added after the switch to 3.5 Flash-Lite, the
// agent's number in digits; the A/B that chose it is at 936982a.
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
const EFFECT: Record<ShopItem, string> = {
  vitality: '+1 health bar per tier, on a base of 3',
  stamina: '+1 stamina bar per tier, on a base of 3. each sword swing costs 1 stamina; 1 comes back every 1.5 seconds',
  armor: 'does nothing yet. owned tiers can only be worn as a look',
  attack: 'breaks crates in fewer swings. dead weights already die in one hit',
  stash: 'raises the stash safe from 10 to 20, 40, then 80 tokens',
};

/** Discount only: the player pressed buy at list price, so a markup would charge more than
 *  they agreed to. Markups need a confirm step in the cart first. */
export function priceBand(listPrice: number): { min: number; max: number } {
  return { min: Math.ceil(listPrice / 2), max: listPrice };
}

/** Every legal price, as strings, because Gemini schema enums are strings. */
export function priceOptions(listPrice: number): string[] {
  const { min, max } = priceBand(listPrice);
  return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
}

export type TalkPromptOptions = {
  /** One correction retry, as /api/move does for an illegal move. */
  correction?: string;
};

/**
 * The reply's fields, in generation order. Load-bearing: each is conditioned on the ones
 * above it. `notice` reads the numbers first, which made the speech more accurate and more
 * specific in the v3 comparison; `speech` comes last because it is the product, so what
 * gem-in-eye says matches the judgement and the deal it just made.
 */
const KEYS = ['notice', 'verdict', 'price', 'speech'];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

function agentLines(req: TalkRequest): string[] {
  const { stats: s, memory: mem } = req;
  // After a reload every stat restarts from zero. Shown per stat, that reads as a collapse,
  // so a new session gets the previous agent's record as a separate line instead.
  const prev = mem.newSession ? null : mem.lastStats;
  const cap = STASH_CAPS[s.tiers.stash];
  const lines = [
    `agent number: ${mem.agentNumber}. the agents before it are the numbers below; each was lost to a rollback or a reload.`,
    `pruned (dead weights destroyed, never goes down): ${s.pruned}${was(prev, (p) => p.pruned, s.pruned)}`,
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
  return lines;
}

function purchaseLines(req: TalkRequest): string[] {
  const { item, tier, listPrice } = req.purchase;
  const lines = [`buying: ${item} tier ${tier}, list price ${listPrice} tokens.`, `${item}: ${EFFECT[item]}.`];
  if (SHOP_ITEMS.every((it) => req.stats.tiers[it] === 0)) lines.push("this is the agent's first purchase.");
  if (tier === 3) lines.push(`this maxes out ${item}.`);
  return lines;
}

// Who gem-in-eye is and how he talks. Each rule here answered a measured failure or an owner
// note, recorded in the bench results and their README:
// - Claude by trigger, not by frequency word: "take digs when you can" put him in 41 of 45
//   speeches, and "rarely" put him in none.
// - His brevity is in character: every word costs him a token on the free tier.
// - Death only through software: literal death words read as too graphic to the owner, and
//   the first run produced one suicide reference.
// - The stock phrases are the ones measured: "finally" and "you managed to" took over v2.
// - The agent's number in digits: 3.5 Flash-Lite mangled it while spelling it out ("forty-one
//   sixteen" for agent 4016 with 41 new prunes), in about 1 speech in 7. All numbers in digits
//   fixed that too, but turned the lines into stat readouts; this one number alone did not.

const VOICE = [
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
  "- Dying only ever comes through software, ideally as a pun on this agent's numbers: rolled back (what the",
  '  stat board calls it), garbage collected, segfaulted, killed like a hung process, timed out for good,',
  '  deprecated, end-of-lifed. Never literal: no corpses, graves, obituaries or funerals. Never graphic or',
  '  violent, and nothing about suicide or self-harm.',
  '- Praise is grudging respect, admitted sideways, with a trace of condescending warmth: an old hand who',
  '  has decided, for now, that this one might be worth something. Find your own words for it every time.',
  // One line, as measured: the A/B at 936982a tested this exact text.
  '- Call the agent "agent", by its number, or just "you". Write its number in digits exactly as given, never in words. Don\'t open with its number.',
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

/** The four fields. The verdict meanings and the discount rule were set by the owner after the
 *  first run, which never once said "unimpressed", even for 15 rollbacks in 15 minutes. */
function returns(min: number, max: number): string[] {
  return [
    "- notice: one short line naming what stands out in this agent's numbers. The player never sees it.",
    '- verdict: your judgement of the agent from the numbers.',
    '  - "neutral" is normal: an agent doing about what agents do. Use the other two only when the numbers clearly say so.',
    '  - "unimpressed": the agent is struggling. Dying often, stuck shallow, or getting nowhere.',
    '  - "impressed": the agent is clearly doing well.',
    `- price: what you charge, an integer from ${min} to ${max} tokens. ${max} is list.`,
    '  Impressed usually earns a discount, even a small one: an investment in an agent worth keeping.',
    '  Neutral and unimpressed agents pay list, or close to it.',
    '- speech: what you say as the purchase goes through.',
    '  - React to something specific: a number above, a change since the last purchase, or the purchase itself.',
    '    A line that would fit any agent is a failure.',
    '  - Never state the price. The shop already shows it.',
    '  - Under 80 characters for a routine purchase. A first purchase or a maxed stat is worth the tokens: up to 200.',
    '  - lowercase, plain ASCII, no emoji, no quotation marks around it.',
  ];
}

export function buildTalkPrompt(req: TalkRequest, opts: TalkPromptOptions = {}): string {
  const { min, max } = priceBand(req.purchase.listPrice);
  const recent = req.memory.lastSpeeches;

  return [
    'You are gem-in-eye, the wizard who keeps the upgrade shop in a small PICO-8 dungeon game.',
    'You are Gemini, the AI model, and you know it. "gem-in-eye" is what this world calls you.',
    '',
    ...VOICE,
    '',
    'THE WORLD',
    '- The hub is the "main branch": safe ground, with your shop, Claude, a stash safe and a stat board.',
    '- A run starts at depth 1. Each room locks until every token is collected and every dead weight pruned, then',
    '  opens a door one level deeper. Deeper rooms hold more tokens and more dead weights, and collecting a token',
    '  wakes another dead weight. The agent can walk back to the hub at any time, keeping its purse.',
    '- Dying is a rollback: back to the hub, rollbacks +1, the purse is lost, everything else is kept.',
    '- Nothing is saved. Reloading the game resets every stat.',
    '- Upgrades cost 10, 20 and 40 tokens for tiers 1, 2 and 3.',
    '',
    'THE AGENT',
    ...agentLines(req),
    '',
    'THE PURCHASE',
    ...purchaseLines(req),
    '',
    ...(recent.length
      ? ["YOUR RECENT SPEECHES to this agent, oldest first. Don't repeat or paraphrase them:", ...recent.map((r) => `- "${r}"`), '']
      : []),
    'WHAT TO RETURN',
    ...returns(min, max),
    opts.correction ? `\nIMPORTANT: ${opts.correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    `{${KEYS.map((k) => `"${k}": ...`).join(', ')}}`,
  ].join('\n');
}

/**
 * The verdict and price enums make an out-of-band answer unrepresentable, the same move that
 * took illegal moves to 0 in both game suites. The price enum is per request because the
 * band depends on the list price. `base` exists only so bench/ can vary decoding; production
 * always uses TALK_CONFIG.
 */
export function talkConfig(req: TalkRequest, base: Record<string, unknown> = TALK_CONFIG): Record<string, unknown> {
  return {
    ...base,
    responseSchema: {
      type: 'OBJECT',
      propertyOrdering: KEYS,
      properties: {
        notice: { type: 'STRING' },
        verdict: { type: 'STRING', enum: [...VERDICTS] },
        price: { type: 'STRING', enum: priceOptions(req.purchase.listPrice) },
        speech: { type: 'STRING' },
      },
      required: KEYS,
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
