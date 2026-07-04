# PICO-8 + Gemini AI Opponent — Build Plan

A step-by-step plan for wiring turn-based PICO-8 games to a Gemini-powered AI
opponent, hosted as a single Vercel app (static frontend + serverless proxy).

> **Starting assumption:** your turn-based PICO-8 games are already built and
> playable as `.p8` carts. This plan picks up at "export them and make the AI
> opponent work."

---

## 1. Architecture at a glance

```
┌─────────────────────────── Vercel (one project, one origin) ───────────────────────────┐
│                                                                                         │
│   Browser                                                                               │
│   ┌─────────────────────────────┐         ┌────────────────────────┐                    │
│   │  React app (static)         │  fetch  │  /api/move             │   HTTPS            │
│   │  ┌───────────────────────┐  │ ──────► │  serverless function   │ ────────►  Gemini  │
│   │  │ PICO-8 web player      │  │         │  (holds API key)       │ ◄────────  API     │
│   │  │  cart  ⇄  pico8_gpio   │  │ ◄────── │  returns {move}        │                    │
│   │  └───────────────────────┘  │  JSON   └────────────────────────┘                    │
│   │     ▲ poll + read/write      │                                                       │
│   │     │ (JS glue)              │                                                       │
│   └─────┴───────────────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why one Vercel project:** frontend and proxy share an origin → no CORS, one
deploy, one URL. The API key lives only in the serverless function's
environment, never in the browser.

**The core trick:** a PICO-8 cart can't make network calls. It communicates
with the page through its **GPIO memory** (128 bytes at `0x5f80`–`0x5fff`),
which the web export mirrors to a JavaScript array named `pico8_gpio`. The cart
`poke`s/`peek`s; the JS reads/writes the same array; the JS does the networking.

---

## 2. Prerequisites & accounts

- [ ] **PICO-8** (full/paid) — required for HTML export. Education Edition can't export.
- [ ] **Node.js** (LTS) + npm installed locally.
- [ ] **Vercel account** (free Hobby tier) + `npm i -g vercel`.
- [ ] **Google AI Studio account** + a **Gemini API key** (no credit card needed for free tier).
- [ ] **Git** repo (GitHub fine for source control + Vercel auto-deploy; you are *not* using GitHub Pages).

---

## 3. Phase 0 — Decisions to lock first

**Pick a Gemini model.** Free tier is Flash / Flash-Lite only (Pro is paid as of
2026). Use a Flash-class model for low latency — you want a fast move, not deep
reasoning. Check AI Studio for the current free model name and your project's
live rate limits; don't hard-trust a model name from a doc. Default starting
point: `gemini-2.5-flash` (or the current recommended free Flash model).

**Pick an embed approach.** Two options:

| Approach | GPIO access | Trade-off |
|---|---|---|
| **Direct embed** (load the cart's `.js` into a canvas on the React page) | `window.pico8_gpio` directly | Simplest for GPIO; but PICO-8 uses fixed globals, so only run **one** cart per page load |
| **iframe** (cart in its own `.html`) | `iframe.contentWindow.pico8_gpio` (same-origin OK) | Cleaner isolation, but slightly more plumbing |

**Recommendation:** direct embed, one game per page. For a multi-game menu,
navigate / reload between games rather than tearing down the player in place
(PICO-8's global state makes in-place teardown fiddly).

---

## 4. Phase 1 — Export the PICO-8 games to web

For each cart, from the PICO-8 prompt:

```
> export tictactoe.html
```

This produces **`tictactoe.html`** + **`tictactoe.js`**. The `.js` holds both the
cart data and the full player runtime — it's the file that matters.

- [ ] Export each game.
- [ ] Drop the files into the project's `public/games/` folder (static passthrough — bundler won't rename them).
- [ ] Quick sanity check: open the `.html` locally to confirm the cart runs.

> If you go the direct-embed route you mainly need the `.js`; you can also run
> `export tictactoe.js` to get just that file.

---

## 5. Phase 2 — Design the GPIO protocol (the heart of it)

Define a tiny state machine in the shared GPIO bytes. Example for tic-tac-toe:

| Byte | Meaning | Written by |
|---|---|---|
| `0` | Status: `0` idle, `1` request move, `2` thinking, `3` move ready | both |
| `1..9` | Board cells: `0` empty, `1` human, `2` AI | cart |
| `10` | AI's chosen cell (`0..8`) | JS |

**Handshake flow:**
1. Cart writes the board into bytes 1–9, sets byte 0 = `1` (request).
2. JS sees `1`, sets byte 0 = `2` (thinking), reads board, calls `/api/move`.
3. JS writes the move to byte 10, sets byte 0 = `3` (ready).
4. Cart sees `3`, reads byte 10, plays it, resets byte 0 = `0`.

**Cart side (Lua):**

```lua
gpio=0x5f80

