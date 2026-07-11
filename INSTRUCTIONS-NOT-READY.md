<!--
  - Target under ~200 lines. High-signal only: things Claude would otherwise re-ask or get wrong.
  - Prefer concrete, verifiable rules ("use tabs to indent") over vague ones ("format nicely").
  - Reserve IMPORTANT / YOU MUST for the 1-2 genuinely load-bearing rules; overuse dilutes them.
  - Don't paste plans/checklists here (they go stale). Link them with @imports instead.
  - Update it when you catch yourself re-explaining something, or a new teammate would need it.
-->

# PICO-8 + Gemini AI Opponent

Turn-based PICO-8 games embedded in a React app, with a Gemini-powered AI opponent.
Single Vercel deploy: static frontend + a serverless proxy that holds the API key.

- **Stack:** Vite + React (frontend), Vercel serverless functions (`api/`), Gemini API (Flash-class model).
- **Games:** authored in PICO-8, exported to web (`.html` + `.js`), embedded and driven via GPIO.
- **Scope:** turn-based games only (real-time is out of scope — LLM latency makes it unworkable).

## Architecture at a glance

The PICO-8 cart cannot make network calls. It talks to the page through its **GPIO memory**
(`0x5f80`–`0x5fff`, 128 bytes), mirrored to a JS array `window.pico8_gpio`. The cart pokes/peeks;
the JS glue polls that array, calls the proxy, and writes results back. All networking lives in JS.

```
cart ⇄ pico8_gpio (128 bytes) ⇄ JS glue ⇄ /api/move (holds key) ⇄ Gemini
```

## GPIO protocol (source of truth — keep cart and JS in sync)

| Byte    | Meaning                                                        | Written by |
|---------|---------------------------------------------------------------|------------|
| `0`     | Status: `0` idle, `1` request, `2` thinking, `3` ready        | both       |
| `1..9`  | Board cells: `0` empty, `1` human, `2` AI                     | cart       |
| `10`    | AI's chosen move                                              | JS         |
| `11`    | Dialogue length header                                        | JS         |
| `12..`  | Dialogue chars (one ASCII code per byte)                      | JS         |

## Project structure

- `api/move.js` — serverless proxy: builds the prompt, calls Gemini, returns `{ move, say }`.
- `public/games/*.{html,js}` — PICO-8 web exports (static passthrough; never bundle/rename these).
- `src/lib/gpio.js` — GPIO constants + helpers (the protocol above).
- `src/lib/ai.js` — `fetch('/api/move')` + move validation / fallback.
- `src/components/Pico8Game.jsx` — loads a cart, wires `pico8_gpio`, runs the poll loop.

## Commands

- **Local dev:** `vercel dev` — YOU MUST use this, not `vite`. Plain `vite` won't run the `api/` proxy, so the AI won't work locally.
- **Build:** `npm run build`
- **Deploy:** push to the connected repo (Vercel auto-deploys) or `vercel --prod`.

## Critical rules

- **IMPORTANT: never reference `GEMINI_API_KEY` from `src/` or any client code.** It lives only in
  the serverless function's environment (`process.env`). Exposing it client-side is the one
  unrecoverable mistake here.
- **IMPORTANT: always validate the LLM's move** against legal cells before writing it to GPIO;
  fall back to a random legal move (or the local solver) on anything illegal, null, or malformed.
- **Sanitize dialogue to plain ASCII** in the proxy before sending it over GPIO. Strip smart quotes,
  em-dashes, ellipses, emoji — PICO-8's character set can't render them.
- Never commit `.env.local` or any secrets. It stays gitignored.
- Keep all turn/win logic in the cart. The AI supplies a move (and optional line), nothing more.
- One cart per page load (PICO-8 uses fixed globals). Switch games by navigation/reload, not teardown.

## Known pitfalls

- GPIO is one byte per value (0–255). Dialogue is capped at ~115 chars per batch; chunk longer text.
- Gemini free tier is Flash/Flash-Lite only, quota is per-project (not per-key), ~10–15 RPM.
  Handle 429s by returning `move: null` so the client falls back rather than erroring.
- `print()` doesn't word-wrap; the cart owns the text-box / wrapping logic.

<!-- Uncomment these imports once the files exist. Imports pull the referenced file into context. -->
<!-- ## References -->
<!-- See @README.md for setup and @package.json for the full script list. -->

---

<!-- ======================= FILL IN BELOW ======================= -->
<!-- These are yours to complete. Guidance is in comments; delete comments as you go. -->

## Code style & conventions
<!-- Be concrete and verifiable. Examples:
     - Indentation: 2 spaces, no tabs.
     - Components: function components + hooks only; no class components.
     - Naming: camelCase for functions, PascalCase for components, SCREAMING_CASE for GPIO constants.
     - Imports: prefer named exports; no default exports except React components.
     - Keep the GPIO protocol constants in ONE place (src/lib/gpio.js) — never hardcode byte offsets. -->
- TODO

## Testing
<!-- e.g.: how you test the GPIO handshake, what to run before committing, mocking the Gemini call. -->
- TODO

## Git workflow
<!-- e.g.: branch naming, commit message style, whether Claude may commit/push or only stage. -->
- TODO

## How I like Claude to work
<!-- Behavioral preferences that actually change output. Examples:
     - Make the smallest change that satisfies the request; don't refactor unrelated code.
     - Ask before adding a new dependency.
     - When touching the GPIO protocol, update BOTH the cart (.p8) and src/lib/gpio.js together. -->
- TODO

## Personal / local notes
<!-- Anything machine-specific or not for the team. Consider a separate .claude/rules/ file or an
     @import to a gitignored file instead of committing personal notes here. -->
- TODO