/**
 * The menu music's route to the speakers (§8.1).
 *
 * The bug this suite was written for: on iOS the menu showed a media indicator — the
 * element was playing — and the phone was silent. Two ways that happens, and both are here.
 * A context that has never run makes `createMediaElementSource` a node iOS never carries,
 * so the graph is built on the far side of the first resume rather than in the constructor;
 * and where the graph carries nothing anyway, the track has to come out as plain media
 * rather than not at all.
 *
 * Web Audio and the DOM are both faked. What is under test is the order the two gates are
 * opened in and what happens when one of them never opens, which is arithmetic about
 * promises and timers rather than anything a browser has to answer.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { MUSIC } from '../src/config';
import { GESTURE_EVENTS } from '../src/audio/AudioCore';
import { Music } from '../src/audio/Music';

class FakeParam {
  value = 0;
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  /** The curve is the graph's business; a test about routes wants the level it lands on. */
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  connected: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode): FakeNode {
    this.connected.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAnalyser extends FakeNode {
  fftSize = 0;
  /** What the graph is putting out, which is the whole of what the probe reads. */
  peak = 0;
  getFloatTimeDomainData(samples: Float32Array): void {
    samples.fill(this.peak);
  }
}

class FakeSource extends FakeNode {
  constructor(readonly element: FakeAudio) {
    super();
  }
}

class FakeContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  readonly gain = new FakeGain();
  readonly analyser = new FakeAnalyser();
  readonly sources: FakeSource[] = [];
  resumeCalls = 0;
  private settle: (() => void) | null = null;

  createGain(): FakeGain {
    return this.gain;
  }
  createAnalyser(): FakeAnalyser {
    return this.analyser;
  }
  createMediaElementSource(element: FakeAudio): FakeSource {
    const source = new FakeSource(element);
    this.sources.push(source);
    return source;
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    return new Promise<void>((resolve) => {
      this.settle = resolve;
    });
  }

  /** The browser answering the resume — a separate act from asking for it, which is the point. */
  async allowResume(state: 'suspended' | 'running' = 'running'): Promise<void> {
    this.state = state;
    this.settle?.();
    this.settle = null;
    await Promise.resolve();
    await Promise.resolve();
  }
}

class FakeAudio {
  static built: FakeAudio[] = [];
  /** Whether the browser is letting anything play yet; false is a page with no gesture. */
  static allowPlay = false;

  paused = true;
  muted = false;
  volume = 1;
  loop = false;
  preload = '';
  playsInline = false;

  constructor(readonly src: string) {
    FakeAudio.built.push(this);
  }

