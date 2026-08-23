/**
 * The Giant Spider (§5.1, §5.3).
 *
 * Everything here is what the beam does to it, and what happens when it reaches the
 * player. The pathing, the speeds and the collision are the shared enemy's (§5); this adds
 * the two things that are only a spider's.
 *
 * **The light reaction is a ladder, not a switch.** Catching a spider in the beam stops it
 * dead; *holding* it there for `T_flee` is what turns it round. The randomised timer is
 * the whole texture of the fight — the player cannot know whether this spider breaks in
 * one second or four, so the beam is never obviously enough and never obviously wasted,
 * and the battery is draining the entire time (§4.1). Sweeping the light off and back on
 * resets the ladder, so panicked flicking between two spiders deters neither.
 *
 * **The attack is a commitment.** Reaching the player starts a lunge rather than landing a
 * hit, the lunge takes 0.35 s, and the range is re-tested at the end of it. That is the
 * only reason a spider is survivable: the damage is answerable, by walking, or by putting
 * the beam on it while it is committed. Every timer below is on the simulation clock (§7),
 * including the strike — §5.3 is explicit that the animation is authored to the strike and
 * not the other way round.
 */

import { ENEMY, HEALTH } from '../config';
import type { Rng } from '../core/rng';
import { Enemy, ENEMY_PROFILES, type EnemyContext } from './Enemy';

const LIGHT = ENEMY.spider.light;
const ATTACK = ENEMY.spider.attack;

export class Spider extends Enemy {
  /** Seconds of *continuous* illumination so far, against `fleeThreshold` (§5.1 step 2). */
  private litFor = 0;
  /** This stun's roll of `T_flee`. Re-rolled every time the beam catches an unlit spider. */
  private fleeThreshold = 0;
  /** Seconds since the light left, against §5.1 step 4's 0.2 s resume delay. */
  private unlitFor = 0;
  /** Seconds left of the current flee leg (§5.1 step 3). */
  private fleeFor = 0;
  /** Whether this flee leg has anywhere to go, or is the cornered spider's cower. */
  private fleeHasRoute = false;
  /** Seconds left of the wind-up, counted down to the strike (§5.3). */
  private windUp = 0;
  /** Seconds left of the post-strike cooldown, hit or miss (§5.3). */
  private cooldown = 0;

  constructor(key: string, spawnX: number, spawnZ: number, rng: Rng) {
    super(ENEMY_PROFILES.SpiderEnemy, key, spawnX, spawnZ, rng);
  }

  /** Lifecycle state for the debug readout — the four steps are not visible from `state`. */
  get lightStatus(): string {
    if (this.state === 'flee') return `flee ${this.fleeFor.toFixed(1)}s${this.fleeHasRoute ? '' : ' (cornered)'}`;
    if (this.state === 'frozen') {
      return this.unlitFor > 0
        ? `resuming in ${(LIGHT.resumeDelaySeconds - this.unlitFor).toFixed(2)}s`
        : `stunned ${this.litFor.toFixed(1)}/${this.fleeThreshold.toFixed(1)}s`;
    }
    if (this.state === 'attack') return `wind-up ${this.windUp.toFixed(2)}s`;
    if (this.cooldown > 0) return `cooldown ${this.cooldown.toFixed(1)}s`;
    return 'clear';
  }

  get attackCooldownRemaining(): number {
    return this.cooldown;
  }

  /**
   * §5.3 — closing to 1.0 m starts an attack; it does not land one. Refused while the
   * spider is held by anything else, so a stunned or fleeing or already-committed spider
   * cannot begin a second lunge by drifting through the threshold.
   */
  override onPlayerContact(_distance: number, _context: EnemyContext): void {
    if (this.cooldown > 0) return;
    if (this.state !== 'wander' && this.state !== 'pursue') return;
    this.windUp = ATTACK.windUpSeconds;
    this.setState('attack');
  }

  protected override decide(dt: number, context: EnemyContext): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const lit = context.illumination.sample(this.key, this.position.x, this.position.y).lit;

    // §5.1 step 3 — a flee leg runs to its end. Checked before the light, because light
    // does not re-stun a fleeing spider: it would otherwise be pinned a metre from where
    // the player started deterring it, which is the opposite of what deterring it means.
    if (this.state === 'flee') {
      this.fleeFor -= dt;
      const arrived = this.fleeHasRoute && this.waypoints.length === 0;
      if (this.fleeFor > 0 && !arrived) return;
      // Out of the flee and straight back into the world's terms: if the player is still
      // inside the detect radius the shared logic re-acquires them on this same tick.
      this.setState('wander');
      this.litFor = 0;
      this.unlitFor = 0;
    }

