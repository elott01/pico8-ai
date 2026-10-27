// Display metadata for the cart switcher: what a cart is called and how it is described.
//
// Kept out of gpio.ts on purpose. That module is the byte-protocol source of truth, and
// marketing copy has no business next to byte offsets — but both are keyed by cart id, and
// typing this as Record<CartId, …> makes a missing entry a compile error the moment a cart
// is added. Same trick GAMES in api/_games.ts uses.

import type { CartId } from './gpio.ts';

export type CartMeta = {
  /** Shown on the cartridge label. */
  name: string;
  /** One line under it — what makes this cart worth playing against an LLM. */
  tagline: string;
};

export const CARTS: Record<CartId, CartMeta> = {
  tic_tac_toe: {
    name: 'Tic-Tac-Toe',
    tagline: '3×3 · solved by minimax',
  },
  connect_four: {
    name: 'Connect Four',
    tagline: '7×6 · no cheap perfect play',
  },
  gemini: {
    name: 'Gem-in-Eye',
    tagline: 'dungeon + shop · the shopkeeper talks back',
  },
};

/** Render order for the switcher. Explicit, because object key order is not a design decision. */
export const CART_ORDER: CartId[] = ['tic_tac_toe', 'connect_four', 'gemini'];