  play(): Promise<void> {
    if (!FakeAudio.allowPlay) return Promise.reject(new Error('gesture required'));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(): void {}
}

interface Listener {
  type: string;
  fire: () => void;
  once: boolean;
}

let listeners: Listener[] = [];

function fakeWindow(): unknown {
  return {
    addEventListener: (type: string, fire: () => void, options?: { once?: boolean }) => {
      listeners.push({ type, fire, once: options?.once === true });
    },
    removeEventListener: (type: string, fire: () => void) => {
      listeners = listeners.filter((entry) => entry.type !== type || entry.fire !== fire);
    },
    // Resolved through `globalThis` at call time so vitest's fake timers are the ones used.
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  };
}

/**
 * The player touching the screen. One tap is four events in a browser, dispatched in this
 * order — which matters, because the first handler to run disarms the rest, and a fake that
 * fired all of them at once would hide a listener that fails to clean up after itself.
 */
function tap(): void {
  for (const type of ['pointerdown', 'touchstart', 'touchend', 'click']) {
    for (const entry of listeners.filter((armed) => armed.type === type)) {
      if (entry.once) listeners = listeners.filter((armed) => armed !== entry);
      entry.fire();
    }
  }
}

function build(): { music: Music; context: FakeContext; input: FakeNode } {
  const context = new FakeContext();
  const input = new FakeNode();
  const listener = {
    context,
    getInput: () => input,
  } as unknown as THREE.AudioListener;
  return { music: new Music('audio/music/track.mp3', listener), context, input };
}

/** Let every pending promise callback run, without advancing any timer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  FakeAudio.built = [];
  FakeAudio.allowPlay = false;
  vi.stubGlobal('window', fakeWindow());
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the route to the speakers (§8.1)', () => {
  it('does not attach the element to a context that has never run', async () => {
    // The trap this whole file exists for: iOS makes a permanently silent node out of an
    // element attached to a context that has not started, and the menu is on screen long
    // before the first gesture. A source built in the constructor is that node.
    const { music, context } = build();
    music.start();
    await flush();

    expect(context.sources).toHaveLength(0);
    expect(music.route).toBe('waiting');
    // And it stays quiet while it is off the graph, or the gap between `play()` and the
    // route landing is the track at the device's own volume.
    expect(FakeAudio.built[0]!.muted).toBe(true);
  });

  it('asks for the context and the element in the same gesture, waiting on neither', async () => {
    // Safari's user activation does not survive an `await`: a `play()` on the far side of
    // one is a `play()` with no gesture behind it.
    const { music, context } = build();
    music.start();
    await flush();
    expect(context.resumeCalls).toBe(1);

    FakeAudio.allowPlay = true;
    tap();
    await flush();

    expect(context.resumeCalls).toBe(2);
    expect(FakeAudio.built[0]!.paused).toBe(false);
    // Still off the graph: the context has been asked, and has not answered yet.
    expect(context.sources).toHaveLength(0);
  });

  it('attaches to the graph and unmutes once the context is running', async () => {
    const { music, context, input } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.element).toBe(FakeAudio.built[0]);
    expect(music.route).toBe('graph');
    expect(FakeAudio.built[0]!.muted).toBe(false);
    // Past the panners and under the master volume, like a non-positional `THREE.Audio`.
    expect(context.gain.connected).toContain(input);
    expect(context.gain.gain.value).toBeCloseTo(MUSIC.volume);
  });

  it('stays on the graph while the graph is carrying it', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();
    context.analyser.peak = 0.3;

    await vi.advanceTimersByTimeAsync(MUSIC.routeProofSeconds * 2000);

    expect(music.route).toBe('graph');
    expect(music.silent).toBe(false);
    expect(FakeAudio.built).toHaveLength(1);
  });
});

describe('falling back to plain media (§8.1)', () => {
  it('gives up on a context that never comes up, and lets the element be heard', async () => {
    // The iOS shape of this: the element plays, the phone shows a media indicator, and the
    // context sits in `suspended` or `interrupted` where it produces nothing.
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();

    await vi.advanceTimersByTimeAsync(MUSIC.routeProofSeconds * 1000 + 250);

    expect(context.sources).toHaveLength(0);
    expect(music.route).toBe('media');
    expect(music.silent).toBe(true);
    // The same element, unmuted: it was never on the graph, so it still has its own output.
    expect(FakeAudio.built).toHaveLength(1);
    expect(FakeAudio.built[0]!.muted).toBe(false);
    expect(FakeAudio.built[0]!.paused).toBe(false);
    // The element is the mixer now, so it carries the level the gain was holding.
    expect(FakeAudio.built[0]!.volume).toBeCloseTo(MUSIC.volume);
    expect(music.volume).toBeCloseTo(MUSIC.volume);
  });

  it('starts a second element when the graph was built and carries nothing', async () => {
    // An element attached to the graph cannot be taken back off it, so the sound comes
    // back only through one that has never been on it.
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();
    context.analyser.peak = 0;

    await vi.advanceTimersByTimeAsync(MUSIC.routeProofSeconds * 1000 + 250);

    expect(music.route).toBe('media');
    expect(FakeAudio.built).toHaveLength(2);
    expect(FakeAudio.built[0]!.paused).toBe(true);
    expect(context.sources[0]!.disconnected).toBe(true);
    const media = FakeAudio.built[1]!;
    expect(media.src).toBe(FakeAudio.built[0]!.src);
    expect(media.muted).toBe(false);
    expect(media.paused).toBe(false);
    expect(media.loop).toBe(true);
    expect(music.playing).toBe(true);
  });

  it('waits for another gesture if the fallback is refused, rather than staying silent', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();
    context.analyser.peak = 0;
    // The fallback's `play()` comes out of a timer, not a gesture, so a browser may refuse it.
    FakeAudio.allowPlay = false;

    await vi.advanceTimersByTimeAsync(MUSIC.routeProofSeconds * 1000 + 250);
    expect(music.playing).toBe(false);
    expect(listeners.length).toBeGreaterThan(0);

    FakeAudio.allowPlay = true;
    tap();
    await flush();
    expect(music.playing).toBe(true);
    expect(music.route).toBe('media');
  });

  it('cuts rather than fades when it is the device holding the level', async () => {
    // A phone ignores `volume` on a media element, so a fade there is a fade nobody hears
    // and a menu still audible under a starting run.
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await vi.advanceTimersByTimeAsync(MUSIC.routeProofSeconds * 1000 + 250);
    expect(music.route).toBe('media');

    music.stop();
    expect(FakeAudio.built[0]!.paused).toBe(true);
    expect(context.resumeCalls).toBeGreaterThan(0);
  });
});

describe('the gesture the context waits on (§4.3)', () => {
  // `AudioCore` builds a `THREE.AudioListener`, which needs a real `AudioContext`, so the
  // core itself is exercised in a browser. What can be checked here is the shape of the
  // gate — which inputs count, and that one refusal is not the end of the session.
  const source = readFileSync(new URL('../src/audio/AudioCore.ts', import.meta.url), 'utf8');

  it('counts the events Safari has always accepted, not only the start of a touch', () => {
    expect(GESTURE_EVENTS).toContain('touchend');
    expect(GESTURE_EVENTS).toContain('click');
    expect(GESTURE_EVENTS).toContain('keydown');
  });

  it('re-arms until the context is actually running', () => {
    // iOS can hold a context in `interrupted`, where `resume` resolves with nothing
    // changed. A listener that disarmed itself on the first try would leave the session
    // silent for good, which looks exactly like a game that has no sound.
    const armed = /armGesture\(\): void \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? '';
    expect(armed).not.toBe('');
    expect(armed).toContain('this.gestureArmed = false;');
    expect(armed).toContain('this.armGesture()');
  });
});
