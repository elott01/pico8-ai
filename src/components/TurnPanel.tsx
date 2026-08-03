// Per-turn record of the model's own analysis, newest first. The panel exists to
// evidence that a real LLM chose each move, so a card must never pair the model's
// commentary with a move it didn't make — hence the fromModel guards below.

import type { Board } from '../lib/gpio.ts';
import type { AiFailure, Line } from '../lib/ai.ts';

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

type Badge = { text: string; color: string };

const MARK = ['', 'X', 'O']; // 0 empty, 1 human (X), 2 AI (O)

const C = {
  ink: '#1d2b53', // pico-8 dark blue
  dim: '#5f6b8a',
  win: '#00a03a',
  threat: '#ff004d',
  notice: '#b07000', // amber: expected condition, not a failure
  rule: '#dfe3ec',
  panel: '#fbfcfe',
};

export default function TurnPanel({ turns }: { turns: Turn[] }) {
  return (
    <aside
      style={{
        width: 320,
        maxHeight: 'min(90vw, 640px)',
        overflowY: 'auto',
        textAlign: 'left',
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        background: C.panel,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: C.ink,
      }}
    >
      <h2
        style={{
          margin: 0,
          padding: '0.6rem 0.75rem',
          fontSize: 13,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${C.rule}`,
          position: 'sticky',
          top: 0,
          background: C.panel,
        }}
      >
        AI Turns
      </h2>

      {turns.length === 0 ? (
        <p style={{ padding: '0.75rem', color: C.dim, margin: 0 }}>
          Waiting for the AI's first move…
        </p>
      ) : (
        turns
          .slice()
          .reverse()
          .map((t, i) => <TurnCard key={t.n} turn={t} defaultOpen={i === 0} />)
      )}
    </aside>
  );
}

function TurnCard({ turn, defaultOpen }: { turn: Turn; defaultOpen: boolean }) {
  const { n, board, move, lines, winMove, blockMove, commentary, fromModel } = turn;
  // WIN/BLOCK comes from the model's own analysis, so it may only tag a move it played.
  const tag = fromModel ? classify(turn) : null;
  const note = fromModel ? null : fallbackNote(turn);

  return (
    <div style={{ borderBottom: `1px solid ${C.rule}`, padding: '0.6rem 0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>#{n}</strong>
        <span style={{ color: C.dim }}>played {move ?? '—'}</span>
        {tag && <Tag {...tag} />}
      </div>

      {/* Generated after `move`, so it narrates a decision already made, never causes
          it. The reasoning below is the actual record. */}
      {commentary && (
        <p style={{ margin: '0.4rem 0 0', fontStyle: 'italic' }}>“{commentary}”</p>
      )}

      {note && (
        <p style={{ margin: '0.4rem 0 0', color: note.color, fontSize: 12 }}>{note.text}</p>
      )}

      {fromModel && lines.length > 0 && (
        <details open={defaultOpen} style={{ marginTop: '0.4rem' }}>
          <summary style={{ cursor: 'pointer', color: C.dim, fontSize: 12 }}>reasoning</summary>
          <Reasoning board={board} move={move} lines={lines} winMove={winMove} blockMove={blockMove} />
        </details>
      )}

      {/* Solver turns have no analysis to show, but the board still shows where it
          played. Skipped when the read-back missed, since there is nothing to ring. */}
      {!fromModel && Number.isInteger(move) && (
        <div style={{ marginTop: '0.5rem' }}>
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
    <div style={{ display: 'flex', gap: 10, marginTop: '0.5rem' }}>
      <MiniBoard board={board} move={move} />
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.6 }}>
        <div style={{ color: C.dim }}>
          winMove: <Val v={winMove} /> · blockMove: <Val v={blockMove} />
        </div>
        {loud.map(({ l, t }) => (
          <div key={l.line.join()}>
            [{l.line.join(',')}] {l.values.join(',')}{' '}
            <span style={{ color: t.color }}>→ {t.text}</span>
          </div>
        ))}
        {quiet > 0 && <div style={{ color: C.dim }}>+ {quiet} quiet lines</div>}
      </div>
    </div>
  );
}

function MiniBoard({ board, move }: { board: Board; move: number | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 18px)', gap: 2, flexShrink: 0 }}>
      {board.map((v, i) => (
        <div
          key={i}
          style={{
            width: 18,
            height: 18,
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            border: `1px solid ${i === move ? C.win : C.rule}`,
            background: i === move ? '#e8f8ee' : '#fff',
            color: i === move ? C.win : C.ink,
            borderRadius: 2,
          }}
        >
          {i === move ? 'O' : MARK[v]}
        </div>
      ))}
    </div>
  );
}

function Tag({ text, color }: Badge) {
  return (
    <span style={{ marginLeft: 'auto', color, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
      ● {text}
    </span>
  );
}

function Val({ v }: { v: number | null }) {
  return <span style={{ color: v === null ? C.dim : C.ink }}>{v === null ? 'null' : v}</span>;
}

// Explains a turn the model didn't decide, where the cart's minimax played instead —
// so `move` is a real, optimal cell, not a failure. Rate limiting reads amber because it
// is an expected condition; only genuine failures read red.
function fallbackNote({ move, intended, board, reason }: Turn): Badge {
  const played = Number.isInteger(move) ? `played ${move}` : 'played';
  const solver = `built-in solver ${played}`;

  if (reason === 'rate-limited') {
    return { color: C.notice, text: `⏳ Demo rate limit reached — ${solver}.` };
  }
  if (reason === 'timeout') {
    return { color: C.threat, text: `⚠ Model timed out — ${solver}.` };
  }
  if (reason === 'error') {
    return { color: C.threat, text: `⚠ Model unavailable — ${solver}.` };
  }
  // No reason, but not a model turn: it answered with an unusable cell.
  if (intended !== null && Number.isInteger(intended) && board[intended] !== 0) {
    return { color: C.threat, text: `⚠ Model chose ${intended} (already taken) — ${solver}.` };
  }
  return { color: C.threat, text: `⚠ Model move rejected — ${solver}.` };
}

function classify({ move, winMove, blockMove }: Turn): Badge | null {
  if (winMove !== null && move === winMove) return { text: 'WIN', color: C.win };
  if (blockMove !== null && move === blockMove) return { text: 'BLOCK', color: C.threat };
  return null;
}

function lineTag(l: Line): Badge | null {
  if (l.twos === 2 && l.ones === 0) return { text: 'WIN', color: C.win };
  if (l.ones === 2 && l.twos === 0) return { text: 'THREAT', color: C.threat };
  return null;
}
