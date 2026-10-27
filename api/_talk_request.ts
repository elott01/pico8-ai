// Checking a /api/talk request before any of it reaches a prompt.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// Two jobs. The first is catching a page bug loudly: a stat block the cart could never send
// is a 400, not a prompt about an impossible agent. The second is a guardrail. The plan's
// rule is that nothing a player types ever reaches the prompt, and `lastSpeeches` is the
// one field that breaks it — the page keeps them in localStorage, which a player can edit.
// So they are treated as untrusted: cleaned to the cart's character set, capped in number
// and length, and quoted in the prompt as data. That bounds what an edit can do to the
// player's own session; it does not prove the speeches are gem-in-eye's.

import type { ShopItem, TalkRequest, TalkStats, TalkMemory } from './_types.ts';
import { SHOP_ITEMS, TIER_COST, STASH_CAPS } from './_talk_prompt.ts';
import { cleanSpeech, BOX_CHARS, PAGE_LINES, MAX_PAGES } from './_talk_text.ts';

/** How many past speeches the prompt carries. */
export const MAX_MEMORY = 3;

/** The longest speech the server ever returns: 3 pages of 3 lines, plus joining spaces. */
export const MAX_SPEECH = MAX_PAGES * PAGE_LINES * (BOX_CHARS + 1);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

// Ranges are what the cart can produce over GPIO: 16-bit fields for the three counters, a
// byte for everything else.
function readStats(v: unknown, label: string): TalkStats | string {
  if (!isObj(v)) return `${label} must be an object`;
  const fields: [keyof Omit<TalkStats, 'tiers'>, number][] = [
    ['pruned', 65535],
    ['rollbacks', 65535],
    ['uptimeSec', 65535],
    ['maxDepth', 255],
    ['lastDepth', 255],
    ['purse', 255],
    ['stashed', 255],
  ];
  for (const [k, max] of fields) {
    if (!isInt(v[k], 0, max)) return `${label}.${k} must be a whole number from 0 to ${max}`;
  }
  if (!isObj(v.tiers)) return `${label}.tiers must be an object`;
  const tiers = {} as Record<ShopItem, number>;
  for (const it of SHOP_ITEMS) {
    if (!isInt(v.tiers[it], 0, 3)) return `${label}.tiers.${it} must be 0-3`;
    tiers[it] = v.tiers[it] as number;
  }
  const s = { ...(v as Omit<TalkStats, 'tiers'>), tiers };
  if (s.stashed > STASH_CAPS[tiers.stash]) return `${label}.stashed is more than stash tier ${tiers.stash} holds`;
  return {
    pruned: s.pruned,
    rollbacks: s.rollbacks,
    uptimeSec: s.uptimeSec,
    maxDepth: s.maxDepth,
    lastDepth: s.lastDepth,
    purse: s.purse,
    stashed: s.stashed,
    tiers,
  };
}

/** A valid request, rebuilt field by field so nothing unvalidated rides along, or the reason
 *  it isn't one. */
export function readTalkRequest(body: unknown): TalkRequest | string {
  if (!isObj(body)) return 'body must be an object';
  if (body.occasion !== 'purchase') return 'occasion must be "purchase"';

  const stats = readStats(body.stats, 'stats');
  if (typeof stats === 'string') return stats;

  const p = body.purchase;
  if (!isObj(p)) return 'purchase must be an object';
  if (!SHOP_ITEMS.includes(p.item as ShopItem)) return `purchase.item must be one of ${SHOP_ITEMS.join(', ')}`;
  const item = p.item as ShopItem;
  if (!isInt(p.tier, 1, 3)) return 'purchase.tier must be 1-3';
  // The cart only ever sells the next tier, at its list price.
  if (p.tier !== stats.tiers[item] + 1) return `purchase.tier must be one above the ${item} tier owned`;
  if (p.listPrice !== TIER_COST[p.tier - 1]) return `purchase.listPrice must be ${TIER_COST[p.tier - 1]} for tier ${p.tier}`;

  const m = body.memory;
  if (!isObj(m)) return 'memory must be an object';
  if (!Array.isArray(m.lastSpeeches) || !m.lastSpeeches.every((x) => typeof x === 'string')) {
    return 'memory.lastSpeeches must be an array of strings';
  }
  const lastSpeeches = (m.lastSpeeches as string[])
    .slice(-MAX_MEMORY)
    .map((x) => cleanSpeech(x).slice(0, MAX_SPEECH))
    .filter(Boolean);
  let lastStats: TalkStats | null = null;
  if (m.lastStats !== null) {
    const ls = readStats(m.lastStats, 'memory.lastStats');
    if (typeof ls === 'string') return ls;
    lastStats = ls;
  }
  if (typeof m.newSession !== 'boolean') return 'memory.newSession must be a boolean';
  if (m.newSession && !lastStats) return 'memory.newSession needs memory.lastStats';
  if (!isInt(m.agentNumber, 1, 999_999)) return 'memory.agentNumber must be a whole number from 1 to 999999';

  const memory: TalkMemory = { lastSpeeches, lastStats, newSession: m.newSession, agentNumber: m.agentNumber };
  return {
    occasion: 'purchase',
    purchase: { item, tier: p.tier as 1 | 2 | 3, listPrice: p.listPrice as number },
    stats,
    memory,
  };
}
