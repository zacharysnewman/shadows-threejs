/**
 * Step cadence (§4.3).
 *
 * The first consumer of the source pool, and the only one until enemies exist: a step
 * sound every stride's worth of ground covered. Driven by distance rather than by a timer,
 * so a player easing into a walk does not get the same cadence as one at full speed, and a
 * player stopped against a wall gets none at all.
 *
 * Pure arithmetic on the fixed clock (§7) — it reports *when* a step lands and nothing
 * else, so the same class serves the player now and any walking entity later.
 */
export class FootstepCadence {
  private travelled = 0;

  constructor(private readonly strideMetres = 0.95) {}

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
