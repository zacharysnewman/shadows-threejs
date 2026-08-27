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
  /**
   * What was *asked* for, in order. The fake lands a ramp instantly, so the resulting value
   * cannot tell a fade from a jump — and whether the first start fades is the whole
   * question in `the first start (§8.1)` below.
   */
  readonly calls: { kind: 'set' | 'ramp'; value: number }[] = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.calls.push({ kind: 'set', value });
    this.value = value;
  }
  /** The curve is the graph's business; a test about routes wants the level it lands on. */
  linearRampToValueAtTime(value: number): void {
    this.calls.push({ kind: 'ramp', value });
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
  /** Where in the track it is. The fix rewinds this, so the fake has to carry it. */
  currentTime = 0;

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

/** The page's own visibility, which the music retries on. */
let visibility: DocumentVisibilityState = 'visible';

function fakeDocument(): unknown {
  return {
    get visibilityState() {
      return visibility;
    },
    hasFocus: () => focused,
    addEventListener: (type: string, fire: () => void) => {
      listeners.push({ type, fire, once: false });
    },
    removeEventListener: (type: string, fire: () => void) => {
      listeners = listeners.filter((entry) => entry.type !== type || entry.fire !== fire);
    },
  };
}

/** Fire every armed `visibilitychange` listener without touching `visibility` itself. */
function fireVisibilityChange(): void {
  for (const entry of listeners.filter((armed) => armed.type === 'visibilitychange')) {
    entry.fire();
  }
}

/** The tab being brought to the front — the moment the menu is actually shown. */
function reveal(): void {
  visibility = 'visible';
  fireVisibilityChange();
}

/** Whether the browser *window* has focus — a different failure from tab visibility. */
let focused = true;

function fireWindowEvent(type: 'blur' | 'focus'): void {
  for (const entry of listeners.filter((armed) => armed.type === type)) entry.fire();
}

const blurWindow = (): void => fireWindowEvent('blur');
const focusWindow = (): void => fireWindowEvent('focus');

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
  visibility = 'visible';
  focused = true;
  FakeAudio.built = [];
  FakeAudio.allowPlay = false;
  vi.stubGlobal('window', fakeWindow());
  vi.stubGlobal('document', fakeDocument());
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

describe('the first start (§8.1)', () => {
  /** Every level the gain was *asked* to go to, as a fade or as a jump. */
  const asks = (context: { gain: { gain: FakeParam } }): string[] =>
    context.gain.gain.calls.map((c) => `${c.kind}:${c.value.toFixed(2)}`);

  it('goes straight to level rather than fading across the opening', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();

    expect(music.volume).toBeCloseTo(MUSIC.volume);
    // The point of the test: no ramp *up* anywhere in it. A fade over the first bars is a
    // fade over the only part of the track that introduces itself.
    expect(asks(context)).not.toContain(`ramp:${MUSIC.volume.toFixed(2)}`);
    expect(asks(context)).toContain(`set:${MUSIC.volume.toFixed(2)}`);
  });

  it('fades in on a return to the menu, where the track is mid-phrase', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();

    // A run begins and ends: the menu comes back to a track a run interrupted.
    music.stop();
    context.gain.gain.calls.length = 0;
    music.start();
    await flush();

    expect(asks(context)).toContain(`ramp:${MUSIC.volume.toFixed(2)}`);
    expect(music.volume).toBeCloseTo(MUSIC.volume);
  });

  it('still fades out, which is a run beginning and not a track being introduced', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();
    context.gain.gain.calls.length = 0;

    music.stop();
    expect(asks(context)).toContain('ramp:0.00');
  });

  it('rewinds whatever played while it was muted and waiting for its route', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();

    // Playing, but off the graph and muted: the context has been asked and has not
    // answered. Nothing here reaches the speakers.
    const element = FakeAudio.built[0]!;
    expect(element.paused).toBe(false);
    expect(element.muted).toBe(true);
    element.currentTime = 0.9;

    await context.allowResume();

    // Nine tenths of a second nobody could hear is nine tenths of the opening, and it is
    // given back rather than skipped past.
    expect(element.currentTime).toBe(0);
    expect(element.muted).toBe(false);
    expect(music.route).toBe('graph');
  });

  it('does not rewind a return to the menu, which resumes where it was paused', async () => {
    const { music, context } = build();
    FakeAudio.allowPlay = true;
    music.start();
    await flush();
    await context.allowResume();

    const element = FakeAudio.built[0]!;
    element.currentTime = 42;
    music.stop();
    music.start();
    await flush();

    // Already on the graph, so there is no muted window to give back — and rewinding a
    // track the player has been listening to would restart it under them.
    expect(element.currentTime).toBe(42);
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

describe('a menu that was never on screen (§8.1)', () => {
  it('tries again when the page becomes visible', async () => {
    // A tab restored with a session or opened in the background is refused for a reason
    // that expires: the browser will not start audio for a page nobody is looking at. The
    // attempt made when the menu was built was answered for a menu that was never shown,
    // and without this the music waits for a click a listening player never makes.
    visibility = 'hidden';
    const { music, context } = build();
    music.start();
    await flush();
    expect(music.playing).toBe(false);

    // The browser is willing now; nothing has been touched.
    FakeAudio.allowPlay = true;
    context.state = 'running';
    reveal();
    await flush();

    expect(music.playing).toBe(true);
    expect(music.route).toBe('graph');
  });

  it('stops asking once the track has started', async () => {
    // "Asking" here is `attempt()`, which calls `context.resume()` on every attempt while
    // the context is not yet running — a countable side effect independent of whether a
    // `visibilitychange` listener still exists. A separate listener stays armed after this
    // point to pause and resume playback on focus (`a paused menu (§8.1)` below); it fires
    // on the same event and must not be mistaken for a second retry.
    FakeAudio.allowPlay = true;
    const { music, context } = build();
    music.start();
    await flush();
    expect(context.resumeCalls).toBe(1);

    visibility = 'hidden';
    fireVisibilityChange();
    visibility = 'visible';
    fireVisibilityChange();
    await flush();
    expect(context.resumeCalls).toBe(1);
  });

  it('lets go of both visibility listeners when the menu does', async () => {
    // The music belongs to these screens and nothing else: a retry left armed would start
    // the menu's track over the top of a run the moment the player switched tabs back, and
    // a focus listener left armed would resume it the same way.
    visibility = 'hidden';
    const { music } = build();
    music.start();
    await flush();
    // The retry (never shown yet) and the focus tracker (`armFocus`) are both armed here —
    // both are `visibilitychange`, and both have a reason to be listening at this point.
    expect(listeners.filter((entry) => entry.type === 'visibilitychange')).toHaveLength(2);

    music.stop();
    expect(listeners.filter((entry) => entry.type === 'visibilitychange')).toHaveLength(0);

    FakeAudio.allowPlay = true;
    reveal();
    await flush();
    expect(music.playing).toBe(false);
  });
});

describe('a paused menu (§8.1)', () => {
  it('pauses when the page loses visibility, and resumes when it regains it', async () => {
    FakeAudio.allowPlay = true;
    const { music } = build();
    music.start();
    await flush();
    expect(music.playing).toBe(true);

    visibility = 'hidden';
    fireVisibilityChange();
    expect(music.playing).toBe(false);

    visibility = 'visible';
    fireVisibilityChange();
    expect(music.playing).toBe(true);
  });

  it('pauses when the window loses focus, even if the tab stays visible', async () => {
    // The two-monitor case: a tab kept in front while the browser window itself is not
    // focused. `visibilitychange` alone would miss this — the page never reports hidden.
    FakeAudio.allowPlay = true;
    focused = true;
    const { music } = build();
    music.start();
    await flush();
    expect(music.playing).toBe(true);

    focused = false;
    blurWindow();
    expect(music.playing).toBe(false);

    focused = true;
    focusWindow();
    expect(music.playing).toBe(true);
  });

  it('does not fight `stop()`: a run starting while backgrounded stays stopped', async () => {
    FakeAudio.allowPlay = true;
    const { music } = build();
    music.start();
    await flush();

    visibility = 'hidden';
    fireVisibilityChange();
    expect(music.playing).toBe(false);

    // The player started a run from another tab, somehow, or the harness just calls stop()
    // regardless of visibility — either way this must not be undone by focus returning.
    music.stop();
    visibility = 'visible';
    fireVisibilityChange();
    expect(music.playing).toBe(false);
  });

  it('never pauses or resumes before the track has actually started', async () => {
    // Focus flapping before the first successful `play()` must not call `pause()` on an
    // element that was never playing, and must not substitute for the gesture retry.
    const { music } = build();
    music.start();
    await flush();
    expect(music.playing).toBe(false);

    visibility = 'hidden';
    fireVisibilityChange();
    visibility = 'visible';
    fireVisibilityChange();
    expect(music.playing).toBe(false);
  });
});
