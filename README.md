# pico-ai

Gemini meets PICO-8 — turn-based PICO-8 games embedded in a React app, playing
against a Gemini-powered AI opponent. One Vercel deploy: a static Vite/React
frontend plus a serverless proxy (`api/move.js`) that holds the API key.

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
same-origin `contentWindow`. Detailed build steps: [webapp-build-steps.md](webapp-build-steps.md).

## Prerequisites

- **Node.js 20.x** (see `engines` in `package.json`)
- **Vercel CLI** — `npm i -g vercel`
- **A Vercel account** (free Hobby tier) — sign up at [vercel.com](https://vercel.com)
- **A Gemini API key** from [Google AI Studio](https://aistudio.google.com) (free tier)

## First-time setup

```sh
npm install                 # install dependencies
npm i -g vercel             # install the Vercel CLI (once, globally)
vercel login                # authenticate (opens a browser)
cp .env.example .env.local  # then paste your GEMINI_API_KEY into .env.local
```

`.env.local` is gitignored — the key lives there locally and must never be
committed. Without a key set, `api/move.js` returns a hardcoded legal move so the
loop still runs end to end.

## Commands

| Command | What it does | Notes |
|---|---|---|
| `vercel dev` | **Local dev — use this.** Runs the frontend **and** the `api/` functions. | Serves on `localhost:3000`. This is the only local command where the AI opponent works. |
| `npm run dev` | Frontend only (plain Vite dev server). | ⚠️ `/api/move` returns 404 here — no AI. Fine for pure UI work; otherwise prefer `vercel dev`. |
| `npm run build` | Production build → `dist/`. | Static frontend only; Vercel runs this for you on deploy. |
| `npm run preview` | Serve the built `dist/` locally. | Static preview only — no `api/` functions. |
| `npm audit` | Check dependencies for known vulnerabilities. | Currently clean (0 vulnerabilities). |
| `vercel --prod` | Deploy to production. | Or just push to the connected repo for auto-deploy. |

> **Why `vercel dev` and not `npm run dev`?** Plain Vite only knows the frontend.
> `vercel dev` also runs `api/move.js` (the Gemini proxy), matching production —
> so the AI works locally. See [webapp-build-steps.md](webapp-build-steps.md).

## Deploy

1. Push to GitHub and import the repo in Vercel (auto-deploys on push), **or** run `vercel --prod`.
2. Set `GEMINI_API_KEY` in **Vercel → Project → Settings → Environment Variables**
   for the **Production** environment (`.env.local` is local-only and does not ship).
3. Smoke-test the live URL on desktop and mobile.

## Project layout

```
api/move.js              serverless proxy (holds the Gemini key)
public/games/*.{html,js} PICO-8 web exports (static); the iframe loads the .html
src/components/           React — embeds the cart in an iframe, runs the GPIO poll loop
src/lib/                  gpio.js (protocol) + ai.js (fetch + fallback)
vercel.json              currently empty {} — see note below
```

> **`vercel.json`:** intentionally empty. A catch-all SPA rewrite
> (`/((?!api/).*)` → `/index.html`) was removed because it breaks `vercel dev` —
> it intercepts Vite's dev modules (`/src/main.jsx`, `/@vite/client`) and returns
> HTML for them. Restore a **dev-safe** rewrite only when client-side routing is
> added; see [webapp-build-steps.md](webapp-build-steps.md).

## Roadmap

The point of this project is that an **LLM** plays — not a solver. Tic-tac-toe is a
solved game, so a minimax opponent would be trivial and beside the point; it's used only
as an offline *availability* fallback, never as the player. That framing drives what's next.

- **Perception layer.** Small models are poor at a game's *arithmetic* (scanning lines,
  counting) but good at *judgement* once the facts are laid out. The plan is to have code
  compute the salient facts of a position (legal moves, threats) and let the LLM weigh
  them and decide — giving it eyes, not a strategy. It stays the player.
- **More carts.** Each PICO-8 game ships a small feature-extractor over a shared contract,
  so the pipeline is written once. Future games have no optimal algorithm to fall back on,
  which is exactly why the LLM genuinely has to play them.
- **Close the fork gap.** The current `win → block → center → corner` heuristic has no
  concept of a move creating two threats at once, so the AI still loses to the
  opposite-corner trap — the first thing the perception layer should fix.
