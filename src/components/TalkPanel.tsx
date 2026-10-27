// Per-purchase record of what gem-in-eye was shown and what he said, newest first.
//
// The same job as TurnPanel: evidence that a real LLM produced what the cart printed. So the
// stats are labelled as input, the notice, verdict and speech as the model's own output, and
// a purchase the cart answered with its own line says so — the panel must never present the
// cart's fallback as something Gemini said.

import type { ShopItem, TalkStats, Verdict } from '../../api/_types.ts';
import type { TalkFailure } from '../lib/talk.ts';
import styles from './TurnPanel.module.scss';

export type TalkTurn = {
  n: number;
  item: ShopItem;
  tier: number;
  listPrice: number;
  /** What gem-in-eye was shown: input, not output. */
  stats: TalkStats;
  agentNumber: number;
  verdict: Verdict | null;
  /** The model's own line about what stood out in the numbers. */
  notice: string | null;
  /** The full speech, every page, exactly as the server paged it for the cart. */
  speech: string | null;
  /** What the cart charged, read back over GPIO. Null if the read-back missed. */
  charged: number | null;
  reason: TalkFailure | null;
  /** True only when the cart printed the model's speech. */
  fromModel: boolean;
  /** The reply came back after the cart had already given up waiting. */
  late: boolean;
};

type BadgeKind = 'win' | 'threat' | 'notice';

const VERDICT_KIND: Record<Verdict, BadgeKind> = { impressed: 'win', neutral: 'notice', unimpressed: 'threat' };

export default function TalkPanel({ talks, thinking }: { talks: TalkTurn[]; thinking: boolean }) {
  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>gem-in-eye</h2>

      {thinking && (
        <div className={styles.thinking}>
          <span className={styles.dot} aria-hidden="true" />
          <span role="status">Gemini is thinking…</span>
        </div>
      )}

      {talks.length === 0 && !thinking && (
        <p className={styles.empty}>Buy something in the shop to hear from gem-in-eye.</p>
      )}

      {talks
        .slice()
        .reverse()
        .map((t, i) => <TalkCard key={t.n} talk={t} defaultOpen={i === 0} />)}
    </aside>
  );
}

function TalkCard({ talk, defaultOpen }: { talk: TalkTurn; defaultOpen: boolean }) {
  const { n, item, tier, listPrice, charged, verdict, speech, notice, fromModel, stats, agentNumber } = talk;
  const note = fromModel ? null : fallbackNote(talk);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span>#{n}</span>
        <span className={styles.played}>
          {item} {tier} · {charged ?? '—'}/{listPrice} tokens
        </span>
        {fromModel && verdict && (
          <span className={`${styles.tag} ${styles[VERDICT_KIND[verdict]]}`}>● {verdict}</span>
        )}
      </div>

      {fromModel && speech && <p className={styles.commentary}>“{speech}”</p>}
      {note && <p className={`${styles.note} ${styles[note.kind]}`}>{note.text}</p>}

      <details open={defaultOpen} className={styles.details}>
        <summary className={styles.summary}>what he was shown</summary>
        <div className={styles.reasoning}>
          {fromModel && notice && <p className={styles.reasoningText}>noticed: {notice}</p>}
          <p className={styles.reasoningText}>
            agent {agentNumber} · {stats.pruned} pruned · {stats.rollbacks} rollbacks · depth {stats.maxDepth} ·{' '}
            {Math.floor(stats.uptimeSec / 60)} min · purse {stats.purse} · stash {stats.stashed}
          </p>
        </div>
      </details>
    </div>
  );
}

function fallbackNote({ reason, late, speech }: TalkTurn): { kind: BadgeKind; text: string } {
  const shop = 'the shop sold at list with its own line';
  if (reason === 'rate-limited') return { kind: 'notice', text: `⏳ Demo rate limit reached — ${shop}.` };
  if (reason === 'timeout') return { kind: 'threat', text: `⚠ Model timed out — ${shop}.` };
  if (reason === 'error') return { kind: 'threat', text: `⚠ Model unavailable — ${shop}.` };
  if (late) return { kind: 'threat', text: `⚠ The reply arrived after the cart stopped waiting — ${shop}.` };
  if (!speech) return { kind: 'threat', text: `⚠ Model gave no usable speech — ${shop}.` };
  return { kind: 'threat', text: `⚠ The cart did not print the reply — ${shop}.` };
}
