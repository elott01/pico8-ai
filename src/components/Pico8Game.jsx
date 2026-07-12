import { useEffect, useRef, useState } from 'react';
import { IDX_STATUS, IDX_MOVE, ST_REQUEST, ST_THINKING, ST_READY, readBoard } from '../lib/gpio.js';
import { getAiMove, validateMove } from '../lib/ai.js';

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

  useEffect(() => {
    setStatus('loading');
  }, [game]);

  // GPIO poll loop: the cart's half of the protocol lives in Lua (tic_tac_toe.p8);
  // this is the page's half. The exported shell declares `pico8_gpio` on the
  // iframe's window and the runtime mirrors the cart's GPIO memory to it. When the
  // cart wants a move it writes the board into bytes 1..9 and sets byte 0 = REQUEST;
  // we answer via /api/move and write the move (byte 10) + set byte 0 = READY.
  useEffect(() => {
    let busy = false; // one request in flight at a time (getAiMove is async)
    const id = setInterval(async () => {
      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously so the cart stops re-requesting
      try {
        const board = readBoard(gpio);
        const move = validateMove(await getAiMove(board), board); // legal cell 0..8, or null if full
        gpio[IDX_MOVE] = move ?? 0;
        gpio[IDX_STATUS] = ST_READY;
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
          margin: '0 auto',
        }}
      />
    </div>
  );
}
