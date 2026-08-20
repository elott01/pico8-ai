// End-to-end /api/move latency, measured the way the page sees it.
//
//   vercel dev                     # in another terminal — NOT `npm run dev`
//   node bench/latency.ts
//   BASE=https://<preview>.vercel.app N=30 node bench/latency.ts
//
// Complements ab.ts. That one calls Gemini directly to isolate the *prompt*; this one goes
// through the whole stack — same-origin check, rate limiter, quota reservation, the model
// call, and the legality retry — because that total is what races getAiTurn's 10s abort.
//
// Why it exists: connect-four-cart-plan.md builds its "the fallback will fire constantly"
// argument on a measurement of 8.5-10.2s end to end against that 10s budget. bench/ab.ts
// later put pure model time at ~700ms. Those two numbers imply completely different
// designs, and several open decisions are waiting on which one is real.
//
// Costs N Gemini calls. The default gap stays under the 12-calls-per-minute global cap.

import { C4_POSITIONS } from './connect_four.ts';
import { POSITIONS as TTT_POSITIONS } from './positions.ts';
import { mean, pct, sleep } from './_shared.ts';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const GAME = process.env.GAME ?? 'connect_four';
const N = Number(process.env.N ?? 20);
const GAP_MS = Number(process.env.GAP ?? 6000);

/** getAiTurn's budget in src/lib/ai.ts. The number every sample is judged against. */
const ABORT_MS = Number(process.env.ABORT_MS ?? 12000);
/** A Connect Four game is 15-20 AI turns; tic-tac-toe is ~4. */
const TURNS_PER_GAME = GAME === 'connect_four' ? 18 : 4;

const positions = GAME === 'connect_four' ? C4_POSITIONS : TTT_POSITIONS;

type Sample = {
  position: string;
  ms: number;
  status: number;
  move: unknown;
  /** Client-side abort at ABORT_MS — exactly what the page would have done. */
  abortedByClient: boolean;
  rateLimited: boolean;
};

const samples: Sample[] = [];

console.log(`end-to-end latency — ${N} requests to ${BASE}/api/move [${GAME}], ${GAP_MS}ms apart`);
console.log(`judged against getAiTurn's ${ABORT_MS}ms abort\n`);

for (let i = 0; i < N; i++) {
  const pos = positions[i % positions.length];
  if (i) await sleep(GAP_MS);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ABORT_MS);
  const t = Date.now();
  let status = 0;
  let move: unknown = null;
  let rateLimited = false;
  let abortedByClient = false;

  try {
    const r = await fetch(`${BASE}/api/move`, {
      method: 'POST',
      // The endpoint's same-origin guard compares Origin's host against Host, so a bare
      // POST would 403 and this would measure the guard rather than the model.
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ board: pos.board, game: GAME }),
      signal: ctrl.signal,
    });
    status = r.status;
    rateLimited = r.status === 429;
    const body = (await r.json()) as { move?: unknown };
    move = body.move ?? null;
  } catch (e) {
    abortedByClient = (e as { name?: string })?.name === 'AbortError';
  } finally {
    clearTimeout(timer);
  }

  const ms = Date.now() - t;
  samples.push({ position: pos.name, ms, status, move, abortedByClient, rateLimited });
  console.log(
    `  [${String(i + 1).padStart(2)}/${N}] ${pos.name.padEnd(15)} ${String(ms).padStart(6)}ms  ` +
      `http=${status || '-'}  move=${move ?? '-'}` +
      `${abortedByClient ? '  ABORTED' : ''}${rateLimited ? '  RATE-LIMITED' : ''}`,
  );
}

// Rate-limited samples are excluded from latency: a 429 returns fast and would flatter the
// numbers. They are counted separately, because they cause fallback turns too — just for a
// different reason.
const served = samples.filter((s) => s.status === 200 && !s.abortedByClient);
const ms = served.map((s) => s.ms);
const overBudget = samples.filter((s) => s.abortedByClient || s.ms >= ABORT_MS).length;
const limited = samples.filter((s) => s.rateLimited).length;

console.log('\n' + '='.repeat(76));
console.log(`samples        ${samples.length}   served ${served.length}   rate-limited ${limited}   over budget ${overBudget}`);
console.log(`latency        p50 ${pct(ms, 50)}ms   p95 ${pct(ms, 95)}ms   mean ${Math.round(mean(ms))}ms   max ${Math.max(...ms, 0)}ms`);
console.log(`headroom       ${((ABORT_MS - pct(ms, 95)) / 1000).toFixed(1)}s at p95 against the ${ABORT_MS}ms abort`);
console.log('='.repeat(76));

const rate = samples.length ? overBudget / samples.length : 0;
console.log(
  `\ntimeout-driven fallback turns per ${TURNS_PER_GAME}-turn game: ${(rate * TURNS_PER_GAME).toFixed(1)}` +
    `  (${(rate * 100).toFixed(0)}% of turns)`,
);
console.log('Timeouts only. Rate limits, model errors and illegal moves are separate causes,');
console.log('and only a real playthrough measures those together.');
