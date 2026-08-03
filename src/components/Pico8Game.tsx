import { useEffect, useRef, useState } from 'react';
import { IDX_STATUS, IDX_MOVE, ST_IDLE, ST_REQUEST, ST_THINKING, ST_READY, NO_MOVE, readBoard } from '../lib/gpio.ts';
import type { Board, Gpio } from '../lib/gpio.ts';
import { getAiTurn } from '../lib/ai.ts';
import type { AiTurn } from '../lib/ai.ts';
import TurnPanel from './TurnPanel.tsx';
import type { Turn } from './TurnPanel.tsx';

type CartStatus = 'loading' | 'ready' | 'missing';

// The cart is embedded as its exported .html in an iframe rather than by injecting the
// .js: the export expects its own shell (canvas wiring, start button, audio gating), and
// loading the .html gets that verbatim. Same-origin, so the cart's GPIO memory stays
// reachable at contentWindow.pico8_gpio.
export default function Pico8Game({ game }: { game: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<CartStatus>('loading');
  const [turns, setTurns] = useState<Turn[]>([]);

  useEffect(() => {
    setStatus('loading');
    setTurns([]); // analysis from the previous cart would be misleading
  }, [game]);

  // The page's half of the GPIO protocol; the cart's half is in tic_tac_toe.p8 and the
  // byte layout is documented in lib/gpio.ts.
  useEffect(() => {
    let busy = false;
    let pausedUntil = 0; // epoch ms; while in the future we are rate-limited
    const id = setInterval(async () => {
      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously, or the cart keeps re-requesting
      try {
        const board = readBoard(gpio);

        // While rate-limited, skip the API entirely — it would only 429 again — but still
        // answer the cart so the game never hangs.
        let ai: AiTurn;
        if (Date.now() < pausedUntil) {
          ai = { move: null, reason: 'rate-limited' };
        } else {
          ai = await getAiTurn(board);
          if (ai.reason === 'rate-limited') {
            const wait = Math.min(Math.max(ai.retryAfter ?? 60, 5), 15 * 60); // clamped: a bad value must not wedge the game
            pausedUntil = Date.now() + wait * 1000;
          }
        }

        // Narrowing once here is what keeps the analysis fields below unreachable on a
        // turn the model did not decide.
        const analysis = ai.reason === null ? ai : null;

        // A legal model move gets played; anything else sends NO_MOVE so the cart falls
        // back to its own minimax rather than the page inventing a move.
        const modelMove =
          analysis !== null && Number.isInteger(analysis.move) && board[analysis.move!] === 0
            ? analysis.move
            : null;
        gpio[IDX_MOVE] = modelMove ?? NO_MOVE;
        gpio[IDX_STATUS] = ST_READY;

        const played = await readCartPlayedMove(gpio);

        setTurns((prev) => {
          // Marks only accumulate within a game, so fewer filled cells than last turn
          // means the cart started a new one.
          const last = prev[prev.length - 1];
          const history = last && filled(board) < filled(last.board) ? [] : prev;
          return [
            ...history,
            {
              n: history.length + 1,
              board,
              move: played, // what the cart played
              intended: Number.isInteger(ai.move) ? ai.move : null, // what the model asked for
              lines: analysis?.lines ?? [],
              winMove: analysis?.winMove ?? null,
              blockMove: analysis?.blockMove ?? null,
              commentary: analysis?.commentary ?? null,
              reason: ai.reason,
              // Only true when the model's own move is the one that got played, so the
              // panel can never credit it with a move the cart substituted.
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

function filled(board: Board) {
  return board.filter((c) => c !== 0).length;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The cart writes the cell it actually played to IDX_MOVE and only then returns to idle,
// so both conditions have to hold before the value can be trusted — otherwise we read the
// NO_MOVE sentinel we just wrote. The timeout is an upper bound, not a wait: a normal turn
// resolves in ~20ms, but the first AI turn of a game has taken ~1.6s to get here.
async function readCartPlayedMove(gpio: Gpio, timeoutMs = 3500): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gpio[IDX_STATUS] === ST_IDLE) {
      const cell = gpio[IDX_MOVE];
      if (cell >= 0 && cell <= 8) return cell;
    }
    await sleep(16);
  }
  return null; // no cart listening, or it never wrote a cell; the panel shows no move
}
