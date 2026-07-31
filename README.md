# pico-ai

**[▶ Play it](https://pico-ai-five.vercel.app)**

Turn-based PICO-8 games embedded in a React app, played against a Gemini-powered
opponent. One Vercel deploy: a static Vite/React frontend plus a serverless proxy
(`api/move.js`) that holds the API key.

The side panel shows the model's own line-by-line analysis for every move, so you can see
what it saw — and when it fell back to the cart's built-in solver instead.

## Architecture

One Vercel project: static frontend + serverless proxy sharing an origin (no CORS, one
URL). The Gemini key lives only in the function's environment, never in the browser.

```
┌───────────────────── Vercel (one project, one origin) ─────────────────────┐
│  Browser                                                                    │
│  ┌───────────────────────────┐        ┌────────────────────────┐           │
│  │  React app (static)       │  fetch │  /api/move             │   HTTPS    │
│  │  ┌─────────────────────┐  │ ─────► │  serverless function   │ ─────► Gemini
│  │  │ PICO-8 web player   │  │        │  (holds API key)       │ ◄───── API │
│  │  │  cart ⇄ pico8_gpio  │  │ ◄───── │  returns move+reasoning│           │
│  │  └─────────────────────┘  │  JSON  └────────────────────────┘           │
│  │    ▲ poll + read/write    │                                             │
│  │    │ (JS glue)            │                                             │
│  └────┴──────────────────────┘                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**The core trick:** a PICO-8 cart can't make network calls. It talks to the page through
its GPIO memory (128 bytes at `0x5f80`–`0x5fff`), which the web export mirrors to a JS
array (`pico8_gpio`). The cart pokes/peeks; the JS reads/writes the same array and does the
networking. The cart is embedded via an iframe, so that array lives on the iframe's
same-origin `contentWindow`.

## Design decisions

**The LLM is the player, not a solver.** Tic-tac-toe is solved, so a minimax opponent
would be unbeatable and beside the point. The cart ships one anyway, but strictly as an
availability fallback: when Gemini is rate-limited, times out, or returns an illegal move,
the page hands control back and the cart plays its own minimax so the game never stalls.
The panel says so explicitly, so a fallback move is never passed off as the model's.

**Reliability came from restructuring the output, not from a longer prompt.** A
flash-class model would transcribe a line correctly and then miscount it — it once emitted
`[1,4,7]: 0,2,2` and still concluded no line had two 2s, missing the win. The fix was to
make each derivation an explicit output field (per-line `twos`/`ones`, then `winMove`,
`blockMove`, `legalCells`) so the model selects from a list it just wrote instead of
re-deriving in its head. Since JSON keys generate in order, that ordering is load-bearing:
`commentary` comes last, after `move`, so flavour text can never steer the game.

**Known limits.** The move priority (win → block → center → corner) has no concept of
forks, so a player who takes two opposite corners can still win. Gemini's free-tier quota
is per-project rather than per-key, so `/api/move` is limited two ways: per IP, and a
global cap counted in *actual Gemini calls* rather than requests, since one request can
retry several times.

## Setup

Requires **Node 20.x**, the **Vercel CLI**, and a **Gemini API key** from
[Google AI Studio](https://aistudio.google.com) (free tier).

```sh
npm install
npm i -g vercel
vercel login
cp .env.example .env.local  # paste your GEMINI_API_KEY into it
```

Without a key, `api/move.js` answers with the first empty cell — enough to exercise the
whole loop, and obviously not the model.

## Commands

| Command | What it does |
|---|---|
| `vercel dev` | **Local dev — use this.** Serves the frontend *and* the `api/` functions on `localhost:3000`. The only local command where the AI works. |
| `npm run dev` | Frontend only. `/api/move` 404s, so no AI — fine for pure UI work. |
| `npm test` | Run the test suite (`node --test`). Add `--watch` via `npm run test:watch`. |
| `npm run build` | Production build → `dist/`. Vercel runs this on deploy. |
| `vercel --prod` | Deploy to production, or just push to the connected repo. |

## Deploy

1. Push to GitHub and import the repo in Vercel (auto-deploys on push), or `vercel --prod`.
2. Set these for the **Production** environment in Vercel → Settings → Environment
   Variables — `.env.local` is local-only and does not ship:
   - `GEMINI_API_KEY`
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN` (from the Upstash/KV integration). Without
     them the rate limiter falls back to per-instance memory, which cannot enforce a
     global cap.
3. Smoke-test the live URL on desktop and mobile.

## Project layout

```
api/move.js               serverless proxy — prompt, Gemini call, response shaping
api/_ratelimit.js         per-IP + global quota limiting, KV-backed, fails open
carts/*.p8                PICO-8 sources; exported into public/games/
public/games/*.{html,js}  exported carts; the iframe loads the .html
src/components/           iframe embed, GPIO poll loop, reasoning panel
src/lib/                  gpio.js (byte protocol) + ai.js (calls /api/move)
tests/                    node:test suites
```

> `vercel.json` is intentionally empty. A catch-all SPA rewrite breaks `vercel dev` by
> intercepting Vite's dev modules (`/src/main.jsx`, `/@vite/client`) and returning HTML
> for them. Only add a dev-safe rewrite if client-side routing is introduced.

## Roadmap

- **Perception layer.** Small models are poor at a game's *arithmetic* (scanning lines,
  counting) but good at *judgement* once the facts are laid out. Have code compute the
  salient facts of a position and let the LLM weigh them — giving it eyes, not a strategy.
  Closing the fork gap is the first thing this should fix.
- **More carts.** Each game ships a small feature-extractor over a shared contract, so the
  pipeline is written once. Games without an optimal algorithm to fall back on are exactly
  where the LLM genuinely has to play.