-- ask the page for a move
function request_ai_move(board)
  for i=1,9 do poke(gpio+i, board[i]) end
  poke(gpio+0, 1)      -- request
  ai_waiting=true
end

-- call every frame in _update; returns a cell or nil
function poll_ai_move()
  if ai_waiting and peek(gpio+0)==3 then
    local cell=peek(gpio+10)
    ai_waiting=false
    poke(gpio+0, 0)    -- reset to idle
    return cell
  end
end
```

- [ ] Add a "thinking…" indicator in the cart while `ai_waiting` is true (the call takes ~0.5–3s).
- [ ] Keep all turn logic (whose turn, win check) in the cart; the AI only supplies a cell.

---

## 6. Phase 3 — Scaffold the Vercel project

```
pico8-ai/
├─ api/
│  └─ move.js            # serverless proxy (Gemini call, holds key)
├─ public/
│  └─ games/
│     ├─ tictactoe.html
│     └─ tictactoe.js
├─ src/
│  ├─ components/
│  │  └─ Pico8Game.jsx   # canvas + player load + GPIO polling
│  ├─ lib/
│  │  ├─ gpio.js         # protocol constants + helpers
│  │  └─ ai.js           # fetch('/api/move')
│  ├─ App.jsx
│  └─ main.jsx
├─ index.html
├─ package.json
├─ vite.config.js
└─ .env.local            # GEMINI_API_KEY (gitignored — never commit)
```

- [ ] `npm create vite@latest` (React).
- [ ] Add the `api/` folder (Vercel detects functions there even in a Vite SPA).
- [ ] Add `.env.local` to `.gitignore`.

---

## 7. Phase 4 — Serverless proxy (`/api/move`)

Holds the key server-side, builds the prompt, calls Gemini, returns a clean move.

```js
// api/move.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { board } = req.body;                 // [9] of 0/1/2
  const model = 'gemini-2.5-flash';           // verify current free model in AI Studio
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const prompt = buildPrompt(board);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,   // key stays here, server-side
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // ask for clean JSON back instead of prose/markdown:
        generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
      }),
    });

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const move = JSON.parse(text).move;          // expecting {"move": N}
    return res.status(200).json({ move });
  } catch (e) {
    return res.status(200).json({ move: null }); // let the client fall back
  }
}

function buildPrompt(board) {
  return [
    'You are playing tic-tac-toe as player 2.',
    'Board is a 9-element array, indices 0..8, row-major.',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'Choose the index of your best legal move (a cell that is 0).',
    'Respond ONLY as JSON: {"move": <index>}.',
  ].join(' ');
}
```

- [ ] Set `GEMINI_API_KEY` in **Vercel → Project → Settings → Environment Variables** (and in local `.env.local`).
- [ ] Confirm the key is **never** referenced from `src/` (client code).

---

## 8. Phase 5 — Frontend glue (embed + poll + call)

**Set up GPIO before the player loads**, then poll it:

```js
// src/lib/gpio.js
export const GPIO_LEN = 128;
export const ST_IDLE = 0, ST_REQUEST = 1, ST_THINKING = 2, ST_READY = 3;

export function initGpio() {
  window.pico8_gpio = new Array(GPIO_LEN).fill(0);
  return window.pico8_gpio;
}
```

```js
// src/lib/ai.js
export async function getAiMove(board) {
  const r = await fetch('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board }),
  });
  const { move } = await r.json();
  return move;
}

