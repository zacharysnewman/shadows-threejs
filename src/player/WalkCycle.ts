/**
 * The player's walk cycle, measured in ground rather than in seconds (§3.1, §4.3).
 *
 * **One cycle is a fixed length of ground, not a fixed length of time.** The clip is
 * authored as `strideSeconds` at `walkClipSpeed`, so a stride is the product of the two —
 * whatever speed the player actually crosses it at. It is the rule §5.1's `Gait` already
 * uses for enemy bodies, for the same reason: legs go down where they touch, and a body
 * held against a wall is not walking however hard it pushes.
 *
 * **The footfalls are part of the cycle, not a second counter beside it.** A leg reaches
 * its forward extreme a quarter and three quarters of the way through — that is where a
 * foot plants — so those are the two moments a step is heard (§4.3). Driving the sound
 * from a distance counter of its own is what let the two drift: the cadence was right for
 * one speed and the animation was right for all of them, and at every other speed the
 * player heard steps their body was not taking.
 *
 * Pure arithmetic on the fixed clock (§7), with no Three.js in it, so both halves — where
 * the legs are and when a step lands — can be checked without a scene.
 */

import { PLAYER_RIG } from '../config';

/**
 * §3.1 — ground covered by one full stride. The clip's own duration times the speed it is
 * authored at: driving it by distance is what makes the product the only thing that matters.
 */
export const CYCLE_METRES = PLAYER_RIG.strideSeconds * PLAYER_RIG.walkClipSpeed;

/** §4.3 — ground between one foot landing and the other. Half a stride, by definition. */
export const FOOTFALL_METRES = CYCLE_METRES / 2;

export class WalkCycle {
  /** Ground covered within the current cycle, in metres. Always `0 ≤ travelled < cycle`. */
  private travelled = 0;
  private _footfalls = 0;

  constructor(private readonly cycleMetres: number = CYCLE_METRES) {}

  /** Cycle position, 0–1, wrapping. What the clip is posed at. */
  get phase(): number {
    return this.travelled / this.cycleMetres;
  }

  /** Feet landed since the run started. The audio side reads the difference. */
  get footfalls(): number {
    return this._footfalls;
  }

  /**
   * Feed the ground covered this tick. Returns how many feet landed on it — normally 0 or
   * 1, and more only if something moved the player further than half a stride in one tick.
   */
  advance(distanceMoved: number): number {
    if (!(distanceMoved > 0)) return 0;
    const after = this.travelled + distanceMoved;
    const landed = this.plantsUpTo(after) - this.plantsUpTo(this.travelled);
    // Modulo rather than reset: at sprint speed a tick can cover a good fraction of a
    // stride, and carrying the remainder keeps the cycle even instead of drifting.
    this.travelled = after % this.cycleMetres;
    this._footfalls += landed;
    return landed;
  }

  /** Back to standing — a body that has been picked up and put somewhere else. */
  reset(): void {
    this.travelled = 0;
  }

  /**
   * Feet planted in the ground from the start of the current cycle up to `metres`.
   *
   * The plants sit at `PLAYER_RIG.footPlantPhase` and half a cycle after it, so counting
   * them is one floor — and taking the difference across a tick is what makes a step land
   * exactly once however far the tick moved the player.
   */
  private plantsUpTo(metres: number): number {
    const first = this.cycleMetres * PLAYER_RIG.footPlantPhase;
    if (metres < first) return 0;
    return Math.floor((metres - first) / (this.cycleMetres / 2)) + 1;
  }
}

/**
 * Interpolate a cycle position across the shortest way round, the way a position is
 * interpolated between ticks (§7).
 *
 * The cycle advances on the simulation clock because the *sound* is on it, and the legs
 * would otherwise show the 60 Hz staircase everything else interpolates away. Straight
 * `lerp` is wrong once per stride: from 0.98 to 0.02 it walks the legs backwards through
 * the whole cycle in one frame.
 */
export function lerpPhase(from: number, to: number, alpha: number): number {
  let delta = to - from;
  if (delta < -0.5) delta += 1;
  else if (delta > 0.5) delta -= 1;
  const phase = (from + delta * alpha) % 1;
  return phase < 0 ? phase + 1 : phase;
}
