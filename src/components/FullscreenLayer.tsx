// What's drawn over the game while it fills the screen: the CRT filter, if the player chose it,
// and in real fullscreen the mouse's way out. Keyboard players have Esc.
//
// Both have to live inside the cart's page. A popover in this page does draw over the fullscreen
// iframe, but no click reaches it: while the iframe is fullscreen, it takes them all. And the
// handheld's filter is behind the iframe altogether. So this is a portal into PICO-8's play area,
// the element that's actually fullscreen. The site's CSS stops at the iframe, so it brings its
// own, along with the font, which that page doesn't have.
//
// The phone's overlay isn't real fullscreen, so its Exit stays in the page (see Pico8Game), but
// its filter still comes through here, to sit over the game and not PICO-8's controller.

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
  /** The cart's iframe, which fills the screen for as long as this is mounted. */
  frame: HTMLIFrameElement;
  /** The player's CRT choice, carried over from the handheld. */
  crt: boolean;
  /** Draws Exit. Left off, the way out is someone else's. */
  onExit?: () => void;
}) {
  const doc = frame.contentDocument;
  const playArea = doc?.getElementById('p8_playarea');
  const canvas = doc?.getElementById('canvas');
  if (!playArea || !canvas) return null;

  return createPortal(
    <>
      <style>{fontCss + layerCss}</style>
      {crt && <CrtFilter canvas={canvas} />}
      {onExit && <ExitButton frame={frame} onExit={onExit} />}
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

// The filter, exactly over the game. PICO-8 decides where that is and how big, and redoes it
// every frame while it fills the screen, for a window that can change under it: a phone turning,
// or Safari's bars sliding. So this follows it the same way, frame by frame, and renders only
// when something moved.
function CrtFilter({ canvas }: { canvas: HTMLElement }) {
  const [box, setBox] = useState({ x: 0, y: 0, width: 0 });

  useEffect(() => {
    const win = canvas.ownerDocument.defaultView;
    if (!win) return;
    let id: number;
    const follow = () => {
      const { x, y, width } = canvas.getBoundingClientRect();
      setBox((last) => (last.x === x && last.y === y && last.width === width ? last : { x, y, width }));
      id = win.requestAnimationFrame(follow);
    };
    follow();
    return () => win.cancelAnimationFrame(id);
  }, [canvas]);

  const style = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.width,
    '--crt-px': `${box.width / GAME_PIXELS}px`,
  } as CSSProperties;
  return <div className="fullscreen-crt" style={style} aria-hidden="true" />;
}
