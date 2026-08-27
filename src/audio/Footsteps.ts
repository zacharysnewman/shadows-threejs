/**
 * Which recording a footstep comes out as (§4.3).
 *
 * *When* a step lands is not here: it is the walk cycle's, in `src/player/WalkCycle.ts`,
 * because a step is a foot going down and the body is what puts it there. A cadence of its
 * own beside the animation is what drifted, and the sound the player heard was a walk
 * nobody was doing. This is the other half — which of the four takes that footfall is.
 */

import type { Rng } from '../core/rng';

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
