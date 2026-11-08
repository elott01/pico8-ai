// The handheld's volume slider. PICO-8 has its own volume, in its pause menu, but the export gives
// the page no way to set it: only to mute (Module.pico8ToggleSound) and to read the level back
// (pico8_state.sound_volume). So the slider is a second volume, after PICO-8's, the way a Game
// Boy's wheel comes after a game's own sound options: a gain the page puts between PICO-8 and
// the speakers.
//
// PICO-8 makes its sound with Web Audio in the cart's page, and connects its output to the
// context's destination. routeAudio wraps AudioNode.prototype.connect in that window, so a
// connection to a destination goes to a gain instead, one per context, and the gain goes on to
// the destination. It has to be in place before PICO-8 connects, which happens once the cart
// starts: Pico8Game calls it from the iframe's onLoad, before the play button can be pressed.

/** Where the setting is kept, beside the CRT choice. */
export const VOLUME_KEY = 'pico-volume';
/** The slider's step, in percent, which is how far an arrow key moves it. */
export const VOLUME_STEP = 5;

/** A level the slider can show: whole steps, from 0 to 100. */
export function toStep(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(100, Math.max(0, Math.round(percent / VOLUME_STEP) * VOLUME_STEP));
}

/** The kept setting, or full volume when there is none, or nothing readable. */
export function readVolume(storage: Storage | null): number {
  try {
    const raw = storage?.getItem(VOLUME_KEY);
    return raw ? toStep(Number(raw)) : 100;
  } catch {
    return 100;
  }
}

export function saveVolume(storage: Storage | null, percent: number): void {
  try {
    storage?.setItem(VOLUME_KEY, String(toStep(percent)));
  } catch {
    // quota or privacy mode: the setting is lost, the sound is not
  }
}

/** The gain for a level. Loudness is heard on a log scale, so a straight line would change
 *  little over the slider's top half and everything near the bottom. The square is the usual
 *  stand-in: half way is a quarter of the amplitude. */
export function gainFor(percent: number): number {
  return (toStep(percent) / 100) ** 2;
}

/** The cart window's audio classes, all routeAudio touches. */
export type AudioWindow = Pick<typeof globalThis, 'AudioNode' | 'AudioDestinationNode'>;

type Connect = (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) => AudioNode | void;

// Each window is routed once, so a second call can't wrap the wrapper.
const routed = new WeakMap<AudioWindow, (percent: number) => void>();

/**
 * Sends everything `win` connects to a destination through one gain per audio context, at
 * `percent`. Returns the setter for later changes, which eases each gain there over a few
 * milliseconds, since a jump clicks.
 */
export function routeAudio(win: AudioWindow, percent: number): (percent: number) => void {
  const known = routed.get(win);
  if (known) {
    known(percent);
    return known;
  }
  let level = gainFor(percent);
  const gains = new Map<BaseAudioContext, GainNode>();
  const proto = win.AudioNode.prototype;
  const connect = proto.connect as Connect;

  const gainOf = (context: BaseAudioContext) => {
    let gain = gains.get(context);
    if (!gain) {
      gain = context.createGain();
      gain.gain.value = level;
      connect.call(gain, context.destination);
      gains.set(context, gain);
    }
    return gain;
  };

  proto.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) {
    if (destination instanceof win.AudioDestinationNode) {
      connect.call(this, gainOf(this.context), ...rest);
      // What connect returns, so a chain off it carries on as PICO-8 meant
      return destination;
    }
    return connect.call(this, destination, ...rest);
  } as AudioNode['connect'];

  const set = (next: number) => {
    level = gainFor(next);
    for (const [context, gain] of gains) gain.gain.setTargetAtTime(level, context.currentTime, 0.015);
  };
  routed.set(win, set);
  return set;
}
