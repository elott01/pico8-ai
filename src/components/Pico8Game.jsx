import { useEffect, useRef, useState } from 'react';
import { initGpio, IDX_STATUS, IDX_MOVE, ST_REQUEST, ST_THINKING, ST_READY } from '../lib/gpio.js';
import { getAiMove, validateMove } from '../lib/ai.js';

// Embeds a PICO-8 web cart and bridges its GPIO memory to the /api/move proxy.
//
// Flow each frame:
//   cart writes board + sets status=REQUEST
//   -> we ack (THINKING), read the board, call the proxy, validate the move
//   -> write the move + set status=READY; the cart plays it and resets to IDLE.
export default function Pico8Game({ game }) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'missing'

  useEffect(() => {
    const gpio = initGpio(); // must exist before the player runtime loads

    // Poll the GPIO status byte and service AI-move requests.
    const loop = setInterval(async () => {
      if (gpio[IDX_STATUS] === ST_REQUEST) {
        gpio[IDX_STATUS] = ST_THINKING; // ack so the cart can show "thinking…"
        const board = gpio.slice(1, 10);
        let move = await getAiMove(board);
        move = validateMove(move, board); // never write an illegal move
        if (move != null) gpio[IDX_MOVE] = move;
        gpio[IDX_STATUS] = ST_READY;
      }
    }, 100);

    // Inject the exported cart's runtime. It draws into <canvas id="canvas">.
    const script = document.createElement('script');
    script.src = `/games/${game}.js`;
    script.async = true;
    script.onload = () => setStatus('ready');
    script.onerror = () => setStatus('missing'); // no cart exported yet
    document.body.appendChild(script);

    return () => {
      clearInterval(loop);
      script.remove();
      // PICO-8's runtime uses fixed globals; a full teardown is fiddly, so we
      // reload/navigate between games rather than swapping carts in place.
    };
  }, [game]);

  return (
    <div>
      {status === 'missing' && (
        <p style={{ color: '#b00', maxWidth: 480, margin: '1rem auto' }}>
          No cart found at <code>/games/{game}.js</code>. Export a PICO-8 game to{' '}
          <code>public/games/</code> (Phase 1) to play.
        </p>
      )}
      {/* PICO-8 web export looks for a canvas with this exact id. */}
      <canvas
        id="canvas"
        ref={canvasRef}
        style={{ display: status === 'missing' ? 'none' : 'block', margin: '0 auto' }}
      />
    </div>
  );
}
