// One selectable cartridge in the switcher: grey plastic, three grip ridges, and a sticker
// showing the cart's own label, the picture saved in its .p8. The image is
// public/labels/<cart>.png, which tests/cart-labels.test.ts keeps level with the cart.
//
// A real <button>, not a div with handlers: that buys the focus ring, Enter/Space, and
// screen-reader semantics for free. Anything like drag-to-insert goes on top of this as an
// affordance over a working button, never as the only way to switch, because drag-only
// excludes keyboard and screen-reader users entirely.

import type { CartId } from '../lib/gpio.ts';
import { CARTS } from '../lib/carts.ts';
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
      {/* Drawn even while this cart is in the device, only hidden, so the outline it leaves
          on the shelf is exactly a cartridge's size. */}
      <span className={styles.ridges} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className={styles.sticker}>
        <img className={styles.label} src={`/labels/${id}.png`} alt="" width={128} height={128} />
        <span className={styles.name}>{meta.name}</span>
        <span className={styles.tagline}>{meta.tagline}</span>
      </span>
      {selected && (
        <span className={styles.slot}>
          <span className={styles.slotName}>{meta.name}</span>
          <span className={styles.slotNote}>in the device</span>
        </span>
      )}
    </button>
  );
}
