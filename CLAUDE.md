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
node scripts/favicon.ts                      # redraw the favicon from gem-in-eye's head (sprite 76)
```

`playwright/` is a separate suite from `npm test` — four projects in three engines, ~2 minutes,
needs `npx playwright install chromium webkit firefox` once. **WebKit is not redundant with Chromium**:
the cart switcher was keyboard-unreachable in Safari while passing every Chromium check.
**On macOS 27, Playwright's Firefox hangs at launch** with a core at 100% each, unless it has
app data of its own; `playwright.config.ts` gives it some. See `playwright/README.md`.

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
  **`Handheld.tsx`** draws the device around it: the shell, the cart in its slot, the POWER
  and GEMINI lights, the keyboard's light, the D-pad and keys, the speaker grille and the pause
  button, the Fullscreen, Eject and CRT buttons, and CRT's light and the volume slider in the
  bottom edge. `Pico8Game` passes the screen in as
  `children` and keeps everything about the cart. **`App.tsx`** owns the page's grid (header,
  carts, device, panel, About), rearranged at the widths in `src/styles/_breakpoints.scss`.
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
  The cart switcher shows `public/labels/<cart>.png`, which the export rewrites and the same
  test checks. After a `cart-label.ts restore`, which skips it, regenerate it with
  `node scripts/cart-label.ts png carts/<cart>.p8 public/labels/<cart>.png 1`.
  An edit to `gemini_dungeon.p8` means `/reexport-cart gemini`: the export bundles every cart
  the code loads by name.
  - **Gem-in-Eye's label is composed, not captured.** Its title, GEM-IN-EYE'S QUEST, is on no
    game screen, so a Ctrl-7 capture would silently replace the label and drop it. To change the
    picture, redraw only the pixels whose art changed, with `cart-label.ts`'s `readLabelPng` and
    `withLabel`, as `29f28bd` did. Then re-export as usual.
- **`carts/` is the only copy of a cart that counts.** PICO-8 resolves a bare `load` against
  its *own* carts folder, which has already left two tic-tac-toe carts drifting apart
  unnoticed. Never treat a cart file outside `carts/` as the source. The same goes for a cart
  calling `load()`: run Gem-in-Eye with `pico8 -root_path <repo>/carts`, or the hub's door
  finds no dungeon.
- **Never name a global after a PICO-8 built-in.** A global `flip` replaced the function
  PICO-8's main loop calls every frame and crashed the cart, with no warning beforehand.
- **Input that changes during a `load()` is lost.** A key released mid-load stays held in the
  next cart, and one pressed then never arrives. That is why `playwright/doors.spec.ts` steers
  through `pico8_buttons` and not the keyboard (see `playwright/README.md`); a keyboard
  version of it was flaky.
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
- **`tabIndex={0}` on a `<button>` or a link is required, not redundant.** WebKit leaves
  buttons and links out of the tab order unless macOS keyboard navigation is enabled, so on
  default Safari the carts, the theme control, Fullscreen, Eject, CRT, the volume slider, the header's links and About's links
  are unreachable by keyboard without it — Tab cycles the iframe and body only. It looks like
  something a linter should strip; deleting it silently makes the page mouse-only for a
  large share of visitors. Verified against Playwright's WebKit, which reproduces the
  default. The handheld's D-pad, keys and pause button are the exception, `-1` on purpose
  (see below).
- **The PICO-8 export swallows Tab.** Its keydown handler blocks keyCode 9 with the cursor
  keys ("block only cursors, M R P, tab"), so once focus is inside a running cart only a
  mouse click gets it back out. Catching Tab from the page was tried and reverted: a
  capture-phase listener on the iframe's document works, but it took every Tab and moved
  focus invisibly. If the page ever needs a way out, make it a visible control, not a key
  handler fighting the runtime. The shell can't be patched either; a re-export regenerates it.
  - **So Tab reaches only what comes before the iframe in the DOM**, and the layout is built
    around that. The carts come first in the DOM at every width, and grid areas place them
    on screen. The handheld's bottom row (Fullscreen, Eject, CRT, then the volume slider) is
    first in `Handheld`'s DOM, in the order it's drawn, and CSS `order` draws it at the bottom.
    About comes after the cart, so the header's About link is the keyboard's way there:
    following `#about` moves Tab's starting point into it. A new control the keyboard needs
    goes before the iframe in the DOM. `eject.spec.ts` and `about.spec.ts` check these paths.
