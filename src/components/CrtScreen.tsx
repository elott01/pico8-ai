// The CRT filter, drawn over the game by src/lib/crt.ts.
//
// In the cart's page, as a portal into PICO-8's play area, at every size. That's the element that
// goes fullscreen, and nothing in this page can draw over a fullscreen iframe, so being in there
// all along gives the handheld, fullscreen and the phone's overlay one filter, with one context
// that never has to move. It covers the game and not PICO-8's controller, which the overlay needs.
// The site's CSS stops at the iframe, so it brings its own.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GAME_PIXELS, LARGEST_PICTURE, createCrt, watchPace } from '../lib/crt.ts';
import layerCss from '../styles/crt-screen.scss?inline';

export default function CrtScreen({
  frame,
  onOverGame,
}: {
  /** The cart's iframe. */
  frame: HTMLIFrameElement;
  /** Told whether the game is on screen for the filter to cover: not until the cart starts. */
  onOverGame: (over: boolean) => void;
}) {
  const doc = frame.contentDocument;
  const playArea = doc?.getElementById('p8_playarea');
  const game = doc?.getElementById('canvas') as HTMLCanvasElement | null | undefined;
  if (!playArea || !game) return null;

  return createPortal(
    <>
      <style>{layerCss}</style>
      <Tube frame={frame} game={game} onOverGame={onOverGame} />
    </>,
    playArea,
  );
}

// PICO-8 decides where the game goes and how big, and redoes it every frame while it fills the
// screen, for a window that can change under it: a phone turning, or Safari's bars sliding. So this
// follows it the same way, frame by frame, and renders only when something moved.
function Tube({
  frame,
  game,
  onOverGame,
}: {
  frame: HTMLIFrameElement;
  game: HTMLCanvasElement;
  onOverGame: (over: boolean) => void;
}) {
  const tubeRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ x: 0, y: 0, width: 0 });

  useEffect(() => {
    const win = frame.contentWindow;
    const tube = tubeRef.current;
    if (!win || !tube) return;
    const draw = createCrt(tube);
    // Read every frame, so a change in the system's setting takes effect at once.
    const still = win.matchMedia('(prefers-reduced-motion: reduce)');
    const tooSlow = watchPace();
    let over = false;
    let id: number;
    const follow = () => {
      const { x, y, width } = game.getBoundingClientRect();
      setBox((last) => (last.x === x && last.y === y && last.width === width ? last : { x, y, width }));
      if (width > 0) {
        if (!over) {
          over = true;
          onOverGame(true);
        }
        // Device pixels, for dots that land on them. The iframe is laid out full-size even where
        // the handheld is drawn smaller, and a transform is invisible from in here.
        const drawnAt = frame.getBoundingClientRect().width / frame.offsetWidth;
        const size = Math.round(width * drawnAt * win.devicePixelRatio);
        const now = win.performance.now();
        // Too slow for a big picture, it's drawn at LARGEST_PICTURE and the browser enlarges it,
        // for the rest of this tube's life. The attribute says so, for devtools and the specs.
        const slow = tooSlow(now, size > LARGEST_PICTURE);
        if (slow) tube.dataset.pace = 'slow';
        draw?.(game, slow ? Math.min(size, LARGEST_PICTURE) : size, still.matches ? null : now / 1000);
      }
      id = win.requestAnimationFrame(follow);
    };
    follow();
    return () => {
      win.cancelAnimationFrame(id);
      onOverGame(false);
    };
  }, [frame, game, onOverGame]);

  const style = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.width,
    '--crt-px': `${box.width / GAME_PIXELS}px`,
  } as CSSProperties;
  return <canvas ref={tubeRef} className="crt-screen" style={style} aria-hidden="true" />;
}
