/**
 * The Shadow Monster (§5.2, §5.3).
 *
 * The spider is a threat you answer with the light. This one is a threat the light only
 * *locates*, and locating it is what lets it close.
 *
 * **The freeze is unconditional and the beam is the only way to find it.** Its body is
 * never drawn (§5.2), and the gloom casts no shadows (§4), so outside a light there is
 * nothing there at all — not a silhouette, not a shape. Sweeping the beam across empty
 * ground and finding a shadow lying in it is the whole of seeing this creature, and the
 * moment light touches it, it cannot move.
 *
 * **So holding the light on it is both the answer and the mistake.** Sustained focus makes
 * the beam struggle, and the struggle ramps: `flickerSeverity` climbs 0.1 → 0.95 over three
 * seconds, and the blink threshold is only reachable past 0.5, about 1.4 s in. The first
 * stretch of watching it is free. After that every dip is a chance for it to be two metres
 * closer than it was, and the player is choosing between knowing where it is and keeping it
 * where it is. Letting go resets the ramp and loses the monster; holding on keeps it and
 * feeds it ground.
 *
 * The one thing the beam cannot do is push it back. There is no deterrence timer here and
 * no flee — §5's table gives the monster no flee speed — and its contact is fatal at any
 * health (§5.3). Everything below is that asymmetry made arithmetic.
 */

import { ENEMY } from '../config';
import type { Rng } from '../core/rng';
import { drawJitter, flickerFraction, severityAt } from '../lighting/flicker';
import { moveCircle } from '../player/collision';
import { Enemy, ENEMY_PROFILES, type EnemyContext } from './Enemy';

const FLICKER = ENEMY.shadowMonster.flicker;
const BLINK = ENEMY.shadowMonster.blink;

export class ShadowMonster extends Enemy {
  /** Seconds of *continuous* flashlight focus, driving the severity ramp (§5.2). */
  private focusFor = 0;
  /** This tick's beam fraction, 1 when nothing is interfering. Read by the manager. */
  private _beamFraction = 1;
  /** Consecutive ticks the beam has been under §5.2's threshold. */
  private dipTicks = 0;
  /** Seconds left of the post-blink lockout. */
  private blinkCooldown = 0;
  /** Seconds left of the current lurch, and where it is carrying the monster. */
  private blinkFor = 0;
  private blinkFromX = 0;
  private blinkFromZ = 0;
  private blinkToX = 0;
  private blinkToZ = 0;
  private _blinks = 0;

  constructor(key: string, spawnX: number, spawnZ: number, rng: Rng) {
    super(ENEMY_PROFILES.ShadowMonster, key, spawnX, spawnZ, rng);
  }

  /**
   * What the flashlight should be scaled to on account of this monster, 0–1 (§5.2). One
   * number out; the beam itself is somebody else's object.
   */
  get beamFraction(): number {
    return this._beamFraction;
  }

  get flickerSeverity(): number {
    return this.focusFor <= 0
      ? 0
      : severityAt(this.focusFor, FLICKER.rampSeconds, FLICKER.severity.from, FLICKER.severity.to);
  }

  /** How many times it has blinked this run — the readout's number, and a test's. */
  get blinkCount(): number {
    return this._blinks;
  }

  /** Lifecycle for the debug readout; `state` alone shows none of the ramp. */
  get lightStatus(): string {
    if (this.state === 'blink') return `BLINK ${this.blinkFor.toFixed(2)}s`;
    if (this.focusFor > 0) {
      return (
        `focus ${this.focusFor.toFixed(1)}s · severity ${this.flickerSeverity.toFixed(2)} · ` +
        `beam ${(this._beamFraction * 100).toFixed(0)}%${this.blinkCooldown > 0 ? ' · locked out' : ''}`
      );
    }
    return this.state === 'frozen' ? 'frozen (lamp)' : 'unseen';
  }

  /** §5.3 — fatal at any health, with no wind-up and no telegraph. */
  override onPlayerContact(_distance: number, context: EnemyContext): void {
    context.player.kill();
  }

