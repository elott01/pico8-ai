import { useEffect, useRef, useState } from 'react';
import { IDX_STATUS, IDX_MOVE, ST_REQUEST, ST_THINKING, ST_READY, readBoard } from '../lib/gpio.js';
import { getAiTurn, validateMove } from '../lib/ai.js';
import TurnPanel from './TurnPanel.jsx';

// Embeds a PICO-8 web cart via an <iframe> pointing at its exported .html.
//
// Why an iframe: a PICO-8 web export isn't a bare script — its .js renders into
// Module.canvas and expects the shell's setup (start button, layout, audio-context
// gating). Loading the exported .html gives us that shell verbatim, so the cart
// "just works." It's same-origin, so we reach the cart's GPIO memory via
// iframeRef.current.contentWindow.pico8_gpio to run the AI.
export default function Pico8Game({ game }) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'missing'
  const [turns, setTurns] = useState([]); // AI turn history: the model's analysis + what it played

  useEffect(() => {
    setStatus('loading');
    setTurns([]); // stale analysis from the previous cart would be misleading
  }, [game]);

  // GPIO poll loop: the cart's half of the protocol lives in Lua (tic_tac_toe.p8);
  // this is the page's half. The exported shell declares `pico8_gpio` on the
  // iframe's window and the runtime mirrors the cart's GPIO memory to it. When the
  // cart wants a move it writes the board into bytes 1..9 and sets byte 0 = REQUEST;
  // we answer via /api/move and write the move (byte 10) + set byte 0 = READY.
  useEffect(() => {
    let busy = false; // one request in flight at a time (getAiTurn is async)
    const id = setInterval(async () => {
      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously so the cart stops re-requesting
      try {
        const board = readBoard(gpio);
        const ai = await getAiTurn(board); // null if the call failed/timed out
        const move = validateMove(ai?.move, board); // legal cell 0..8, or null if full
        gpio[IDX_MOVE] = move ?? 0;
        gpio[IDX_STATUS] = ST_READY;

        // Record what actually happened: `move` is the cell played, which differs from
        // ai.move when validateMove had to fall back — so the panel never credits the
        // model with a move it didn't make.
        setTurns((prev) => {
          // The cart resets the board on a new game; marks only ever accumulate within
          // one game, so a drop in filled cells means "start a fresh history".
          const last = prev[prev.length - 1];
          const history = last && filled(board) < filled(last.board) ? [] : prev;
          return [
            ...history,
            {
              n: history.length + 1,
              board,
              move, // the cell actually played (may be a validateMove fallback)
              intended: Number.isInteger(ai?.move) ? ai.move : null, // what the model asked for
              lines: ai?.lines ?? [],
              winMove: ai?.winMove ?? null,
              blockMove: ai?.blockMove ?? null,
              commentary: ai?.commentary ?? null,
              fromModel: Number.isInteger(ai?.move) && ai.move === move,
            },
          ];
        });
      } finally {
        busy = false;
      }
    }, 100);
    return () => clearInterval(id);
  }, [game]);

  const src = `/games/${game}.html`;

  return (
    <div>
      {status === 'missing' && (
        <p style={{ color: '#b00', maxWidth: 480, margin: '1rem auto' }}>
          No cart found at <code>{src}</code>. Export a PICO-8 game to{' '}
          <code>public/games/</code> to play.
        </p>
      )}
      {/* Cart and panel side by side; wraps to stacked on narrow screens. */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          justifyContent: 'center',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={game}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('missing')}
          style={{
            display: status === 'missing' ? 'none' : 'block',
            border: 0,
            width: 'min(90vw, 640px)',
            height: 'min(90vw, 640px)',
          }}
        />
        {status !== 'missing' && <TurnPanel turns={turns} />}
      </div>
    </div>
  );
}

// How many cells are occupied — used to detect a board reset between games.
function filled(board) {
  return board.filter((c) => c !== 0).length;
}