    if (lit) {
      this.reactToLight(dt, context);
      return;
    }

    if (this.state === 'frozen') {
      // §5.1 step 4 — the beam left before `T_flee` expired. A short delay, then it comes
      // on again. Without the delay a spider tracked by a shaky beam would stutter between
      // stopped and charging every few frames and read as broken rather than as deterred.
      this.unlitFor += dt;
      if (this.unlitFor < LIGHT.resumeDelaySeconds) return;
      this.litFor = 0;
      this.unlitFor = 0;
      this.setState('pursue');
    }

    if (this.state === 'attack') {
      this.windUp -= dt;
      if (this.windUp <= 0) this.strike(context);
      return;
    }

    super.decide(dt, context);
  }

  /** §5.1 steps 1–3: the stun, the timer it starts, and what the timer buys. */
  private reactToLight(dt: number, context: EnemyContext): void {
    if (this.state !== 'frozen') {
      // §5.1 step 1 — instant and unconditional, including out of a committed lunge:
      // §5.3's cancellation is this line, and the strike that never happens starts no
      // cooldown, so the beam is the answer to an attack rather than a way to buy one off.
      this.windUp = 0;
      this.setState('frozen');
      // §5.1 step 2 — rolled per stun, from the run's seed, so a replay deters identically.
      this.fleeThreshold = this.rng.range(
        LIGHT.fleeDelaySeconds.min,
        LIGHT.fleeDelaySeconds.max,
      );
      this.litFor = 0;
    }

    this.unlitFor = 0;
    this.litFor += dt;
    if (this.litFor >= this.fleeThreshold) this.beginFlee(context);
  }

  /**
   * §5.1 step 3 — directly away from the player, as far along that vector as the map
   * allows, for 3 s.
   *
   * Stepped rather than solved: the grid is what decides walkability (§2), and marching it
   * in sub-tile steps and stopping at the first blocked sample is what guarantees the
   * target is somewhere the spider can actually stand. Taking the far end and testing only
   * that would happily aim it through a wall into open ground beyond.
   */
  private beginFlee(context: EnemyContext): void {
    const dx = this.position.x - context.playerX;
    const dz = this.position.y - context.playerZ;
    const length = Math.hypot(dx, dz);
    const ux = length < 1e-4 ? 0 : dx / length;
    const uz = length < 1e-4 ? 1 : dz / length;

    let targetX = this.position.x;
    let targetZ = this.position.y;
    for (let d = LIGHT.fleeSearchStep; d <= LIGHT.fleeSearchDistance; d += LIGHT.fleeSearchStep) {
      const x = this.position.x + ux * d;
      const z = this.position.y + uz * d;
      const { gx, gy } = context.grid.worldToGrid(x, z);
      if (!context.grid.isWalkable(gx, gy)) break;
      targetX = x;
      targetZ = z;
    }

    this.setState('flee');
    this.fleeFor = LIGHT.fleeSeconds;
    this.litFor = 0;
    // Nothing found means the away vector is into a wall: cornered. It still spends the
    // 3 s, standing — a spider backed into a dead end has been beaten, and pretending it
    // can retreat anyway by sending it somewhere sideways would undo that.
    this.fleeHasRoute =
      Math.hypot(targetX - this.position.x, targetZ - this.position.y) > LIGHT.fleeSearchStep * 0.5 &&
      this.repath(context, targetX, targetZ);
  }

  /**
   * §5.3 step 2 — the 1.0 m check, taken again, now. The distance at the start of the
   * wind-up is not consulted: the whole point of the telegraph is that the player can make
   * this test fail.
   */
  private strike(context: EnemyContext): void {
    this.windUp = 0;
    // §5.3 — from the strike, hit or miss, and on the spider rather than on the player, so
    // two spiders converging both land inside the same second.
    this.cooldown = ATTACK.cooldownSeconds;

    const distance = this.distanceTo(context.playerX, context.playerZ);
    if (distance >= ENEMY.contactDistance) {
      // Missing costs it tempo, or dodging bought the player nothing.
      this.setState('recoil', ATTACK.missHoldSeconds);
      return;
    }

    context.player.damage(HEALTH.spiderDamage);
    context.player.knockBack(this.position.x, this.position.y, ATTACK.playerKnockback);
    this.knockBack(context.colliders, context.playerX, context.playerZ, ATTACK.recoilDistance);
    this.setState('recoil', ATTACK.hitHoldSeconds);
  }
}
