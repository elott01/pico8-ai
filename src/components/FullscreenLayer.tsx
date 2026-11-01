// What's drawn over the game in fullscreen: the CRT filter, if the player chose it, and the
// mouse's way out. Keyboard players have Esc.
//
// Both have to live inside the cart's page. A popover in this page does draw over the fullscreen
// iframe, but no click reaches it: while the iframe is fullscreen, it takes them all. And the
// handheld's filter is behind the iframe altogether. So this is a portal into PICO-8's play area,
// the element that's actually fullscreen. The site's CSS stops at the iframe, so it brings its
// own, along with the font, which that page doesn't have.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import fontCss from '@fontsource/silkscreen/latin-400.css?inline';
import layerCss from '../styles/fullscreen-layer.scss?inline';

// How long Exit stays once the mouse stops moving.
const SHOWN_MS = 2500;

// PICO-8's screen is this many pixels across, whatever size it's drawn.
const GAME_PIXELS = 128;

export default function FullscreenLayer({
  frame,
  crt,
  onExit,
}: {
  /** The cart's iframe, which is fullscreen for as long as this is mounted. */
  frame: HTMLIFrameElement;
  /** The player's CRT choice, carried over from the handheld. */
  crt: boolean;
  onExit: () => void;
}) {
  const [shown, setShown] = useState(true);

  // Shows on arrival and whenever the mouse moves, then fades, leaving only the game on screen.
  // In fullscreen the mouse is over the cart's page, so that's where its moves land.
  useEffect(() => {
    const win = frame.contentWindow;
    if (!win) return;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), SHOWN_MS);
    };
    show();
    win.addEventListener('mousemove', show);
    return () => {
      clearTimeout(timer);
      win.removeEventListener('mousemove', show);
    };
  }, [frame]);

  const doc = frame.contentDocument;
  const playArea = doc?.getElementById('p8_playarea');
  const canvas = doc?.getElementById('canvas');
  if (!playArea || !canvas) return null;

  return createPortal(
    <>
      <style>{fontCss + layerCss}</style>
      {crt && <CrtFilter canvas={canvas} />}
      <button
        type="button"
        className={`fullscreen-exit ${shown ? 'shown' : ''}`}
        // Out of the tab order like the D-pad: the cart swallows Tab, and Esc is the key for this.
        tabIndex={-1}
        onClick={onExit}
      >
        Exit
      </button>
    </>,
    playArea,
  );
}

// The filter, the size of the game. PICO-8 picks that size, the largest multiple of 128 that fits
// the window, so it's followed rather than assumed: a window can change while fullscreen. The
// observer comes from the canvas's own window, since that's the document it's watching.
function CrtFilter({ canvas }: { canvas: HTMLElement }) {
  const [size, setSize] = useState(canvas.offsetWidth);

  useEffect(() => {
    const win = canvas.ownerDocument.defaultView;
    if (!win) return;
    const observer = new win.ResizeObserver(() => setSize(canvas.offsetWidth));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  const style = { width: size, height: size, '--crt-px': `${size / GAME_PIXELS}px` } as CSSProperties;
  return <div className="fullscreen-crt" style={style} aria-hidden="true" />;
}
