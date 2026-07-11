# pico-ai

Gemini meets PICO-8 — turn-based PICO-8 games embedded in a React app, playing
against a Gemini-powered AI opponent. One Vercel deploy: a static Vite/React
frontend plus a serverless proxy (`api/move.js`) that holds the API key.

- **Build plan:** [pico8-gemini-build-plan.md](pico8-gemini-build-plan.md) (concept/architecture)
- **Step-by-step:** [webapp-build-steps.md](webapp-build-steps.md) (ordered checklist)
- **Contributor notes:** [AGENTS.md](AGENTS.md)

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
public/games/*.js        PICO-8 web exports (static; loaded by the player)
src/components/           React — embeds the cart, runs the GPIO poll loop
src/lib/                  gpio.js (protocol) + ai.js (fetch + fallback)
vercel.json              SPA routing (everything but /api/ → index.html)
```
