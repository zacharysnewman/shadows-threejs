/**
 * The flicker curve (§5.2), shared by the flashlight's interference and by an
 * environmental lamp under strain (§4.2).
 *
 * One formula in one place, because §4.2 asks for "the same character" and the reason is a
 * gameplay one: a lamp starting to strain across the map and a beam starting to blink are
 * the player learning the same fact — the monster is *there* — and they must not look like
 * two unrelated effects.
 *
 * ```
 * I(t) = I_base · max(floor, 1 − severity · |sin(f · t)| · random(0.7, 1.3))
 * ```
 *
 * The floor is the part worth knowing about: the formula's own range runs below zero at
 * high severity, and a light that reaches zero is not flickering, it is off (§5.2).
 *
 * Pure arithmetic, and the randomness is passed in rather than drawn here, so the curve
 * can be tested exactly and so a run replays identically from its seed (Cross-Cutting:
 * determinism).
 */

import { FLICKER } from '../config';

/**
 * The intensity fraction at time `t`, 0–1. `severity` is the ramp's current value and
 * `jitter` is one draw from `random(0.7, 1.3)` — one per simulation tick (§5.2), which is
 * what makes the depth of successive dips uneven.
 */
export function flickerFraction(t: number, severity: number, jitter: number): number {
  const dip = severity * Math.abs(Math.sin(FLICKER.frequency * t)) * jitter;
  // Clamped to `FLICKER.floor` rather than to zero (§5.2): at full severity a high jitter
  // draw takes the formula negative, and a light held at zero is a light switched off.
  return Math.min(1, Math.max(FLICKER.floor, 1 - dip));
}

/**
 * A severity ramp: `from` at zero seconds of focus, `to` at `rampSeconds` and after.
 * Linear, because §5.2 says "ramps ... over 3 seconds" and gives no curve — and because
 * the number the player actually reads is how *bad* the flicker looks, which a linear ramp
 * in severity already renders as an accelerating one.
 */
export function severityAt(
  focusSeconds: number,
  rampSeconds: number,
  from: number,
  to: number,
): number {
  if (rampSeconds <= 0) return to;
  const progress = Math.min(1, Math.max(0, focusSeconds / rampSeconds));
  return from + (to - from) * progress;
}

/** One draw of §5.2's `random(0.7, 1.3)`. */
export function drawJitter(random: () => number): number {
  return FLICKER.jitter.min + random() * (FLICKER.jitter.max - FLICKER.jitter.min);
}