- **The cart's screen is a crop, and its numbers are PICO-8's.** The export draws the game at
  a whole multiple of 128 only when its frame, 95% of the iframe, is at least 512px. So from
  `$full-device` up the iframe is 540 × 539, 14px left of a 512px window that shows only the
  game (`Pico8Game.module.scss`). Those numbers are the export's layout, and a new PICO-8
  could move the game; `playwright/screen.spec.ts` fails if it does. The window is
  `overflow: clip`, not `hidden`: focusing the iframe scrolls a hidden box, which slid the
  crop sideways. **`scrolling="no"` on the iframe is required, not obsolete.** PICO-8's page
  overflows the iframe, and its scrollbars would show inside the screen and narrow the crop.
  Headless browsers draw no scrollbars, so no test can see them return; `screen.spec.ts`
  checks the attribute instead. Below `$full-device` the iframe is plain and column-wide.
  - **Below `$full-device` the game is not centred by PICO-8, so the page does it.** It draws
    the game at 95% of the iframe, pinned to the top, so all the slack lands underneath, and its
    page is #222 grey. `Pico8Game.module.scss` moves the iframe down 2.5%, with a `transform`
    because a percentage `top` needs a definite height, and `paintPageBlack` paints the page
    black on load, so the grey doesn't read as a second bezel. Neither applies in the phone's
    overlay, which gives PICO-8 the whole window. `screen.spec.ts` pins both at 620 and 480.
  - **The screen sits in black glass inside the bezel** (`.glass` in `Handheld`), so the game
    has room and its HUD doesn't touch the navy. The glass's width comes out of the bezel's:
    the bezel and glass at the sides and bottom still make the 20px `--device-width` counts, and
    the 34px above the screen is 8 + the lights + 8 + 10. Make either one bigger and
    `--device-width` and `--device-height` are wrong, and the screen specs fail.
- **On a short window the handheld is a transform.** Wider than `$full-device` and shorter
  than `$full-height`, it draws at 3/4 (`--device-scale`) and the rest of the page keeps its
  size. PICO-8 has to go on measuring a 540px iframe, so a smaller `--stage-size` would bring
  the blur back. CSS `zoom` keeps it 540px in Chromium and WebKit, and was never tried in
  Firefox, where the transform passes `screen.spec.ts`.
  Only 0.75 lands every 4px block on whole pixels at any pixel density. A transform leaves
  the box full-size, so `.device` sets the scaled height from `--device-height`, which is the
  shell's height copied by hand; `screen.spec.ts` fails if the two drift. `$full-height` and
  `$tight-height` in `_breakpoints.scss` are measured from it too, and so is the shortest window
  `layout.spec.ts` fits the arcade into, so a change to the shell's height moves all four. The cartridges come
  down with it through `zoom`, since they hold no iframe, all but their labels. Zoomed to 96px,
  a label loses one row and one column in four, and in Chromium which ones moves with the
  window's size, so it's drawn at 128 / 0.75 to stay 128 screen pixels. Its 32px are more than
  the shelf has to spare there, so at 3/4 the tagline is visually hidden to give them back.
  `labels.spec.ts` compares each label on screen with its PNG, at 1x, in Firefox too.
- **Touches inside the cart's page don't reach PICO-8, outside the phone's overlay.** At its
  first touch PICO-8 switches to its own touch layout: it shrinks the game to two thirds of its
  window, draws a controller over it, and zeroes `pico8_buttons` on every later touch, breaking
  the crop and the handheld's controls. `keepTouchOut` in `Pico8Game.tsx` stops touch events in
  the capture phase on each new iframe's window, unless the overlay has let them in. A tap
  still clicks, so the play button still starts the cart. `controls.spec.ts` checks this on the
  mobile project.
