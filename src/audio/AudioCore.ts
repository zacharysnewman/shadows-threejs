/**
 * Spatial audio (§4.3).
 *
 * The listener rides the *player*, not the camera. §4.3 allows either, but the camera sits
 * 14 m above and behind (§3.2), and every distance in §4.3 — 2 m reference, 25 m maximum,
 * 35 m for the monster's footsteps — is obviously measured from where the player is
 * standing. Hanging the listener off the camera would add 14 m to every source and quietly
 * halve the map's audible radius.
 *
 * Its orientation is the camera's: forward `-z`, up `+y`, never rotated (§3.2). That makes
 * world `+x` screen-right, so what the player hears on the left is on the left of their
 * screen. North and south of the player sound alike; distance carries the rest.
 *
 * Sources come from a fixed pool. Allocating a `PositionalAudio` per one-shot would build
 * and tear down a Web Audio node graph during play, and the pool also puts a hard ceiling
 * on how many things can be shouting at once — which matters for a game where a specific
 * sound (§5.2's footsteps) is the only way to find a specific threat.
 */

import * as THREE from 'three';
import { AUDIO } from '../config';
import { AUDIO_PROFILES, type DistanceProfile, type ProfileName } from './profiles';
import { isLooping, SoundBank, type SoundName } from './SoundBank';
import { Music } from './Music';

export type AudioState = 'unavailable' | 'suspended' | 'running' | 'closed';

/**
 * A long-lived source bound to something that moves — an enemy's footsteps, a lamp's buzz.
 * Entities hold these for as long as they exist rather than borrowing from the pool, so a
 * burst of one-shots can never silence the thing the player is tracking.
 */
export class Emitter {
  constructor(
    readonly audio: THREE.PositionalAudio,
    private readonly core: AudioCore,
  ) {}

  get playing(): boolean {
    return this.audio.isPlaying;
  }

  moveTo(x: number, z: number, y = 0.6): void {
    this.audio.position.set(x, y, z);
  }

  play(): void {
    if (!this.audio.buffer || this.audio.isPlaying) return;
    this.audio.play();
  }

  stop(): void {
    if (this.audio.isPlaying) this.audio.stop();
  }

  dispose(): void {
    this.stop();
    this.core.release(this);
  }
}

export class AudioCore {
  readonly listener: THREE.AudioListener | null;
  readonly bank: SoundBank | null;

  private readonly pool: THREE.PositionalAudio[] = [];
  private readonly emitters = new Set<Emitter>();
  private nextSlot = 0;
  private gestureArmed = false;
  private pausedByGame = false;

  constructor(private readonly scene: THREE.Scene) {
    let listener: THREE.AudioListener | null = null;
    try {
      listener = new THREE.AudioListener();
    } catch (error) {
      // No Web Audio: the game is still playable, just silent. Worth surviving rather than
      // failing to start, since audio is a cue here and not a dependency of anything.
      console.warn('[audio] no AudioContext available; running silent', error);
    }

    this.listener = listener;
    this.bank = listener ? new SoundBank(listener.context) : null;

    if (listener) {
      listener.setMasterVolume(AUDIO.masterVolume);
      // Parented to the scene rather than to the camera, and never rotated.
      scene.add(listener);
      for (let i = 0; i < AUDIO.poolSize; i += 1) {
        const source = new THREE.PositionalAudio(listener);
        source.name = `AudioPool${i}`;
        applyProfile(source, AUDIO_PROFILES.default);
        scene.add(source);
        this.pool.push(source);
      }
    }
  }

  get state(): AudioState {
    if (!this.listener) return 'unavailable';
    return this.listener.context.state as AudioState;
  }

  /** Sources currently making noise, pooled and long-lived together. */
  get playingCount(): number {
    let count = this.pool.filter((source) => source.isPlaying).length;
    for (const emitter of this.emitters) if (emitter.playing) count += 1;
    return count;
  }

  async load(): Promise<void> {
    await this.bank?.loadAll();
  }

  /**
   * §4.3 — browsers refuse to start an `AudioContext` without a user gesture. The spec
   * hangs this on the title screen's first input; there is no title screen yet (Phase 10),
   * so the first input of any kind does it, which is the same rule with a wider net.
   */
  /**
   * §4.3, §8.1 — start the context from inside a user gesture, which is the only place a
   * browser allows it. `Play` is that gesture: `armGesture` waits for the *next* one, and a
   * listener added while the click is already dispatching does not hear that click.
   */
  async resume(): Promise<void> {
    const context = this.listener?.context;
    if (!context || context.state === 'running') return;
    await context.resume();
    console.info(`[audio] context ${context.state} from the title screen`);
  }

