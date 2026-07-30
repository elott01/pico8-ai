# Web App — Step-by-Step Build

Concrete, repo-specific steps for building the web app in **this** repo — the ordered
"what do I actually do next" checklist. Architecture overview is in [README.md](README.md).

**Where we're starting:** Phase 3 scaffolding is already committed. The React
app, GPIO helpers, the `/api/move` proxy (with a hardcoded-move fallback), and
`Pico8Game.jsx` all exist as working stubs. `public/games/` is empty. So the
first real milestone is just **get a cart rendering in the page** — no GPIO, no
AI yet.

> **Ordering matches your intent:** prove the PICO-8 cart runs inside the web app
> *first*, with the current (GPIO-less) tic-tac-toe cart. Only after that do we
> touch the cart to add GPIO. Steps 1–2 need no cart changes; Step 4 is where the
> cart gets edited.

---

## Step 0 — One-time local setup

- [x] `npm install` (if `node_modules` is stale).
- [x] `npm i -g vercel` if you don't have it.
- [x] `cp .env.example .env.local` — leave `GEMINI_API_KEY` **blank** for now.
      With no key, [api/move.js](api/move.js) returns a legal move, so the whole
      loop works before you ever touch Gemini.

---

## Step 1 — Get the current cart into the app (no GPIO, no AI)

Goal: PICO-8 renders and is playable inside the React page. This proves the
embed works before any bridge code matters.

**Embed approach: iframe.** A PICO-8 web export isn't a bare script — its `.js`
renders into `Module.canvas` and needs the exported shell's setup (start button,
layout, audio-context gating). So we embed the exported **`.html`** in an
`<iframe>` (it carries that shell verbatim) rather than injecting the `.js`
ourselves. It's same-origin, so GPIO stays reachable via
`iframeRef.current.contentWindow.pico8_gpio` (wired in Step 4). This also isolates
each cart, so the multi-game menu (Step 9) can just swap the iframe `src`.

- [x] Copy **both** exported files into the static games folder, keeping their
      names (the `.html` references `tic_tac_toe.js` by that exact name):

  ```sh
  cp carts/tic_tac_toe/tic_tac_toe.html public/games/tic_tac_toe.html
  cp carts/tic_tac_toe/tic_tac_toe.js  public/games/tic_tac_toe.js
  ```

  [src/App.jsx](src/App.jsx) passes `game="tic_tac_toe"`, and
  [Pico8Game.jsx](src/components/Pico8Game.jsx) loads `/games/${game}.html`.

- [x] Sanity check the cart on its own first: open
      `carts/tic_tac_toe/tic_tac_toe.html` directly in a browser. If it doesn't
      run here, it won't run embedded — fix the export before continuing.

- [x] `vercel dev` (NOT `npm run dev` / plain `vite` — plain vite won't run
      `api/`). Open the local URL.

- [x] Confirm the cart appears in the iframe. PICO-8 shows a **start button**
      (`p8_autoplay` is off); click it to boot (also satisfies the browser's
      audio-gesture requirement). Play it as a normal 2-player / hotseat cart —
      the AI isn't wired to it yet.

**✅ Done — cart plays in the iframe.** (Confirmed 2026-07-11.)

> ⚠️ If the iframe is blank: check the browser console/network for a 404 on
> `/games/tic_tac_toe.html` or `/games/tic_tac_toe.js`, and make sure `vercel.json`
> has no catch-all rewrite intercepting them (it was emptied in an earlier step
> for exactly this reason).

---

## Step 2 — (folded into Step 4) The JS side of the bridge

