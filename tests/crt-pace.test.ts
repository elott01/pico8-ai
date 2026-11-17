// watchPace in src/lib/crt.ts: whether a picture bigger than LARGEST_PICTURE is drawn too slowly
// for the game to keep up, which is when the CRT caps it. A wrong yes costs a fast machine its
// fine fullscreen lines; a wrong no leaves a slow one's game running at half speed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { watchPace } from '../src/lib/crt.ts';

type Watch = ReturnType<typeof watchPace>;

/** Frames every `gap` ms from `from` for `ms`; when it first said slow, or null, and when it stopped. */
function frames(watch: Watch, { from = 0, ms, gap, big = true }: { from?: number; ms: number; gap: number; big?: boolean }) {
  let slowAt: number | null = null;
  let now = from;
  for (; now <= from + ms; now += gap) {
    if (watch(now, big) && slowAt === null) slowAt = now;
  }
  return { slowAt, end: now };
}

describe('watchPace', () => {
  it('keeps the whole picture on a display at 60', () => {
    assert.equal(frames(watchPace(), { ms: 10_000, gap: 1000 / 60 }).slowAt, null);
  });

  it('and on one held at 30 to save power, where the game still keeps up', () => {
    assert.equal(frames(watchPace(), { ms: 10_000, gap: 1000 / 30 }).slowAt, null);
  });

  it('caps a picture drawn at 22 frames a second, once it has settled', () => {
    // Software rendering at 2048 managed 22
    const { slowAt } = frames(watchPace(), { ms: 10_000, gap: 45 });
    assert.ok(slowAt !== null, 'never capped');
    // Not during fullscreen's own first second, and within a second of its 30 samples after that
    assert.ok(slowAt >= 1000, `capped at ${slowAt}ms, before the picture settled`);
    assert.ok(slowAt <= 1000 + 31 * 45, `capped only at ${slowAt}ms`);
  });

  it('takes a pause for a pause, not a pace: a hidden tab, or a load()', () => {
    const watch = watchPace();
    const before = frames(watch, { ms: 3000, gap: 1000 / 60 });
    // Two seconds away, then five short stalls
    let { end } = frames(watch, { from: before.end + 2000, ms: 2000, gap: 1000 / 60 });
    for (let i = 0; i < 5; i++) end = frames(watch, { from: end + 300, ms: 500, gap: 1000 / 60 }).end;
    assert.equal(watch(end, true), false);
  });

  it('lets a few long frames go', () => {
    const watch = watchPace();
    let slow = false;
    for (let i = 0, now = 0; i < 600; i++) {
      now += i % 4 === 0 ? 80 : 1000 / 60;
      slow ||= watch(now, true);
    }
    assert.equal(slow, false);
  });

  it('judges only a picture bigger than the cap', () => {
    // The handheld's, however slowly it comes
    assert.equal(frames(watchPace(), { ms: 10_000, gap: 45, big: false }).slowAt, null);
  });

  it('stays capped once capped, or it would uncap and slow down again', () => {
    const watch = watchPace();
    const { end } = frames(watch, { ms: 5000, gap: 45 });
    assert.equal(frames(watch, { from: end, ms: 5000, gap: 1000 / 60 }).slowAt, end);
    assert.equal(watch(end + 6000, false), true);
  });

  it('settles again whenever the picture grows', () => {
    const watch = watchPace();
    const { end } = frames(watch, { ms: 3000, gap: 1000 / 60 });
    watch(end, false); // fullscreen left
    // Back in, slow for its first second, as fullscreen's animation can be
    assert.equal(frames(watch, { from: end + 100, ms: 900, gap: 45 }).slowAt, null);
  });
});
