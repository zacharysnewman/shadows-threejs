/**
 * Step cadence, and which recording a step comes out as (§4.3).
 *
 * The first consumer of the source pool, and the only one until enemies exist: a step
 * sound every stride's worth of ground covered. Driven by distance rather than by a timer,
 * so a player easing into a walk does not get the same cadence as one at full speed, and a
 * player stopped against a wall gets none at all.
 *
 * Pure arithmetic on the fixed clock (§7) — it reports *when* a step lands and *which* of
 * the recordings it is, and nothing else, so the same classes serve the player now and any
 * walking entity later.
 */

import { AUDIO } from '../config';
import type { Rng } from '../core/rng';

export class FootstepCadence {
  private travelled = 0;

  constructor(private readonly strideMetres: number = AUDIO.playerStrideMetres) {}

  /** Feed the distance covered this tick. True on the tick a step lands. */
  tick(distanceMoved: number): boolean {
    if (distanceMoved <= 0) return false;
    this.travelled += distanceMoved;
    if (this.travelled < this.strideMetres) return false;
    // Modulo rather than reset: at high speed a tick can cover more than one stride, and
    // carrying the remainder keeps the cadence even instead of drifting.
    this.travelled %= this.strideMetres;
    return true;
  }

  reset(): void {
    this.travelled = 0;
  }
}

/**
 * Which of the player's step recordings the next footfall is (§4.3).
 *
 * **Never the same one twice running.** A uniform draw repeats a clip one time in four, and
 * a sample heard twice in a row is exactly what stops a set of variants reading as a person
 * walking — the repeat is more audible than the variation it is hiding in. So the draw is
 * over the *other* variants: an offset of 1…count−1 from the last index, which is uniform
 * across them and cannot land on where it already is.
 *
 * The numbers come from the run's `Rng` rather than `Math.random` (Cross-Cutting:
 * determinism), so a seed replays the same steps in the same order.
 */
export class FootstepVariants {
  private last = -1;

  constructor(
    private readonly count: number,
    private readonly rng: Rng,
  ) {}

  /** The index of the recording to play, in `0 ≤ i < count`. */
  next(): number {
    if (this.count <= 1) return 0;
    if (this.last < 0) {
      this.last = this.rng.int(this.count);
      return this.last;
    }
    this.last = (this.last + 1 + this.rng.int(this.count - 1)) % this.count;
    return this.last;
  }
}
