// GPIO bridge between the page and the PICO-8 carts, and the source of truth for the
// byte protocol — each cart's Lua half must match the descriptor here.
//
// The web export mirrors the cart's 128 GPIO bytes into a plain JS array declared on
// the *iframe's* window, so it is reached via contentWindow.pico8_gpio, not the top
// window. The cart pokes and peeks; the page does the networking the cart cannot.
//
// Two carts now share the handshake but not the layout, so the per-cart parts live in
// PROTOCOLS rather than as module constants. Nothing outside this file should hardcode a
// byte offset or a board size: that is how the page and a cart drift apart silently, and
// tests/gpio-protocol.test.ts checks both carts' Lua against these values.

import type { GameId, ShopItem, Verdict } from '../../api/_types.ts';

export const ST_IDLE = 0;
export const ST_REQUEST = 1;
export const ST_THINKING = 2;
export const ST_READY = 3;

/** Byte 0 in every cart. The one offset that is not per-cart. */
export const IDX_STATUS = 0;

// Any value the cart does not accept as a move trips its own fallback opponent. 255 is
// unmistakably not a cell or a column, and is outside both carts' accepted ranges.
export const NO_MOVE = 255;

export type Status = typeof ST_IDLE | typeof ST_REQUEST | typeof ST_THINKING | typeof ST_READY;

/** One board square: 0 empty, 1 human, 2 AI. */
export type Cell = 0 | 1 | 2;

/** The board cells in GPIO order — row-major from the top-left, in both carts. */
export type Board = Cell[];

/** The cart's 128 GPIO bytes, mirrored by the web export as a plain JS array. */
export type Gpio = number[];

// Imported rather than redeclared: the id now travels to /api/move in the request body,
// so it is part of the wire contract and _types.ts owns it. A local copy here would be a
// second definition of one concept — the drift this repo keeps paying for.
export type BoardCartId = GameId;

/** Carts whose GPIO carries talk rather than a board: gem-in-eye's shop. Not a GameId,
 *  because /api/move never sees it — it talks to /api/talk. */
export type TalkCartId = 'gemini';

export type CartId = BoardCartId | TalkCartId;

/**
 * What a move value names.
 *
 * Tic-tac-toe moves name the cell to fill. Connect Four moves name a *column* and gravity
 * picks the row, so the page never chooses a cell — which is why legality and the panel's
 * highlight both have to go through `landingCell` rather than indexing the board directly.
 */
export type MoveUnit = 'cell' | 'column';

export type Protocol = {
  readonly id: CartId;
  /** First board byte. */
  readonly idxBoard: number;
  /** How many board bytes follow it. */
  readonly cells: number;
  readonly cols: number;
  readonly rows: number;
  /** The dual-meaning move byte: page writes a request, cart overwrites it with the truth. */
  readonly idxMove: number;
  /** Highest move value the cart accepts. The lowest is always 0. */
  readonly maxMove: number;
  readonly moveUnit: MoveUnit;
};

export const PROTOCOLS: Record<BoardCartId, Protocol> = {
  tic_tac_toe: {
    id: 'tic_tac_toe',
    idxBoard: 1,
    cells: 9,
    cols: 3,
    rows: 3,
    idxMove: 10,
    maxMove: 8,
    moveUnit: 'cell',
  },
  connect_four: {
    id: 'connect_four',
    idxBoard: 1,
    cells: 42,
    cols: 7,
    rows: 6,
    idxMove: 43,
    maxMove: 6,
    moveUnit: 'column',
  },
};

export function isBoardCart(id: CartId): id is BoardCartId {
  return id in PROTOCOLS;
}

export function isCartId(id: string): id is CartId {
  return id in PROTOCOLS || id in TALK_PROTOCOLS;
}

declare global {
  interface Window {
    // Declared by the PICO-8 web export inside the iframe, so it is absent until the
    // cart has loaded.
    pico8_gpio?: Gpio;
  }
}

export function readBoard(gpio: Gpio, p: Protocol): Board {
  const board: Board = [];
  // The cart only ever writes 0..2 to these bytes, so narrowing to Cell is an assertion
  // about the cart's half of the protocol (checked by tests/gpio-protocol.test.ts), not
  // a runtime guard.
  for (let i = 0; i < p.cells; i++) board.push((gpio[p.idxBoard + i] | 0) as Cell);
  return board;
}

/**
 * The board index a move would fill, or null if the move is not playable.
 *
 * One function rather than a legality check plus a separate index calculation, because
 * the two would encode the same rule twice and could disagree — the panel would then ring
 * a cell the cart never filled.
 */
export function landingCell(board: Board, move: number, p: Protocol): number | null {
  if (!Number.isInteger(move) || move < 0 || move > p.maxMove) return null;

  if (p.moveUnit === 'cell') return board[move] === 0 ? move : null;

  // A column: the disc falls to the lowest empty row. The wire is row-major from the
  // TOP, so the bottom row is the last one and the search runs upward from there.
  for (let row = p.rows - 1; row >= 0; row--) {
    const i = row * p.cols + move;
    if (board[i] === 0) return i;
  }
  return null; // column full
}

export function isLegalMove(board: Board, move: number, p: Protocol): boolean {
  return landingCell(board, move, p) !== null;
}

// ---- talk carts -------------------------------------------------------------------------
//
// gem-in-eye's shop, carts/gemini.p8. Same byte 0 and the same four-state handshake, but the
// payload is the agent's record going up and a page of speech coming down. A purchase is
// one /api/talk call; every later page is served from memory with no call at all.
// Constants in the cart: the gp_* lines, which tests/gpio-protocol.test.ts parses back.

