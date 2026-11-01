// The handheld the cart plays in: the lavender shell, the cart standing in its slot, the
// bezel with its two status lights, the printed lettering, the D-pad and O/X keys, and Eject.
//
// Pico8Game owns the cart and passes the screen in as `children`. The D-pad and keys report
// what's held through `onButtons`, as the bitfield in lib/buttons.ts, and Pico8Game hands
// that to the cart. What the keyboard is holding comes back the other way, through
// `keyboardHeld`, only to be drawn: the cart gets those keys for itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { BUTTON } from '../lib/buttons.ts';
import styles from './Handheld.module.scss';

export default function Handheld({
  cartName,
  powered,
  thinking,
  canEject,
  onEject,
  onButtons,
  keyboardHeld = 0,
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
  /** Every change to what's held on the D-pad and keys, as player 1's button bits. */
  onButtons?: (held: number) => void;
  /** The button bits the keyboard is holding in the cart, drawn pressed like a click. */
  keyboardHeld?: number;
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
    // Keeps focus where it was, usually in the cart, so its keys still work after a press here.
    onMouseDown: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault(),
  });

  return (
    <div className={styles.shell}>
      {/* First in the DOM, drawn last (see .eject's order). The cart's iframe swallows Tab,
          so a keyboard user can reach Eject only before the screen, never after it. */}
      <button
        type="button"
        className={styles.eject}
        // Required for WebKit's tab order; see CartCard.
        tabIndex={0}
        disabled={!canEject}
        onClick={onEject}
      >
        Eject
      </button>

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
        {children}
      </div>

      <div className={styles.lettering}>
        <span className={styles.model}>PICO-8 + GEMINI</span>
        <span>P · PAUSE MENU</span>
      </div>

      <div className={styles.controls} role="group" aria-label="Cart buttons">
        <div className={styles.control}>
          <div className={styles.dpad}>
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
          <span className={styles.caption}>OR ARROW KEYS</span>
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

function Chevron({ points }: { points: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={points} />
    </svg>
  );
}
