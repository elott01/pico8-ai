# GPIO bridge — how the cart and the page talk

A PICO-8 cart cannot make network calls. It has no sockets, no HTTP, no way to reach an
LLM — so the AI opponent has to be driven from outside the cart entirely, across four
layers:

```
cart (Lua) ⇄ pico8_gpio (128 bytes) ⇄ React poll loop ⇄ /api/move ⇄ Gemini
```

Everything interesting happens at that second arrow. Two processes with no shared clock, no
callbacks and no events have to agree on whose turn it is to write, using nothing but a
128-byte block of memory both can see. This document is the walkthrough of that handshake.

**Read this when** touching [src/lib/gpio.ts](../src/lib/gpio.ts),
[carts/tic_tac_toe.p8](../carts/tic_tac_toe.p8) or
[carts/connect_four.p8](../carts/connect_four.p8) (`update_ai` / `request_web_move`), or the
poll loop in [src/components/Pico8Game.tsx](../src/components/Pico8Game.tsx).

**Not covered here:** prompt construction, rate limiting, and quota accounting. Those live
in [api/move.ts](../api/move.ts) and [api/_ratelimit.ts](../api/_ratelimit.ts).

**Source of truth:** [src/lib/gpio.ts](../src/lib/gpio.ts) declares both layouts, one
`PROTOCOLS` entry per cart. The Lua constants in each `.p8` are a hand-maintained copy —
nothing at runtime enforces that they agree, so
[tests/gpio-protocol.test.ts](../tests/gpio-protocol.test.ts) parses them back out of the
Lua and checks them against `PROTOCOLS` for **both** carts. This document is the prose
version; `gpio.ts` wins if they ever disagree.

**Connect Four is wired end to end and playable.** `gpio.ts` and `Pico8Game.tsx` speak its
protocol — 42 board bytes, a column at byte 43, gravity resolved by `landingCell` — and
`/api/move` serves it through `api/_games.ts`, with its own prompt, its own decoding schema
and its own analysis fields. `App.tsx` is currently pinned to `connect_four` to measure real
play; the switcher that makes it a choice is planned in `cart-switcher-plan.md`.

The request carries `game` explicitly and the endpoint checks the board length against it,
so a mismatch is a 400 rather than 42 cells quietly read as a 9-cell board.

*Last verified 2026-08-18.*

---

## What the GPIO actually is

PICO-8 exposes 128 bytes of "general purpose I/O" at `0x5f80..0x5fff`. On the desktop these
map to real hardware pins; in the **web export** the runtime mirrors that block into a plain
JS array on the iframe's window, synced both directions every frame.

- Cart side: `poke(gpio+n, v)` / `peek(gpio+n)` where `gpio = 0x5f80`
- Page side: `iframe.contentWindow.pico8_gpio[n]` — the *iframe's* window, not the top one

It is a 128-byte shared mailbox. That is the entire vocabulary between the two halves: no
callbacks, no events, just two processes polling bytes at each other.

## Byte layout

Two carts share the handshake but not the layout. Byte 0 means the same thing in both;
everything after it differs, so a page-side reader has to know which cart it is talking to.

### Tic-tac-toe — 9 cells, move at byte 10

| Byte | Meaning | Written by |
|---|---|---|
| 0 | status: `0` idle · `1` request · `2` thinking · `3` ready | both, alternating |
| 1–9 | board cells: `0` empty, `1` human, `2` AI | cart only |
| 10 | a cell index, 0-based — **two different meanings**, see below | both |
| 11–127 | unused (117 spare bytes) | — |

Two indexing quirks that bite when editing this code:

