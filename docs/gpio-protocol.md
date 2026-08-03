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
[carts/tic_tac_toe.p8](../carts/tic_tac_toe.p8) (`update_ai` / `request_web_move`), or the
poll loop in [src/components/Pico8Game.tsx](../src/components/Pico8Game.tsx).

**Not covered here:** prompt construction, rate limiting, and quota accounting. Those live
in [api/move.js](../api/move.js) and [api/_ratelimit.js](../api/_ratelimit.js).

**Source of truth:** [src/lib/gpio.ts](../src/lib/gpio.ts) declares the protocol. The Lua
constants at [tic_tac_toe.p8:138-141](../carts/tic_tac_toe.p8#L138-L141) are a
hand-maintained copy — nothing enforces that they agree, so a mismatch fails silently.

*Last verified 2026-08-02.*

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
([Pico8Game.tsx:35](../src/components/Pico8Game.tsx#L35)). Otherwise the next 100ms poll
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

4. **Page calls the API.** `getAiTurn(board)` POSTs to `/api/move` with a 10s abort
   ([ai.ts:46](../src/lib/ai.ts#L46)). It always resolves to an object, never throws —
   `reason` carries `null` / `'rate-limited'` / `'timeout'` / `'error'`.

5. **Server does the real work.** [api/move.js](../api/move.js): same-origin check, rate
   limit, board validation, then `askGemini` — quota reservation *inside* the retry loop,
   JSON-mode generation at temp 0.1, up to 3 attempts on 503/429, plus one correction retry
   if the model names an occupied cell. Returns
   `{move, winMove, blockMove, lines, commentary}`.

6. **Page validates and writes.** Only a move that is both legal and came back clean survives
   ([:58-60](../src/components/Pico8Game.tsx#L58-L60)); anything else becomes `NO_MOVE`.
   Byte 10 gets the value, then status goes to `3`.

7. **Cart consumes.** `peek(gpio+10)`; if it is 0–8 and that cell is empty, play it —
   otherwise `best_move(board, 2)`, the local minimax
   ([:171-183](../carts/tic_tac_toe.p8#L171-L183)). Then overwrite byte 10 with `cell-1`,
   drop status to `0`, and `place(cell)`, which flips the turn back to the human.

8. **Page reads back.** `readCartPlayedMove` has been polling at 16ms; it now sees idle plus a
   valid cell and returns it. The turn record stores `move` (what happened) separately from
   `intended` (what the model asked for), and sets `fromModel` only when those agree
   ([:86](../src/components/Pico8Game.tsx#L86)).

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
[buildPrompt](../api/move.js#L141) the JSON key order is deliberate — tokens generate in
sequence, so each field is conditioned on the ones above it, and `commentary` sits **last,
after `move`**. It narrates a decision already made rather than participating in it. Move it
above `move` and flavour text starts steering the game.

## Timing chain

| Bound | Value | Where |
|---|---|---|
| Page poll interval | 100ms | `Pico8Game.tsx` |
| Read-back poll / ceiling | 16ms / 3500ms | `readCartPlayedMove` |
| Page request timeout | ~10s | `getAiTurn`, `ai.ts` |
| Cart no-ack fallback | 15 frames (~0.5s) | `ai_ack_frames` |
| Cart stall fallback | 450 frames (~15s) | `ai_max_frames` |

The ordering `10s < 15s` is the invariant: the page must always get to answer, because if the
cart gives up first it self-plays and the read-back finds nothing to report.

## This doc is stale if…

- `gpio.ts` and the Lua constants at `tic_tac_toe.p8:138-141` no longer agree
- byte 11+ gets used, or a second cart joins with a different layout
- `getAiTurn`'s timeout rises to meet `ai_max_frames`
- `commentary` starts crossing the bridge instead of arriving over HTTP
