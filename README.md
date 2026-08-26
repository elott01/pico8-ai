# PICO-8 + Gemini

**[▶ Play it](https://pico8-ai.vercel.app)** &nbsp;·&nbsp; [![tests](https://github.com/elott01/pico8-ai/actions/workflows/test.yml/badge.svg)](https://github.com/elott01/pico8-ai/actions/workflows/test.yml)

Turn-based PICO-8 games embedded in a React app, played against a Gemini-powered
opponent. One Vercel deploy: a static Vite/React frontend plus a serverless proxy
(`api/move.ts`) that holds the API key.

Two carts, switchable in the browser:

| cart | why it is here |
| --- | --- |
| **Tic-tac-toe** | 3×3. Solved by 40 lines of minimax, so it proves the pipeline — not the model |
| **Connect Four** | 7×6. No cheap perfect play, so the model's judgement does real work |

The side panel shows the model's own analysis for every move, so you can see what it saw —
and when it fell back to the cart's built-in solver instead. Which prompt each cart ships
was **chosen by measurement**, not taste: see [`bench/`](bench/results/README.md).

## Architecture

One Vercel project: static frontend + serverless proxy sharing an origin (no CORS, one
URL). The Gemini key lives only in the function's environment, never in the browser.

```
┌─ Vercel ─────────────────────────────────────────────────┐
│                                                          │
│  Browser                          Serverless             │
│  ┌───────────────────────┐        ┌───────────────────┐  │
│  │ React app (static)    │  fetch │ /api/move         │  │
│  │  ┌─────────────────┐  │ ──────►│ holds the API key │  │
│  │  │ PICO-8 player   │  │        │ builds the prompt │  │
│  │  │ cart ⇄ gpio     │  │◄────── │ returns move+why  │  │
│  │  └─────────────────┘  │  JSON  └─────────┬─────────┘  │
│  │    ▲ poll + r/w       │                  │            │
│  └────┴──────────────────┘                  │ HTTPS      │
│                                             │            │
└─────────────────────────────────────────────┼────────────┘
                                              ▼
                                         Gemini API
```

**The core trick:** a PICO-8 cart can't make network calls. It talks to the page through
its GPIO memory (128 bytes at `0x5f80`–`0x5fff`), which the web export mirrors to a JS
array (`pico8_gpio`). The cart pokes/peeks; the JS reads/writes the same array and does the
networking. The cart is embedded via an iframe, so that array lives on the iframe's
same-origin `contentWindow`.

Two processes with no shared clock, coordinating through 128 bytes, need a protocol —
[docs/gpio-protocol.md](docs/gpio-protocol.md) walks the whole handshake end to end: the
byte layout, why the move byte carries two different values in one exchange, and the
timeout budget that keeps the cart and the page from both giving up at once.

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

Requires **Node 24.x**, the **Vercel CLI**, and a **Gemini API key** from
[Google AI Studio](https://aistudio.google.com) (free tier).

```sh
npm install
npm i -g vercel
vercel login
cp .env.example .env.local  # paste your GEMINI_API_KEY into it
```

Without a key, `api/move.ts` answers with the first empty cell — enough to exercise the
whole loop, and obviously not the model.

## Commands

| Command | What it does |
|---|---|
| `vercel dev` | **Local dev — use this.** Serves the frontend *and* the `api/` functions on `localhost:3000`. The only local command where the AI works. |
| `npm run dev` | Frontend only. `/api/move` 404s, so no AI — fine for pure UI work. |
| `npm test` | Unit suite (`node --test`), ~3s, needs nothing. `npm run test:watch` to watch. |
| `npm run test:playwright` | Browser suite across Chromium, WebKit and mobile Safari. Boots Vite itself; no API key needed. |
| `npm run bench` | Prompt benchmark against the real model. **Spends Gemini quota.** |
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
api/move.ts               serverless proxy — game-agnostic; per-cart bits live in _games.ts
api/_games.ts             per-cart dispatch: board size, prompt, schema, legality, analysis
api/_ratelimit.ts         per-IP + global quota limiting, KV-backed, fails open
api/_types.ts             the /api/move wire contract, shared with the client
carts/*.p8                PICO-8 sources; exported into public/games/
public/games/*.{html,js}  exported carts; the iframe loads the .html
src/components/           iframe embed, GPIO poll loop, cart switcher, reasoning panel
src/lib/                  gpio.ts (byte protocol per cart) + ai.ts (calls /api/move)
src/styles/               design tokens (PICO-8 palette, geometry) + global reset
tests/                    node:test suites — fast, no browser, no network
playwright/               browser suite — Chromium, WebKit, mobile Safari
bench/                    prompt benchmarks against the real model + recorded results
LICENSE / NOTICE          MIT, plus the Lexaloffle carve-out for public/games/
```

> `vercel.json` is intentionally empty. A catch-all SPA rewrite breaks `vercel dev` by
> intercepting Vite's dev modules (`/src/main.tsx`, `/@vite/client`) and returning HTML
> for them. Only add a dev-safe rewrite if client-side routing is introduced.

## Roadmap

- **Two-ply sight.** The one measured weakness, and it belongs to the model rather than the
  prompt. Tic-tac-toe loses to a two-corner fork; Connect Four answers the equivalent
  position — one move creating two winning threats — with the centre column **0 out of 9
  times, across every prompt variant tested**. Two carts, two prompt styles, the same blind
  spot. Closing it means computing "this move creates two threats" in code, which is a
  decision about how much the program plays rather than a prompt to tune.
- **A third cart.** `api/_games.ts` and `PROTOCOLS` already make this one entry each and no
  edit to `move.ts` — the shared contract exists and has been exercised once.
- **Not on the list: a perception layer for tic-tac-toe.** It was built, benchmarked and
  rejected. Computing the line facts in code made play *worse*: generating the derivation
  buys the model's *attention*, not its arithmetic, and handed the same facts as a table it
  skimmed and missed an immediate block. Connect Four ships a facts-based prompt because it
  won its own A/B; tic-tac-toe does not because it lost.
  See [`bench/results/README.md`](bench/results/README.md).

## License

[MIT](LICENSE) — with one carve-out, detailed in [NOTICE](NOTICE).

The MIT grant covers the source authored here (`src/`, `api/`, `carts/`, `tests/`,
`playwright/`, `bench/`, `docs/`). It does **not** cover `public/games/`, which holds
PICO-8 export artifacts: each cart ships ~1.7 MB of PICO-8 web player runtime,
© Lexaloffle Games LLP, redistributed under PICO-8's terms for exported carts rather than
relicensed.

The games themselves are not third-party content — the Lua in
[carts/](carts/) is MIT like the rest of the source. Only the player runtime that PICO-8's
HTML export wraps around it belongs to Lexaloffle. See [NOTICE](NOTICE) for the file list.