- **The handheld's D-pad, keys and pause button write `pico8_buttons[0]`**, the export's hook
  for on-page buttons, with the bits in `src/lib/buttons.ts`. Pause is `0x40`, the bit PICO-8's
  own touch controller sets for its menu button, and it opens the pause menu, where tic-tac-toe
  and Connect Four keep their two-player switch. Without it, a player with no keyboard could
  never reach that. Its face says PAUSE as O's says O, and its caption names the key, `OR P`.
  Not Enter, which pauses too: pressed while the page has focus, it presses whatever button has
  focus, such as the cart just picked. It sits under the grille, between the D-pad and the keys,
  wherever they fit three across: from `$middle-column` (520px), a narrow window's shell
  included. Under 502px the D-pad's caption would wrap, and the shell grow a line. A phone's
  shell is narrower, so there it's at the lettering's right edge, under a finger only (`.phonePause`):
  the keyboard's light isn't drawn under a finger, and a window that narrow under a mouse keeps
  the light and has P. Two buttons in the DOM, never both shown. The phone's overlay has
  PICO-8's own. Under a finger no control has a caption, there being no key to name: a phone's
  shell drops them and their room, and from `$middle-column` they're invisible but keep it,
  since from `$full-device` the shell's height is `--device-height`. The controls let go of
  everything on a cart change,
  since input held across a `load()` is lost, and when the tab is hidden. Not on window blur,
  which fires every time focus goes into the cart. A press leaves focus where it was, so the
  cart's own keys keep working. They are out of the tab order (`tabIndex -1`) on purpose:
  keyboard players have the real keys, and Tab can't get past the iframe to reach them.
  - **They move with the keyboard too, but it only draws.** `watchKeys` in `Pico8Game.tsx`
    listens in the iframe's window and passes `keyboardHeld` to the handheld. It stays out of
    `pico8_buttons`: the runtime already has the key, and `pressButtons` overwrites that whole
    int on every press. Keys pressed with focus outside the cart don't move anything, which
    is right, because the cart didn't get them either.
  - **The keyboard's light says whether keys reach the cart.** It's lit beside `KEYBOARD INPUT`
    while the cart's window has focus (`watchFocus` in `Pico8Game.tsx`). While it hasn't, the
    light is dark and the words read `CLICK SCREEN`. A cart key pressed on the page then flashes
    the light red, not GEMINI's orange, so each colour means one thing, and the words stay
    still. Focus going into the cart, or the slot emptying, cuts a flash short, so it never
    covers the green or lights an empty slot.
    With the slot empty it's dark beside `KEYBOARD INPUT`, since there's nothing to click into.
    Under a finger the line isn't drawn at all. The light is one element after the words, at the
    row's edge as GEMINI's is on the bezel, so it never moves when they change, as a light on
    real hardware wouldn't. Both lines of words share one grid cell, so the swap can't wrap the
    row and make `--device-height` wrong, and the light is empty, so it sits on their baseline
    and can't make the row taller. The hint follows a cart being in the slot, not POWER:
    tied to POWER, a cart switch showed it, dropped it while the next cart loaded, and showed it
    again. Every handheld button keeps focus on a mouse press (`keepFocus` in `Handheld.tsx`).
    One that doesn't hands the keyboard to the page, and flashes the hint for as long as it's
    held. The key itself is never redirected into the cart, which would be focus moving
    invisibly. Playwright's clicks are instant and the local server is fast, so the flicker
    specs hold the press 150ms and the next cart's page 500ms.
  - **The D-pad rocks as one piece.** `.cross` is the plastic and tips on its centre, and
    `.dpad` draws the dark base behind it. The lip is how far the plastic stands out of the
    shell, so it closes under a held arm and opens on the far side. A base left still does the
    reverse, showing around the arm as it narrows, which reads as the wrong way round. The
    tilt rules use `:has()` on the arms and fail silently without them. **Playwright's WebKit paints 3D flat in
    a screenshot**, headless or headed: no taper, and a `perspective()` in the transform comes
    out twisted. Its layout is right, matching Chromium to the decimal, so measure 3D with
    `getBoundingClientRect` as `controls.spec.ts` does, and judge the look in Chromium or Safari.
- **The bottom row is named by its icons, and CRT's light reads `aria-pressed`.** Each button's
  name is visually hidden text (`.name`), which is what screen readers and every spec find it by,
  so a new button there needs one. CRT's light in the shell's bottom edge is lit by
  `.shell:has(.crtButton[aria-pressed='true'])`, so it can't disagree with what a screen reader
  hears; `crt.spec.ts` compares its colour with POWER's. It sits `--action-step` right of the
  shell's centre, the step the buttons are spaced by, so moving one moves the other.
