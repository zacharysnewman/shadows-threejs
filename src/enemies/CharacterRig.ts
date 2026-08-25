/**
 * An animated body on an enemy (§5.1).
 *
 * The state machine decides what an enemy *is doing*; this decides what that looks like.
 * One `AnimationMixer` per enemy — a mixer holds the playback state, so two spiders sharing
 * one would share a stride.
 *
 * **The locomotion cycle is driven by ground speed, not by a clock.** §5.1 is specific
 * about why: a wandering spider (1.2 m/s), a pursuing one (2.4 m/s) and a fleeing one
 * (3.6 m/s) all have to place their legs on the ground rather than skate, and a fixed
 * playback rate can only be right for one of them. So the walk clip's `timeScale` is the
 * enemy's actual speed over the speed the clip was authored at.
 *
 * **The attack clip is scaled to the strike, not the other way round.** §5.3: "the strike
 * time belongs to the simulation, not to the animation" — damage lands at 0.35 s whatever
 * the art does, and an attack animation whose contact frame is somewhere else is the thing
 * that gets re-timed. So the clip is stretched to the wind-up and the wind-up is never
 * stretched to the clip.
 *
 * Runs on the render delta rather than the sim tick, like every other presentation effect
 * (§7): what the mixer produces is pixels, and stepping it at 60 Hz while the display runs
 * at 144 would make the legs stutter under a body that moves smoothly.
 */

import * as THREE from 'three';
import type { Character } from '../core/CharacterLoader';
import type { EnemyState } from './Enemy';

export interface CharacterRigOptions {
  /**
   * Ground speed the walk clip was authored at, in m/s. The clip plays at rate 1 here and
   * scales from it — so this is the one number that decides whether the legs skate, and it
   * is measured by watching, not by reading the file.
   */
  walkReferenceSpeed: number;
  /** Seconds the attack clip is squeezed or stretched into (§5.3's wind-up). */
  attackSeconds: number;
  /** Uniform scale onto the enemy's authored size. */
  scale: number;
}

/** Which clip a state wants, in the order a fallback should be tried. */
const STATE_CLIPS: Readonly<Record<EnemyState, readonly string[]>> = {
  // §5.1 — a blink and a pursuit are both walking; the state names differ, the legs do not.
  wander: ['walk', 'idle'],
  pursue: ['walk', 'idle'],
  blink: ['walk', 'idle'],
  flee: ['walk', 'idle'],
  attack: ['attack', 'jump', 'idle'],
  // §5.1's stun is literal: velocity drops to zero. The body still breathes — a spider held
  // in a beam is stopped, not switched off, and a frozen pose reads as a bug.
  frozen: ['idle'],
  recoil: ['idle'],
};

export class CharacterRig {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: string | null = null;

  constructor(
    readonly character: Character,
    private readonly options: CharacterRigOptions,
  ) {
    character.scene.scale.setScalar(options.scale);
    this.mixer = new THREE.AnimationMixer(character.scene);

    for (const [key, clip] of character.clips) {
      const action = this.mixer.clipAction(clip);
      if (key === 'attack') {
        // Squeezed into §5.3's wind-up, and played once: an attack that loops is an attack
        // whose contact frame comes round again while the strike has already resolved.
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = clip.duration / options.attackSeconds;
      }
      this.actions.set(key, action);
    }
  }

  /** Clips this rig actually has, for the debug readout and for tests. */
  get clipNames(): string[] {
    return [...this.actions.keys()];
  }

  /** The clip playing right now, or null before the first update. */
  get playing(): string | null {
    return this.current;
  }

  /**
   * Advance the animation. `speed` is the enemy's ground speed in m/s and `delta` is the
   * render delta in seconds (§7).
   */
  update(state: EnemyState, speed: number, delta: number): void {
    const wanted = this.pick(state);
    if (wanted && wanted !== this.current) {
      const next = this.actions.get(wanted)!;
      const previous = this.current ? this.actions.get(this.current) : undefined;
      // Restarted rather than resumed, so an attack always begins at its first frame — a
      // second lunge that picks up halfway through the wind-up has no telegraph (§5.3).
      next.reset().play();
      if (previous) previous.crossFadeTo(next, 0.15, false);
      this.current = wanted;
    }

    const walk = this.actions.get('walk');
    if (walk && this.current === 'walk') {
      // §5.1 — the legs keep up with the ground. Clamped above zero so a spider that has
      // stopped without changing state does not freeze mid-stride, which reads as a hitch
      // rather than as a stop.
      walk.timeScale = Math.max(0.05, speed / this.options.walkReferenceSpeed);
    }

    this.mixer.update(delta);
  }

  private pick(state: EnemyState): string | null {
    for (const key of STATE_CLIPS[state]) {
      if (this.actions.has(key)) return key;
    }
    return this.actions.keys().next().value ?? null;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.character.scene);
    this.character.scene.removeFromParent();
  }
}
