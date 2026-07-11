import { useEffect, useRef, useState } from 'react';

// Embeds a PICO-8 web cart via an <iframe> pointing at its exported .html.
//
// Why an iframe: a PICO-8 web export isn't a bare script — its .js renders into
// Module.canvas and expects the shell's setup (start button, layout, audio-context
// gating). Loading the exported .html gives us that shell verbatim, so the cart
// "just works." It's same-origin, so we can still reach the cart's GPIO memory
// via iframeRef.current.contentWindow.pico8_gpio when we wire the AI (Step 4).
export default function Pico8Game({ game }) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'missing'

  // TODO(step-4): once the cart has GPIO code, poll
  // iframeRef.current.contentWindow.pico8_gpio here — ack requests, read the
  // board, call getAiMove()/validateMove(), write the move back. See
  // src/lib/gpio.js + src/lib/ai.js and webapp-build-steps.md Step 4.
  useEffect(() => {
    setStatus('loading');
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
