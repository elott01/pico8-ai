// One selectable cartridge in the switcher.
//
// A real <button>, not a div with handlers: that buys the focus ring, Enter/Space, and
// screen-reader semantics for free. Phase 2 layers dragging on top of this — the plan
// treats drag as an affordance over a working button, never as the only way to switch,
// because drag-only excludes keyboard and screen-reader users entirely.

import { PROTOCOLS } from '../lib/gpio.ts';
import type { CartId } from '../lib/gpio.ts';
import { CARTS } from '../lib/carts.ts';
import MiniBoard, { emptyBoard } from './MiniBoard.tsx';
import styles from './CartCard.module.scss';

export default function CartCard({
  id,
  selected,
  busy,
  onSelect,
}: {
  id: CartId;
  selected: boolean;
  /** A switch is already in flight; further clicks would race two iframe loads. */
  busy: boolean;
  onSelect: (id: CartId) => void;
}) {
  const meta = CARTS[id];
  const protocol = PROTOCOLS[id];

  return (
    <button
      type="button"
      className={`${styles.cart} ${selected ? styles.selected : ''}`}
      // aria-pressed rather than aria-selected: these are toggle buttons, not tabs or
      // listbox options, and a wrong role is worse than none.
      // Explicit tabIndex, which looks redundant on a <button> and is not: WebKit omits
      // buttons and links from the tab order unless macOS keyboard navigation is switched
      // on, so on default Safari this control is unreachable by keyboard without it.
      // Verified in Playwright's WebKit — Tab cycled iframe/body only until this was added.
      tabIndex={0}
      aria-pressed={selected}
      disabled={busy && !selected}
      onClick={() => !selected && onSelect(id)}
    >
      <span className={styles.label}>
        {/* The board shape IS the label art — an empty 3x3 beside an empty 7x6 says which
            game faster than the name does. Real PICO-8 cart labels are phase 2; they need
            a Ctrl-7 capture and a decode step, and the HTML export drops them anyway. */}
        <MiniBoard board={emptyBoard(protocol)} protocol={protocol} size="9px" />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{meta.name}</span>
        <span className={styles.tagline}>{meta.tagline}</span>
      </span>
    </button>
  );
}
