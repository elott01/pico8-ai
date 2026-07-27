import { useEffect, useRef, useState } from 'react';
import { IDX_STATUS, IDX_MOVE, ST_IDLE, ST_REQUEST, ST_THINKING, ST_READY, NO_MOVE, readBoard } from '../lib/gpio.js';
import { getAiTurn } from '../lib/ai.js';
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
    let pausedUntil = 0; // epoch ms; while in the future we're rate-limited and skip the API
    const id = setInterval(async () => {
      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously so the cart stops re-requesting
      try {
        const board = readBoard(gpio);

        // While rate-limited, don't call the API at all — it would only 429 again. We
        // still answer the cart so the game never hangs; the panel explains why the
        // move isn't the model's.
        let ai;
        if (Date.now() < pausedUntil) {
          ai = { move: null, reason: 'rate-limited' };
        } else {
          ai = await getAiTurn(board);
          if (ai.reason === 'rate-limited') {
            // Honour Retry-After, clamped so a bad value can't wedge the game.
            const wait = Math.min(Math.max(ai.retryAfter ?? 60, 5), 15 * 60);
            pausedUntil = Date.now() + wait * 1000;
          }
        }

        // If the model gave a legal cell, ask the cart to play it. Otherwise send NO_MOVE
        // and let the cart play its own (unbeatable) minimax — better than a random cell.
        const modelMove =
          ai?.reason == null && Number.isInteger(ai?.move) && board[ai.move] === 0 ? ai.move : null;
        gpio[IDX_MOVE] = modelMove ?? NO_MOVE;
        gpio[IDX_STATUS] = ST_READY;

        // The cart plays (our move or its own minimax), writes the cell it ACTUALLY
        // played back to byte 10, and returns to idle. Read that back so the panel shows
        // the real move even on fallback turns.
        const played = await readCartPlayedMove(gpio);

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
              move: played, // cell the cart actually played, read back from GPIO (0..8 or null)
              intended: Number.isInteger(ai?.move) ? ai.move : null, // what the model asked for
              lines: ai?.lines ?? [],
              winMove: ai?.winMove ?? null,
              blockMove: ai?.blockMove ?? null,
              commentary: ai?.commentary ?? null,
              reason: ai?.reason ?? null, // why there's no model move, if there isn't one
              // true only when the model's own move is the one that got played
              fromModel: modelMove !== null && played === modelMove,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// After we set READY, the cart consumes the move, plays it (or its own minimax when we
// sent NO_MOVE), writes the cell it ACTUALLY played back to IDX_MOVE, then returns
// status to IDLE. Poll for that release and read the played cell (0..8), or null if the
// cart never releases (e.g. no cart listening) or wrote back a non-cell. Bounded at
// ~500ms so a non-listening cart can't wedge the poll loop — the cart normally releases
// within a frame or two at 30fps.
// timeout is an upper bound only — the loop returns the instant the cart gives a valid
// cell (normal turns ~20ms). The first AI turn of a game has been seen to take ~1.6s to
// reach this point, so the ceiling sits well above that for margin; it only matters if
// the cart never responds at all.
async function readCartPlayedMove(gpio, timeoutMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // The cart pokes the played cell to byte 10, THEN flips to idle. Wait for BOTH —
    // idle status AND a cell in range — so we never give up mid-handshake or read the
    // NO_MOVE sentinel we wrote. The first AI turn of a game can take several hundred ms
    // to reach this point (turn-transition frames), which is why the wait is generous;
    // a normal turn still returns within a frame or two.
    if (gpio[IDX_STATUS] === ST_IDLE) {
      const cell = gpio[IDX_MOVE];
      if (cell >= 0 && cell <= 8) return cell;
    }
    await sleep(16); // ~1 frame at 60fps
  }
  return null; // cart never returned a valid cell in time (rare); panel shows no cell
}
