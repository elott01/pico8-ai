// Display metadata for the cart switcher: what a cart is called and how it is described.
//
// Kept out of gpio.ts on purpose. That module is the byte-protocol source of truth, and
// marketing copy has no business next to byte offsets — but both are keyed by GameId, and
// typing this as Record<GameId, …> makes a missing entry a compile error the moment a third
// cart is added. Same trick GAMES in api/_games.ts uses.

import type { GameId } from '../../api/_types.ts';

export type CartMeta = {
  /** Shown on the cartridge label. */
  name: string;
  /** One line under it — what makes this cart worth playing against an LLM. */
  tagline: string;
};

export const CARTS: Record<GameId, CartMeta> = {
  tic_tac_toe: {
    name: 'Tic-Tac-Toe',
    tagline: '3×3 · solved by minimax',
  },
  connect_four: {
    name: 'Connect Four',
    tagline: '7×6 · no cheap perfect play',
  },
};

/** Render order for the switcher. Explicit, because object key order is not a design decision. */
export const CART_ORDER: GameId[] = ['tic_tac_toe', 'connect_four'];
