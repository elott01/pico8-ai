// Shows the model's own analysis for each AI turn, newest first.
//
// The point of this panel is to make it evident that a real LLM is choosing the
// moves: every card pairs the model's trash talk with the exact line-by-line
// scan it produced to pick that cell. The two must stay together — a quip next to
// someone else's reasoning would prove nothing.

const MARK = ['', 'X', 'O']; // board values: 0 empty, 1 human (X), 2 AI (O)

const C = {
  ink: '#1d2b53', // pico-8 dark blue
  dim: '#5f6b8a',
  win: '#00a03a',
  threat: '#ff004d',
  rule: '#dfe3ec',
  panel: '#fbfcfe',
};

export default function TurnPanel({ turns }) {
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

function TurnCard({ turn, defaultOpen }) {
  const { n, board, move, lines, winMove, blockMove, commentary, fromModel } = turn;
  const tag = classify(turn);

  return (
    <div style={{ borderBottom: `1px solid ${C.rule}`, padding: '0.6rem 0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>#{n}</strong>
        <span style={{ color: C.dim }}>played {move ?? '—'}</span>
        {tag && <Tag {...tag} />}
      </div>

      {/* Commentary is generated after `move`, so it narrates a decision already
          made — flavor, never the cause. The reasoning below is the real record. */}
      {commentary && (
        <p style={{ margin: '0.4rem 0 0', fontStyle: 'italic' }}>“{commentary}”</p>
      )}

      {!fromModel && (
        <p style={{ margin: '0.4rem 0 0', color: C.threat, fontSize: 12 }}>
          ⚠ Fallback move — the model didn't pick this cell.
        </p>
      )}

      {fromModel && lines?.length > 0 && (
        <details open={defaultOpen} style={{ marginTop: '0.4rem' }}>
          <summary style={{ cursor: 'pointer', color: C.dim, fontSize: 12 }}>reasoning</summary>
          <Reasoning board={board} move={move} lines={lines} winMove={winMove} blockMove={blockMove} />
        </details>
      )}
    </div>
  );
}

function Reasoning({ board, move, lines, winMove, blockMove }) {
  // Only lines with a completed pair are decision-relevant; the rest are noise, so
  // they collapse to a count rather than padding the card with eight rows.
  const loud = lines.filter((l) => lineTag(l));
  const quiet = lines.length - loud.length;

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: '0.5rem' }}>
      <MiniBoard board={board} move={move} />
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.6 }}>
        <div style={{ color: C.dim }}>
          winMove: <Val v={winMove} /> · blockMove: <Val v={blockMove} />
        </div>
        {loud.map((l) => {
          const t = lineTag(l);
          return (
            <div key={l.line.join()}>
              [{l.line.join(',')}] {l.values.join(',')}{' '}
              <span style={{ color: t.color }}>→ {t.text}</span>
            </div>
          );
        })}
        {quiet > 0 && <div style={{ color: C.dim }}>+ {quiet} quiet lines</div>}
      </div>
    </div>
  );
}

// The position as the model saw it, with the cell it chose ringed.
function MiniBoard({ board, move }) {
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

function Tag({ text, color }) {
  return (
    <span style={{ marginLeft: 'auto', color, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
      ● {text}
    </span>
  );
}

function Val({ v }) {
  return <span style={{ color: v === null ? C.dim : C.ink }}>{v === null ? 'null' : v}</span>;
}

// Why this cell: the model took its win, covered a threat, or just played position.
function classify({ move, winMove, blockMove }) {
  if (winMove !== null && move === winMove) return { text: 'WIN', color: C.win };
  if (blockMove !== null && move === blockMove) return { text: 'BLOCK', color: C.threat };
  return null;
}

function lineTag(l) {
  if (l.twos === 2 && l.ones === 0) return { text: 'WIN', color: C.win };
  if (l.ones === 2 && l.twos === 0) return { text: 'THREAT', color: C.threat };
  return null;
}
