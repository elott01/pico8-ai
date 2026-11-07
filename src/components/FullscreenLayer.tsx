// What's drawn over the game in real fullscreen: the mouse's way out. Keyboard players have Esc.
//
// It has to live inside the cart's page. A popover in this page does draw over the fullscreen
// iframe, but no click reaches it: while the iframe is fullscreen, it takes them all. So this is
// a portal into PICO-8's play area, the element that's actually fullscreen. The site's CSS stops
// at the iframe, so it brings its own, along with the font, which that page doesn't have.
//
// The phone's overlay isn't real fullscreen, so its Exit stays in the page (see Pico8Game).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import fontCss from '@fontsource/silkscreen/latin-400.css?inline';
import layerCss from '../styles/fullscreen-layer.scss?inline';

// How long Exit stays once the mouse stops moving.
const SHOWN_MS = 2500;

export default function FullscreenLayer({
  frame,
  onExit,
}: {
  /** The cart's iframe, which fills the screen for as long as this is mounted. */
  frame: HTMLIFrameElement;
  onExit: () => void;
}) {
  const playArea = frame.contentDocument?.getElementById('p8_playarea');
  if (!playArea) return null;

  return createPortal(
    <>
      <style>{fontCss + layerCss}</style>
      <ExitButton frame={frame} onExit={onExit} />
    </>,
    playArea,
  );
}

function ExitButton({ frame, onExit }: { frame: HTMLIFrameElement; onExit: () => void }) {
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

  return (
    <button
      type="button"
      className={`fullscreen-exit ${shown ? 'shown' : ''}`}
      // Out of the tab order like the D-pad: the cart swallows Tab, and Esc is the key for this.
      tabIndex={-1}
      onClick={onExit}
    >
      Exit
    </button>
  );
}
