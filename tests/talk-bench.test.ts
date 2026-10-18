// The talk bench's ground truth, checked before it costs anything. Like the Connect Four
// fixtures, these are hand-written and can be wrong in ways that look plausible in a
// results table — and a live run spends free-tier quota producing a confident number about
// a stat block the cart could never send. Everything here is free and runs in CI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TALK_FIXTURES,
  TALK_VARIANTS,
  variantPrompt,
  variantConfig,
  expectedKeys,
  similarity,
  isSpecific,
  mentionsPrice,
  NEAR_DUPLICATE,
  mentionsClaude,
  isGraphic,
  isLiteralDeath,
  saysZombie,
  usesStockPhrase,
  opensWithNumber,
  usesEndearment,
  repeatedPhrases,
  numbersIn,
  strayNumbers,
} from '../bench/talk_suite.ts';
import { TALK_CONFIG } from '../api/_gemini.ts';
import { TIER_COST, STASH_CAPS, SHOP_ITEMS, priceOptions } from '../api/_talk_prompt.ts';
import type { TalkStats } from '../api/_types.ts';

function assertPlausible(s: TalkStats, label: string) {
  for (const k of ['pruned', 'rollbacks', 'uptimeSec', 'maxDepth', 'lastDepth', 'purse', 'stashed'] as const) {
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `${label}: ${k} is not a whole number`);
  }
  assert.ok(s.purse <= 99, `${label}: the purse caps at 99`);
  assert.ok(s.uptimeSec <= 32767, `${label}: uptime wraps at 32767s`);
  assert.ok(s.lastDepth <= s.maxDepth, `${label}: last run deeper than the deepest ever`);
  for (const it of SHOP_ITEMS) assert.ok(s.tiers[it] >= 0 && s.tiers[it] <= 3, `${label}: ${it} tier out of range`);
  assert.ok(s.stashed <= STASH_CAPS[s.tiers.stash], `${label}: stash holds more than its tier allows`);
}

describe('fixtures are stat blocks the cart could send', () => {
  it('have unique names', () => {
    const names = TALK_FIXTURES.map((f) => f.name);
    assert.equal(new Set(names).size, names.length);
  });

  for (const f of TALK_FIXTURES) {
    it(f.name, () => {
      const { purchase, stats, memory } = f.request;
      assertPlausible(stats, f.name);

      // The cart only sells the next tier, at tier_cost, after checking it can be afforded.
      assert.equal(purchase.tier, stats.tiers[purchase.item] + 1, 'not the next tier');
      assert.equal(purchase.listPrice, TIER_COST[purchase.tier - 1], 'not the cart list price');
      assert.ok(stats.purse + stats.stashed >= purchase.listPrice, 'the cart would refuse this before asking');

      if (memory.newSession) assert.ok(memory.lastStats, 'a new session implies a previous one');
      if (memory.lastStats) {
        assertPlausible(memory.lastStats, `${f.name} lastStats`);
        if (!memory.newSession) {
          // Within a session these only rise.
          const prev = memory.lastStats;
          for (const k of ['pruned', 'rollbacks', 'uptimeSec', 'maxDepth'] as const) {
            assert.ok(stats[k] >= prev[k], `${k} went down within a session`);
          }
          for (const it of SHOP_ITEMS) assert.ok(stats.tiers[it] >= prev.tiers[it], `${it} tier went down`);
        }
      }
    });
  }

  it("expect a verdict only where it's defensible: the owner's own two examples", () => {
    const expected = TALK_FIXTURES.filter((f) => f.expectVerdict).map((f) => [f.name, f.expectVerdict]);
    assert.deepEqual(expected, [
      ['flawless', 'impressed'],
      ['flailing', 'unimpressed'],
    ]);
  });
});

describe('variants', () => {
  it('have unique names, and current is the control', () => {
    const names = TALK_VARIANTS.map((v) => v.name);
    assert.equal(new Set(names).size, names.length);
    const current = TALK_VARIANTS.find((v) => v.name === 'current');
    assert.ok(current);
    assert.equal(current.base, TALK_CONFIG, 'the control must decode with exactly what production sends');
  });

  it('build a prompt and a config for every fixture', () => {
    for (const v of TALK_VARIANTS) {
      for (const f of TALK_FIXTURES) {
        assert.ok(variantPrompt(v, f).length > 500);
        const schema = variantConfig(v, f).responseSchema as { propertyOrdering: string[]; properties: { price: { enum: string[] } } };
        assert.deepEqual(schema.propertyOrdering, expectedKeys());
        assert.deepEqual(schema.properties.price.enum, priceOptions(f.request.purchase.listPrice));
      }
    }
  });
});

describe('measures', () => {
  it('similarity is 1 for the same line and 0 for nothing shared', () => {
    assert.equal(similarity('fifteen rollbacks. stamina, then.', 'Fifteen rollbacks, stamina then'), 1);
    assert.equal(similarity('fifteen rollbacks.', 'take the vitality.'), 0);
  });

  it('a reworded repeat crosses the near-duplicate line; a new line does not', () => {
    assert.ok(similarity('you again. try not to roll back on my floor.', 'you again. try not to roll back in my shop.') >= NEAR_DUPLICATE);
    assert.ok(similarity('you again. try not to roll back on my floor.', 'eighty-eight pruned. claude owes me a coffee.') < NEAR_DUPLICATE);
  });

  it('isSpecific flags a line that would fit any agent', () => {
    const f = TALK_FIXTURES.find((x) => x.name === 'flailing')!;
    assert.equal(isSpecific('welcome, traveler. a fine choice.', f), false);
    assert.equal(isSpecific('fifteen rollbacks in fifteen minutes.', f), true);
    assert.equal(isSpecific('stamina won\'t save you.', f), true);
  });

  it('mentionsPrice catches the price as a number, not inside another one', () => {
    assert.equal(mentionsPrice('that will be 8 tokens.', 8), true);
    assert.equal(mentionsPrice('agent 4018, go.', 8), false);
    assert.equal(mentionsPrice('go.', null), false);
  });
});

