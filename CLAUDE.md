# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
vercel dev                                   # local dev — USE THIS, not `npm run dev`
npm test                                     # full suite (node:test, no framework)
npm run typecheck                            # tsc --noEmit; the suite does NOT typecheck
node --test tests/ratelimit.test.ts          # one file
node --test tests/a.test.ts tests/b.test.ts  # several files
node --test --test-name-pattern="fail-open" "tests/**/*.test.{js,ts}"   # filter by name
npm run test:watch                           # watch mode
npm run build                                # production build -> dist/
npm run bench                                # prompt benchmark; SPENDS Gemini quota
node bench/ab.ts --variants current,perception   # A/B prompt variants
```

`bench/` calls Gemini for real, reading `GEMINI_API_KEY` straight out of `.env.local`. It is
a local tool only — CI never runs it, and it burns free-tier quota, so `--runs`/`--gap` are
worth setting deliberately. Results land in `bench/results/`; see the README there before
comparing two files.

Everything under `src/`, `api/` and `tests/` is TypeScript. The test glob still spans
`{js,ts}` so a stray `.js` test would not be skipped silently, and it must stay **quoted**
— Node expands it, and zsh would fail on the braces first.

`tests/_mocks.ts` holds the shared `VercelRequest`/`VercelResponse` and `fetch` fakes. It
is underscore-prefixed and not a `*.test.*` file, so the runner's glob skips it.

**`npm run dev` runs Vite only**, so `/api/move` 404s and the AI silently does nothing. Only
`vercel dev` runs the serverless functions. It reads `.env.local` and `api/` **at boot** —
after editing either, fully restart it (a Vite hot-restart is not enough).

## Architecture

A PICO-8 cart cannot make network calls, so the AI opponent is driven across four layers:

```
cart (Lua) ⇄ pico8_gpio (128 bytes) ⇄ React poll loop ⇄ /api/move ⇄ Gemini
```

- **`carts/tic_tac_toe.p8`** owns all game logic (turns, win detection) and a local minimax.
  On the CPU's turn it publishes the board to GPIO and waits.
- **`src/components/Pico8Game.tsx`** embeds the cart's *exported `.html`* in an iframe (not the
  `.js` — the export needs its own shell) and polls `contentWindow.pico8_gpio` every 100ms.
- **`src/lib/gpio.ts`** is the byte-protocol source of truth; the cart's Lua half must match it.
- **`api/move.ts`** holds the API key, calls Gemini, and returns the move plus the model's own
  analysis, which `TurnPanel.tsx` renders as evidence a real LLM chose it.
- **`api/_prompt.ts`** owns `buildPrompt`. It lives outside `move.ts` so the benchmark harness
  in `bench/` can import the *real* prompt instead of keeping a copy that would drift.

### Byte 10 has two meanings in one handshake

The page writes the move to play (or `NO_MOVE`, 255). The cart then **overwrites byte 10 with
the cell it actually played** before returning to idle, so the page can read back what really
happened. Understanding this requires `gpio.ts`, `Pico8Game.tsx` (`readCartPlayedMove`) and the
cart's `update_ai()` together.

### The fallback is the cart's minimax, not a random move

When Gemini is rate-limited, times out, errors, or returns an illegal cell, the page sends
`NO_MOVE` and the cart plays its own minimax. The LLM is the player; minimax exists only for
availability. The panel labels these turns explicitly — never present a fallback move as the
model's.

## Cross-file invariants

Breaking any of these fails silently, so verify them when touching the relevant code:

- **JSON key order in `buildPrompt` (`api/_prompt.ts`) is load-bearing.** Keys generate in
  order, so each field is conditioned on the ones above it. `commentary` must stay **last**,
  after `move`, or flavour text starts steering the game. `bench/ab.ts` checks this per call
  and reports it as `commentaryLastAlways`.
- **Timeout budget chain:** `getAiTurn` (~10s, `src/lib/ai.ts`) must stay *below* the cart's
  `ai_max_frames` (~15s). If the cart gives up first it self-plays and the read-back finds
  nothing, so the panel loses the played cell.
- **The quota cap counts Gemini calls, not requests.** `reserveGeminiCall()` sits *inside* the
  retry loop in `askGemini` — one request can issue several calls.
- **`EXPIRE … NX`, never a plain EXPIRE** in `_ratelimit.ts`; refreshing the TTL each increment
  would push the window out forever and the counter would never reset.
- **Rate limiting fails open.** Any KV error degrades to a per-instance memory Map. A limiter
  outage must never break the game.
- **The model id and decoding settings live in `api/_gemini.ts` and nowhere else.** `move.ts`
  and `bench/_shared.ts` both import them, so the harness cannot benchmark a different model
  than production serves. `bench/variants.ts` builds its `current` control by spreading
  `GENERATION_CONFIG`; restating `temperature` there would make the control not a control.
- **The `/api/move` wire contract lives in `api/_types.ts` and nowhere else.** `move.ts`
  annotates its response bodies with it and `src/lib/ai.ts` imports it, so the producer and
  consumer break together. Restating the shape on either side reintroduces silent drift —
  that is how `emptyCell` vs `emptyCells` shipped past typecheck, tests and build.

## Gotchas

- **Cart edits require a manual PICO-8 re-export** (`load`, then `export tic_tac_toe.html`) and
  copying both files into `public/games/`. This cannot be scripted. Comment-only edits to the
  `.p8` need no re-export.
- **Files in `api/` become public routes** unless underscore-prefixed — that is why the limiter
  lives in `api/_ratelimit.ts`.
- **Never prefix an env var with `VITE_`** — those are inlined into the browser bundle.
- **`allowImportingTsExtensions` and `rewriteRelativeImportExtensions` are a pair.**
  Imports carry explicit `.ts`/`.tsx` extensions so Node resolves them while stripping
  types for `npm test`. Vercel's builder *emits* `.js`, and TypeScript never rewrites
  specifiers on its own — so without the rewrite flag the emitted `api/move.js` still
  imports `./_ratelimit.ts`, a file that does not exist in the bundle, and every request
  dies with `FUNCTION_INVOCATION_FAILED` before the handler runs. Drop either flag and one
  of the two runtimes breaks. `npm test`, `typecheck`, `build` and `vercel dev` all pass
  either way; only a real deploy fails.
- **TypeScript must stay on 5.x.** Vercel's serverless builder compiles `api/*.ts` with
  the project's *local* TypeScript ("Using TypeScript X (local user-provided)" in the build
  log). TypeScript 7 is the Go rewrite and does not expose the compiler-host API the
  builder calls, so the deploy dies with `Cannot read properties of undefined (reading
  'readFile')` — after `vite build` has already succeeded, which makes it look like a
  frontend problem. `npm test`, `npm run typecheck` and `npm run build` all pass on 7;
  only `vercel build` fails. Reproduce deploy issues with `vercel build`, not `npm run build`.
- **Node runs `.ts` tests by stripping types, not compiling them**, so `npm test` passes on
  code that does not typecheck, and only *erasable* syntax works — no `enum`, `namespace`,
  or parameter properties. `erasableSyntaxOnly` in `tsconfig.json` turns that runtime
  failure into a typecheck error; don't remove it. Type-only imports need `import type`.
- **The theme storage key is duplicated on purpose.** `index.html`'s inline pre-paint
  script and `STORAGE_KEY` in `ThemeToggle.tsx` must stay in agreement. That script cannot
  be a module — a deferred one runs after first paint, so a stored choice that disagrees
  with the OS flashes the wrong theme on every load. Changing one side alone silently
  reintroduces the flash.
- **Colours belong in `src/styles/`, never in a `.tsx`.** Badges carry a semantic `kind`
  (`win`/`threat`/`notice`) that maps to a class; a hex code in a component would be
  invisible to the light/dark switch.
- Diagnostic signature: if the AI always plays the **first empty cell**, `GEMINI_API_KEY` is
  unset and `api/move.ts` took its no-key branch.
- Module state does not survive `vercel dev`'s per-request reload, which is why rate-limit
  counters live in KV rather than memory.

## Known limitation

The move priority (win → block → center → corner) has no concept of forks, so a player taking
two opposite corners can still win. See the Roadmap in `README.md`.
