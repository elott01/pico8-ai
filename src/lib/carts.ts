// Display metadata for each cart: what it is called and how it is described, on its
// cartridge and in the Gemini panel before the first call.
//
// Kept out of gpio.ts on purpose. That module is the byte-protocol source of truth, and
// marketing copy has no business next to byte offsets — but both are keyed by cart id, and
// typing this as Record<CartId, …> makes a missing entry a compile error the moment a cart
// is added. Same trick GAMES in api/_games.ts uses.

import type { CartId } from './gpio.ts';

/**
 * What the Gemini panel says before a cart's first call: what to do, then what each card
 * will hold. It describes the cards and never mocks one, since the panel may only show as
 * evidence what the model produced (CLAUDE.md). So it promises only what the card renders:
 * if a cart's analysis fields change in `spec.analysis()` (api/_games.ts), or a card gains
 * or loses a section, the cart's intro changes with it.
 */
export type PanelIntro = {
  /** What the player does to bring on the first call. Hidden while Gemini thinks, since by
   *  then they have done it. */
  action: string;
  /** What the panel records, leading into `shows`. Stays up until the first card, so it
   *  can't start with the action already done. */
  lead: string;
  /** One item per part of a card, in the card's order. `label` is the card's own heading
   *  for that part, so the first real card is recognisable from this. */
  shows: { label?: string; text: string }[];
};

export type CartMeta = {
  /** Shown on the cartridge label. */
  name: string;
  /** One line under it — what makes this cart worth playing against an LLM. */
  tagline: string;
  panel: PanelIntro;
};

export const CARTS: Record<CartId, CartMeta> = {
  tic_tac_toe: {
    name: 'Tic-Tac-Toe',
    tagline: '3×3 · solved by minimax',
    panel: {
      action: 'Make your first move.',
      lead: "Gemini plays O's, and each of its turns lands here:",
      shows: [
        { text: 'the cell it played, and a line of commentary' },
        {
          label: 'reasoning',
          text: 'the board it was shown, and its read of every line: where it could win, and where it had to block',
        },
        {
          text: 'if Gemini fails or picks a taken cell, the built-in solver plays instead, and the turn card says so',
        },
      ],
    },
  },
  connect_four: {
    name: 'Connect Four',
    tagline: '7×6 · no cheap perfect play',
    panel: {
      action: 'Drop your first piece.',
      lead: 'Gemini plays second, and each of its turns lands here:',
      shows: [
        { text: 'the column it played, and a line of commentary' },
        // Not "the threats it found": the threat lines are computed in api/_connect_four.ts
        // and handed to the model, so only its sentence is its own.
        {
          label: 'reasoning',
          text: 'the board it was shown, and why it chose that column, in one sentence of its own',
        },
        {
          text: 'if Gemini fails or picks a full column, the built-in solver plays instead, and the turn card says so',
        },
      ],
    },
  },
  gemini: {
    name: 'Gem-in-Eye',
    tagline: 'dungeon + shop · the shopkeeper talks back',
    panel: {
      action: 'Buy something in the shop.',
      lead: 'Each sale lands here, once gem-in-eye has sized you up, set the price and had his say:',
      shows: [
        { text: 'what you bought, what he charged against the list price, and his verdict on you' },
        { text: 'his speech, every page of it' },
        { label: 'noticed', text: 'what stood out to him in your numbers' },
        { label: 'what he was shown', text: 'the stats from your run that he judged' },
        {
          text: 'if Gemini fails, the shop sells at list price with a line of its own, and the turn card says so',
        },
      ],
    },
  },
};

/** The panel with no cart in the device. Generic, because nothing cart-specific is true yet. */
export const NO_CART_PANEL: PanelIntro = {
  action: 'Insert a cart to start a game.',
  lead: 'Whichever you pick, this panel records each call Gemini makes: what it was shown and what it answered, so you can see a real model made it.',
  shows: [],
};

/**
 * Render order for the switcher. Explicit, because object key order is not a design decision.
 * The first is also the cart in the device when the page opens.
 */
export const CART_ORDER: CartId[] = ['gemini', 'connect_four', 'tic_tac_toe'];
