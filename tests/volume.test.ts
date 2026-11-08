// The volume slider's routing and its kept setting. The routing is a wrap of the cart window's
// AudioNode.prototype.connect, so it runs here against fake audio classes: a connection to a
// destination has to land on one gain per context, and nothing else may change.
// playwright/volume.spec.ts checks it against PICO-8's real sound.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { routeAudio, readVolume, saveVolume, gainFor, toStep, VOLUME_KEY } from '../src/lib/volume.ts';
import type { AudioWindow } from '../src/lib/volume.ts';

/** A fresh set of audio classes, as a new window would have. Each node records what it's
 *  connected to. */
function fakeWindow() {
  class Node {
    connections: object[] = [];
    context: Context;
    constructor(context: Context) {
      this.context = context;
    }
    connect(destination: object) {
      this.connections.push(destination);
      return destination;
    }
  }
  class Destination extends Node {}
  class Gain extends Node {
    gain = {
      value: 1,
      setTargetAtTime(value: number) {
        this.value = value;
      },
    };
  }
  class Context {
    currentTime = 0;
    destination: Destination = new Destination(this);
    createGain() {
      return new Gain(this);
    }
  }
  const win = { AudioNode: Node, AudioDestinationNode: Destination } as unknown as AudioWindow;
  return { win, Node, Gain, Context };
}

/** localStorage, minus everything this module does not call. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

describe('routeAudio', () => {
  it('puts a gain between a node and the destination, at the level asked for', () => {
    const { win, Node, Gain, Context } = fakeWindow();
    routeAudio(win, 50);
    const context = new Context();
    const source = new Node(context);

    const returned = source.connect(context.destination);

    assert.equal(returned, context.destination, 'connect still returns what it was given');
    const [gain] = source.connections;
    assert.ok(gain instanceof Gain);
    assert.equal(gain.gain.value, 0.25);
    assert.deepEqual(gain.connections, [context.destination]);
  });

  it('gives a context one gain, however many nodes reach its destination', () => {
    const { win, Node, Context } = fakeWindow();
    routeAudio(win, 100);
    const context = new Context();
    const [a, b] = [new Node(context), new Node(context)];
    a.connect(context.destination);
    b.connect(context.destination);
    assert.equal(a.connections[0], b.connections[0]);

    const other = new Context();
    const c = new Node(other);
    c.connect(other.destination);
    assert.notEqual(c.connections[0], a.connections[0]);
  });

  it('leaves every other connection alone', () => {
    const { win, Node, Context } = fakeWindow();
    routeAudio(win, 100);
    const context = new Context();
    const [a, b] = [new Node(context), new Node(context)];
    a.connect(b);
    assert.deepEqual(a.connections, [b]);
  });

  it('moves every gain it has made, and starts later ones at the new level', () => {
    const { win, Node, Gain, Context } = fakeWindow();
    const set = routeAudio(win, 100);
    const first = new Context();
    const early = new Node(first);
    early.connect(first.destination);
    const firstGain = early.connections[0] as InstanceType<typeof Gain>;
    assert.equal(firstGain.gain.value, 1);

    set(0);
    assert.equal(firstGain.gain.value, 0);

    const later = new Context();
    const node = new Node(later);
    node.connect(later.destination);
    assert.equal((node.connections[0] as InstanceType<typeof Gain>).gain.value, 0);
  });

  it('wraps a window once, so a second call only sets the level', () => {
    const { win, Node, Gain, Context } = fakeWindow();
    const set = routeAudio(win, 100);
    assert.equal(routeAudio(win, 50), set);
    const context = new Context();
    const node = new Node(context);
    node.connect(context.destination);
    const gain = node.connections[0] as InstanceType<typeof Gain>;
    assert.equal(gain.gain.value, 0.25);
    assert.deepEqual(gain.connections, [context.destination], 'one gain, not a gain behind a gain');
  });
});

describe('the level', () => {
  it('is the square of the slider, so half way is a quarter', () => {
    assert.equal(gainFor(100), 1);
    assert.equal(gainFor(50), 0.25);
    assert.equal(gainFor(0), 0);
  });

  it('lands on whole steps from 0 to 100', () => {
    assert.equal(toStep(52), 50);
    assert.equal(toStep(53), 55);
    assert.equal(toStep(-10), 0);
    assert.equal(toStep(140), 100);
    assert.equal(toStep(Number.NaN), 100);
  });
});

describe('the kept setting', () => {
  it('is full volume when nothing is kept, or nothing readable', () => {
    assert.equal(readVolume(fakeStorage()), 100);
    assert.equal(readVolume(null), 100);
    assert.equal(readVolume(fakeStorage({ [VOLUME_KEY]: 'loud' })), 100);
    const throwing = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    assert.equal(readVolume(throwing), 100);
  });

  it('comes back as it was saved, as a step', () => {
    const storage = fakeStorage();
    saveVolume(storage, 35);
    assert.equal(readVolume(storage), 35);
    saveVolume(storage, 0);
    assert.equal(readVolume(storage), 0);
    saveVolume(storage, 33);
    assert.equal(readVolume(storage), 35);
  });

  it('survives a store that refuses it', () => {
    const throwing = { setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    assert.doesNotThrow(() => saveVolume(throwing, 50));
  });
});
