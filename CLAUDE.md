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
node bench/talk.ts --dry                         # gem-in-eye's dialogue bench; drop --dry to spend quota
npm run test:playwright                      # browser suite; boots Vite itself, no API key
npx playwright test --project=webkit         # the engine that catches the real bugs
node scripts/export-cart.ts gemini           # re-export a cart headless; runs the PICO-8 app
node scripts/cart-label.ts png carts/gemini.p8 label.png   # look at a cart's saved label
```

`playwright/` is a separate suite from `npm test` — three engines, ~10s, needs
`npx playwright install chromium webkit` once. **WebKit is not redundant with Chromium**:
the cart switcher was keyboard-unreachable in Safari while passing every Chromium check.
See `playwright/README.md`.

`bench/` calls Gemini for real, reading `GEMINI_API_KEY` straight out of `.env.local`. It is
a local tool only — CI never runs it, and it burns free-tier quota, so `--runs`/`--gap` are
worth setting deliberately. Results land in `bench/results/`; see the README there before
comparing two files.

Everything under `src/`, `api/` and `tests/` is TypeScript. The test glob still spans
`{js,ts}` so a stray `.js` test would not be skipped silently, and it must stay **quoted**
— Node expands it, and zsh would fail on the braces first.

`tests/_mocks.ts` holds the shared `VercelRequest`/`VercelResponse` and `fetch` fakes. It
is underscore-prefixed and not a `*.test.*` file, so the runner's glob skips it.

**`npm run dev` runs Vite only**, so `/api/move` and `/api/talk` 404 and the AI silently does nothing. Only
`vercel dev` runs the serverless functions. It reads `.env.local` and `api/` **at boot** —
after editing either, fully restart it (a Vite hot-restart is not enough).

## Architecture

A PICO-8 cart cannot make network calls, so the AI opponent is driven across four layers:

```
cart (Lua) ⇄ pico8_gpio (128 bytes) ⇄ React poll loop ⇄ /api/move ⇄ Gemini
```

- **`carts/tic_tac_toe.p8`** owns all game logic (turns, win detection) and a local minimax.
  On the CPU's turn it publishes the board to GPIO and waits.
- **Gem-in-Eye is two carts in one export.** `carts/gemini.p8` boots: the hub, the shop,
  Claude's talk and the GPIO bridge. `carts/gemini_dungeon.p8` is the combat and never touches
  GPIO. Each door is a `load()` that resets the machine, so the run crosses in `load()`'s param
  string, packed in `carry`'s order and read back with `stat(6)`. A load costs about a frame on
  the web. Desktop PICO-8 is noticeably slower, so judge speed in an export, not the editor.
- **`src/components/Pico8Game.tsx`** embeds the cart's *exported `.html`* in an iframe (not the
  `.js` — the export needs its own shell) and polls `contentWindow.pico8_gpio` every 100ms.
- **`src/lib/gpio.ts`** is the byte-protocol source of truth, one `PROTOCOLS` entry per game
  cart and one `TALK_PROTOCOLS` entry for the shop cart (see `docs/gpio-protocol.md`);
  each cart's Lua half must match its entry, and `tests/gpio-protocol.test.ts` parses the Lua
  to check that it does. Nothing outside this file may hardcode a byte offset or board size.
- **`api/move.ts`** holds the API key, calls Gemini, and returns the move plus the model's own
  analysis, which `TurnPanel.tsx` renders as evidence a real LLM chose it. It is
  **game-agnostic**: everything per-cart comes from `api/_games.ts`.
- **`api/talk.ts`** voices gem-in-eye, the shopkeeper in `carts/gemini.p8`: on a purchase it
  judges the agent, prices the sale and speaks. It is a sibling of `move.ts`, not a game in
  `_games.ts`, because a speech has no legal set or right answer.
  - **`api/_talk_prompt.ts`** holds the prompt: only the voice that ships. The versions the
    bench compared to get there are in git history at `e3b5902`, and the digit rules tried
    on 3.5 Flash-Lite at `936982a`, beside their results in `bench/results/`.
  - **`api/_talk_text.ts`** cleans the speech and pages it to the cart's own `wrap_text`.
  - **`api/_talk_request.ts`** validates the request.
  - Both endpoints share the Gemini call, retry, quota and origin rules in
    **`api/_ask_gemini.ts`**.
  - **Only `/api/talk` hedges, on purpose.** If the first call has not answered at
    `HEDGE_MS` (5s), an identical second one goes out and the first success wins. It is on
    trial there before `/api/move` gets it. A call already retrying 503s is never hedged.
  - On the page, `Pico8Game.tsx` runs a second poll loop for talk carts. **`src/lib/talk.ts`**
    holds the client and gem-in-eye's memory in `localStorage`, keyed per speaker, and
    **`TalkPanel.tsx`** shows what he was shown and what he said.
- **`api/_games.ts`** is the per-cart dispatch table — board size, prompt, decoding config,
  move parsing, legality, and which analysis fields that game returns. Adding a cart should
  mean one entry here plus one in `PROTOCOLS`, and no edit to `move.ts`.
- **`api/_prompt.ts`** (tic-tac-toe) and **`api/_connect_four.ts`** own the prompts. They live
  outside `move.ts` so `bench/` can import the *real* prompt instead of a copy that would
  drift.

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
- **Timeout budget chain:** `getAiTurn` (12s, `src/lib/ai.ts`) must stay *below* the cart's
  `ai_max_frames` (450 frames ≈ 15s). If the cart gives up first it self-plays and the
  read-back finds nothing, so the panel loses the played cell. `CLIENT_ABORT_MS` in
  `api/_ask_gemini.ts` (shared by both endpoints) is a third copy of the same number — it only drives the `TOO-LATE` log
  marker, but if it disagrees the logs misreport which turns the player actually saw.
  Raising the client side past ~13s means raising `ai_max_frames` too, which costs a cart
  re-export (`/reexport-cart`).
- **The quota cap counts Gemini calls, not requests.** `reserveGeminiCall()` sits *inside* the
  retry loop in `askGemini` (`api/_ask_gemini.ts`) — one request can issue several calls.
- **`EXPIRE … NX`, never a plain EXPIRE** in `_ratelimit.ts`; refreshing the TTL each increment
  would push the window out forever and the counter would never reset.
- **Rate limiting fails open.** Any KV error degrades to a per-instance memory Map. A limiter
  outage must never break the game.
- **The model id and decoding settings live in `api/_gemini.ts` and nowhere else.** `move.ts`
  and `bench/_shared.ts` both import them, so the harness cannot benchmark a different model
  than production serves. `bench/variants.ts` builds its `current` control by spreading
  `GENERATION_CONFIG`; restating `temperature` there would make the control not a control.
- **The panel may only present as evidence what the model actually produced.** `TurnPanel`
  exists to show a real LLM chose the move, so anything it renders as reasoning must have
  been *generated*, not supplied. Tic-tac-toe's `lines` qualify — the model derives them.
  Connect Four's threat lines do **not**: `api/_connect_four.ts` computes them and puts them
  in the prompt, so echoing them back would be our own numbers dressed as the model's. Only
  its `reasoning` string is the model's own. Any future cart that moves more derivation into
  code moves the same content out of the evidence column, and the panel has to follow.
- **Analysis fields are per-game, and each game sends only its own.** Tic-tac-toe fills
  `lines`/`winMove`/`blockMove`; Connect Four fills `reasoning`. `TurnPanel` picks its layout
  from which is present, so a game emitting both would render two contradictory records of
  one move. `spec.analysis()` in `_games.ts` is the single place that decides.
- **`game` is sent explicitly and checked against the board length.** Never infer the cart
  from `board.length` — a third cart with 42 cells would then be silently misread. A
  mismatch is a 400.
- **`memory.lastSpeeches` in a `/api/talk` request is untrusted.** The page keeps gem-in-eye's
  past speeches in `localStorage`, which a player can edit, so they are the one route by which
  typed text could reach a prompt. `_talk_request.ts` cleans them to the cart's character set,
  keeps the last 3, caps their length, and the prompt quotes them as data. Don't loosen that.
- **The `/api/move` and `/api/talk` wire contracts live in `api/_types.ts` and nowhere else.** `move.ts`
  annotates its response bodies with it and `src/lib/ai.ts` imports it, so the producer and
  consumer break together. Restating the shape on either side reintroduces silent drift —
  that is how `emptyCell` vs `emptyCells` shipped past typecheck, tests and build.
- **Gem-in-Eye's two carts share a section byte for byte.** `-- >> shared` to `-- << shared`
  holds the knight, the hud, collision, doors and `carry`. It must be identical in both carts,
  and it draws only from sprites 0-63, which must match too. Edit it in one cart and copy it to
  the other; `tests/cart-bundle.test.ts` fails otherwise. `carry`'s order is the param's format,
  so a key added on one side shifts every value after it. What crosses must be a number or a
  word, because `split` leaves `"false"` a truthy string: a flag goes as 0/1.

## Gotchas

- **Cart edits need a PICO-8 re-export.** After editing a `.p8`'s code, sprites, map, sound or
  label, tell the user to run `/reexport-cart <cart>`, which re-exports through
  `scripts/export-cart.ts` (PICO-8's headless `-export`) and checks the result. It is
  manual-only because it runs the PICO-8 app outside the repo, so Claude cannot invoke it,
  and for the same reason should not run `scripts/export-cart.ts` unasked.
  Comment-only edits need no re-export. A label edit does: the `.html` embeds the label as the
  poster behind the play button, and `tests/cart-labels.test.ts` fails until the two agree.
  An edit to `gemini_dungeon.p8` means `/reexport-cart gemini`: the export bundles every cart
  the code loads by name.
- **`carts/` is the only copy of a cart that counts.** PICO-8 resolves a bare `load` against
  its *own* carts folder, which has already left two tic-tac-toe carts drifting apart
  unnoticed. Never treat a cart file outside `carts/` as the source. The same goes for a cart
  calling `load()`: run Gem-in-Eye with `pico8 -root_path <repo>/carts`, or the hub's door
  finds no dungeon.
- **Never name a global after a PICO-8 built-in.** A global `flip` replaced the function
  PICO-8's main loop calls every frame and crashed the cart, with no warning beforehand.
- **Gem-in-Eye's shop backdrop is the hub's sprites 128-255**, one `memcpy` to the screen's
  top half. Anything drawn there shows up behind gem-in-eye. Neither cart has sound yet, so
  music and SFX have both carts' sound memory free.
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
- **`tabIndex={0}` on a `<button>` is required, not redundant.** WebKit leaves buttons and
  links out of the tab order unless macOS keyboard navigation is enabled, so on default
  Safari every control in `CartCard.tsx` and `ThemeToggle.tsx` is unreachable by keyboard
  without it — Tab cycles the iframe and body only. It looks like something a linter should
  strip; deleting it silently makes the page mouse-only for a large share of visitors.
  Verified against Playwright's WebKit, which reproduces the default.
- **Colours belong in `src/styles/`, never in a `.tsx`.** Badges carry a semantic `kind`
  (`win`/`threat`/`notice`) that maps to a class; a hex code in a component would be
  invisible to the light/dark switch.
- Diagnostic signature: if the AI always plays the **first empty cell**, `GEMINI_API_KEY` is
  unset and `api/move.ts` took its no-key branch.
- Module state does not survive `vercel dev`'s per-request reload, which is why rate-limit
  counters live in KV rather than memory.

## Known limitation — two-ply sight, in both carts

The move priority (win → block → center → corner) has no concept of forks, so a player taking
two opposite corners can still win at tic-tac-toe. See the Roadmap in `README.md`.

This is not a tic-tac-toe quirk. Connect Four reproduces it exactly: the `double-threat`
fixture, where one column creates two winning threats at once, is **0/9 across every prompt
variant tested** — always answered with the centre column. Two carts, two prompt styles, the
same blind spot, measured (`bench/results/README.md`).

Treat it as a property of the model rather than a prompt that needs more work. The only
variant that ever solved a fork did so by having the answer computed for it — which is a
decision about how much the code plays, not a prompt fix. The cart's own fallback shares the
blind spot, which is one reason strengthening it would misrepresent where the intelligence is.
