/**
 * The menu music (§8.1).
 *
 * **It plays through the game's own audio graph, not the device's media flow.** An
 * `HTMLAudioElement` left to itself is *media* to a phone: it takes the lock-screen
 * transport controls, it shows up in the notification shade, and it stops whatever the
 * player was already listening to. That is right for a music app and wrong for a game,
 * whose sound should sit with the rest of its sound. Routing the element through
 * `createMediaElementSource` on the listener's context makes it one more node in the graph
 * every other sound comes out of, so it is mixed, suspended and resumed with them.
 *
 * **Streamed, not decoded.** Every other sound goes through the `SoundBank` and ends up as
 * an `AudioBuffer` (§4.3), which is right for a half-second footstep and wrong for a
 * four-minute track: `decodeAudioData` holds the whole thing as PCM, and at 48 kHz stereo
 * this one would be around 110 MB of memory to play a 6 MB file. A media element source
 * streams it and decodes as it goes, which is the only reason the element is here at all.
 *
 * **Not a world sound.** It has no position and no distance model — it is connected to the
 * listener's input directly, the way a non-positional `THREE.Audio` is, because nothing
 * about it is a threat to be located (§4.3).
 *
 * **The first time it comes up, it comes up whole.** A fade-in over the opening of a track
 * nobody has heard yet spends the bars that introduce it — the player never gets the start
 * of the music, only its second phrase arriving at full volume. So the first start is set
 * straight to level, and `MUSIC.fadeInSeconds` is for a *return* to the menu, which is
 * picking up something already heard from wherever it was paused (§8.1).
 *
 * **A browser will not start audio before a gesture**, and the menu is on screen before
 * there has been one. A refusal is the expected first answer rather than a failure, and the
 * reply to it is to wait for an input and try again — see `start`.
 *
 * **Two gates open on that gesture, in this order: the context, then the element.** The
 * context is asked to resume and the element is asked to play in the same handler, neither
 * awaited, because Safari's user activation does not survive an `await` — a `play()` on the
 * far side of one is a `play()` with no gesture behind it. The *graph* is then built on the
 * far side of the resume, which is the part that has to wait: see below.
 *
 * **The route is built once the context is running, and not before.** iOS produces a
 * permanently silent `MediaElementAudioSourceNode` when the element is attached to a context
 * that has never run, which is exactly what a node built in this constructor would be — the
 * menu is on screen well before the first gesture. So the element is held off the graph
 * until the context reports `running`, and kept muted while it is off it, or the moment
 * between `play()` and the route landing is a blast of the track at the device's own volume.
 *
 * **Where the graph will not carry it, it plays as plain media rather than not at all.**
 * The analyser reads the graph's own output, so a route that produces nothing is visible
 * rather than guessable, and the answer to it is to fall back: the media flow costs the
 * lock-screen transport and, on iOS, the level (a phone holds `volume` at the device's
 * own), which is a poor second to the graph and a long way better than a silent menu.
 * Attaching an element to the graph takes its own output away for good, so the fallback
 * from a route that *did* get built is a second element that has never been on it.
 *
 * **The pitch trap is elsewhere, and this path is clear of it.** iOS takes the context's
 * sample rate from whatever the audio is routed through — 44.1 kHz on the speaker, 48 kHz on
 * many headphones — so a raw `AudioBuffer` built at an assumed rate plays at the wrong speed
 * and pitch. `SoundBank` guards that by synthesising at `context.sampleRate`; nothing here
 * needs to, because a media element source is resampled by the graph, as decoded files are.
 */

import type * as THREE from 'three';
import { MUSIC } from '../config';
import { GESTURE_EVENTS } from './AudioCore';

/** How the sound is reaching the speakers, or why it is not. */
export type MusicRoute =
  /** Off the graph and waiting for a context that is running. Silent by design. */
  | 'waiting'
  /** On the graph, mixed with the rest of the game's sound. The intended route (§8.1). */
  | 'graph'
  /** The graph would not carry it, so it is the device's media instead. */
  | 'media';

/** Below this the graph is producing nothing; it is a noise floor, not a level. */
const SILENCE = 1e-4;

export class Music {
  /** Replaced if the graph turns out to be silent — an element on it cannot come back off. */
  private element: HTMLAudioElement;
  private readonly gain: GainNode;
  /** `AudioContext` rather than `BaseAudioContext`: only the former streams an element. */
  private readonly context: AudioContext;
  /** Built on the first gesture that leaves the context running, and never in the constructor. */
  private source: MediaElementAudioSourceNode | null = null;
  /** Removes the one-shot gesture listeners, or null when none are armed. */
  private disarm: (() => void) | null = null;
  private wanted = false;
  /** Whether the track has ever actually started — what tells a first start from a return. */
  private begun = false;
  /** Reads the graph's own output, to tell a silent route from a track that never started. */
  private readonly analyser: AnalyserNode;
  private probe = 0;
  private fellBack = false;

