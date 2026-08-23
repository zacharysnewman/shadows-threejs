/**
 * The player's health pool (§3.4).
 *
 * A 0.0–1.0 buffer against the spider only — the Shadow Monster's contact is fatal at any
 * value (§5.3) and never asks this class anything. There is no invulnerability window
 * here: the attack cooldown that stops a spider re-hitting on consecutive ticks lives on
 * the spider (§5.3), so two attackers landing inside the same second both deduct.
 *
 * Every timer runs on the fixed simulation clock (§7), so `tick` takes the sim delta and
 * never reads wall time.
 */

import { HEALTH } from '../config';

export class Health {
  /** Current pool, 0.0–1.0. Full at run start (§3.4). */
  private _value: number = HEALTH.max;
  /** Seconds of simulation time since the last damage, or `Infinity` if never damaged. */
  private _sinceDamage = Number.POSITIVE_INFINITY;

  get value(): number {
    return this._value;
  }

  get dead(): boolean {
    return this._value <= 0;
  }

  /** True once health has been low enough for long enough to be regenerating (§3.4). */
  get regenerating(): boolean {
    return !this.dead && this._value < HEALTH.max && this._sinceDamage >= HEALTH.regenDelay;
  }

  /** Seconds until regeneration starts; `0` once it has, `Infinity` at full health. */
  get regenDelayRemaining(): number {
    if (this._value >= HEALTH.max || this.dead) return Number.POSITIVE_INFINITY;
    return Math.max(0, HEALTH.regenDelay - this._sinceDamage);
  }

  /** Below this the heartbeat quickens and the screen desaturates (§3.4, Phase 10). */
  get critical(): boolean {
    return this._value < HEALTH.lowThreshold;
  }

  /**
   * Deduct damage and restart the regeneration delay. Returns true when this deduction is
   * what took the pool to zero, so the caller can resolve death exactly once.
   */
  damage(amount: number = HEALTH.spiderDamage): boolean {
    if (this.dead) return false;
    this._value = Math.max(0, this._value - Math.max(0, amount));
    // §3.4 — taking damage resets the delay, so chip damage indefinitely postpones regen.
    this._sinceDamage = 0;
    return this.dead;
  }

  /** Debug and run-restart affordance; nothing in the game heals the player (§3.4). */
  set(value: number): void {
    this._value = Math.min(HEALTH.max, Math.max(0, value));
    this._sinceDamage = Number.POSITIVE_INFINITY;
  }

  reset(): void {
    this.set(HEALTH.max);
  }

  /** Advance the delay and, once it has elapsed, the refill (§3.4). */
  tick(dt: number): void {
    if (this.dead) return;
    this._sinceDamage += dt;
    if (this._value >= HEALTH.max || this._sinceDamage < HEALTH.regenDelay) return;
    // Regeneration continues while moving; there is no resting action to gate it on.
    this._value = Math.min(HEALTH.max, this._value + HEALTH.regenRate * dt);
  }
}