  protected override decide(dt: number, context: EnemyContext): void {
    this.blinkCooldown = Math.max(0, this.blinkCooldown - dt);

    if (this.state === 'blink') {
      this.advanceBlink(dt, context);
      return;
    }

    const sample = context.illumination.sample(this.key, this.position.x, this.position.y);

    if (!sample.lit) {
      // Nothing on it: no interference, and the ramp restarts from scratch next time
      // (§5.2 — focus is continuous, exactly as §5.1's deterrence timer is).
      this.releaseBeam();
      // §5.2 step 1 is the only thing that freezes it, so losing the light unfreezes it on
      // the same tick — including the instant a lamp fails under it (§4.2).
      if (this.state === 'frozen') this.setState('pursue');
      super.decide(dt, context);
      return;
    }

    // §5.2 step 1 — illuminated by anything, it cannot move.
    if (this.state !== 'frozen') this.setState('frozen');

    if (sample.source !== 'flashlight') {
      // Under a lamp. §4.2 pins it there until the lamp fails, and the lamp's own flicker
      // is not this monster's beam interference — it belongs to the lamp (§4.2).
      this.releaseBeam();
      return;
    }

    this.interfere(dt, context);
  }

  /** §5.2 step 2 — the severity ramp, the curve, and the blink it eventually allows. */
  private interfere(dt: number, context: EnemyContext): void {
    this.focusFor += dt;
    // `t` is the focus time, not wall time: the sine has to start at a zero crossing when
    // the beam lands, or the first tick of focus can be a deep dip out of nowhere.
    const fraction = flickerFraction(
      this.focusFor,
      this.flickerSeverity,
      drawJitter(() => this.rng.float()),
    );
    this._beamFraction = fraction;

    if (fraction >= BLINK.intensityThreshold) {
      this.dipTicks = 0;
      return;
    }

    this.dipTicks += 1;
    if (this.dipTicks < BLINK.consecutiveTicks || this.blinkCooldown > 0) return;
    this.beginBlink(context);
  }

  /** Stop interfering with a beam this monster is no longer in. */
  private releaseBeam(): void {
    this.focusFor = 0;
    this.dipTicks = 0;
    this._beamFraction = 1;
  }

  /**
   * §5.2 — up to 2 m straight at the player, stopping short at the first solid tile.
   *
   * Marched against the grid in sub-tile steps for the same reason §5.1's flee target is:
   * testing only the far end would happily place the monster through a wall into whatever
   * is behind it, and a creature that walks through geometry is a bug rather than a tell.
   */
  private beginBlink(context: EnemyContext): void {
    const dx = context.playerX - this.position.x;
    const dz = context.playerZ - this.position.y;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) return;

    const ux = dx / length;
    const uz = dz / length;
    const reach = Math.min(BLINK.distance, length);

    let toX = this.position.x;
    let toZ = this.position.y;
    for (let d = BLINK.searchStep; d <= reach; d += BLINK.searchStep) {
      const x = this.position.x + ux * d;
      const z = this.position.y + uz * d;
      const { gx, gy } = context.grid.worldToGrid(x, z);
      if (!context.grid.isWalkable(gx, gy)) break;
      toX = x;
      toZ = z;
    }

    this.blinkFromX = this.position.x;
    this.blinkFromZ = this.position.y;
    this.blinkToX = toX;
    this.blinkToZ = toZ;
    this.blinkFor = BLINK.seconds;
    this.dipTicks = 0;
    this._blinks += 1;
    // §5.2 — the freeze breaks for the step and nothing else. The lockout starts here
    // rather than at the end, so the 0.5 s is measured from the blink the player saw.
    this.blinkCooldown = BLINK.cooldownSeconds;
    this.setState('blink');
  }

  /**
   * Carry the lurch. A displacement over a fixed 0.15 s rather than a velocity: it has to
   * take exactly that long however far it is going, and steering towards the endpoint
   * would overshoot the wall the march stopped at.
   *
   * Each tick's step still goes through the collider resolution, though. The march tests
   * the *centre* against the grid, which would leave a 0.55 m body half inside the wall it
   * stopped at; `moveCircle` is what actually keeps a body out of geometry, here as
   * everywhere else.
   */
  private advanceBlink(dt: number, context: EnemyContext): void {
    this.blinkFor = Math.max(0, this.blinkFor - dt);
    const progress = 1 - this.blinkFor / BLINK.seconds;
    const wantX = this.blinkFromX + (this.blinkToX - this.blinkFromX) * progress;
    const wantZ = this.blinkFromZ + (this.blinkToZ - this.blinkFromZ) * progress;

    const result = moveCircle(
      context.colliders,
      this.position.x,
      this.position.y,
      wantX - this.position.x,
      wantZ - this.position.y,
      this.profile.radius,
    );
    this.position.set(result.x, result.z);
    if (this.blinkFor > 0) return;

    // Landed. Still in the beam, almost certainly — so it freezes again, and the ramp goes
    // on from where it was: a blink is not a reprieve from the focus that caused it.
    this.setState('frozen');
  }
}
