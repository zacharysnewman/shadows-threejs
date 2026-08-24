/**
 * The Shadow Monster's footsteps (§5.2, §4.3).
 *
 * Its body is never drawn (§5.2), so for most of a run the only thing the player has is
 * this: a heavy step, somewhere, carrying much further than anything else on the map
 * (§4.3's `monsterFootsteps` profile). Slower than the player's own stride so the two are
 * never confusable — a step you did not take is the monster.
 *
 * Driven by ground covered rather than by a timer, like the player's (§4.3), so a monster
 * frozen in a beam is silent and one closing at speed is not. That silence is the point:
 * light stops it, and stopping it also takes away the sound you were tracking it by.
 *
 * One-shots from the pool rather than a held emitter, because a step is an onset and the
 * pool is exactly what §4.3 sized for them.
 */

import { ENEMY } from '../config';
import type { AudioCore } from '../audio/AudioCore';
import { FootstepCadence } from '../audio/Footsteps';
import type { ShadowMonster } from './ShadowMonster';

export class MonsterFootsteps {
  private readonly cadences = new Map<ShadowMonster, FootstepCadence>();
  private readonly last = new Map<ShadowMonster, { x: number; z: number }>();
  private _steps = 0;

  constructor(private readonly audio: AudioCore) {}

  /** Steps played this run — the readout's number, and a test's. */
  get stepCount(): number {
    return this._steps;
  }

  /** One simulation tick (§7): feed each monster the ground it just covered. */
  tick(monsters: readonly ShadowMonster[]): void {
    for (const monster of monsters) {
      let cadence = this.cadences.get(monster);
      if (!cadence) {
        cadence = new FootstepCadence(ENEMY.shadowMonster.strideMetres);
        this.cadences.set(monster, cadence);
        this.last.set(monster, { x: monster.position.x, z: monster.position.y });
        continue;
      }

      const previous = this.last.get(monster)!;
      const moved = Math.hypot(monster.position.x - previous.x, monster.position.y - previous.z);
      previous.x = monster.position.x;
      previous.z = monster.position.y;

      // A blink gets footsteps like any other walking (§5.2). It used to be silenced here,
      // when it was a 2 m jump-cut: eight strides' worth of ground in 0.15 s would have
      // been a burst of noise for a movement that never happened. It is a walk now, at
      // walking speed, and the steps are the only thing the player has while the beam is
      // down — half a second of hearing it come is the point of the window.
      if (!cadence.tick(moved)) continue;
      this.audio.playAt(
        'footstep_heavy',
        monster.position.x,
        monster.position.y,
        'monsterFootsteps',
      );
      this._steps += 1;
    }
  }
}
