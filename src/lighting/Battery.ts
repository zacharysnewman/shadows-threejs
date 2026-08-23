/**
 * Flashlight battery (§4.1).
 *
 * A 0.0–1.0 charge fraction that drains while the light is on and recharges, at half the
 * rate, while it is off — so sustained use costs twice what it returns, and the player is
 * pushed into moments of being in the dark on purpose rather than by accident.
 *
 * The lockout is the part worth being careful with. Draining to empty does not just switch
 * the light off: it latches, and the light cannot be switched back on until the charge has
 * recovered to 0.15. Without that, a player could strobe the beam a frame at a time and
 * hold the Shadow Monster frozen indefinitely (§5.2) on almost no charge at all.
 *
 * Pure arithmetic on the fixed simulation clock (§7) — no Three.js, no rendering.
 */

import { FLASHLIGHT } from '../config';

export class Battery {
  private _charge = 1;
  private _on = false;
  /** Latched by a full drain; cleared once the charge recovers to `reEnableCharge`. */
  private _lockedOut = false;

  get charge(): number {
    return this._charge;
  }

  get on(): boolean {
    return this._on;
  }

  get lockedOut(): boolean {
    return this._lockedOut;
  }

  /** False while the lockout holds or the battery is flat — a toggle would be refused. */
  get canTurnOn(): boolean {
    return !this._lockedOut && this._charge > 0;
  }

  /**
   * Beam brightness as a fraction of full, 0 when off (§4.1). Full above 0.25 charge and
   * falling linearly to 40% at empty, so the reserve draining is something the player sees
   * before it fails rather than a light that is fine until it is gone.
   */
  get intensityFraction(): number {
    if (!this._on) return 0;
    if (this._charge >= FLASHLIGHT.falloffCharge) return 1;
    const t = this._charge / FLASHLIGHT.falloffCharge;
    return FLASHLIGHT.minIntensityFraction + (1 - FLASHLIGHT.minIntensityFraction) * t;
  }

  /** Returns whether the light is on afterwards, so a refused turn-on is visible. */
  turnOn(): boolean {
    if (!this.canTurnOn) return false;
    this._on = true;
    return true;
  }

  turnOff(): void {
    this._on = false;
  }

  toggle(): boolean {
    if (this._on) {
      this.turnOff();
      return false;
    }
    return this.turnOn();
  }

  tick(dt: number): void {
    if (this._on) {
      this._charge = Math.max(0, this._charge - FLASHLIGHT.drainPerSecond * dt);
      if (this._charge === 0) {
        // §4.1 — at 0.0 the light cuts out, and stays out until the charge recovers.
        this._on = false;
        this._lockedOut = true;
      }
      return;
    }

    this._charge = Math.min(1, this._charge + FLASHLIGHT.rechargePerSecond * dt);
    if (this._lockedOut && this._charge >= FLASHLIGHT.reEnableCharge) this._lockedOut = false;
  }

  /** Debug and run-restart affordance; nothing in the game sets the charge directly. */
  set(charge: number): void {
    this._charge = Math.min(1, Math.max(0, charge));
    if (this._charge === 0) {
      this._on = false;
      this._lockedOut = true;
    } else if (this._charge >= FLASHLIGHT.reEnableCharge) {
      this._lockedOut = false;
    }
  }

  reset(): void {
    this._charge = 1;
    this._on = false;
    this._lockedOut = false;
  }
}