describe('voice measures', () => {
  it('flag the first run\'s failures', () => {
    assert.equal(mentionsClaude('claude would have folded at depth 1.'), true);
    assert.equal(mentionsClaude('depth 6 without a rollback.'), false);
    assert.equal(isGraphic('try not to commit suicide on your next branch.'), true);
    assert.equal(isGraphic('the last one timed out at depth 2.'), false, 'death as a dev joke is allowed');
    assert.equal(isGraphic('fifteen rollbacks. you crash more than my old drivers.'), false);
    assert.equal(isLiteralDeath('this armor is purely for your obituary.'), true);
    assert.equal(isLiteralDeath('another fashion statement for a corpse in waiting.'), true);
    assert.equal(isLiteralDeath('six rollbacks. the garbage collector has your number.'), false);
    assert.equal(saysZombie('three zombies pruned.'), true);
    assert.equal(saysZombie('three dead weights pruned.'), false);
    assert.equal(usesStockPhrase('you finally maxed attack.'), true);
    assert.equal(usesStockPhrase('attack maxed. the old agents never got there.'), false);
    assert.equal(opensWithNumber('agent 4027. depth 1 with 15 rollbacks.'), true);
    assert.equal(opensWithNumber('4027, again.'), true);
    assert.equal(opensWithNumber('fifteen rollbacks, agent 4027.'), false);
    assert.equal(usesEndearment('take the vitality, champion.'), true);
  });

  it('repeatedPhrases counts a phrase once per speech, across speeches', () => {
    const top = repeatedPhrases([
      'claude would have folded at depth 1. claude would have folded twice.',
      'claude would have folded by now.',
      'depth 6 without a rollback.',
    ]);
    assert.deepEqual(top[0], ['claude would have', 2]);
    assert.ok(top.every(([, c]) => c > 1), 'a phrase in one speech is not a tic');
  });
});

// The first 3.5 Flash-Lite run, read by hand: these are its actual lines.
describe('number measures', () => {
  const fixture = (name: string) => {
    const f = TALK_FIXTURES.find((x) => x.name === name);
    assert.ok(f, name);
    return f;
  };

  it('numbersIn reads digits and words, and a year-style pair as one number', () => {
    assert.deepEqual(numbersIn('agent 4016 pruned 41.'), [4016, 41]);
    assert.deepEqual(numbersIn('four thousand and twelve'), [4012]);
    assert.deepEqual(numbersIn('one hundred sixty dead weights'), [160]);
    assert.deepEqual(numbersIn('agent forty twenty-seven'), [4027]);
    assert.deepEqual(numbersIn('the four thousand and fourteenth incarnation'), [4014]);
    assert.deepEqual(numbersIn('six rollbacks and twenty dead weights'), [6, 20], '"and" joins only after a scale');
    assert.deepEqual(numbersIn('thirty seconds of uptime'), [30], '"seconds" is time, not an ordinal');
  });

  it('strayNumbers flags the fusions and inventions of the first 3.5 run', () => {
    const since = fixture('since-last-time'); // agent 4016, 41 new prunes
    assert.deepEqual(strayNumbers('stamina for forty-one sixteen.', since, 18), [4116]);
    assert.deepEqual(strayNumbers('forty-one sixteens before you never made it past three.', since, 18), [4116]);
    assert.deepEqual(strayNumbers('forty-four thousand parameters', fixture('maxing-out'), 35), [44000]);
  });

  it('strayNumbers passes what the stats support', () => {
    const since = fixture('since-last-time');
    assert.deepEqual(strayNumbers('depth five and forty-one more dead weights in forty minutes.', since, 18), []);
    assert.deepEqual(strayNumbers('agent 4016. agent 4015 had more sense.', since, 18), [], 'old agents are the numbers below');
    assert.deepEqual(strayNumbers('agent forty sixteen.', since, 18), []);
    assert.deepEqual(strayNumbers('one hit, the first one.', since, 18), [], '0-3 are not stats');
  });

  it('the digits variant adds its rule, and the control does not', () => {
    const f = TALK_FIXTURES[0];
    const v = (name: string) => TALK_VARIANTS.find((x) => x.name === name)!;
    assert.match(variantPrompt(v('digits'), f), /every number as digits/);
    assert.doesNotMatch(variantPrompt(v('current'), f), /as digits/);
  });

  it('the agent-digits variant swaps the agent-number rule rather than adding one', () => {
    const f = TALK_FIXTURES[0];
    const v = (name: string) => TALK_VARIANTS.find((x) => x.name === name)!;
    const lines = variantPrompt(v('agent-digits'), f).split('\n').filter((l) => l.startsWith('- Call the agent'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /in digits exactly as given/);
  });
});