  constructor(
    private readonly url: string,
    listener: THREE.AudioListener,
  ) {
    this.context = listener.context as AudioContext;
    this.element = this.buildElement();

    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    // Tapped off the gain rather than inserted after it: an analyser passes its input
    // through untouched, but reading *before* the master volume would call a muted game
    // silent and report a bug that is not one.
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;

    // Straight to the listener's input, like a non-positional `THREE.Audio`: past the
    // panners, under the master volume. The element joins this on the far side of the
    // first gesture (`route`), which is the whole of what keeps iOS audible.
    this.gain.connect(listener.getInput());
    this.gain.connect(this.analyser);
  }

  /** §8.3 — which of the two ways out the sound is taking, or that it has neither yet. */
  get route(): MusicRoute {
    if (this.fellBack) return 'media';
    return this.source ? 'graph' : 'waiting';
  }

  /**
   * True when the game's own graph would not carry the track and it is coming out as the
   * device's media instead — the shape of `createMediaElementSource` failing on iOS, or of
   * a context that never started. Distinct from "not playing", which is a track that has
   * not begun, and from a muted game, which is why the analyser sits after the fade rather
   * than before it.
   */
  get silent(): boolean {
    return this.fellBack;
  }

  /** True once the browser has actually let it start. */
  get playing(): boolean {
    return !this.element.paused;
  }

  /** The level the sound is currently at, which a fade moves. */
  get volume(): number {
    return this.fellBack ? this.element.volume : this.gain.gain.value;
  }

  /**
   * §8.1 — start, or fade back up if this is a return to the menu.
   *
   * Two separate gates have to open: the context has to be running and the element has to
   * be allowed to play. Both are asked for in the same gesture, and neither is waited on
   * there — see the note above.
   */
  start(): void {
    this.wanted = true;
    // §8.1 — the first start is not a fade. Everything below this line is about a track
    // that has never been heard, and a ramp across its opening is a ramp across the only
    // part of it that introduces itself. A return to the menu is a different thing — the
    // track is mid-phrase where a run interrupted it — and that fades.
    if (this.begun) this.rampTo(MUSIC.volume, MUSIC.fadeInSeconds);
    else this.setLevel(MUSIC.volume);
    this.attempt();
  }

  /** §8.1 — a run has its own soundscape, so the menu's music gets out of the way. */
  stop(): void {
    this.wanted = false;
    this.clearGesture();
    window.clearInterval(this.probe);
    if (this.fellBack) {
      // No fade: a phone holds an element's volume at the device's own, so this is a cut
      // wherever it matters most and pretending otherwise would only delay it.
      this.element.pause();
      return;
    }
    this.rampTo(0, MUSIC.fadeOutSeconds);
    // Paused only once it is inaudible, or the fade is a cut. An element left running at
    // zero is still a stream being pulled.
    window.setTimeout(() => {
      if (!this.wanted) this.element.pause();
    }, MUSIC.fadeOutSeconds * 1000);
  }

  dispose(): void {
    this.wanted = false;
    window.clearInterval(this.probe);
    this.clearGesture();
    this.element.pause();
    this.element.removeAttribute('src');
    this.source?.disconnect();
    this.gain.disconnect();
  }

  private buildElement(): HTMLAudioElement {
    const element = new Audio(this.url);
    element.loop = true;
    // The stream is what this is for; the browser decides how much to hold.
    element.preload = 'auto';
    // Silent until it is on the graph, or the gap between `play()` and the route landing is
    // the track at the device's volume rather than under the fade.
    element.muted = true;
    // The element's own volume stays at 1: the graph does the mixing, and a level set in
    // two places is a level nobody can find. It is turned down only if the graph is given
    // up on, when the element becomes the mixer.
    element.volume = 1;
    // iOS treats a media element as something that might want the whole screen; this says
    // it does not. Not in the `HTMLAudioElement` type — it is declared on the video
    // element — but it is read off any media element on iOS, which is where it matters.
    (element as HTMLMediaElement & { playsInline: boolean }).playsInline = true;
    return element;
  }

  private attempt(): void {
    // Ask for the context first and do not wait for it: the element's `play()` below needs
    // the same gesture, and an `await` here spends it (§8.1).
    if (this.context.state !== 'running') {
      void this.context.resume().then(
        () => this.attachToGraph(),
        () => undefined,
      );
    }
    this.attachToGraph();

    void this.element.play().then(
      () => {
        this.begun = true;
        this.clearGesture();
        // The context may have come up while the element was starting.
        this.attachToGraph();
        this.watchRoute();
      },
      // Refused for want of a gesture. Wait for one rather than giving up: on a cold page
      // this is the normal path, not an error.
      () => this.armGesture(),
    );
  }

