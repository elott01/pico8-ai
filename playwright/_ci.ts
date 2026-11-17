// What the suite allows for CI's machines, which have no GPU and are slower than a desktop.
// Underscore-prefixed and not a *.spec.ts, so the runner doesn't take it for tests.

/**
 * The tag on a test that reads what the CRT shader drew. CI runs these in Chromium only (see
 * playwright.config.ts), since its machines have no GPU: Firefox there has no WebGL at all, and
 * WebKit on the Mac runner moved a picture that holds still on a real Mac. A failure there would
 * be about the machine, not about what a player sees. Locally they run in every engine.
 */
export const GPU = { tag: '@gpu' };

/**
 * How long a cart gets to boot, from its play button to 30 frames run. A desktop takes a second
 * or two. CI's machines have taken over 10s, with the CRT filter drawn in software at 2x.
 */
export const BOOT_MS = 30_000;
