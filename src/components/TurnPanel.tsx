// Per-turn record of the model's own analysis, newest first. The panel exists to
// evidence that a real LLM chose each move, so a card must never pair the model's
// commentary with a move it didn't make — hence the fromModel guards below.

import type { Board } from '../lib/gpio.ts';
import type { AiFailure, Line } from '../lib/ai.ts';
import styles from './TurnPanel.module.scss';

/** One row of the panel: what the model said, and what the cart actually played. */
export type Turn = {
  n: number;
  board: Board;
  /** The cell the cart played, read back over GPIO; null if the read-back missed. */
  move: number | null;
  /** The cell the model asked for, which may differ from `move` or be illegal. */
  intended: number | null;
  lines: Line[];
  winMove: number | null;
  blockMove: number | null;
  commentary: string | null;
  reason: AiFailure | null;
  /** True only when the model's own move is the one that got played. */
  fromModel: boolean;
};

// Badges carry a semantic kind rather than a colour, so the palette lives entirely in the
// stylesheet and re-theming never touches this file.
type BadgeKind = 'win' | 'threat' | 'notice';
type Badge = { text: string; kind: BadgeKind };

const MARK = ['', 'X', 'O']; // 0 empty, 1 human (X), 2 AI (O)

export default function TurnPanel({ turns, thinking }: { turns: Turn[]; thinking: boolean }) {
  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>AI Turns</h2>

      {thinking && (
        <div className={styles.thinking}>
          <span className={styles.dot} aria-hidden="true" />
          <span role="status">Gemini is thinking…</span>
        </div>
      )}

      {turns.length === 0 && !thinking && (
        <p className={styles.empty}>Waiting for the AI's first move…</p>
      )}

      {turns
        .slice()
        .reverse()
        .map((t, i) => <TurnCard key={t.n} turn={t} defaultOpen={i === 0} />)}
    </aside>
  );
}

function TurnCard({ turn, defaultOpen }: { turn: Turn; defaultOpen: boolean }) {
  const { n, board, move, lines, winMove, blockMove, commentary, fromModel } = turn;
  // WIN/BLOCK comes from the model's own analysis, so it may only tag a move it played.
  const tag = fromModel ? classify(turn) : null;
  const note = fromModel ? null : fallbackNote(turn);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <strong>#{n}</strong>
        <span className={styles.played}>played {move ?? '—'}</span>
        {tag && <Tag {...tag} />}
      </div>

      {/* Generated after `move`, so it narrates a decision already made, never causes
          it. The reasoning below is the actual record. */}
      {commentary && <p className={styles.commentary}>“{commentary}”</p>}

      {note && <p className={`${styles.note} ${styles[note.kind]}`}>{note.text}</p>}

      {fromModel && lines.length > 0 && (
        <details open={defaultOpen} className={styles.details}>
          <summary className={styles.summary}>reasoning</summary>
          <Reasoning board={board} move={move} lines={lines} winMove={winMove} blockMove={blockMove} />
        </details>
      )}

      {/* Solver turns have no analysis to show, but the board still shows where it
          played. Skipped when the read-back missed, since there is nothing to ring. */}
      {!fromModel && Number.isInteger(move) && (
        <div className={styles.boardWrap}>
          <MiniBoard board={board} move={move} />
        </div>
      )}
    </div>
  );
}

function Reasoning({
  board,
  move,
  lines,
  winMove,
  blockMove,
}: {
  board: Board;
  move: number | null;
  lines: Line[];
  winMove: number | null;
  blockMove: number | null;
}) {
  // Only lines with a completed pair drove the decision; the rest collapse to a count
  // rather than padding every card with eight rows. Tagging once here keeps the tag and
  // the filter from drifting apart.
  const loud = lines
    .map((l) => ({ l, t: lineTag(l) }))
    .filter((x): x is { l: Line; t: Badge } => x.t !== null);
  const quiet = lines.length - loud.length;

  return (
    <div className={styles.reasoning}>
      <MiniBoard board={board} move={move} />
      <div className={styles.reasoningText}>
        <div className={styles.meta}>
          winMove: <Val v={winMove} /> · blockMove: <Val v={blockMove} />
        </div>
        {loud.map(({ l, t }) => (
          <div key={l.line.join()}>
            [{l.line.join(',')}] {l.values.join(',')}{' '}
            <span className={styles[t.kind]}>→ {t.text}</span>
          </div>
        ))}
        {quiet > 0 && <div className={styles.quiet}>+ {quiet} quiet lines</div>}
      </div>
    </div>
  );
}

function MiniBoard({ board, move }: { board: Board; move: number | null }) {
  return (
    <div className={styles.board}>
      {board.map((v, i) => (
        <div key={i} className={`${styles.cell} ${i === move ? styles.cellPlayed : ''}`}>
          {i === move ? 'O' : MARK[v]}
        </div>
      ))}
    </div>
  );
}

function Tag({ text, kind }: Badge) {
  return <span className={`${styles.tag} ${styles[kind]}`}>● {text}</span>;
}

function Val({ v }: { v: number | null }) {
  return <span className={v === null ? styles.quiet : undefined}>{v === null ? 'null' : v}</span>;
}

// Explains a turn the model didn't decide, where the cart's minimax played instead —
// so `move` is a real, optimal cell, not a failure. Rate limiting reads as a notice
// because it is an expected condition; only genuine failures read as threats.
function fallbackNote({ move, intended, board, reason }: Turn): Badge {
  const played = Number.isInteger(move) ? `played ${move}` : 'played';
  const solver = `built-in solver ${played}`;

  if (reason === 'rate-limited') {
    return { kind: 'notice', text: `⏳ Demo rate limit reached — ${solver}.` };
  }
  if (reason === 'timeout') {
    return { kind: 'threat', text: `⚠ Model timed out — ${solver}.` };
  }
  if (reason === 'error') {
    return { kind: 'threat', text: `⚠ Model unavailable — ${solver}.` };
  }
  // No reason, but not a model turn: it answered with an unusable cell.
  if (intended !== null && Number.isInteger(intended) && board[intended] !== 0) {
    return { kind: 'threat', text: `⚠ Model chose ${intended} (already taken) — ${solver}.` };
  }
  return { kind: 'threat', text: `⚠ Model move rejected — ${solver}.` };
}

function classify({ move, winMove, blockMove }: Turn): Badge | null {
  if (winMove !== null && move === winMove) return { text: 'WIN', kind: 'win' };
  if (blockMove !== null && move === blockMove) return { text: 'BLOCK', kind: 'threat' };
  return null;
}

function lineTag(l: Line): Badge | null {
  if (l.twos === 2 && l.ones === 0) return { text: 'WIN', kind: 'win' };
  if (l.ones === 2 && l.twos === 0) return { text: 'THREAT', kind: 'threat' };
  return null;
}