  /**
   * Put the element on the graph, once the context is running and once only.
   *
   * This is the step that must not happen in the constructor: an element attached to a
   * context that has never run is a node iOS never carries, and the failure is permanent
   * and silent (§8.1).
   */
  private attachToGraph(): void {
    if (this.source || this.fellBack || this.context.state !== 'running') return;
    this.source = this.context.createMediaElementSource(this.element);
    this.source.connect(this.gain);
    // §8.1 — anything that played between `play()` and this moment played muted and off
    // the graph, where nobody could hear it. Give the opening back rather than start the
    // player a second into a track they have not heard: losing the start of it to the
    // route being built is the same loss as losing it under a fade. Only ever the first
    // attach — the guard above means this runs once.
    if (this.element.currentTime > 0) this.element.currentTime = 0;
    // Now that the graph holds the level, the element can be let go of.
    this.element.muted = false;
  }

  /**
   * Play on the next input, once.
   *
   * Re-armed on each failure rather than left listening, because a gesture is not always
   * enough on its own — a browser may want the context resumed first, which another of
   * these listeners is doing at the same moment — and the next input has to still be able
   * to start it.
   */
  private armGesture(): void {
    if (this.disarm || !this.wanted) return;

    const fire = (): void => {
      this.clearGesture();
      if (this.wanted) this.attempt();
    };
    // Capture, so a handler that hides this screen does not get there first.
    const options = { capture: true, once: true } as const;
    for (const type of GESTURE_EVENTS) window.addEventListener(type, fire, options);
    this.disarm = () => {
      for (const type of GESTURE_EVENTS) window.removeEventListener(type, fire, options);
    };
  }

  private clearGesture(): void {
    this.disarm?.();
    this.disarm = null;
  }

  /**
   * Once playing, check that something is actually carrying it: that the context came up at
   * all, and then that the graph is passing the track. Sampled over a couple of seconds
   * rather than once, because the first buffers can legitimately be silence and a track that
   * opens quietly is not a broken route.
   */
  private watchRoute(): void {
    window.clearInterval(this.probe);
    const interval = MUSIC.routeProbeSeconds * 1000;
    const proof = Math.max(1, Math.round(MUSIC.routeProofSeconds / MUSIC.routeProbeSeconds));
    let waited = 0;
    let quiet = 0;
    const samples = new Float32Array(this.analyser.fftSize);

    this.probe = window.setInterval(() => {
      if (this.fellBack || !this.wanted) {
        window.clearInterval(this.probe);
        return;
      }

      // The context has had its gesture and still is not running — on iOS that is a
      // context that was interrupted or never allowed, and waiting longer will not fix it.
      if (!this.source) {
        this.attachToGraph();
        waited += 1;
        if (waited >= proof && !this.source) {
          this.fallBackToMedia('the context never started');
        }
        return;
      }

      // Nothing to conclude while it is not running or the fade has not brought it up.
      if (this.element.paused || this.gain.gain.value <= 0) {
        waited += 1;
        if (waited > proof * 3) window.clearInterval(this.probe);
        return;
      }

      this.analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (peak > SILENCE) {
        window.clearInterval(this.probe);
        return;
      }

      quiet += 1;
      if (quiet >= proof) {
        this.fallBackToMedia('createMediaElementSource is not carrying it');
      }
    }, interval);
  }

  /**
   * §8.1 — give up on the graph and let the element be the device's media instead.
   *
   * The lock-screen transport and, on a phone, the level go with it; a silent menu is the
   * worse of the two. An element that has been attached to the graph cannot be taken back
   * off it, so that case starts a second one.
   */
  private fallBackToMedia(reason: string): void {
    if (this.fellBack) return;
    this.fellBack = true;
    window.clearInterval(this.probe);
    console.warn(`[audio] the menu music is off the graph — ${reason}; playing it as media`);

    if (this.source) {
      this.source.disconnect();
      this.source = null;
      this.element.pause();
      this.element.removeAttribute('src');
      this.element = this.buildElement();
    }
    // The element is the mixer now, so it carries the level the graph was holding.
    this.element.muted = false;
    this.element.volume = MUSIC.volume;
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.value = 0;

    if (!this.wanted) return;
    void this.element.play().then(
      () => this.clearGesture(),
      // Out of the probe rather than out of a gesture, so a browser may well refuse this
      // one; the next input starts it.
      () => this.armGesture(),
    );
  }

  /** Straight to a level, cancelling any fade in flight. The first start uses this. */
  private setLevel(to: number): void {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(to, now);
  }

  /**
   * A gain ramp rather than a timer on the render loop: the graph has a clock of its own and
   * it does not stop when a frame is slow. Cancelled from the current value first, or a
   * second fade starts from wherever the first one was heading rather than from where the
   * sound actually is.
   */
  private rampTo(to: number, seconds: number): void {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(to, now + Math.max(0.001, seconds));
  }
}