- **The volume slider is a gain the page puts between PICO-8 and the speakers.** PICO-8's own
  volume is in its pause menu, and the export lets the page only mute it
  (`Module.pico8ToggleSound`) and read it back (`pico8_state.sound_volume`), never set it. So the
  slider is a second volume after the menu's, as a Game Boy's wheel is after a game's options.
  `routeAudio` (`src/lib/volume.ts`) wraps `AudioNode.prototype.connect` in the cart's window, so
  PICO-8's connection to the destination lands on a gain, one per context. It must be in before
  PICO-8 connects, which is when the cart starts: `Pico8Game` routes from the iframe's `onLoad`,
  and a cart started before that would play at full volume until the next one. A Gem-in-Eye door
  is a `load()` inside the same page, so the gain stays, though no cart there has sound yet to
  prove it. The level is the slider squared, since loudness is heard on a log scale. A mouse or
  a finger drags the drawing, with pointer capture and `keepFocus` like the D-pad, so the
  keyboard stays in the cart; a visually hidden range input is the keyboard's and screen
  readers', and its focus is drawn on the slot. `volume.spec.ts` listens to what reaches the
  speakers in Chromium, WebKit and Firefox. Its listener goes in at the iframe's first, blank document,
  because Chromium keeps that window for the cart's page and Playwright doesn't run init scripts
  again there. A phone's shell has no slider, nor room for one beside CRT's light.
- **Fullscreen is the export's own, run from outside its page.** The handheld's button calls
  `p8_request_fullscreen()` in the iframe, which fullscreens PICO-8's play area, so PICO-8
  draws a whole multiple of 128. `iframe.requestFullscreen()` also works, but PICO-8 can't tell
  and draws 768 where 1024 fits. Focus has to go to the iframe by hand: `p8_give_focus`, which
  the export's own button uses, targets a `display:none` textarea here, leaving a cart that
  looks right and takes no keys. The cart must stay in this page's iframe, because the poll
  loops live here: moving it reloads the run, and opening `/games/<cart>.html` directly shows
  a working game with no AI, every turn falling back to minimax. The panel is hidden
  meanwhile, so fullscreen stays something the player chooses.
  - **A finger gets an overlay, not fullscreen.** iPhone has no element fullscreen, and real
    fullscreen elsewhere would cover the D-pad. So on `(hover: none), (pointer: coarse)` the
    button makes `.screen` a popover over the page, and flips the export's private switches:
    `p8_touch_detected` turns on PICO-8's controller and `p8_allow_mobile_menu` off its icons,
    whose fullscreen and X do nothing here. It's a popover because the top layer is the way out
    from under the handheld's transform, and it needs `position: fixed` in `.overlay`, since
    `.screen`'s `position: relative` outranks the browser's: without that it sits at the top of
    the page, off screen, because the button is always reached by scrolling.
    `p8_touch_detected` has to come after `p8_run_cart`, or the export's boot takes its touch
    path, which rearranges its page and adds a `#playing` hash. Leaving clears `pico8_buttons`,
    because a finger still down never gets to let go. Safari's bars stay. **`overlay.spec.ts`
    runs in an engine with none, so anything about them needs a real iPhone.** PICO-8 only
    cancels a touch on its controller, so a drag anywhere else ran out of the iframe and
    scrolled the page, showing About through the gaps on a real phone. `holdPageStill` cancels
    every touch in the cart's page, with `passive: false` because Safari ignores the cancel
    otherwise, and `.cart-overlay` in `global.scss` is the backstop: the page can't scroll and
    isn't drawn, with black behind it. It has to stay in the DOM, since the poll loops live in it.
    WebKit's emulation can't drag; Chromium's can, with `Input.synthesizeScrollGesture`. WebKit stops the
    frames of an iframe out of sight, so PICO-8's layout and the game wait while it's scrolled
    away, and an overlay left off screen looks like a controller that never appeared.
    - **PICO-8's controller has O and X the other way round from the handheld**, X lower-left,
      so `matchHandheld` (`src/lib/controller.ts`) trades them, or going fullscreen swaps them
      under the player's thumbs. It redraws `p8_gfx_dat.controls_right_panel` with the two
      circles turned 180° about the point between them, and wraps `pico8_buttons_event`, which
      every touch listener calls by name, to trade the two bits after it. That handler starts each
      touch from 0, so trading after it can't drift. The picture and the bits trade together or
      not at all: if `findCircles` doesn't find the picture it expects, both stay PICO-8's,
      since buttons that don't do what they show are worse than buttons on the wrong side.
      `tests/controller.test.ts` reads the picture out of every export, so a PICO-8 that redraws
      it fails there, and `overlay.spec.ts` taps each circle.
  - **A control in real fullscreen has to be inside the cart's page.** While the iframe is
    fullscreen it takes every click, so a `popover` in this page draws over it and can't be
    pressed, in Chromium and WebKit alike. The overlay isn't real fullscreen, so its Exit stays
    in the page, beside the iframe, where PICO-8 can't cancel the touch.
    `FullscreenLayer.tsx` is a portal into `p8_playarea` for this reason. The
    site's CSS and fonts stop at the iframe, so it carries `src/styles/fullscreen-layer.scss`
    and Silkscreen in with it, both `?inline`. The Exit button is out of the tab order, since
    the cart swallows Tab and keyboard players have Esc.
  - **The CRT filter is a WebGL shader, `src/lib/crt.ts`, drawn inside the cart's page.**
    `CrtScreen.tsx` portals its canvas into `p8_playarea` at every size, so the handheld,
    fullscreen and the overlay share one filter and one context, and it covers the game, not
    PICO-8's controller. It follows the canvas frame by frame, since a phone puts the game near
    the top, and redraws PICO-8's 128px canvas: sharp across with red and blue fringes, fine
    scanlines (as many to a row as fit about 4 device pixels apart), RGB stripes, a glow from
    mipmaps, and a sway, a hum bar and a flicker. Those three move only while the system allows
    motion: under `prefers-reduced-motion` the tube is drawn still, read from the cart's own
    window every frame. A picture bigger than `LARGEST_PICTURE` (1024) is drawn whole for as long
    as frames keep up, and capped at 1024, enlarged smoothly, once `watchPace` finds them under
    about 28 a second: on a machine with no GPU a 2048 fullscreen held the game itself to 43.5fps.
    The cap is one-way for that tube, or it would uncap and slow down again, and `data-pace="slow"`
    on `.crt-screen` says when it has happened. Specs can't count on a test machine's speed, so
    they accept either size in fullscreen and force the slow case on purpose. `src/styles/_crt.scss` is the old CSS overlay, kept for what the
    shader can't draw: PICO-8's poster before a cart starts (`.crt::after`, off once `CrtScreen`
    reports the game) and no WebGL or a lost context (`.crt-screen`'s own background, behind
    the transparent canvas). Its lines are in game pixels through `--crt-px`. **A broken shader
    is silent**, because the fallback still looks like a CRT filter, so test it by reading its
    buffer, not a screenshot (`crt.spec.ts`). Never lose the context in an effect's cleanup: a
    canvas keeps one context for life, and StrictMode's second mount got the dead one back. The
    row reads force mip level 0, or the GPU picks a blurred level at each row's edge and smears
    every line sideways, in WebKit and not headless Chromium's software GL. Fullscreen only
    carries the player's choice over: the CRT button is on the handheld.