> This step originally had you drive the protocol **by hand** from the browser
> console (`window.pico8_gpio[0] = 1`, watch it flip to READY) to prove the page's
> half before editing the cart. That made sense with the old direct-embed, where
> `pico8_gpio` sat on the top window. With the **iframe**, the array lives on
> `iframe.contentWindow.pico8_gpio` and only exists once the cart is running, so
> the clean "test it in isolation" separation is gone. We wired the **real** poll
> loop instead (Step 4's JS side) and test it against the actual cart. Skip ahead.

The page's half now lives in [Pico8Game.jsx](src/components/Pico8Game.jsx): a
`setInterval` reads `iframeRef.current.contentWindow.pico8_gpio`, and on
`status == REQUEST` it acks (→ THINKING), reads the board via
[readBoard](src/lib/gpio.js), calls [getAiTurn](src/lib/ai.js) →
[api/move.js](api/move.js), then writes the move (byte 10) and sets `status = READY`.

- [x] JS poll loop wired against the iframe's GPIO array.

**If you still want a pure-JS smoke test** (no cart), boot the cart, open the
console, and poke the iframe's array by hand:

```js
const g = document.querySelector('iframe').contentWindow.pico8_gpio;
[1,0,0, 0,0,0, 0,0,0].forEach((v,i) => g[i+1] = v); // human took cell 0
g[0] = 1;                                            // ST_REQUEST
setTimeout(() => console.log('status', g[0], 'move', g[10]), 500); // -> 3, a legal cell
```

---

## Step 3 — Lock the GPIO protocol (source of truth)

The protocol table lives in **two** places that must agree: the cart's Lua and
[src/lib/gpio.js](src/lib/gpio.js). Pick the layout now so the cart edit in Step 4
targets the right bytes.

Current agreed layout (tic-tac-toe):

| Byte    | Meaning                                                | Written by |
|---------|--------------------------------------------------------|------------|
| `0`     | Status: `0` idle, `1` request, `2` thinking, `3` ready | both       |
| `1..9`  | Board cells: `0` empty, `1` human, `2` AI              | cart       |
| `10`    | AI's chosen move (0..8)                                 | JS         |

> Bytes `11..` are reserved for optional AI "dialogue"/trash-talk. That ended up
> travelling over the `/api/move` JSON response instead (see Step 5b), so the
> reservation is currently unused.

- [x] Decide if you're keeping it minimal (bytes 0–10) for the first pass. If so,
      no code change needed here — the stubs already match.

**✅ Done — kept minimal (bytes 0–10); no code change needed.** The AI's
trash-talk ended up travelling over the `/api/move` JSON response instead of the
reserved GPIO bytes `11..` (see Step 5b), so that reservation is still unused.

---

## Step 4 — Add GPIO to the cart, then re-export

**This is the first and only cart edit for the basic loop.** The Lua glue is
already written in [carts/tic_tac_toe.p8](carts/tic_tac_toe.p8) — you just need to
re-export it so `public/games/` picks it up.

- [x] GPIO glue added to the cart. On the cpu's turn `update_ai()` writes the
      board into bytes `1..9`, sets byte `0 = 1` (request), and waits; when byte
      `0 == 3` (ready) it reads byte `10` (a 0-based index), plays that cell, and
      resets byte `0 = 0`. It **falls back to local minimax** if the page never
      acks (~0.5s — e.g. desktop PICO-8) or stalls (~6s), so the cart never hangs
      and still plays standalone. The existing "cpu thinking…" status shows while
      waiting.
- [x] JS side wired (see Step 2) — the poll loop answers the request.
- [x] All turn/win logic stays in the cart; the AI only supplies a cell index.
- [x] **Re-export from PICO-8** (this can't be scripted — do it in the PICO-8
      app). Load the edited cart and export the web version:

  ```
  load carts/tic_tac_toe.p8
  export tic_tac_toe.html
  ```

  Copy the exported files into `public/games/`, keeping the names:

  ```sh
  cp carts/tic_tac_toe/tic_tac_toe.html public/games/tic_tac_toe.html
  cp carts/tic_tac_toe/tic_tac_toe.js  public/games/tic_tac_toe.js
  ```

  > Where PICO-8 writes the export depends on your cwd/config; adjust the source
  > paths above to wherever `export` dropped them.

- [x] `vercel dev`, switch the cart to **vs cpu** (pause menu → "mode: vs cpu"),
      and play. Your move → cart requests → proxy returns the fallback move →
      cart plays it. This is the **full loop with a dumb AI** (first-empty-cell,
      since no Gemini key yet).

**✅ Done — full GPIO loop confirmed.** (Confirmed 2026-07-11.) Verified via the
Network tab: `/api/move` requests fired from `ai.js` returned 200, and the AI
played first-empty-cell (not its local minimax), proving the moves came over the
bridge rather than the cart's fallback.

---

## Step 5 — Swap the fallback for real Gemini

- [x] Get a **Gemini API key** from Google AI Studio (free tier, Flash-class).
- [x] Put it in `.env.local`: `GEMINI_API_KEY=...` (never commit — it's gitignored).
- [x] Verify the free model name in AI Studio and update `MODEL` in
      [api/move.js](api/move.js). Now `gemini-3.1-flash-lite`.
- [x] Restart `vercel dev`. Now [api/move.js](api/move.js) takes the real branch
      (it only falls back when the key is missing).
- [x] Play again — the opponent should now play like Gemini, not first-empty-cell.

**Done when:** moves come from Gemini, and the game is still fully playable.

**✅ Done — Gemini plays the moves.** (Confirmed 2026-07-19.)

### Gotchas worth keeping

**Model availability, not code, was most of the fight.** `ListModels` lists models
your key cannot actually call: the whole `2.5` family is retired for new keys and
404s on `generateContent` despite appearing in the list. `gemini-flash-latest`
resolves to the flagship and gets 503-stormed on the free tier. `gemini-3.1-flash-lite`
is callable, fast, and low-demand. **Env vars and `api/` code are read only at boot —
fully restart `vercel dev` after touching either.**

**Symptom decoder** (which layer produced the move):

| What you see | Where it came from |
|---|---|
| Always the first empty cell | No-key branch — `firstLegal()` in [api/move.js](api/move.js) |
| Strong play with a "built-in solver" note in the panel | Gemini was unavailable (rate-limited/timeout/error) → the cart played its own minimax |
| Blocks and takes wins | Real Gemini |

### Prompt design (why it looks the way it does)

Getting a flash-lite model to play soundly took three rounds, and the shape of
[buildPrompt](api/move.js) is the result. The one technique that worked every time:
**when the model fumbles a derivation, make that derivation an explicit output field**
rather than something it computes in its head.

1. **Room to think.** The original prompt demanded bare `{"move": N}`, forcing the
   entire scan → count → prioritise chain into the first generated token. Adding a
   reasoning field (and `temperature` `0.6` → `0.1`) fixed most bad play immediately.
2. **Counting as a field.** It would write `[1,4,7]: 0,2,2` and still conclude "no
   line has two 2s," missing wins. Emitting per-line `twos`/`ones`/`emptyCells`, then
   `winMove`/`blockMove` as separate fields, fixed win detection.
3. **Legality as a field.** It played the center while the center was occupied —
   having correctly listed that line's `emptyCells` moments earlier. Emitting
   `legalCells` and choosing *from that list* addressed it, backed by a server-side
   retry (Step 6).

**Key-order is load-bearing.** JSON keys generate in order, so each field is
conditioned on the ones above it. `commentary` sits **last**, after `move`, so flavor
text can never steer the game. Don't reorder these keys.

**Known gap: forks.** The `win → block → center → corner` priority has no concept of
a move creating *two* threats at once, so the AI still loses to the opposite-corner
trap. Not a perception failure — its counting is correct; the strategy itself is
incomplete. See the Roadmap in [README.md](README.md).

---

## Step 5b — Show the model's work (reasoning panel)

Not in the original plan; built after Step 5. Makes it evident a real LLM is playing
rather than a hidden algorithm — the most portfolio-relevant piece of the app.

- [x] `/api/move` returns the model's full analysis, not just a move:
      `{ move, winMove, blockMove, lines, commentary }`.
- [x] `getAiMove` → **`getAiTurn`** in [src/lib/ai.js](src/lib/ai.js), returning the
      whole payload (renamed because it no longer returns a move).
- [x] [Pico8Game.jsx](src/components/Pico8Game.jsx) keeps a per-game turn history,
      reset when the board's filled-cell count drops (i.e. a new game started).
- [x] [TurnPanel.jsx](src/components/TurnPanel.jsx) renders one card per turn beside
      the cart: commentary, a WIN/BLOCK tag, and collapsible reasoning with a mini
      board and the decision-relevant lines.

**Honesty rules baked in** — the panel exists to prove the LLM is really choosing, so
it must never imply more than it can support:

- Cards store the cell **actually played** plus the model's **intended** cell. When
  they differ, the card says so (`"Model chose 4 — already taken; played 5 instead"`).
- Reasoning is hidden on fallback turns — showing the model's analysis next to a move
  it didn't make would undercut the whole point.
- Commentary is generated *after* `move`, so it narrates a decision already made. It's
  flavor, not cause; the structured reasoning is the real record.

---

## Step 6 — Robustness (already partly stubbed — verify it holds)

The stubs already include validation, timeout, and graceful failure. Two of the
three got verified **in real play** rather than by forced testing:

- [x] **Illegal-move guard** — verified in the wild: the model returned cell `4`
      while `4` was occupied. Two layers now:
      1. **Server** ([api/move.js](api/move.js)) checks legality and retries **once**,
         echoing the mistake back (`"Cell 4 is NOT empty. You may only play …"`).
      2. **Cart** — if an illegal move still gets through, the page sends `NO_MOVE` and
         the cart plays its own minimax (see [src/lib/gpio.js](src/lib/gpio.js)).
      An occasional `illegal move N; retrying with correction` in the server log is
      the guard working. The red panel warning means it whiffed *twice*.
- [x] **Timeout** — verified in the wild, and the original 5s was too tight: turns
      generate 8 line objects plus commentary before the response completes, so valid
      answers were being discarded (200 in the server log, random cell on screen).
      Now **10s** in [getAiTurn](src/lib/ai.js), mirrored by `CLIENT_ABORT_MS` in
      [api/move.js](api/move.js), which flags any generation finishing past it.
      **Keep those two in sync.**
- [ ] **Bad key / quota:** set a bogus key; [api/move.js](api/move.js) `catch`
      returns `{ move: null }`, client falls back. Confirm the game stays playable.
      *(Untested deliberately — it lands in the same `{ move: null }` path the
      timeouts already exercised. Transient 503/429 retry is separately confirmed
      working.)*

**Done when:** killing the network or using a bad key never hard-stops the game.

> Belt and braces: per Step 4 the **cart itself** falls back to local minimax if the
> page stalls (~6s), so the game stays playable even with the whole web layer dead.

---

## Step 7 — Deploy

> ⚠️ **Do Step 8 first if the URL is going straight to recruiters.** These steps were
> written assuming deploy-then-harden with a quiet gap between. Sharing the link
> immediately closes that gap: an unlimited public `/api/move` can be drained by one
> bored visitor, and the next person to open the demo gets random fallback moves.

- [ ] Commit and push. Import the repo in Vercel (auto-build), or `vercel --prod`.
- [ ] Set these in **Vercel → Settings → Environment Variables** for **Production**
      (local `.env.local` doesn't ship): `GEMINI_API_KEY`, and the KV creds
      `KV_REST_API_URL` / `KV_REST_API_TOKEN`. The Upstash/KV Marketplace link usually
      adds the KV vars to all envs — confirm Production has them, or the rate limiter
      silently runs on the per-request in-memory fallback (i.e. no real global cap).
- [ ] Smoke-test the live URL on desktop **and** mobile (touch input).
- [ ] **Verify rate limiting live** (only checkable against a deployed URL):
      - A few normal games → zero 429s.
      - Abuse loop from one browser (`while(true) fetch('/api/move', …)`) → 429s begin
        and Gemini calls stop.
      - **Cross-instance / cold-start:** trip the cap, then hit it again after a cold
        start — still limited. This is what proves KV is doing its job (an in-memory
        limiter couldn't survive the reload).
      - *(optional)* point `KV_REST_API_URL` at a bad host → game stays playable
        (fail-open; already unit-tested, so belt-and-suspenders).

---

## Step 8 — Harden (before sharing publicly) ✅

The public `/api/move` endpoint can burn the shared free-tier quota (≈ 10–15 req/min,
per project), so it's rate-limited. Implemented in [api/_ratelimit.js](api/_ratelimit.js):

- [x] **Origin check** — rejects requests that didn't come from this app's own page
      (a speed bump, not security; missing `Origin` = a non-browser client).
- [x] **Per-IP limit** (40 / 10 min) and a **global cap on actual Gemini calls**
      (default 12/min, 800/day; env-tunable). The global cap counts *calls including
      retries*, not requests — one request can issue several. On trip → **429** with
      `Retry-After` (not a silent `{move:null}`), so the UI shows a rate-limit notice
      instead of a random move that looks broken.
- [x] **Durable, shared state** via Vercel KV / Upstash (REST, no dep). Counters live in
      the store so they survive the per-request module reload that `vercel dev` and cold
      starts cause. **Fail-open:** any KV error degrades to in-memory, never a broken game.
- [x] **Availability fallback** — the cart plays its own minimax when Gemini is
      unavailable (rate-limited / timeout / error), so the LLM stays the player but the
      game never depends on it. See the cart-minimax write-back handshake in
      [src/lib/gpio.js](src/lib/gpio.js).
- [x] Temp diagnostics stripped; operational logs (retries, cap-trip, KV fail-open) kept.
- Live verification of all this happens post-deploy — see Step 7.
- Note: free-tier prompts may be used for training — fine for a game board.

---

## Step 9 — More games + menu (later)

- [ ] Export each new cart's `.js` to `public/games/<name>.js`.
- [ ] Reuse the GPIO protocol (or extend per-game) and pass `game="<name>"` to
      `Pico8Game`.
- [ ] Add a menu in [src/App.jsx](src/App.jsx). Because PICO-8 uses fixed globals,
      **navigate/reload between games** rather than swapping carts in place.
- [ ] **Restore an SPA fallback rewrite** in [vercel.json](vercel.json) so deep
      links / refreshes on client-side routes don't 404 in production. It was
      removed during Step 1 because a naive catch-all (`/((?!api/).*)` →
      `/index.html`) breaks `vercel dev` — it intercepts Vite's virtual dev
      modules (`/src/main.jsx`, `/@vite/client`) and returns HTML for them. Use a
      **dev-safe** version that excludes Vite internals and real files, e.g.
      `"/((?!api/|@|src/|node_modules/|.*\\.).*)"`. Test under `vercel dev`
      *and* a production build before relying on it.

---

## Quick reference

- **Run locally:** `vercel dev` (never plain `vite` — the proxy won't run).
  **Restart fully** after any change to `.env.local` or `api/` — both are read only
  at boot.
- **Cart location the app loads:** `public/games/tic_tac_toe.html` + `.js`
  (from `game="tic_tac_toe"` in [App.jsx](src/App.jsx)).
- **Protocol lives in 2 synced places:** cart Lua · [src/lib/gpio.js](src/lib/gpio.js).
- **Also keep in sync:** the client abort in [src/lib/ai.js](src/lib/ai.js) and
  `CLIENT_ABORT_MS` in [api/move.js](api/move.js).
- **Model:** `gemini-3.1-flash-lite`. Don't trust `ListModels` — it lists models a new
  key can't call.
- **Milestone order:** run cart embedded → prove JS bridge → add cart GPIO →
  real Gemini → show its reasoning → harden → deploy → more games.
- **Current position:** Steps 0–5b done, Step 6 all but the bad-key test.
  **Next: Step 8 (rate limit), then Step 7 (deploy).**
- **Separate track:** the perception layer — moving fact-derivation from prompt into JS.
  Not part of this checklist; see the Roadmap in [README.md](README.md). The open fork
  gap is its trigger condition.
