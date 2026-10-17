// The /api/move wire contract, owned by the endpoint that produces it and imported by
// the client that consumes it. Underscore-prefixed so Vercel treats it as a helper rather
// than a route.
//
// Before this existed, `api/move.js` and `src/lib/ai.ts` each described this shape by
// hand and drifted — the client declared `emptyCell` while the server sent `emptyCells`,
// which typechecked, tested and built clean and was only caught by reading a live
// response. One definition makes that class of drift a compile error.

/**
 * Which cart is asking. Part of the wire now, so it is owned here rather than in
 * src/lib/gpio.ts — two names for one concept is how the halves drift.
 *
 * The request may omit it, in which case the endpoint assumes tic-tac-toe. That keeps a
 * stale client working, and a mismatched board length is a 400 rather than a board quietly
 * read as the wrong game.
 */
export type GameId = 'tic_tac_toe' | 'connect_four';

/** One board square as it travels over the wire: 0 empty, 1 human, 2 AI. */
export type Cell = 0 | 1 | 2;

/** The 9 cells, row-major. Kept separate from gpio.ts's Board on purpose: that one
 *  describes bytes read out of the cart, this one describes JSON on the wire. */
export type Board = Cell[];

/** One of the 8 winning lines, as scored by the model in its own analysis. */
export type Line = {
  line: number[];
  values: number[];
  ones: number;
  twos: number;
  emptyCells?: number[];
};

/** What the model is asked to return. Every field is its own output so it never has to
 *  do the arithmetic in its head — see buildPrompt in _prompt.ts. */
export type ModelReply = {
  // Connect Four constrains `move` with a schema enum, and Gemini enums are strings — so
  // this arrives as "3" there and 3 in tic-tac-toe. Each game's spec parses it.
  move?: number | string | null;
  winMove?: number | null;
  blockMove?: number | null;
  lines?: Line[];
  legalCells?: number[];
  /** Connect Four's one-sentence account of the rule it applied. Tic-tac-toe has none —
   *  its reasoning is the structured `lines` array instead. */
  reasoning?: string | null;
  commentary?: string | null;
};

// A 200 does NOT guarantee a move: the endpoint answers 200 with `move: null` when the
// model returned nothing usable, and 200 with a bare `move` on the no-key branch.
// Analysis fields are per-game and all optional: tic-tac-toe fills lines/winMove/blockMove,
// Connect Four fills `reasoning`, and neither sends the other's. The client must not assume
// a field is present because a previous turn had it.
export type MoveSuccess = {
  move: number | null;
  winMove?: number | null;
  blockMove?: number | null;
  lines?: Line[];
  reasoning?: string | null;
  commentary?: string | null;
};

/** 429. `retryAfter` is seconds, and is mirrored in the Retry-After header. */
export type MoveRateLimited = {
  move: null;
  rateLimited: true;
  retryAfter: number;
};

/** 400/403/405. */
export type MoveError = { error: string };

export type MoveResponse = MoveSuccess | MoveRateLimited | MoveError;

// ---- /api/talk: gem-in-eye, the shopkeeper in carts/gemini.p8 ----------------------------
//
// A second contract beside /api/move rather than another GameSpec: a line of dialogue has
// no legal set and no right answer, so a move-shaped contract would be half empty. Owned
// here for the same reason as the move types — the endpoint and the page must break
// together.

/** The five things gem-in-eye sells, in the cart's `shop` order — which is also the order
 *  the tiers travel in over GPIO. */
export type ShopItem = 'vitality' | 'stamina' | 'armor' | 'attack' | 'stash';

/** The agent's record, as the cart reports it at the moment of a purchase. */
export type TalkStats = {
  pruned: number;
  rollbacks: number;
  /** Seconds since the cart started. Resets on reload; wraps at 32767 (about 9 hours). */
  uptimeSec: number;
  maxDepth: number;
  /** How deep the most recent run got. 0 before the first run. */
  lastDepth: number;
  /** Tokens carried. Lost on a rollback. */
  purse: number;
  /** Tokens in the hub's safe. Survives rollbacks. */
  stashed: number;
  /** Tiers owned, 0-3 each. */
  tiers: Record<ShopItem, number>;
};

export type TalkPurchase = {
  item: ShopItem;
  /** The tier being bought: one above the tier owned. */
  tier: 1 | 2 | 3;
  listPrice: number;
};

/** What the page remembers between purchases, in localStorage. The cart remembers nothing. */
export type TalkMemory = {
  /** gem-in-eye's last few speeches, oldest first. */
  lastSpeeches: string[];
  /** The stats at the previous call, or null on the first. */
  lastStats: TalkStats | null;
  /** The cart restarted since lastStats, so a drop in every stat is a new agent. */
  newSession: boolean;
  /** Stable across calls: +1 per rollback and per new session. Each rollback is an agent
   *  killed, so the old agents are the numbers below this one. */
  agentNumber: number;
};

export type TalkRequest = {
  /** Only purchases call Gemini in v1. 'enter' is reserved for a generated greeting. */
  occasion: 'purchase';
  purchase: TalkPurchase;
  stats: TalkStats;
  memory: TalkMemory;
};

export type Verdict = 'impressed' | 'neutral' | 'unimpressed';

/** What the model is asked to return, in this generation order: the judgement, then the
 *  deal, then the words, so the speech is conditioned on both. `notice` exists only in the
 *  bench variant that tests whether naming what stands out first improves the speech. */
export type TalkModelReply = {
  notice?: string | null;
  verdict?: string | null;
  price?: number | string | null;
  speech?: string | null;
};

/**
 * 200. Everything is null when the server fell back; a null `price` alone means "charge
 * list". `pages` is the cleaned speech already split to the cart's own wrap — 1 to 3
 * pages of at most 3 lines, each small enough for one GPIO handshake. `notice` is the
 * model's own line about what stood out in the numbers: generated, so the panel can show
 * it as evidence, and never sent to the cart.
 */
export type TalkSuccess = {
  verdict: Verdict | null;
  price: number | null;
  pages: string[] | null;
  notice: string | null;
};

/** 429, the same shape and header as /api/move's. */
export type TalkRateLimited = {
  verdict: null;
  price: null;
  pages: null;
  notice: null;
  rateLimited: true;
  retryAfter: number;
};

export type TalkResponse = TalkSuccess | TalkRateLimited | MoveError;
