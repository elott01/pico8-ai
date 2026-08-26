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
| `mobile-safari` | real touch — `hasTouch`, mobile viewport, not just a narrow window |

WebKit is not redundant with Chromium. The cart switcher was keyboard-unreachable in Safari
while passing every Chromium check, because WebKit leaves buttons out of the tab order unless
macOS keyboard navigation is enabled. A single-engine suite stays green through that entire
bug. Verified by mutation: deleting the `tabIndex={0}` from `CartCard` fails `webkit` and
leaves `chromium` passing.

## What each file guards

- **`keyboard.spec.ts`** — tab order reaches both cards, focus is visibly painted, Enter
  switches, the live region announces. Focus that moves invisibly is indistinguishable from a
  keyboard that does nothing, which is how the Safari bug was first misdiagnosed.
- **`layout.spec.ts`** — no sideways scroll, equal card widths, WCAG 2.5.5 target sizes, and
  the 7×6 board still fitting after a switch. Runs at every project's viewport, because these
  only break at particular widths.
- **`cart-switch.spec.ts`** — a turn in flight when you switch carts must never land in the
  new cart's panel. Stages a request by writing `ST_REQUEST` into `pico8_gpio` directly (the
  iframe is same-origin, which is how the page reads it at all), rather than driving the game.

## The timing trap in `cart-switch.spec.ts`

Without the fix the phantom turn does **not** appear immediately. The stale tick spends the
stubbed model delay, then a further ~3.5s in `readCartPlayedMove` polling an iframe React has
already unmounted, before it appends. It surfaces around 6.5s after the switch.

A "switch and glance" check clears this wrongly — it did during development. That is why the
test waits past both delays, and why the wait looks generous.
