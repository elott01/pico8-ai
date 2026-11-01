# Browser tests

```sh
npm run test:playwright      # all three projects
npm run test:playwright:ui   # watch mode with a time-travel debugger
npx playwright test --project=webkit
```

Separate from `npm test`, which is node:test only, runs in ~3s and needs nothing. These boot
Vite and drive real browser engines.

**No API key, no quota, no `vercel dev`.** The carts are static files, and the one test that
needs a model response stubs `/api/move` in the page — which also makes it deterministic
rather than hostage to a model whose p95 has been measured at 14s.

First run downloads browsers:

```sh
npx playwright install chromium webkit
```

## Why three projects

| project | covers |
| --- | --- |
| `chromium` | the common case |
| `webkit` | **the reason this suite exists** |
| `mobile-safari` | real touch — `hasTouch`, mobile viewport, not just a narrow window. The only project where PICO-8's own touch layout can switch on |

WebKit is not redundant with Chromium. The cart switcher was keyboard-unreachable in Safari
while passing every Chromium check, because WebKit leaves buttons out of the tab order unless
macOS keyboard navigation is enabled. A single-engine suite stays green through that entire
bug. Verified by mutation: deleting the `tabIndex={0}` from `CartCard` fails `webkit` and
leaves `chromium` passing. Links are left out the same way, and the header's Source link was
once committed without it: `about.spec.ts` now fails in `webkit` if a header link loses its
`tabIndex={0}`.

## What each file guards

- **`keyboard.spec.ts`** — tab order reaches every cart, focus is visibly painted, Enter
  switches, the live region announces. Focus that moves invisibly is indistinguishable from a
  keyboard that does nothing, which is how the Safari bug was first misdiagnosed.
- **`layout.spec.ts`** — no sideways scroll, every cartridge the same size (the empty slot
  included), WCAG 2.5.5 target sizes, the 7×6 board still fitting after a switch, and Source
  opening in a new tab. Runs at every project's viewport, because these only break at
  particular widths. The size check runs at 1400px too, where the carts stand in a column:
  in a row, stretching hides a mismatch. Also that the shelf, shell and panel fit a laptop's
  window and end level, from 1208 x 879 to 2560 x 1440, that a 3/4 cartridge keeps its
  full-size shape, and that the panel's title matches the shelf's in font and position. Also
  that the arcade has the first screen to itself, so the window's edge can't cut About, that
  About lines up with it at every layout, and which windows get the wider page and larger
  text: a regular one must not.
- **`screen.spec.ts`** — the game fills the handheld's 512px screen exactly, at 4×, before
  and after the cart starts, at 1280 and 780px, on a window tall enough for the full-size
  handheld and on a short one, where it's drawn at 384px and PICO-8 must still draw 512 behind
  the transform. The iframe is 540 × 539 and cropped to where PICO-8's page draws the game,
  which is the export's layout, not ours: a new PICO-8 that moved it would fail here. Also
  that `--device-height` is still the shell's real height, since the 3/4 handheld's box is
  set from it, and that the iframe keeps `scrolling="no"`. Headless browsers
  draw no scrollbars, so this can't see them come back. It checks the attribute instead,
  plus the reason for it, that PICO-8's page still overflows the iframe.
- **`controls.spec.ts`** — the handheld's D-pad and keys set and clear bits in
  `pico8_buttons[0]`, two held at once, focus staying in the cart, a click with no pointer
  tapping, letting go on a cart switch, and the disabled state with no cart. Keys held in the
  cart draw their control pressed without touching `pico8_buttons`, and let go when focus
  leaves or the cart changes. On `mobile-safari`, a tap starts the cart without PICO-8
  switching to its touch layout.
- **`eject.spec.ts`** — Eject empties the device, focus moves to the first cart, a cart goes
  back in, and Tab reaches Eject before the cart's iframe, which swallows Tab.
- **`theme.spec.ts`** — the theme control is one icon named for the current choice. It
  opens sideways on a click, Enter or a tap, never on hover, moving the header's links along
  without re-wrapping the header. A choice applies and survives a reload, Escape puts focus
  back on the icon, and Auto clears the stored choice. A slow click on a link the pill had
  pushed aside still lands.
- **`about.spec.ts`** — the header's About and Source links are in the tab order, following
  About lands Tab inside the section, every link off the site opens a new tab and says so,
  and the chain lists the five steps a move takes, in order.
- **`cart-switch.spec.ts`** — a turn in flight when you switch carts must never land in the
  new cart's panel. Stages a request by writing `ST_REQUEST` into `pico8_gpio` directly (the
  iframe is same-origin, which is how the page reads it at all), rather than driving the game.
- **`talk.spec.ts`** — gem-in-eye's talk loop, with `/api/talk` stubbed and the cart's side
  of the handshake played by writing GPIO directly. A purchase gets the first page and later
  pages come from memory, a failed call answers with the fallback, and a reply that arrives
  after the cart stopped waiting is dropped.
- **`doors.spec.ts`**: both ways from Gem-in-Eye's dungeon back to the hub, which are
  separate code paths. One test walks the knight into the dungeon, home, and back in, and
  checks that the run (max depth, uptime) survives each `load()`. The other lets a dead weight
  kill him and rolls back, and checks the rollback is counted, he's refilled, and the hub
  carries it back down. This is the only file that starts a cart and plays it. It reads each
  switch from the runtime's console log, and steers through `pico8_buttons` rather than the
  keyboard, for the reason below. The death takes ~12s, the slowest test in the suite.

## Input that changes mid-load is lost

A key released while a cart is loading stays held in the next cart, and one pressed then never
arrives. Driven from the keyboard, `doors.spec.ts` passed about seven runs in ten: the knight
would arrive with the last direction stuck down and stand still against the next one.
`pico8_buttons` is a single number the runtime takes up when it changes, so the first change a
cart sees overwrites anything stale, and the walk keeps changing it until a door takes him.
60 of 60 runs passed that way, across Chromium and WebKit with up to 20 in parallel. Players
can hit the same thing by letting go of an arrow mid-load.

## The timing trap in `cart-switch.spec.ts`

Without the fix the phantom turn does **not** appear immediately. The stale tick spends the
stubbed model delay, then a further ~3.5s in `readCartPlayedMove` polling an iframe React has
already unmounted, before it appends. It surfaces around 6.5s after the switch.

A "switch and glance" check clears this wrongly — it did during development. That is why the
test waits past both delays, and why the wait looks generous.
