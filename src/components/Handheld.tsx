// The handheld the cart plays in: the lavender shell, the cart standing in its slot, the
// bezel with its two status lights, the printed lettering, the D-pad and O/X keys, and Eject.
//
// Pico8Game owns the cart and passes the screen in as `children`. The D-pad and keys are
// hidden from assistive tech until they press the cart's buttons; until then they would be
// controls that do nothing.

import type { ReactNode } from 'react';
import styles from './Handheld.module.scss';

export default function Handheld({
  cartName,
  powered,
  thinking,
  canEject,
  onEject,
  children,
}: {
  /** The cart in the slot, or null when the slot is empty. */
  cartName: string | null;
  /** The cart has booted. Lights POWER. */
  powered: boolean;
  /** A model call is in flight. Blinks GEMINI. */
  thinking: boolean;
  /** A loaded cart is in the slot, so Eject has something to do. */
  canEject: boolean;
  onEject?: () => void;
  /** The screen. */
  children: ReactNode;
}) {
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

      <div className={styles.controls} aria-hidden="true">
        <div className={styles.control}>
          <div className={styles.dpad}>
            <span className={styles.up}>
              <Chevron points="3,9 7,5 11,9" />
            </span>
            <span className={styles.left}>
              <Chevron points="9,3 5,7 9,11" />
            </span>
            <span className={styles.centre} />
            <span className={styles.right}>
              <Chevron points="5,3 9,7 5,11" />
            </span>
            <span className={styles.down}>
              <Chevron points="3,5 7,9 11,5" />
            </span>
          </div>
          <span className={styles.caption}>OR ARROW KEYS</span>
        </div>
        <div className={styles.keys}>
          <div className={`${styles.control} ${styles.low}`}>
            <span className={styles.key}>O</span>
            <span className={styles.caption}>OR Z</span>
          </div>
          <div className={`${styles.control} ${styles.high}`}>
            <span className={styles.key}>X</span>
            <span className={styles.caption}>OR X</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron({ points }: { points: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={points} />
    </svg>
  );
}
