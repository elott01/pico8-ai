// Client-side glue to /api/talk, and gem-in-eye's memory between purchases.
//
// The memory lives in localStorage because the cart remembers nothing and the server keeps
// no per-player state. That makes it editable by the player. /api/talk accounts for that
// by treating past speeches as untrusted, but it can't tell a real speech from a forged one;
// signing them, or keeping memory on the server, would.
//
// It is keyed per speaker from the start, so Claude can get a voice of his own later
// without a migration of anything already saved.

import type { TalkMemory, TalkRequest, TalkStats, TalkSuccess } from '../../api/_types.ts';

export type TalkFailure = 'rate-limited' | 'timeout' | 'error';

// Discriminated on `reason`, so nothing the model said is reachable on a reply it did not
// give — the panel cannot pair a speech with a fallback.
export type TalkReply =
  | (TalkSuccess & { reason: null })
  | { reason: 'rate-limited'; retryAfter?: number }
  | { reason: 'timeout' | 'error' };

// Same budget and the same reasoning as getAiTurn in ai.ts: 12s keeps the page inside the
// cart's 450-frame (15s) wait, so the cart always gets the page's answer rather than giving
// up and selling at list on its own.
export async function getTalk(request: TalkRequest, timeoutMs = 12000, signal?: AbortSignal): Promise<TalkReply> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const r = await fetch('/api/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: ctrl.signal,
    });
    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      const header = Number(r.headers.get('Retry-After'));
      return { reason: 'rate-limited', retryAfter: Number(body.retryAfter) || header || 60 };
    }
    if (!r.ok) return { reason: 'error' };
    return { ...((await r.json()) as TalkSuccess), reason: null };
  } catch (e) {
    const timedOut = (e as { name?: unknown } | null)?.name === 'AbortError';
    return { reason: timedOut ? 'timeout' : 'error' };
  } finally {
    clearTimeout(t);
  }
}

// ---- memory --------------------------------------------------------------------------------

export const MEMORY_KEY = 'pico-ai:memory';

/** Who said it. Only gem-in-eye talks in v1; Claude is the planned second. */
export type Speaker = 'gem-in-eye';

/** How many past speeches a speaker remembers. The server keeps at most this many too. */
export const MEMORY_SPEECHES = 3;

type SpeakerMemory = { lastSpeeches: string[]; lastStats: TalkStats | null };

export type Memory = {
  v: 1;
  /** The agent's number, and the counters it was last advanced from. Shared by every
   *  speaker: it is the agent's number, not a speaker's. */
  agent: { number: number; rollbacks: number; uptimeSec: number } | null;
  speakers: Partial<Record<Speaker, SpeakerMemory>>;
};

export const emptyMemory = (): Memory => ({ v: 1, agent: null, speakers: {} });

/** localStorage, or null where reading it throws (some privacy modes). Same guard as
 *  ThemeToggle.tsx: a missing store must cost the memory, never the game. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isStats = (v: unknown): v is TalkStats =>
  typeof v === 'object' && v !== null && typeof (v as TalkStats).rollbacks === 'number' && typeof (v as TalkStats).uptimeSec === 'number';

/** Whatever is saved, or a fresh memory if there is nothing, or nothing readable. The server
 *  validates what it is sent anyway; this only has to avoid crashing on a bad save. */
export function loadMemory(storage: Storage | null): Memory {
  try {
    const raw = storage?.getItem(MEMORY_KEY);
    if (!raw) return emptyMemory();
    const m = JSON.parse(raw) as Memory;
    if (m?.v !== 1 || typeof m.speakers !== 'object' || m.speakers === null) return emptyMemory();
    const agent = m.agent && Number.isInteger(m.agent.number) ? m.agent : null;
    const speakers: Memory['speakers'] = {};
    for (const [name, sp] of Object.entries(m.speakers) as [Speaker, SpeakerMemory][]) {
      speakers[name] = {
        lastSpeeches: Array.isArray(sp?.lastSpeeches) ? sp.lastSpeeches.filter((x) => typeof x === 'string').slice(-MEMORY_SPEECHES) : [],
        lastStats: isStats(sp?.lastStats) ? sp.lastStats : null,
      };
    }
    return { v: 1, agent, speakers };
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(storage: Storage | null, memory: Memory): void {
  try {
    storage?.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* quota or privacy mode: the memory is lost, the game is not */
  }
}

/**
 * The cart restarted since `prev`: a reload resets every stat, so a counter that only rises
 * within a session went down. Uptime alone would miss a reload followed by a long session,
 * so rollbacks count too.
 */
export function isNewSession(prev: { rollbacks: number; uptimeSec: number } | null, now: TalkStats): boolean {
  return prev !== null && (now.uptimeSec < prev.uptimeSec || now.rollbacks < prev.rollbacks);
}

/**
 * The agent's number now. Each rollback is an agent lost and the next one walking in, so the
 * number rises by one per rollback, and by one more when a reload started a new session (plus
 * whatever rollbacks that new session has already had). The first number ever is random in
 * the low thousands, so the old agents are a long line of numbers below it.
 */
export function nextAgentNumber(agent: Memory['agent'], stats: TalkStats, rand: () => number = Math.random): number {
  if (!agent) return 4000 + Math.floor(rand() * 1000) + stats.rollbacks;
  if (isNewSession(agent, stats)) return agent.number + 1 + stats.rollbacks;
  return agent.number + Math.max(0, stats.rollbacks - agent.rollbacks);
}

/** The `memory` half of a request to /api/talk, from what the page remembers. */
export function memoryFor(memory: Memory, speaker: Speaker, stats: TalkStats, rand?: () => number): TalkMemory {
  const sp = memory.speakers[speaker];
  const lastStats = sp?.lastStats ?? null;
  return {
    lastSpeeches: sp?.lastSpeeches ?? [],
    lastStats,
    newSession: isNewSession(lastStats, stats),
    agentNumber: nextAgentNumber(memory.agent, stats, rand),
  };
}

/**
 * The memory after a purchase. The stats and agent number always advance; a speech is only
 * remembered if the cart actually printed it, so gem-in-eye never "remembers" a line the
 * player never saw.
 */
export function remember(memory: Memory, speaker: Speaker, stats: TalkStats, agentNumber: number, shownSpeech: string | null): Memory {
  const sp = memory.speakers[speaker] ?? { lastSpeeches: [], lastStats: null };
  const lastSpeeches = shownSpeech ? [...sp.lastSpeeches, shownSpeech].slice(-MEMORY_SPEECHES) : sp.lastSpeeches;
  return {
    v: 1,
    agent: { number: agentNumber, rollbacks: stats.rollbacks, uptimeSec: stats.uptimeSec },
    speakers: { ...memory.speakers, [speaker]: { lastSpeeches, lastStats: stats } },
  };
}