export type TalkProtocol = {
  readonly id: TalkCartId;
  // cart -> page. The first three are 16-bit, low byte first (the cart's poke2).
  readonly idxPruned: number;
  readonly idxRollbacks: number;
  readonly idxUptime: number;
  readonly idxMaxDepth: number;
  readonly idxDepth: number;
  readonly idxPurse: number;
  readonly idxStash: number;
  /** Five bytes, one tier per item, in `items` order. */
  readonly idxTiers: number;
  readonly idxOccasion: number;
  /** 1-based index into `items`. */
  readonly idxItem: number;
  readonly idxTier: number;
  readonly idxList: number;
  // page -> cart
  readonly idxVerdict: number;
  /** The page's quote; the cart overwrites it with the price it actually charged. */
  readonly idxPrice: number;
  readonly idxFlags: number;
  /** The page's page length; the cart writes 0 back if it showed its own line instead. */
  readonly idxLen: number;
  readonly idxText: number;
  /** Text bytes available: idxText to the end of the block. */
  readonly maxText: number;
  readonly occasionPurchase: number;
  readonly occasionNext: number;
  /** Flags bit: more pages follow this one. */
  readonly flagMore: number;
  /** The cart's `shop` order. Over GPIO an item is its 1-based position here. */
  readonly items: readonly ShopItem[];
  /** Index i+1 is the byte for verdicts[i]; 0 means no verdict. */
  readonly verdicts: readonly Verdict[];
};

export const TALK_PROTOCOLS: Record<TalkCartId, TalkProtocol> = {
  gemini: {
    id: 'gemini',
    idxPruned: 1,
    idxRollbacks: 3,
    idxUptime: 5,
    idxMaxDepth: 7,
    idxDepth: 8,
    idxPurse: 9,
    idxStash: 10,
    idxTiers: 11,
    idxOccasion: 16,
    idxItem: 17,
    idxTier: 18,
    idxList: 19,
    idxVerdict: 24,
    idxPrice: 25,
    idxFlags: 26,
    idxLen: 27,
    idxText: 28,
    maxText: 100,
    occasionPurchase: 2,
    occasionNext: 3,
    flagMore: 1,
    items: ['vitality', 'stamina', 'armor', 'attack', 'stash'],
    verdicts: ['impressed', 'neutral', 'unimpressed'],
  },
};

const u16 = (gpio: Gpio, i: number) => ((gpio[i] | 0) & 0xff) | (((gpio[i + 1] | 0) & 0xff) << 8);

/** The agent's record, as the cart publishes it on a purchase. */
export type TalkStatsBytes = {
  pruned: number;
  rollbacks: number;
  uptimeSec: number;
  maxDepth: number;
  lastDepth: number;
  purse: number;
  stashed: number;
  tiers: Record<ShopItem, number>;
};

export type TalkCall =
  | { occasion: 'purchase'; item: ShopItem; tier: number; listPrice: number; stats: TalkStatsBytes }
  | { occasion: 'next' };

/** What the cart is asking for, or null for an occasion this page does not know. */
export function readTalkCall(gpio: Gpio, p: TalkProtocol): TalkCall | null {
  const occasion = gpio[p.idxOccasion];
  if (occasion === p.occasionNext) return { occasion: 'next' };
  if (occasion !== p.occasionPurchase) return null;

  const item = p.items[gpio[p.idxItem] - 1];
  if (!item) return null;
  const tiers = Object.fromEntries(p.items.map((it, i) => [it, gpio[p.idxTiers + i] | 0])) as Record<ShopItem, number>;
  return {
    occasion: 'purchase',
    item,
    tier: gpio[p.idxTier] | 0,
    listPrice: gpio[p.idxList] | 0,
    stats: {
      pruned: u16(gpio, p.idxPruned),
      rollbacks: u16(gpio, p.idxRollbacks),
      uptimeSec: u16(gpio, p.idxUptime),
      maxDepth: gpio[p.idxMaxDepth] | 0,
      lastDepth: gpio[p.idxDepth] | 0,
      purse: gpio[p.idxPurse] | 0,
      stashed: gpio[p.idxStash] | 0,
      tiers,
    },
  };
}

/**
 * Write one page of reply. Does NOT touch the status byte: the caller sets ST_READY after,
 * because the payload has to land before the flag, as in the game carts.
 *
 * Text is printable ASCII by the time it gets here (the server cleans it), but this is the
 * last line of defence before bytes reach the cart, so anything else is dropped and the
 * page is clamped to the bytes available. An empty page is length 0: the cart's fallback.
 */
export function writeTalkPage(
  gpio: Gpio,
  p: TalkProtocol,
  page: { text: string; verdict?: Verdict | null; price?: number | null; more?: boolean },
): number {
  const text = page.text.replace(/[^\x20-\x7e]/g, '').slice(0, p.maxText);
  gpio[p.idxVerdict] = page.verdict ? p.verdicts.indexOf(page.verdict) + 1 : 0;
  gpio[p.idxPrice] = page.price ?? 0; // 0 = no quote: the cart charges list
  gpio[p.idxFlags] = page.more ? p.flagMore : 0;
  for (let i = 0; i < text.length; i++) gpio[p.idxText + i] = text.charCodeAt(i);
  gpio[p.idxLen] = text.length;
  return text.length;
}

/** After the cart returns to idle on a purchase: what it charged, and whether it printed
 *  the page's speech or its own line. */
export function readTalkBack(gpio: Gpio, p: TalkProtocol): { charged: number; showedSpeech: boolean } {
  return { charged: gpio[p.idxPrice] | 0, showedSpeech: (gpio[p.idxLen] | 0) > 0 };
}
