// The handheld the cart plays in: the lavender shell, the cart standing in its slot, the
// bezel with its two status lights and the black glass the screen sits in, the printed
// lettering and the keyboard's light, the D-pad and O/X keys with the speaker grille and the
// pause button between them (on a phone's shell, the pause button in the lettering instead),
// the Fullscreen, Eject and CRT buttons, and in the bottom edge CRT's light and the volume
// slider.
//
// Pico8Game owns the cart and passes the screen in as `children`. The D-pad and keys report
// what's held through `onButtons`, as the bitfield in lib/buttons.ts, and Pico8Game hands
// that to the cart. What the keyboard is holding comes back the other way, through
// `keyboardHeld`, only to be drawn: the cart gets those keys for itself. Whether the keyboard
// reaches the cart at all comes back as `keyboardInCart`, and the lettering says so.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { BUTTON } from '../lib/buttons.ts';
import { VOLUME_STEP, toStep } from '../lib/volume.ts';
import styles from './Handheld.module.scss';

export default function Handheld({
  cartName,
  powered,
  thinking,
  canEject,
  onEject,
  onFullscreen,
  crt,
  onCrt,
  volume,
  onVolume,
  onButtons,
  keyboardHeld = 0,
  keyboardInCart = true,
  missedKeys = 0,
  children,
}: {
  /** The cart in the slot, or null when the slot is empty. */
  cartName: string | null;
  /** The cart has booted. Lights POWER, and lets the D-pad and keys press. */
  powered: boolean;
  /** A model call is in flight. Blinks GEMINI. */
  thinking: boolean;
  /** A loaded cart is in the slot, so Eject has something to do. */
  canEject: boolean;
  onEject?: () => void;
  /** The Fullscreen button, which is live whenever POWER is lit. */
  onFullscreen?: () => void;
  /** The CRT filter is over the screen. */
  crt: boolean;
  onCrt: () => void;
  /** The volume slider's setting, in percent, a whole number of VOLUME_STEPs. */
  volume: number;
  onVolume: (percent: number) => void;
  /** Every change to what's held on the D-pad and keys, as player 1's button bits. */
  onButtons?: (held: number) => void;
  /** The button bits the keyboard is holding in the cart, drawn pressed like a click. */
  keyboardHeld?: number;
  /** The cart's window has focus, so keys reach it. While it hasn't and a cart is in, loading
   *  or not, the lettering says to click the screen. Not only once POWER is lit: a switch would
   *  then show the hint, drop it while the next cart loads, and show it again. */
  keyboardInCart?: boolean;
  /** Keys meant for the cart that reached the page instead. Each new one blinks that hint. */
  missedKeys?: number;
  /** The screen. */
  children: ReactNode;
}) {
  // The ref is what's written to the cart, synchronously in the event, so a press lands on
  // the next frame; the state only draws the pressed look.
  const heldRef = useRef(0);
  const [held, setHeld] = useState(0);
  const onButtonsRef = useRef(onButtons);
  onButtonsRef.current = onButtons;

  const update = useCallback((next: number) => {
    heldRef.current = next;
    setHeld(next);
    onButtonsRef.current?.(next);
  }, []);

  // Nothing stays held across a cart change: input that changes during a load is lost, so a
  // button held into the next cart would stay down there (see playwright/README.md).
  useEffect(() => update(0), [cartName, update]);

  // Nor while the tab is hidden, where a release would never arrive.
  useEffect(() => {
    const letGo = () => document.hidden && update(0);
    document.addEventListener('visibilitychange', letGo);
    return () => document.removeEventListener('visibilitychange', letGo);
  }, [update]);

  // The volume slider under a mouse or a finger: the level whose nub would be centred under the
  // pointer, in whole steps. Measured from the drawing, so it holds at 3/4 too.
  const slotRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef(false);
  const slide = (e: PointerEvent<HTMLElement>) => {
    const slot = slotRef.current;
    const nub = slot?.firstElementChild;
    if (!slot || !nub) return;
    const box = slot.getBoundingClientRect();
    const width = nub.getBoundingClientRect().width;
    onVolume(toStep(((e.clientX - box.left - width / 2) / (box.width - width)) * 100));
  };

  const control = (bit: number, className: string, label: string) => ({
    type: 'button' as const,
    className: `${className} ${(held | keyboardHeld) & bit ? styles.held : ''}`,
    'aria-label': label,
    // Out of the tab order: keyboard players have the keys the captions name, and Tab could
    // never reach these anyway, since they come after the cart's iframe, which swallows it.
    tabIndex: -1,
    disabled: !powered,
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      // Captured, so the release arrives here even if the finger slides off. Synthetic
      // pointers can't be captured; a press without capture still works.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // see above
      }
      update(heldRef.current | bit);
    },
    onPointerUp: () => update(heldRef.current & ~bit),
    onPointerCancel: () => update(heldRef.current & ~bit),
    onLostPointerCapture: () => update(heldRef.current & ~bit),
    // A click with no pointer behind it is Enter, Space or a screen reader pressing the
    // button. Tap it: held long enough for the cart to see, a frame being 1/30s at most.
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      if (e.detail !== 0) return;
      update(heldRef.current | bit);
      setTimeout(() => update(heldRef.current & ~bit), 100);
    },
    onMouseDown: keepFocus,
  });

  return (
    <div className={styles.shell}>
      {/* First in the DOM, drawn last (see .actions' order). The cart's iframe swallows Tab,
          so a keyboard user can reach these only before the screen, never after it. */}
      <div className={styles.actions}>
        {/* Named by their icons alone. The name each one says is hidden text, for screen readers
            and the specs, which find them by it. */}
        <button
          type="button"
          className={styles.action}
          // Required for WebKit's tab order; see CartCard.
          tabIndex={0}
          disabled={!powered}
          onClick={onFullscreen}
          onMouseDown={keepFocus}
        >
          <PixelIcon rows={FULLSCREEN_ICON} />
          <span className={styles.name}>Fullscreen</span>
        </button>
        <button
          type="button"
          className={styles.action}
          tabIndex={0}
          disabled={!canEject}
          onClick={onEject}
          onMouseDown={keepFocus}
        >
          <PixelIcon rows={EJECT_ICON} />
          <span className={styles.name}>Eject</span>
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.crtButton}`}
          tabIndex={0}
          aria-pressed={crt}
          onClick={onCrt}
          onMouseDown={keepFocus}
        >
          <PixelIcon rows={CRT_ICON} />
          <span className={styles.name}>CRT</span>
        </button>
        {/* The volume slider, in the shell's bottom edge at the right. The range input is the
            keyboard's and screen readers', hidden from sight. A mouse or a finger drags the
            drawing instead, which leaves focus where it was, as the buttons do. */}
        <span className={styles.volume} style={{ '--volume': volume / 100 } as CSSProperties}>
          {/* Printed on the face, for sight only: the input's own name already says it. */}
          <span className={styles.volumeCaption} aria-hidden="true">
            VOLUME
          </span>
          <input
            className={styles.volumeInput}
            type="range"
            aria-label="Volume"
            aria-valuetext={`${volume}%`}
            min={0}
            max={100}
            step={VOLUME_STEP}
            value={volume}
            tabIndex={0}
            onChange={(e) => onVolume(Number(e.currentTarget.value))}
          />
          <span
            className={styles.volumeGrip}
            aria-hidden="true"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              // Captured, so a drag off the end still moves it; see the D-pad.
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // a synthetic pointer: the press still lands
              }
              draggingRef.current = true;
              slide(e);
            }}
            onPointerMove={(e) => draggingRef.current && slide(e)}
            onPointerUp={() => (draggingRef.current = false)}
            onPointerCancel={() => (draggingRef.current = false)}
            onLostPointerCapture={() => (draggingRef.current = false)}
            onMouseDown={keepFocus}
          >
            <svg className={styles.wedge} width="80" height="8" viewBox="0 0 80 8">
              <polygon points="0,8 80,0 80,8" fill="currentColor" />
            </svg>
            <span ref={slotRef} className={styles.volumeSlot}>
              <span className={styles.volumeNub} />
            </span>
          </span>
        </span>
      </div>
      {/* CRT's light, in the shell's bottom edge under its button. It's lit from the button's own
          aria-pressed (see .edgeLight), so it can't disagree with what a screen reader hears. */}
      <span className={styles.edgeLight} aria-hidden="true" />

      <span className={styles.slot} aria-hidden="true" />
      {/* The cart that's in, standing up out of the slot. The switcher's status line already
          says which cart is loaded, so this is drawn for sight only. */}
      {cartName && (
        <span className={styles.cartTop} aria-hidden="true">
          <span className={styles.cartTopName}>{cartName}</span>
          <span className={styles.ridges}>
            <span />
            <span />
            <span />
          </span>
        </span>
      )}

      <div className={styles.bezel}>
        {/* The panel says "Gemini is thinking…" in words; the lights are its echo. */}
        <div className={styles.status} aria-hidden="true">
          <span className={styles.light}>
            <span className={`${styles.led} ${powered ? styles.power : ''}`} />
            POWER
          </span>
          <span className={styles.light}>
            GEMINI
            <span className={`${styles.led} ${thinking ? styles.gemini : ''}`} />
          </span>
        </div>
        <div className={styles.glass}>{children}</div>
      </div>

      <div className={styles.lettering}>
        <span className={styles.model}>GEMBOY-8</span>
        {/* The keyboard's light, lit while the cart has the keyboard. While it hasn't, the words
            beside it say how to give it back, and a key meant for the cart flashes it. Both lines
            stay in the DOM in one cell, so the swap can't resize the row, and the light comes
            after them, at the edge as GEMINI's is on the bezel, so it stays put whichever shows.
            With the slot empty there's no cart for keys to reach, so it's dark without asking
            for a click. */}
        <span className={`${styles.keysLine} ${cartName !== null && !keyboardInCart ? styles.away : ''}`}>
          <span className={styles.keysWords}>
            <span className={styles.keyboard}>KEYBOARD INPUT</span>
            <span className={styles.reconnect}>CLICK SCREEN</span>
          </span>
          {/* Keyed so each missed key remounts it, which restarts the flash */}
          <span
            key={missedKeys}
            className={`${styles.keyLight} ${cartName !== null && keyboardInCart ? styles.lit : ''} ${missedKeys ? styles.missed : ''}`}
            aria-hidden="true"
          />
        </span>
        {/* The pause button on a phone's shell, which has no room for it between the D-pad and
            the keys. Only under a finger: there's no keyboard, so the keyboard's light isn't
            drawn, and this takes its place. A window that narrow under a mouse shows the light,
            and has P. No caption, since a finger has no key to name. */}
        <span className={styles.phonePause}>
          <button {...control(BUTTON.pause, styles.pauseButton, 'Pause button')}>PAUSE</button>
        </span>
      </div>

      <div className={styles.controls} role="group" aria-label="Cart buttons">
        <div className={styles.control}>
          <div className={styles.dpad}>
            <div className={styles.cross}>
              <button {...control(BUTTON.up, styles.up, 'Up')}>
                <Chevron points="3,9 7,5 11,9" />
              </button>
              <button {...control(BUTTON.left, styles.left, 'Left')}>
                <Chevron points="9,3 5,7 9,11" />
              </button>
              <button {...control(BUTTON.right, styles.right, 'Right')}>
                <Chevron points="5,3 9,7 5,11" />
              </button>
              <button {...control(BUTTON.down, styles.down, 'Down')}>
                <Chevron points="3,5 7,9 11,5" />
              </button>
            </div>
          </div>
          <span className={styles.caption}>OR ARROW KEYS</span>
        </div>
        {/* Its face says PAUSE as O's says O, and its caption names the key, as theirs do. Only
            P: Enter pauses too, but pressed while the page has focus, it presses whatever button
            has focus, such as the cart just picked. */}
        <div className={styles.middle}>
          <Grille />
          <button {...control(BUTTON.pause, styles.pauseButton, 'Pause button')}>PAUSE</button>
          <span className={styles.caption}>OR P</span>
        </div>
        <div className={styles.keys}>
          <div className={`${styles.control} ${styles.low}`}>
            <button {...control(BUTTON.o, styles.key, 'O button')}>O</button>
            <span className={styles.caption}>OR Z</span>
          </div>
          <div className={`${styles.control} ${styles.high}`}>
            <button {...control(BUTTON.x, styles.key, 'X button')}>X</button>
            <span className={styles.caption}>OR X</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Every button on the handheld leaves focus where it was when the mouse presses it, usually in
// the cart, so its keys still work afterwards. Any that took focus would also flash the
// lettering's CLICK SCREEN for as long as it was held: Eject and Fullscreen did, before emptying
// the slot or handing focus back. Enter and Space still press one that Tab has focused. The
// volume slider's drawing does the same.
function keepFocus(e: MouseEvent<HTMLElement>) {
  e.preventDefault();
}

function Chevron({ points }: { points: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={points} />
    </svg>
  );
}

// The bottom row's icons, drawn on a 9 x 9 grid in 2px pixels: the same pixel as the 16px
// Silkscreen lettering on the shell. Each X is a pixel.
const FULLSCREEN_ICON = [
  'XXX...XXX',
  'X.......X',
  'X.......X',
  '.........',
  '.........',
  '.........',
  'X.......X',
  'X.......X',
  'XXX...XXX',
];

const EJECT_ICON = [
  '.........',
  '....X....',
  '...XXX...',
  '..XXXXX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  '.........',
  'XXXXXXXXX',
  'XXXXXXXXX',
];

// A television, its screen in scanlines
const CRT_ICON = [
  '..X...X..',
  '...X.X...',
  '.XXXXXXX.',
  'X.......X',
  'X.XXXXX.X',
  'X.......X',
  'X.XXXXX.X',
  'X.......X',
  '.XXXXXXX.',
];

function PixelIcon({ rows }: { rows: string[] }) {
  const width = rows[0]!.length;
  const path = rows
    .flatMap((row, y) => [...row].map((pixel, x) => (pixel === 'X' ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      aria-hidden="true"
      width={width * 2}
      height={rows.length * 2}
      viewBox={`0 0 ${width} ${rows.length}`}
      fill="currentColor"
      shapeRendering="crispEdges"
    >
      <path d={path} />
    </svg>
  );
}

// The speaker grille between the D-pad and the keys, above the pause button, for the look: rows
// of 3, 4, 5, 4 and 3 holes, each a dark hole over a lighter rim two pixels lower, so it reads
// as punched in. 9px holes 18 x 14 apart, 82 x 68 in all. With the button and its caption under
// it, the column is 128px tall, shorter than the D-pad and its caption, so the row, and the
// shell, keep their height. Past 162px it would make --device-height wrong.
const GRILLE_ROWS = [3, 4, 5, 4, 3];

function Grille() {
  const holes = GRILLE_ROWS.flatMap((count, row) =>
    Array.from({ length: count }, (_, i) => ({ x: 41 + (i - (count - 1) / 2) * 18, y: 5 + row * 14 })),
  );
  return (
    <svg className={styles.grille} aria-hidden="true" width="82" height="68" viewBox="0 0 82 68">
      {holes.map(({ x, y }) => (
        <g key={`${x},${y}`}>
          <circle className={styles.rim} cx={x} cy={y + 2} r={4.5} />
          <circle className={styles.hole} cx={x} cy={y} r={4.5} />
        </g>
      ))}
    </svg>
  );
}
