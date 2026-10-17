// gem-in-eye's prompt structure: the properties that fail silently. A reordered key list or
// a stale price table still typechecks, still builds, and still returns plausible speech —
// it just conditions the speech on the wrong things or charges what the cart won't.
//
// As in prompt.test.ts, the key order and price bands are restated by hand rather than
// imported from the module under test, so the two sides cannot move together. The shop
// tables are parsed out of carts/gemini.p8, which is the copy that counts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildTalkPrompt,
  talkConfig,
  parseTalkReply,
  priceOptions,
  SHOP_ITEMS,
  TIER_COST,
  STASH_CAPS,
} from '../api/_talk_prompt.ts';
import { TALK_CONFIG } from '../api/_gemini.ts';
import type { TalkRequest, TalkStats } from '../api/_types.ts';

const lua = readFileSync(new URL('../carts/gemini.p8', import.meta.url), 'utf8');

const STATS: TalkStats = {
  pruned: 62,
  rollbacks: 8,
  uptimeSec: 562,
  maxDepth: 3,
  lastDepth: 1,
  purse: 1,
  stashed: 10,
  tiers: { vitality: 1, stamina: 1, armor: 0, attack: 0, stash: 0 },
};

function request(over: Partial<TalkRequest> = {}): TalkRequest {
  return {
    occasion: 'purchase',
    purchase: { item: 'attack', tier: 1, listPrice: 10 },
    stats: STATS,
    memory: { lastSpeeches: [], lastStats: null, newSession: false, agentNumber: 4012 },
    ...over,
  };
}

type Schema = { propertyOrdering: string[]; required: string[]; properties: Record<string, { enum?: string[] }> };
const schema = (cfg: Record<string, unknown>) => cfg.responseSchema as Schema;

