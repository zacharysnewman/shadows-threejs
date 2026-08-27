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
 * **A browser will not start audio before a gesture**, and the menu is on screen before
 * there has been one. A refusal is the expected first answer rather than a failure, and the
 * reply to it is to wait for an input and try again — see `start`.
 *
 * **The pitch trap is elsewhere, and this path is clear of it.** iOS takes the context's
 * sample rate from whatever the audio is routed through — 44.1 kHz on the speaker, 48 kHz on
 * many headphones — so a raw `AudioBuffer` built at an assumed rate plays at the wrong speed
 * and pitch. `SoundBank` guards that by synthesising at `context.sampleRate`; nothing here
 * needs to, because a media element source is resampled by the graph, as decoded files are.
 *
 * What iOS *does* threaten here is `createMediaElementSource` itself, which produced silence
 * on Safari for years and is only dependable from iOS 15. A graph that plays nothing looks
 * exactly like a track that failed to load, so `silent` tells the two apart rather than
 * leaving it to be guessed at from a quiet phone.
 */

import type * as THREE from 'three';
import { MUSIC } from '../config';
import { GESTURE_EVENTS } from './AudioCore';

export class Music {
  private readonly element: HTMLAudioElement;
  private readonly gain: GainNode;
  /** `AudioContext` rather than `BaseAudioContext`: only the former streams an element. */
  private readonly context: AudioContext;
  /** Removes the one-shot gesture listeners, or null when none are armed. */
  private disarm: (() => void) | null = null;
  private wanted = false;
  /** Reads the graph's own output, to tell a silent route from a track that never started. */
  private readonly analyser: AnalyserNode;
  private probe = 0;
  private graphSilent = false;

  constructor(url: string, listener: THREE.AudioListener) {
    this.context = listener.context as AudioContext;

    this.element = new Audio(url);
    this.element.loop = true;
    // The stream is what this is for; the browser decides how much to hold.
    this.element.preload = 'auto';
    // The element's own volume stays at 1: the graph does the mixing, and a level set in
    // two places is a level nobody can find.
    this.element.volume = 1;
    // iOS treats a media element as something that might want the whole screen; this says
    // it does not. Not in the `HTMLAudioElement` type — it is declared on the video
    // element — but it is read off any media element on iOS, which is where it matters.
    (this.element as HTMLMediaElement & { playsInline: boolean }).playsInline = true;

    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    // Tapped off the gain rather than inserted after it: an analyser passes its input
    // through untouched, but reading *before* the master volume would call a muted game
    // silent and report a bug that is not one.
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;

    // Straight to the listener's input, like a non-positional `THREE.Audio`: past the
    // panners, under the master volume.
    this.context
      .createMediaElementSource(this.element)
      .connect(this.gain)
      .connect(listener.getInput());
    this.gain.connect(this.analyser);
  }

  /**
   * True when the element is running but the graph is producing nothing — the shape of
   * `createMediaElementSource` failing on an older iOS Safari. Distinct from "not playing",
   * which is a track that has not started, and from a muted game, which is why the analyser
   * sits after the fade rather than before it.
   */
  get silent(): boolean {
    return this.graphSilent;
  }

  /** True once the browser has actually let it start. */
  get playing(): boolean {
    return !this.element.paused;
  }

  /** The level the graph is currently at, which a fade moves. */
  get volume(): number {
    return this.gain.gain.value;
  }

  /**
   * §8.1 — start, or fade back up if this is a return to the menu.
   *
   * Two separate gates have to open: the element has to be allowed to play, and the context
   * has to be running. `AudioCore.armGesture` handles the second; this handles the first,
   * and both wait on the same kind of input.
   */
  start(): void {
    this.wanted = true;
    this.rampTo(MUSIC.volume, MUSIC.fadeInSeconds);
    this.attempt();
  }

  /** §8.1 — a run has its own soundscape, so the menu's music gets out of the way. */
  stop(): void {
    this.wanted = false;
    this.clearGesture();
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
    this.gain.disconnect();
  }

  private attempt(): void {
    void this.element.play().then(
      () => {
        this.clearGesture();
        this.watchForSilence();
      },
      // Refused for want of a gesture. Wait for one rather than giving up: on a cold page
      // this is the normal path, not an error.
      () => this.armGesture(),
    );
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
   * Once playing, check that the graph is carrying it. Sampled a few times over a couple of
   * seconds rather than once: the first buffers can legitimately be silence, and a track
   * that opens quietly is not a broken route.
   */
  private watchForSilence(): void {
    window.clearInterval(this.probe);
    let checks = 0;
    const samples = new Float32Array(this.analyser.fftSize);

    this.probe = window.setInterval(() => {
      checks += 1;
      // Nothing to conclude while it is not running or the fade has not brought it up.
      if (this.element.paused || this.context.state !== 'running' || this.gain.gain.value <= 0) {
        if (checks > 12) window.clearInterval(this.probe);
        return;
      }

      this.analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (peak > 1e-4) {
        this.graphSilent = false;
        window.clearInterval(this.probe);
        return;
      }

      if (checks < 8) return;
      window.clearInterval(this.probe);
      this.graphSilent = true;
      console.warn(
        '[audio] the music element is playing but the graph is silent — ' +
          'createMediaElementSource is not carrying it (an older iOS Safari does this)',
      );
    }, 250);
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
