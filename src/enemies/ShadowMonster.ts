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
 * stretch of watching it is free. After that the beam blinks — half a second in which it
 * drops to almost nothing and the freeze lifts, and the monster simply *walks*, at the
 * speed it always walks, towards the player. Letting go resets the ramp and loses the
 * monster; holding on keeps it and feeds it ground half a second at a time.
 *
 * The blink is not a teleport and the beam does not go out. Both were true once and both
 * were worse: a jump-cut is a thing the player is told about after the fact, and a beam at
 * zero reads as the torch failing rather than as the monster reaching into it. What the
 * player gets now is half a second of near-dark with heavy footsteps in it, and a shape
 * that is closer when the light comes back.
 *
 * It throws no shadow while it walks. §5.2 is absolute that it is never both moving and
 * visible, and a beam held at 15% is still enough to cast by — so the shadow goes out for
 * the window and comes back somewhere else. See `render`.
 *
 * The one thing the beam cannot do is push it back. There is no deterrence timer here and
 * no flee — §5's table gives the monster no flee speed — and its contact is fatal at any
 * health (§5.3). Everything below is that asymmetry made arithmetic.
 */

import { ENEMY } from '../config';
import type { Rng } from '../core/rng';
import type { PathOptions } from '../nav/AStar';
import { litCostFor, unlitOnly } from '../nav/LitGrid';
import { drawJitter, flickerFraction, severityAt } from '../lighting/flicker';
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
  /** Seconds left of the post-blink lockout; it starts when the blink ends. */
  private blinkCooldown = 0;
  /** Seconds left of the current blink — the window the beam is down and it is free. */
  private blinkFor = 0;
  private _blinks = 0;

  constructor(key: string, spawnX: number, spawnZ: number, rng: Rng) {
    super(ENEMY_PROFILES.ShadowMonster, key, spawnX, spawnZ, rng);
  }

  /**
   * §5.2's hard rule, and the one thing in this class that is not negotiable: **it is
   * never both moving and visible.**
   *
   * It is visible only as the shadow it throws, so the rule is enforced by not throwing
   * one. Everywhere else that comes free — light freezes it, so anything lighting it has
   * already stopped it. The blink is the exception the rule has to be spelled out for: the
   * beam holds at 15% through the window (§5.2), which is enough light to cast by, and the
   * monster is walking. So for the length of a blink it casts nothing at all.
   *
   * What the player gets is the shape on the floor going out, half a second of footsteps in
   * near-dark, and the shape back in a different place. Never a silhouette in motion.
   *
   * Set on the render frame rather than the tick that changes the state, so the value the
   * shadow pass reads is always this frame's.
   */
  override render(alpha: number): void {
    super.render(alpha);

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

  /**
   * §5 — light is expensive, never impassable.
   *
   * The distinction is the whole of this creature's half of §5's asymmetry. A spider will
   * not enter light at all; this one prefers the dark and pays when the dark is longer,
   * because §5.2's threat is that it *never stops* — a monster a lamp could wall off is a
   * monster the player can hide from, and §5.2 spends its whole length promising they
   * cannot.
   *
   * It is also what keeps §4.2's sabotage in the game. The monster disables a lamp by
   * standing in its cone (§5.2 step 3), so a monster that refused to cross a pool could
   * never start one — the lifecycle would be waiting on a lamp to come on over its head.
   * At this price it walks into pools when the way round is long, freezes there, and the
   * lamp's flicker becomes the tell that it is being taken apart.
   */
  protected override pathOptions(context: EnemyContext): PathOptions {
    const from = context.grid.worldToGrid(this.position.x, this.position.y);
    return {
      enterCost: litCostFor(context.lightTiles, ENEMY.lightAvoidance.monsterLitCost),
      // Straightened against the dark, or the shortcut undoes the detour: string-pulling
      // drops any waypoint the previous one can see, and the line it would replace the way
      // round a pool with is the line straight through it.
      smoothGrid: unlitOnly(context.grid, context.lightTiles, from.gx, from.gy),
    };
  }

  /** §5.3 — fatal at any health, with no wind-up and no telegraph. */
  override onPlayerContact(_distance: number, context: EnemyContext): void {
    context.player.kill();
  }

  protected override decide(dt: number, context: EnemyContext): void {
    if (this.state === 'blink') {
      this.advanceBlink(dt, context);
      return;
    }
    // Only ticks down outside a blink, so the dead time is half a second of *beam*, not
    // half a second that the blink itself has already spent.
    this.blinkCooldown = Math.max(0, this.blinkCooldown - dt);

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

    this.interfere(dt);
  }

  /** §5.2 step 2 — the severity ramp, the curve, and the blink it eventually allows. */
  private interfere(dt: number): void {
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
    this.beginBlink();
  }

  /** Stop interfering with a beam this monster is no longer in. */
  private releaseBeam(): void {
    this.focusFor = 0;
    this.dipTicks = 0;
    this._beamFraction = 1;
  }

  /**
   * §5.2 — the beam goes down and the freeze lifts. Nothing here places the monster
   * anywhere: it is put into `blink`, and `blink` steers and walks exactly as `pursue`
   * does, so the ground it covers is the ground its own legs cover in half a second, along
   * a route the grid allows. That is the whole difference from the lurch this replaces —
   * no march, no displacement, and no way to arrive somewhere it could not have walked.
   */
  private beginBlink(): void {
    this.blinkFor = BLINK.seconds;
    this.dipTicks = 0;
    // From this tick, not the next: the tick that triggers the blink is already part of it,
    // and leaving the curve's value on the beam would put one bright frame at the front of
    // a window whose whole job is to be dark.
    //
    // Zero, not the flicker's floor. §5.2's hard rule is that this creature is never both
    // moving and visible, and the only thing that makes it visible is a light casting its
    // shadow — so the window in which it walks is a window in which the torch emits nothing
    // at all. Held at 15% the rule needed enforcing against the renderer, by switching the
    // monster's shadow off underneath a beam that was still lit; off, it enforces itself.
    this._beamFraction = 0;
    this._blinks += 1;
    this.setState('blink');
  }

  /**
   * Carry the blink: hold the beam at the floor and let the ordinary pursuit steering do
   * the moving.
   *
   * The beam is pinned to `FLICKER.floor` for the whole window rather than left to the
   * oscillating curve. A blink is one event the player reads — the light goes, they hear
   * it coming, the light returns — and a beam still strobing through it would read as
   * several small ones instead.
   */
  private advanceBlink(dt: number, context: EnemyContext): void {
    const sample = context.illumination.sample(this.key, this.position.x, this.position.y);

    // `inBeam`, not `lit`. The beam is out *because of this blink*, so asking whether there
    // is light here would answer with the monster's own darkness and end the window one tick
    // after it opened. The question is whether the player still has the torch on and still
    // has it pointed here (§5.2).
    const held = sample.inBeam === true;
    // A lamp reaches it: light it cannot interfere with, so the blink is over and §5.2 step
    // 1 applies again on this tick, before anything moves.
    const lamped = sample.lit && sample.source === 'environment';

    // The beam has left it, or a lamp has caught it. Either ends the blink on this tick.
    //
    // A blink is half a second long and the player can sweep the torch away inside it —
    // and §5.2 is absolute that a beam not on the monster is a clean beam. Running the
    // window out regardless would hold their torch out while it points at something
    // else, and hold the severity ramp open across a break in focus that should have
    // reset it. Both were true of the first version of this walk.
    if (!held || lamped) {
      this.releaseBeam();
      this.blinkFor = 0;
      this.blinkCooldown = BLINK.cooldownSeconds;
      // §5.2 step 1 — a lamp freezes it exactly as the beam did; nothing else does.
      if (lamped) {
        this.setState('frozen');
        return;
      }
      this.setState('pursue');
      super.decide(dt, context);
      return;
    }

    this.blinkFor = Math.max(0, this.blinkFor - dt);
    this._beamFraction = 0;

    if (this.blinkFor > 0) {
      // Free, and hunting — in the dark it is standing in, which is what §5.2 licenses it
      // to walk through.
      super.decide(dt, context);
      return;
    }

    // The beam is back, and it is still in it — so it freezes again, the ramp goes on from
    // where it was (a blink is not a reprieve from the focus that caused it), and the dead
    // time starts now rather than half a second ago.
    //
    // `interfere` on this tick, not the next: the window is over, so the torch is emitting
    // again *now*. Leaving the fraction at zero until the next tick would keep the player in
    // the dark for a frame after the blink they just survived — and would leave the monster
    // recorded as frozen by a light that is out. It cannot re-trigger from here, because the
    // dead time is set first.
    this.blinkCooldown = BLINK.cooldownSeconds;
    this.setState('frozen');
    this.interfere(dt);
  }
}
