/**
 * Flashlight battery (§4.1).
 *
 * A 0.0–1.0 charge fraction that drains while the light is on and does not come back. It is
 * the run's whole supply of light — ten minutes of it — rather than a cooldown between uses,
 * so switching the beam off is not waiting for a meter to refill, it is banking what is
 * left for somewhere that needs it more.
 *
 * That is what makes being in the dark a decision. A battery that recharges asks the player
 * to spend a little time unlit and hands the light back; one that does not asks them to
 * decide, every time, whether this stretch of corridor is worth part of the ending.
 *
 * There is no lockout, and none is needed. The strobe exploit a lockout would guard against
 * — blinking the beam a frame at a time to hold the Shadow Monster frozen indefinitely
 * (§5.2) — only pays when the charge comes back. Here every blink is spent for good, so the
 * exploit is its own cost. A flat battery is flat for the rest of the run.
 *
 * Pure arithmetic on the fixed simulation clock (§7) — no Three.js, no rendering.
 */

import { FLASHLIGHT } from '../config';

export class Battery {
  private _charge = 1;
  private _on = false;

  get charge(): number {
    return this._charge;
  }

  get on(): boolean {
    return this._on;
  }

  /** False once the battery is flat — a toggle would be refused, and always will be. */
  get canTurnOn(): boolean {
    return this._charge > 0;
  }

  /**
   * Beam brightness as a fraction of full, 0 when off (§4.1). Full above 0.25 charge and
   * falling linearly to 40% at empty, so the last of the light is something the player
   * watches happen rather than a beam that is fine until it is gone.
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
    if (!this._on) return;

    this._charge = Math.max(0, this._charge - FLASHLIGHT.drainPerSecond * dt);
    // §4.1 — at 0.0 the light cuts out, and there is nothing to switch back on.
    if (this._charge === 0) this._on = false;
  }

  /** Debug and run-restart affordance; nothing in the game sets the charge directly. */
  set(charge: number): void {
    this._charge = Math.min(1, Math.max(0, charge));
    if (this._charge === 0) this._on = false;
  }

  reset(): void {
    this._charge = 1;
    this._on = false;
  }
}
