// What the suite allows for CI's machines, which have no GPU and are slower than a desktop.
// Underscore-prefixed and not a *.spec.ts, so the runner doesn't take it for tests.

/**
 * The tag on a test that reads what the CRT shader drew, which needs WebGL. Firefox skips these in
 * CI (see playwright.config.ts): the Linux machine it runs on there has no GPU, and Firefox there
 * has no WebGL at all, so they could only fail. Every other engine runs them in CI, and every
 * engine runs them locally.
 */
export const GPU = { tag: '@gpu' };

/**
 * How long a cart gets to boot, from its play button to 30 frames run. A desktop takes a second
 * or two. CI's machines have taken over 10s, with the CRT filter drawn in software at 2x.
 */
export const BOOT_MS = 30_000;
