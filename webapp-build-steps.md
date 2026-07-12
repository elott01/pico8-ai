# Web App — Step-by-Step Build

Concrete, repo-specific steps for building the web app in **this** repo. The
conceptual/architecture reference is [pico8-gemini-build-plan.md](pico8-gemini-build-plan.md);
this file is the ordered "what do I actually do next" checklist.

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

- [ ] `npm install` (if `node_modules` is stale).
- [ ] `npm i -g vercel` if you don't have it.
- [ ] `cp .env.example .env.local` — leave `GEMINI_API_KEY` **blank** for now.
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
[readBoard](src/lib/gpio.js), calls [getAiMove](src/lib/ai.js) →
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

The protocol table lives in **three** places that must agree: the cart's Lua,
[src/lib/gpio.js](src/lib/gpio.js), and [AGENTS.md](AGENTS.md). Pick the layout
now so the cart edit in Step 4 targets the right bytes.

Current agreed layout (tic-tac-toe):

| Byte    | Meaning                                                | Written by |
|---------|--------------------------------------------------------|------------|
| `0`     | Status: `0` idle, `1` request, `2` thinking, `3` ready | both       |
| `1..9`  | Board cells: `0` empty, `1` human, `2` AI              | cart       |
| `10`    | AI's chosen move (0..8)                                 | JS         |

> AGENTS.md also reserves bytes `11..` for optional AI "dialogue"/trash-talk.
> That's a later enhancement — ignore it until the basic move loop works.

- [ ] Decide if you're keeping it minimal (bytes 0–10) for the first pass. If so,
      no code change needed here — the stubs already match.

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

- [ ] Get a **Gemini API key** from Google AI Studio (free tier, Flash-class).
- [ ] Put it in `.env.local`: `GEMINI_API_KEY=...` (never commit — it's gitignored).
- [ ] Verify the free model name in AI Studio and update `model` in
      [api/move.js](api/move.js#L24) if `gemini-2.5-flash` isn't current/free.
- [ ] Restart `vercel dev`. Now [api/move.js](api/move.js) takes the real branch
      (it only falls back when the key is missing).
- [ ] Play again — the opponent should now play like Gemini, not first-empty-cell.

**Done when:** moves come from Gemini, and the game is still fully playable.

---

## Step 6 — Robustness (already partly stubbed — verify it holds)

The stubs already include validation, timeout, and graceful failure. Confirm
each actually works:

- [ ] **Illegal-move guard:** [validateMove](src/lib/ai.js) replaces any illegal
      / non-integer move with a random legal cell. Force it by temporarily
      returning a garbage move from the proxy and confirm the game doesn't break.
- [ ] **Timeout:** [getAiMove](src/lib/ai.js) aborts after 5s → `null` → fallback.
      Test with the network throttled.
- [ ] **Bad key / quota:** set a bogus key; [api/move.js](api/move.js) `catch`
      returns `{ move: null }`, client falls back. Confirm the game stays playable.

**Done when:** killing the network or using a bad key never hard-stops the game.

---

## Step 7 — Deploy

- [ ] Commit and push. Import the repo in Vercel (auto-build), or `vercel --prod`.
- [ ] Set `GEMINI_API_KEY` in **Vercel → Project → Settings → Environment
      Variables** for the **Production** environment (the local `.env.local`
      doesn't ship).
- [ ] Smoke-test the live URL on desktop **and** mobile (touch input).

---

## Step 8 — Harden (before sharing publicly)

The key is safe server-side, but the public `/api/move` endpoint can still burn
your shared project quota (free tier ≈ 10–15 req/min, per project).

- [ ] Rate-limit `/api/move` per IP (there's a `TODO(phase-9)` marker already in
      [api/move.js](api/move.js#L9-L12)). On trip → `{ move: null }` so the
      client falls back.
- [ ] On Gemini 429/quota errors, return `{ move: null }` (don't error).
- [ ] Consider a **local minimax fallback** for tic-tac-toe so the game is fully
      playable even when Gemini is down — turns the LLM into an enhancement, not
      a dependency.
- [ ] Note: free-tier prompts may be used for training — fine for a game board.

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
- **Cart location the app loads:** `public/games/tic_tac_toe.html` + `.js`
  (from `game="tic_tac_toe"` in [App.jsx](src/App.jsx)).
- **Protocol lives in 3 synced places:** cart Lua · [src/lib/gpio.js](src/lib/gpio.js) · [AGENTS.md](AGENTS.md).
- **Milestone order:** run cart embedded → prove JS bridge → add cart GPIO →
  real Gemini → harden → more games.