- **Body text sizes are `calc(Npx + var(--text-step))`.** On a `$big` window that adds 2px, and
  `--page-width` grows with it, so a bare `font-size` in the page's text silently misses the
  step. Silkscreen stays out of it, being sharp only at multiples of 8px, and so does anything
  on the handheld or a cartridge: they're objects, and keep their scale.
- **Colours belong in `src/styles/`, never in a `.tsx`.** Badges carry a semantic `kind`
  (`win`/`threat`/`notice`) that maps to a class; a hex code in a component would be
  invisible to the light/dark switch. The handheld's and the cartridges' colours are a group
  of their own in `tokens.scss`, outside the theme mixins on purpose: the device is a
  physical object and looks the same in both themes.
- **Silkscreen is set only at multiples of 8px, and in px.** A font pixel is 1/8 em, so any
  other size, a `rem` or a fluid `clamp()`, lands between pixels and blurs, and any
  `letter-spacing` pushes letters off the grid. It is bundled from `@fontsource/silkscreen`
  (OFL) in `main.tsx`.
- **`src/lib/site.ts` is Ethan's to fill in by hand:** the bio and links About shows. An empty
  field is left off the page, so leave one empty rather than inventing a placeholder.
- **A hot reload of `Pico8Game.tsx` turns POWER off.** It resets the cart's status to
  `loading` but keeps the iframe, so `onLoad` never fires again: POWER goes dark and both
  poll loops skip every tick, so the AI stops answering. It's dev-only; reload the page.
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