// always validate — LLMs occasionally return illegal/garbage moves
export function validateMove(move, board) {
  if (Number.isInteger(move) && board[move] === 0) return move;
  const legal = board.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0);
  return legal[Math.floor(Math.random() * legal.length)]; // safe fallback
}
```

```js
// inside Pico8Game.jsx — after initGpio() and loading the cart's .js
const g = window.pico8_gpio;
const loop = setInterval(async () => {
  if (g[0] === ST_REQUEST) {
    g[0] = ST_THINKING;                 // ack so the cart shows "thinking"
    const board = g.slice(1, 10);
    let move = await getAiMove(board);
    move = validateMove(move, board);   // never write an illegal move
    g[10] = move;
    g[0] = ST_READY;
  }
}, 100);
// clearInterval(loop) on unmount
```

- [ ] Load the cart's `.js` (inject a `<script>` tag pointing at `/games/<game>.js`, with a `<canvas id="canvas">` present).
- [ ] Verify `pico8_gpio` exists **before** the player initializes.
- [ ] Clean up the interval on component unmount.

---

## 9. Phase 6 — Prompt design & robustness

- [ ] **Strict output contract:** ask for `{"move": N}` only; use `responseMimeType: 'application/json'` to suppress prose/markdown fences.
- [ ] **Always validate** the returned move against legal cells; fall back to a random legal move. This is the #1 thing that breaks these projects.
- [ ] **Difficulty knob (optional):** lower `temperature` ≈ stronger/steadier play; higher ≈ more variety/mistakes. You can expose this as an "easy/hard" toggle.
- [ ] **Timeout:** abort the fetch after ~5s and fall back, so a slow/over-quota call never hangs the game.

---

## 10. Phase 7 — Local development

- [ ] Run `vercel dev` (NOT plain `vite`) — it serves the frontend **and** runs the `api/` function locally, so the proxy works end to end.
- [ ] Test the full loop: human move → cart requests → proxy calls Gemini → move written back → cart plays.
- [ ] Test failure paths: kill network / use a bad key and confirm the fallback move still keeps the game playable.

---

## 11. Phase 8 — Deploy

- [ ] Push to GitHub; import the repo in Vercel (auto-build on push) — or run `vercel --prod`.
- [ ] Confirm `GEMINI_API_KEY` is set for the Production environment.
- [ ] Smoke-test the live URL on desktop + mobile (touch input).

---

## 12. Phase 9 — Hardening (before sharing publicly)

The proxy means your key is safe, but a public endpoint can still be abused and
burn your shared project quota (free tier ≈ 10–15 req/min, a few hundred to
~1,500 req/day, **per project, not per key**).

- [ ] **Rate-limit the proxy** per IP (simple in-memory or a small KV store).
- [ ] **Validate input** in the function (board is a 9-length array of 0/1/2) before calling Gemini.
- [ ] **Graceful 429 handling:** on quota errors, return `move: null` so the client falls back to a local move instead of erroring.
- [ ] Consider a **local minimax fallback** for tic-tac-toe so the game stays fully playable even when Gemini is unavailable — turns the LLM into an enhancement, not a dependency.
- [ ] Remember free-tier prompts may be used for model training — fine for a game board, just know it.

---

## 13. Milestone checklist (suggested order)

1. [ ] Export one game; get it running embedded in the React page (no AI yet).
2. [ ] Prove the GPIO bridge: cart writes a value, JS reads it, JS writes back, cart reacts.
3. [ ] Stand up `/api/move` returning a **hardcoded** legal move; complete the loop end to end.
4. [ ] Swap the hardcoded move for a real Gemini call via the proxy.
5. [ ] Add validation + fallback + timeout.
6. [ ] Deploy to Vercel; test live.
7. [ ] Add remaining games + a menu.
8. [ ] Harden (rate limit, input validation, local fallback).

---

## 14. Open questions / future ideas

- Multiple games sharing one GPIO protocol vs. per-game protocols?
- Single AI-opponent "service" prompt vs. per-game prompts/personas?
- Difficulty levels (temperature, or "explain your move" trash-talk via a second field)?
- Caching identical board states to save quota?
- A local minimax/heuristic per game as the always-available fallback opponent.
