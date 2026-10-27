// The page side of gem-in-eye: the /api/talk client, and the memory it keeps between
// purchases. The memory rules decide what Gemini is told about the agent's history, so a
// wrong one does not crash — it just has him remember a reload as a collapse, or number a
// dead agent as the living one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getTalk,
  loadMemory,
  saveMemory,
  emptyMemory,
  isNewSession,
  nextAgentNumber,
  memoryFor,
  remember,
  MEMORY_KEY,
  MEMORY_SPEECHES,
} from '../src/lib/talk.ts';
import type { Memory } from '../src/lib/talk.ts';
import type { TalkRequest, TalkStats } from '../api/_types.ts';
import { asResponse } from './_mocks.ts';

/** localStorage, minus everything this module does not call. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

const STATS: TalkStats = {
  pruned: 62, rollbacks: 8, uptimeSec: 562, maxDepth: 3, lastDepth: 1, purse: 1, stashed: 10,
  tiers: { vitality: 1, stamina: 1, armor: 0, attack: 0, stash: 0 },
};
const later = (over: Partial<TalkStats>): TalkStats => ({ ...STATS, ...over });

describe('loading and saving', () => {
  it('starts empty, and round-trips what it saves', () => {
    const storage = fakeStorage();
    assert.deepEqual(loadMemory(storage), emptyMemory());
    const m = remember(emptyMemory(), 'gem-in-eye', STATS, 4012, 'depth three. take it.');
    saveMemory(storage, m);
    assert.deepEqual(loadMemory(storage), m);
  });

  it('survives unreadable saves and a missing store', () => {
    assert.deepEqual(loadMemory(fakeStorage({ [MEMORY_KEY]: '{not json' })), emptyMemory());
    assert.deepEqual(loadMemory(fakeStorage({ [MEMORY_KEY]: '{"v":99}' })), emptyMemory());
    assert.deepEqual(loadMemory(null), emptyMemory());
    assert.doesNotThrow(() => saveMemory(null, emptyMemory()));
  });

  it('drops anything malformed it finds in a save', () => {
    const saved = {
      v: 1,
      agent: { number: 4012, rollbacks: 8, uptimeSec: 562 },
      speakers: { 'gem-in-eye': { lastSpeeches: ['a', 42, 'b', 'c', 'd'], lastStats: 'nope' } },
    };
    const m = loadMemory(fakeStorage({ [MEMORY_KEY]: JSON.stringify(saved) }));
    assert.deepEqual(m.speakers['gem-in-eye'], { lastSpeeches: ['b', 'c', 'd'], lastStats: null });
  });
});

describe('new sessions', () => {
  it('is a new session when a counter that only rises went down', () => {
    assert.equal(isNewSession(null, STATS), false, 'no history is not a reload');
    assert.equal(isNewSession(STATS, later({ uptimeSec: 900, rollbacks: 9 })), false);
    assert.equal(isNewSession(STATS, later({ uptimeSec: 40 })), true);
    assert.equal(isNewSession(STATS, later({ rollbacks: 0, uptimeSec: 9000 })), true, 'a reload followed by a long session');
  });
});

describe('agent numbers', () => {
  it('seeds the first number in the low thousands, plus any agents already lost', () => {
    assert.equal(nextAgentNumber(null, later({ rollbacks: 0 }), () => 0.5), 4500);
    assert.equal(nextAgentNumber(null, STATS, () => 0), 4008);
  });

  it('rises by one per rollback since the last purchase, and never falls', () => {
    const agent = { number: 4012, rollbacks: 8, uptimeSec: 562 };
    assert.equal(nextAgentNumber(agent, later({ rollbacks: 8, uptimeSec: 700 })), 4012);
    assert.equal(nextAgentNumber(agent, later({ rollbacks: 11, uptimeSec: 700 })), 4015);
  });

  it("counts a reload as a new agent, plus the new session's own rollbacks", () => {
    const agent = { number: 4012, rollbacks: 8, uptimeSec: 562 };
    assert.equal(nextAgentNumber(agent, later({ rollbacks: 2, uptimeSec: 60 })), 4015);
  });
});

describe('what a request carries, and what is kept after it', () => {
  it("builds the memory half of a request from the speaker's record", () => {
    let m: Memory = remember(emptyMemory(), 'gem-in-eye', STATS, 4012, 'first.');
    const reloaded = later({ pruned: 3, rollbacks: 0, uptimeSec: 140 });
    const mem = memoryFor(m, 'gem-in-eye', reloaded);
    assert.deepEqual(mem, { lastSpeeches: ['first.'], lastStats: STATS, newSession: true, agentNumber: 4013 });

    m = remember(m, 'gem-in-eye', reloaded, mem.agentNumber, null);
    assert.equal(memoryFor(m, 'gem-in-eye', later({ pruned: 9, rollbacks: 0, uptimeSec: 300 })).newSession, false);
  });

  it(`keeps only speeches the cart printed, at most ${MEMORY_SPEECHES}`, () => {
    let m = emptyMemory();
    for (const s of ['one.', 'two.', 'three.', 'four.']) m = remember(m, 'gem-in-eye', STATS, 4012, s);
    m = remember(m, 'gem-in-eye', STATS, 4012, null); // a fallback: nothing he said was seen
    assert.deepEqual(m.speakers['gem-in-eye']?.lastSpeeches, ['two.', 'three.', 'four.']);
  });

  it('advances the stats and agent counters even when nothing was said', () => {
    const m = remember(emptyMemory(), 'gem-in-eye', STATS, 4012, null);
    assert.deepEqual(m.agent, { number: 4012, rollbacks: 8, uptimeSec: 562 });
    assert.equal(m.speakers['gem-in-eye']?.lastStats, STATS);
  });
});

describe('getTalk', () => {
  const request: TalkRequest = {
    occasion: 'purchase',
    purchase: { item: 'attack', tier: 1, listPrice: 10 },
    stats: STATS,
    memory: { lastSpeeches: [], lastStats: null, newSession: false, agentNumber: 4012 },
  };
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => asResponse({ status, ok: status < 300, headers: new Headers(headers), json: async () => body })) as typeof globalThis.fetch;

  it('posts the request and returns the reply with reason null', async () => {
    let sent: unknown;
    globalThis.fetch = (async (_u: RequestInfo | URL, opts?: RequestInit) => {
      sent = JSON.parse(String(opts?.body));
      return asResponse({ status: 200, ok: true, headers: new Headers(), json: async () => ({ verdict: 'neutral', price: 10, pages: ['x.'], notice: 'y' }) });
    }) as typeof globalThis.fetch;
    assert.deepEqual(await getTalk(request), { verdict: 'neutral', price: 10, pages: ['x.'], notice: 'y', reason: null });
    assert.deepEqual(sent, request);
  });

  it('tells a rate limit apart from a failure', async () => {
    globalThis.fetch = reply(429, { retryAfter: 30 });
    assert.deepEqual(await getTalk(request), { reason: 'rate-limited', retryAfter: 30 });
    globalThis.fetch = reply(500, {});
    assert.deepEqual(await getTalk(request), { reason: 'error' });
  });

  it('reports a timeout when the request outlives its budget', async () => {
    globalThis.fetch = ((_u: RequestInfo | URL, opts?: RequestInit) =>
      new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof globalThis.fetch;
    assert.deepEqual(await getTalk(request, 10), { reason: 'timeout' });
  });
});
