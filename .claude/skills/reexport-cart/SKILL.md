---
name: reexport-cart
description: Re-export a PICO-8 cart from carts/ into public/games/ with PICO-8's headless export, after the user captures a new label if one was asked for, then check the export and that it still boots. Manual only, because it runs the PICO-8 app.
disable-model-invocation: true
argument-hint: "<cart> [label]"
---

# Re-export a cart

Request: $ARGUMENTS

The site loads `public/games/<cart>.html` and its `.js` (see `Pico8Game.tsx`), never the
`.p8`, so a cart edit does nothing on the site until the cart is exported. PICO-8's
command-line `-export` does that headless, and `scripts/export-cart.ts` wraps it. It runs the PICO-8
app from `/Applications`, outside this repo. That is why this skill is manual only: the user
invoking it is the go-ahead for that.

Cart ids are the ones in the switcher, `CART_ORDER` in `src/lib/carts.ts`. The export must be
named after the id, because that is the URL the page builds. Touch only the two export files
for the cart in hand.

A cart can `load()` others by name, and then its export carries them inside its `.js`:
`gemini.p8` loads `gemini_dungeon.p8`, so `public/games/gemini.js` holds both.
`scripts/cart-bundle.ts` reads the names out of the code. A bundled cart is part of the cart
that loads it. It has no export or label of its own, so a request to export
`gemini_dungeon` means exporting `gemini`.

What each export file carries:

- **`.js`**: the cart ROM, meaning code (comments included), sprites, map and sound.
- **`.html`**: the label, at half brightness, as the poster behind the play button. Every
  visitor sees it, because autoplay is off.

## 1. Work out what is needed

Do this for the cart named, or for every cart in `CART_ORDER` if none was. `git status` can't
find them for you: it only sees uncommitted edits, so a cart edited and committed but never
exported looks clean to it.

Diff each cart, and every cart it bundles, against the commit that last exported it. That
covers committed and uncommitted edits alike:

```sh
git diff "$(git log -1 --format=%h -- public/games/<cart>.js)" -- carts/<cart>.p8 carts/<bundled>.p8
```

The bundled carts are the ones the cart's code names in a string like `go("gemini_dungeon.p8")`.
An edit to one of them needs the cart that loads it exported.

If `git log` finds no commit, the cart has never been exported, so export it.

Read the diff by section:

| changed | needs |
|---|---|
| code in `__lua__` | export; the `.js` changes |
| `__gfx__`, `__gff__`, `__map__`, `__sfx__`, `__music__` | export; the `.js` changes |
| `__label__` | export; the `.html` changes |
| only comments or blank lines in `__lua__`, including `--[[ ]]` blocks | nothing |

A line holding code and a trailing comment counts as code. A comment-only edit would still
change the `.js` bytes, but not what the cart does, so it isn't worth a 1.7 MB diff. Export one
only if the user asks.

The `__label__` row has one exception. If
`node scripts/cart-label.ts check carts/<cart>.p8 public/games/<cart>.html` passes, the live
poster already shows the new label, as after a `restore`, so the label is no reason to export.
That only removes the label as a reason: if any other row applies, export anyway.

If nothing needs exporting and no label was asked for, say so and stop.

## 2. A new label, only if one was asked for

This is the only step that needs a person in PICO-8. A saved label stays in the `.p8` and every
export reads it, so it only needs capturing when the picture should change. Give the user
these steps:

1. **Open the repo's copy.** Start PICO-8 with `pico8 -root_path <repo>/carts`, drag
   `carts/<cart>.p8` onto its window, or pass the path on the command line. Then
   `load <cart>.p8`.
2. `run`, play until the screen shows what the label should be, press Ctrl-7, Esc, then `save`.
3. Tell you when it's done. They don't export; you do.

Step 1 is the one that goes wrong. A bare `load` looks in PICO-8's own carts folder, not this
repo, and the mistake is silent. Save over a stale copy there, and the label never reaches
`carts/`. Copy that stale copy back, and the repo's edits are overwritten. This has already
left two tic-tac-toe carts drifting apart.

Afterwards:

- `git diff carts/<cart>.p8` should show only the new `__label__`, and possibly the `version`
  line if PICO-8 was updated. A `__lua__` change nobody made means PICO-8 saved a different
  copy over the repo's. Stop and tell the user. `git checkout` would restore it, but whether
  to discard the save is their call.
- Render the label and look at it:

  ```sh
  node scripts/cart-label.ts png carts/<cart>.p8 <scratchpad>/<cart>-label.png
  ```

  Read the PNG, say what it shows, and ask whether it's the screen they meant. Exit code 2
  means the cart has no label or a blank one, so the capture or the save didn't happen. The
  PNG is only for checking; don't add it to the repo.

## 3. Export

```sh
node scripts/export-cart.ts <cart>
```

It runs PICO-8 headless in a temp folder (an export lands wherever PICO-8 was started), with a
temp `-home` so the user's PICO-8 config is never touched. It bundles every cart the code
loads by name. It copies both files into `public/games/` only once both exist and the `.js`
lists every cart it should carry. It takes a second or two, with a 60s limit.

- **Exit 2:** the cart has no saved label, which `-export` requires. Go to step 2.
- **Exit 1:** something else failed; show the user what PICO-8 printed. If PICO-8 isn't in
  `/Applications`, ask where it is and rerun with `PICO8=<path to the binary>`. "Left out"
  means PICO-8 exported without a bundled cart. Nothing was copied, so the live export is
  untouched.

## 4. Check it

- `git status --short carts/<cart>.p8 public/games/<cart>.*`: what changed should match the
  table in step 1. A label alone changes only the `.html`; code alone, only the `.js`. Use
  `--stat` for any diff of the `.js`. An export of an unchanged cart is byte-identical to the
  last one, so no change there is expected, not a failure.
- `npm test`: `cart-labels.test.ts` checks every poster against its cart's saved label, and
  `gpio-protocol.test.ts` checks that the Lua side still matches `src/lib/gpio.ts`.
  `cart-bundle.test.ts` checks that the export carries every cart the code loads, and that
  bundled carts share their `-- >> shared` section and sprites 0-63.
- `npm run test:playwright`: boots the real exported carts in Chromium, WebKit and mobile
  Safari, which is the first time the new export actually runs. If the browsers aren't
  installed, report that. Don't treat a skipped run as a pass.
- For Gem-in-Eye, `playwright/doors.spec.ts` walks the knight through both doors of the new
  export, so the run above covers its `load()`s. A new bundled cart has no such test until one
  is written. Until then, ask the user to take one trip into it and back under `vercel dev`.

## If a poster and its label disagree

An export made by hand from PICO-8's menu takes whatever label is in memory, saved or not, so a
poster can go live that the `.p8` never got, and `tests/cart-labels.test.ts` then fails. If the
live poster is the label the user wants, write it back into the cart:

```sh
node scripts/cart-label.ts restore carts/<cart>.p8 public/games/<cart>.html
```

The poster is the label at half brightness, and halving keeps every colour distinct, so this
recovers the label exactly. Ask before running it, since it overwrites the cart's saved label.

## 5. Report

List which files changed and what each check showed. Don't commit; that's the user's call.