describe('the shop tables match the cart', () => {
  it('SHOP_ITEMS is the cart shop order', () => {
    const names = [...lua.matchAll(/\{name = "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, [...SHOP_ITEMS]);
  });

  it('TIER_COST is the cart tier_cost', () => {
    const m = lua.match(/^tier_cost\s*=\s*split"([\d,]+)"/m);
    assert.ok(m, 'could not parse tier_cost');
    assert.deepEqual(m[1].split(',').map(Number), [...TIER_COST]);
  });

  it('STASH_CAPS is the cart vault_caps', () => {
    const m = lua.match(/vault_caps\s*=\s*\{\[0\]\s*=\s*([\d,\s]+)\}/);
    assert.ok(m, 'could not parse vault_caps');
    assert.deepEqual(m[1].split(',').map(Number), [...STASH_CAPS]);
  });
});

describe('key order', () => {
  it('is verdict, price, speech — the speech last, conditioned on both', () => {
    const s = schema(talkConfig(request()));
    assert.deepEqual(s.propertyOrdering, ['verdict', 'price', 'speech']);
    assert.deepEqual(s.required, ['verdict', 'price', 'speech']);
    assert.match(buildTalkPrompt(request()), /\{"verdict": \.\.\., "price": \.\.\., "speech": \.\.\.\}\s*$/);
  });

  it('puts notice first in the notice variant, and nowhere else', () => {
    assert.deepEqual(schema(talkConfig(request(), { notice: true })).propertyOrdering, ['notice', 'verdict', 'price', 'speech']);
    assert.doesNotMatch(buildTalkPrompt(request()), /notice/);
  });
});

describe('price', () => {
  it('is discount-only: half of list to list, whole tokens', () => {
    assert.deepEqual(priceOptions(10), ['5', '6', '7', '8', '9', '10']);
    assert.deepEqual(priceOptions(20).at(0), '10');
    assert.deepEqual(priceOptions(20).at(-1), '20');
    assert.deepEqual(priceOptions(40).at(0), '20');
    assert.deepEqual(priceOptions(40).at(-1), '40');
  });

  it('is enumerated in the schema, so an out-of-band price cannot be expressed', () => {
    const req = request({ purchase: { item: 'vitality', tier: 2, listPrice: 20 } });
    assert.deepEqual(schema(talkConfig(req)).properties.price.enum, priceOptions(20));
    assert.match(buildTalkPrompt(req), /an integer from 10 to 20 tokens/);
  });
});

describe('decoding', () => {
  it('uses TALK_CONFIG as-is, so production and the bench control send the same settings', () => {
    const cfg = talkConfig(request());
    for (const [k, v] of Object.entries(TALK_CONFIG)) assert.equal(cfg[k], v);
  });
});

describe('what the prompt states', () => {
  it('states the raw stats and the agent number', () => {
    const p = buildTalkPrompt(request());
    for (const s of ['agent number: 4012', 'pruned (zombies destroyed, never goes down): 62', 'rollbacks (deaths, never goes down): 8', '9 min 22 s', 'depth 3', '1 token', '10 of 10 tokens']) {
      assert.ok(p.includes(s), `missing "${s}"`);
    }
  });

  it('shows changes since the last purchase within a session', () => {
    const p = buildTalkPrompt(request({ memory: { lastSpeeches: [], lastStats: { ...STATS, pruned: 50 }, newSession: false, agentNumber: 4012 } }));
    assert.ok(p.includes('62 [was 50 at the last purchase]'));
    assert.ok(p.includes('8 [unchanged since the last purchase]'));
  });

  it('after a reload, shows the previous agent separately instead of a collapse', () => {
    const p = buildTalkPrompt(request({ memory: { lastSpeeches: [], lastStats: { ...STATS, pruned: 112 }, newSession: true, agentNumber: 4013 } }));
    assert.doesNotMatch(p, /\[was /);
    assert.match(p, /NEW SESSION: .*ended with 112 pruned/);
  });

  it('names a first purchase and a maxed stat', () => {
    const fresh = { ...STATS, tiers: { vitality: 0, stamina: 0, armor: 0, attack: 0, stash: 0 } };
    assert.match(buildTalkPrompt(request({ stats: fresh })), /first purchase/);
    assert.match(buildTalkPrompt(request({ purchase: { item: 'attack', tier: 3, listPrice: 40 } })), /maxes out attack/);
  });

  it('lists recent speeches only when there are some', () => {
    assert.doesNotMatch(buildTalkPrompt(request()), /RECENT SPEECHES/);
    const p = buildTalkPrompt(request({ memory: { lastSpeeches: ['you again.'], lastStats: null, newSession: false, agentNumber: 4012 } }));
    assert.match(p, /RECENT SPEECHES[\s\S]*- "you again\."/);
  });

  it('keeps the reference lines out of the shipping prompt', () => {
    assert.doesNotMatch(buildTalkPrompt(request()), /TONE REFERENCE/);
    assert.match(buildTalkPrompt(request(), { examples: true }), /TONE REFERENCE/);
  });
});

describe('parseTalkReply', () => {
  it('reads an enum price back from its string', () => {
    assert.deepEqual(parseTalkReply({ notice: ' depth 1. ', verdict: 'neutral', price: '8', speech: 'stamina, then.' }, 10), {
      verdict: 'neutral',
      price: 8,
      speech: 'stamina, then.',
      notice: 'depth 1.',
      badPrice: false,
    });
  });

  it('drops a bad price without losing the speech', () => {
    for (const price of ['4', '11', '7.5', 'cheap', null]) {
      const r = parseTalkReply({ verdict: 'unimpressed', price, speech: 'useless armor.' }, 10);
      assert.equal(r.price, null, `price ${price} was kept`);
      assert.equal(r.speech, 'useless armor.');
      assert.equal(r.badPrice, price !== null, 'only a named price is worth a correction retry');
    }
  });

  it('rejects an unknown verdict and an empty speech', () => {
    const r = parseTalkReply({ verdict: 'amused', price: '10', speech: '   ' }, 10);
    assert.equal(r.verdict, null);
    assert.equal(r.speech, null);
  });

  it('survives no reply at all', () => {
    assert.deepEqual(parseTalkReply(null, 10), { verdict: null, price: null, speech: null, notice: null, badPrice: false });
  });
});

describe('the v2 voice', () => {
  const v2 = buildTalkPrompt(request(), { version: 2 });

  it('defines Claude in-world, so he is not credited with fights or agents', () => {
    assert.match(v2, /never fights and has no\s+agents of his own/);
  });

  it("draws the owner's bleak line explicitly", () => {
    assert.match(v2, /No graves/);
    assert.match(v2, /nothing\s+about suicide or self-harm/);
  });

  it('states what each verdict means, with neutral as normal', () => {
    assert.match(v2, /"neutral" is normal/);
    assert.match(v2, /"unimpressed": the agent is struggling/);
    assert.match(v2, /Impressed usually earns a discount/);
  });

  it('changes the words only: same keys, same price band', () => {
    assert.deepEqual(talkConfig(request(), { version: 2 }), talkConfig(request()));
  });

  it('leaves version 1 as it was', () => {
    assert.doesNotMatch(buildTalkPrompt(request()), /free tier|max plan/);
  });
});

describe('the v3 voice', () => {
  const v3 = buildTalkPrompt(request(), { version: 3 });

  it('calls the enemies dead weights everywhere, and never zombies', () => {
    assert.match(v3, /dead weights destroyed/);
    assert.match(v3, /every dead weight pruned/);
    assert.match(v3, /Never call them zombies/);
    assert.doesNotMatch(v3.replace('Never call them zombies', ''), /zombie/);
  });

  it('keeps zombies in versions 1 and 2, so their measured prompts are unchanged', () => {
    assert.match(buildTalkPrompt(request()), /zombies destroyed/);
    assert.match(buildTalkPrompt(request(), { version: 2 }), /zombies destroyed/);
  });

  it('allows death as a dev joke but draws the graphic line', () => {
    assert.match(v3, /Dying is fair game as a dev joke/);
    assert.match(v3, /Never graphic or violent, and nothing about suicide or self-harm/);
  });

  it('gives Claude triggers instead of a frequency word', () => {
    assert.match(v3, /Take a dig at him when the agent wastes something/);
    assert.match(v3, /never mention him in two speeches running/);
  });

  it('bans the stock phrases v2 fell into', () => {
    assert.match(v3, /"finally", "you managed to", "let us see"/);
  });

  it('states the notice instruction once when asked for it', () => {
    const p = buildTalkPrompt(request(), { version: 3, notice: true });
    assert.equal(p.split('- notice:').length - 1, 1);
  });
});

describe('the v4 voice', () => {
  const v4 = buildTalkPrompt(request(), { version: 4, notice: true });

  it('conveys the praise tone without prescribing pet names', () => {
    assert.doesNotMatch(v4, /champion|my boy/);
    assert.match(v4, /condescending warmth/);
    assert.match(buildTalkPrompt(request(), { version: 3 }), /champion/, 'v3 stays as measured');
  });

  it('puts death through software, never literally', () => {
    assert.match(v4, /Dying only ever comes through software/);
    assert.match(v4, /rolled back \(what the\s+stat board calls it\)/);
    assert.match(v4, /no\s+corpses, graves, obituaries or funerals/);
    assert.match(v4, /nothing about suicide or self-harm/);
  });

  it('keeps neutral as the default verdict', () => {
    assert.match(v4, /Use the other two only when the numbers clearly say so/);
  });

  it('keeps everything else from v3', () => {
    assert.match(v4, /dead weights destroyed/);
    assert.match(v4, /Take a dig at him when the agent wastes something/);
    assert.deepEqual(talkConfig(request(), { version: 4, notice: true }), talkConfig(request(), { notice: true }));
  });
});