- **Board bytes are 1-based, the move byte is 0-based.** The cart's `board` table is `1..9`
  and pokes straight to bytes `1..9`, so those offsets line up for free. Byte 10 is 0-based
  to match JS. Hence `cell = m + 1` on read
  ([:175](../carts/tic_tac_toe.p8#L175)) and `poke(gpio+gp_move, cell-1)` on write
  ([:186](../carts/tic_tac_toe.p8#L186)).
- **`255` (`NO_MOVE`) is the "I have nothing" sentinel.** Any value outside 0–8 trips the
  cart's fallback; 255 is just unmistakably not a cell index.

### Connect Four — 42 cells, move at byte 43

| Byte | Meaning | Written by |
|---|---|---|
| 0 | status: the same four states as above | both, alternating |
| 1–42 | board cells, row-major **from the top-left**: `index = 1 + row_from_top*7 + col_from_left`, both 0-based. Values `0` empty, `1` human, `2` AI | cart only |
| 43 | a **column** index, 0-based — same two-meanings rule as byte 10 | both |
| 44–127 | unused (84 spare bytes) | — |

Constants at [connect_four.p8:195-198](../carts/connect_four.p8#L195-L198). Three
differences from tic-tac-toe matter:

- **A move names a column, not a cell.** Gravity picks the row, so the page never chooses
  one, and legality is "column not full". The cart re-checks the page's column with
  `legal(m+1)` before trusting it ([:247](../carts/connect_four.p8#L247)).
- **The wire is row-major from the top; the cart's own board is column-major from the
  bottom.** That transform lives in `publish_board()`
  ([:210-216](../carts/connect_four.p8#L210-L216)) and nowhere else. Open-coding it a second
  time is the most likely way to introduce a silent bug in this cart — the board would still
  look plausible, just transposed or flipped.
- **Any column above 6 means "play your own fallback"**, filling the role `255` plays for
  tic-tac-toe. The page is expected to keep using `NO_MOVE = 255`, which satisfies that.

**The fallback is a heuristic here, not a solver.** Tic-tac-toe falls back to exact minimax,
which is free at 9 cells. Connect Four has no cheap perfect play, so the cart uses one-ply
tactics — take the win, block theirs, avoid handing the opponent the cell directly above,
else centre-out ([:150-183](../carts/connect_four.p8#L150-L183)). It is deliberately weak: it
exists for availability, and a fallback strong enough to be interesting would undermine the
claim that the LLM is the player.

That weakness is load-bearing in a way it is not for tic-tac-toe, because a game is 15–20 AI
turns rather than ~4, so any per-turn failure rate compounds.

**Now measured, over live play.** Our own stack costs a flat ~210ms; the rest is Gemini, and
its latency has a fat tail — median ~1.5s, but 29% of calls over 5s and ~7% over the old 10s
abort. That is roughly one timeout-driven fallback turn per game. The response was to widen
the client budget to 12s, **not** to strengthen the cart: the lever for this is the abort
budget or the panel's labelling, both page-side. A fallback strong enough to be interesting
would undermine the claim that the LLM is the player.

## The status byte is a four-state handshake

Neither side can interrupt the other, so byte 0 is a baton passed in a fixed cycle:

```
cart: 0 → 1   "board is published, I need a move"
page: 1 → 2   "seen it, I'm working"          ← ack
page: 2 → 3   "byte 10 holds your answer"
cart: 3 → 0   "byte 10 now holds what I played"
```

**The ack is load-bearing in both directions.**

The page writes it *synchronously*, before any `await`
([Pico8Game.tsx:41](../src/components/Pico8Game.tsx#L41)). Otherwise the next 100ms poll
tick would still see `ST_REQUEST` standing and fire a second Gemini call for the same turn.

The cart uses it to tell two failure modes apart
([tic_tac_toe.p8:169](../carts/tic_tac_toe.p8#L169)):

- **No ack within 15 frames (~0.5s)** → nobody is listening; the cart was opened in desktop
  PICO-8. Play minimax immediately rather than making the user wait.
- **Acked but no answer within 450 frames (~15s)** → the page stalled. Play minimax
  reluctantly. Only a dead page should ever reach this.

## Byte 10 carries two different values in one handshake

This is the part that is not obvious from either file alone. The page writes byte 10 as
*"play this"*; the cart overwrites it with *"here is what I actually played"* before
releasing the baton. Same byte, opposite direction, one handshake.

Byte 43 works identically in Connect Four
([:258-262](../carts/connect_four.p8#L258-L262)), and for the same reason — read the rest of
this section as describing both.

It exists because request and outcome can diverge: the page may send `NO_MOVE`, the model may
name an occupied cell, or the cart may have already timed out and self-played. Without the
read-back the panel would credit the LLM with a move minimax made.

Two ordering rules keep it correct:

- **Cart writes move before status**
  ([:186-187](../carts/tic_tac_toe.p8#L186-L187)). The page treats `status === IDLE` as the
  signal that byte 10 is trustworthy, so the payload has to land before the flag.
- **Page requires both conditions** — `status === ST_IDLE` *and* `0 ≤ byte10 ≤ 8`
  ([Pico8Game.tsx:148-150](../src/components/Pico8Game.tsx#L148-L150)). Checking only the
  range reads back the `255` it just wrote itself; checking neither reads back its own
  suggestion and credits the model for a cell the cart substituted.

## End to end: one human move to one AI move

1. **Human plays — GPIO is not involved.** `_update` reads the buttons, `place(cursor)`
   stamps `board[cursor] = 1`, `check_win()` runs, `turn` flips to 2
   ([:258-265](../carts/tic_tac_toe.p8#L258-L265)). Human moves are pure cart logic.

2. **Cart requests.** Next frame `turn == 2` routes to `update_ai()` → `request_web_move()`:
   pokes all 9 cells into bytes 1–9, sets status `1`, marks itself `waiting`
   ([:151-157](../carts/tic_tac_toe.p8#L151-L157)). It then spins one frame at a time drawing
   "cpu thinking…", doing nothing but incrementing `ai_frames`.

3. **Page picks it up.** The 100ms poll sees `gpio[0] === 1`, sets a local `busy` latch,
   writes status `2`, and `readBoard()` copies bytes 1–9 into a 0-indexed JS array
   ([gpio.ts:47](../src/lib/gpio.ts#L47)).

4. **Page calls the API.** `getAiTurn(board, game)` POSTs to `/api/move` with a 12s abort
   ([ai.ts:46](../src/lib/ai.ts#L46)). It always resolves to an object, never throws —
   `reason` carries `null` / `'rate-limited'` / `'timeout'` / `'error'`.

5. **Server does the real work.** [api/move.ts](../api/move.ts): same-origin check, rate
   limit, board validation, then `askGemini` — quota reservation *inside* the retry loop,
   JSON-mode generation at temp 0.1, up to 3 attempts on 503/429, plus one correction retry
   if the model names an occupied cell. Returns
   `{move, winMove, blockMove, lines, commentary}`.

6. **Page validates and writes.** Only a move that is both legal and came back clean survives
   ([:68-70](../src/components/Pico8Game.tsx#L68-L70)); anything else becomes `NO_MOVE`.
   Byte 10 gets the value, then status goes to `3`.

7. **Cart consumes.** `peek(gpio+10)`; if it is 0–8 and that cell is empty, play it —
   otherwise `best_move(board, 2)`, the local minimax
   ([:171-183](../carts/tic_tac_toe.p8#L171-L183)). Then overwrite byte 10 with `cell-1`,
   drop status to `0`, and `place(cell)`, which flips the turn back to the human.

8. **Page reads back.** `readCartPlayedMove` has been polling at 16ms; it now sees idle plus a
   valid cell and returns it. The turn record stores `move` (what happened) separately from
   `intended` (what the model asked for), and sets `fromModel` only when those agree
   ([:96](../src/components/Pico8Game.tsx#L96)).

9. **Panel renders.** [TurnPanel.tsx](../src/components/TurnPanel.tsx) gates the WIN/BLOCK tag
   and the reasoning dropdown on `fromModel`; when it is false it shows a `fallbackNote`
   naming the actual cause — rate limit in amber, genuine failures in red.

## Where the flavour text lives — not in GPIO

`commentary` never touches the bridge. 128 bytes could not hold much of a sentence, and the
cart has no use for it anyway: it is not drawing prose on a 128×128 screen. The text takes a
separate path entirely:

```
Gemini → /api/move JSON → getAiTurn → React setTurns → TurnPanel DOM
```

It renders in the sidebar *next to* the iframe, not inside it. **GPIO carries exactly two
things: a board snapshot going out, and one cell index coming back.**

The commentary is still constrained, just not by bytes. In
[buildPrompt](../api/_prompt.ts) the JSON key order is deliberate — tokens generate in
sequence, so each field is conditioned on the ones above it, and `commentary` sits **last,
after `move`**. It narrates a decision already made rather than participating in it. Move it
above `move` and flavour text starts steering the game.

## Timing chain

| Bound | Value | Where |
|---|---|---|
| Page poll interval | 100ms | `Pico8Game.tsx` |
| Read-back poll / ceiling | 16ms / 3500ms | `readCartPlayedMove` |
| Page request timeout | 12s | `getAiTurn`, `ai.ts` |
| Cart no-ack fallback | 15 frames (~0.5s) | `ai_ack_frames` |
| Cart stall fallback | 450 frames (~15s) | `ai_max_frames` |

The ordering `10s < 15s` is the invariant: the page must always get to answer, because if the
cart gives up first it self-plays and the read-back finds nothing to report.

Both carts use the same two frame budgets. Connect Four adds one constraint: its drop
animation must not run inside the `ai_max_frames` window, or the timeout budget quietly
shrinks by the animation length on every turn.

## This doc is stale if…

- a cart's Lua constants and its `PROTOCOLS` entry no longer agree (the protocol test
  catches this, so a red suite is the signal — not a careful reading of this file)
- a third cart joins, which should mean one `GAMES` entry and one `PROTOCOLS` entry — if it
  also needs an edit inside `move.ts`, that dispatch table has stopped doing its job
- byte 11+ is used by tic-tac-toe, byte 44+ by Connect Four, or a third cart joins
- `getAiTurn`'s timeout rises to meet `ai_max_frames`
- `commentary` starts crossing the bridge instead of arriving over HTTP
- the Connect Four fallback rate gets measured, or its fallback stops being one-ply