  armGesture(): void {
    if (!this.listener || this.gestureArmed) return;
    this.gestureArmed = true;

    const context = this.listener.context;
    if (context.state === 'running') return;

    const resume = (): void => {
      void context.resume().then(() => {
        console.info(`[audio] context ${context.state} after user gesture`);
      });
      for (const type of GESTURE_EVENTS) window.removeEventListener(type, resume);
    };
    for (const type of GESTURE_EVENTS) window.addEventListener(type, resume, { once: true });
  }

  /**
   * §4.3 — a paused simulation (§6) goes silent: a world that is not advancing must not
   * still be walking towards the player. Suspending the context rather than stopping the
   * sources means a loop picks up where it left off instead of restarting on unpause.
   */
  setPaused(paused: boolean): void {
    const context = this.listener?.context;
    if (!context) return;

    if (paused) {
      if (context.state !== 'running') return;
      this.pausedByGame = true;
      void context.suspend();
      return;
    }

    // Only resume what this suspended: a context still waiting on its first gesture
    // (§4.3) must stay suspended until the player provides one.
    if (!this.pausedByGame) return;
    this.pausedByGame = false;
    void context.resume();
  }

  /**
   * §5.3 — stop everything the world is playing and leave the context running.
   *
   * Not `setPaused`, which suspends the context and would take the jump-scare's own sound
   * with it. What has to stop is the world — a spider still chittering over the scare is a
   * world that has not noticed the player is dead — and what has to survive is the one
   * sound the scare is allowed. Nothing is resumed by this; the run that follows builds its
   * own emitters.
   */
  silenceWorld(): void {
    for (const emitter of this.emitters) emitter.stop();
    for (const source of this.pool) if (source.isPlaying) source.stop();
  }

  /**
   * §8.1 — the menu's music, built on this context so it is game audio rather than the
   * device's (see `src/audio/Music.ts`). Null where there is no Web Audio at all.
   */
  createMusic(url: string): Music | null {
    return this.listener ? new Music(url, this.listener) : null;
  }

  /** Move the listener with the player. Called per rendered frame from the interpolated position. */
  update(x: number, z: number): void {
    this.listener?.position.set(x, 1.4, z);
  }

  /**
   * Fire a one-shot at a world position. Returns false when it could not be played —
   * silent build, sound not loaded, or the context still waiting on its gesture — so
   * callers can report it rather than assume it was heard.
   */
  playAt(name: SoundName, x: number, z: number, profile: ProfileName = 'default'): boolean {
    const buffer = this.bank?.get(name);
    if (!buffer || this.pool.length === 0) return false;

    const source = this.takeSlot();
    if (source.isPlaying) source.stop();
    applyProfile(source, AUDIO_PROFILES[profile]);
    source.position.set(x, 0.6, z);
    source.setBuffer(buffer);
    source.setLoop(false);
    source.play();
    return true;
  }

  /** A source that belongs to an entity for as long as the entity exists. */
  createEmitter(name: SoundName, profile: ProfileName = 'default'): Emitter | null {
    const buffer = this.bank?.get(name);
    if (!this.listener || !buffer) return null;

    const audio = new THREE.PositionalAudio(this.listener);
    audio.name = `Emitter:${name}`;
    applyProfile(audio, AUDIO_PROFILES[profile]);
    audio.setBuffer(buffer);
    audio.setLoop(isLooping(name));
    this.scene.add(audio);

    const emitter = new Emitter(audio, this);
    this.emitters.add(emitter);
    return emitter;
  }

  /** Called by `Emitter.dispose`; not part of the public surface. */
  release(emitter: Emitter): void {
    this.emitters.delete(emitter);
    emitter.audio.removeFromParent();
  }

  /**
   * Round-robin rather than "first free": reusing the least recently started slot means a
   * burst of one-shots cuts its own oldest sound instead of whichever happened to be first
   * in the array.
   */
  private takeSlot(): THREE.PositionalAudio {
    const source = this.pool[this.nextSlot % this.pool.length]!;
    this.nextSlot = (this.nextSlot + 1) % this.pool.length;
    return source;
  }

  dispose(): void {
    for (const emitter of [...this.emitters]) emitter.dispose();
    for (const source of this.pool) {
      if (source.isPlaying) source.stop();
      source.removeFromParent();
    }
    this.pool.length = 0;
    this.listener?.removeFromParent();
  }
}

export const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

function applyProfile(source: THREE.PositionalAudio, profile: DistanceProfile): void {
  source.setDistanceModel(profile.model);
  source.setRefDistance(profile.refDistance);
  source.setMaxDistance(profile.maxDistance);
  source.setRolloffFactor(profile.rolloffFactor);
}
