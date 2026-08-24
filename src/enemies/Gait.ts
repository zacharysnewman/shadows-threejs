/**
 * What an enemy's body is doing, as arithmetic (§5.1, §5.2).
 *
 * The art pass (Phase 11) owes the spider "a speed-driven locomotion cycle and an attack
 * whose contact frame lands on §5.3's strike time". This is the half of that which is not
 * art: the numbers a clip would be driven by, so that swapping a placeholder for a real
 * `.glb` changes what is drawn and not when anything happens.
 *
 * **The cycle advances with ground covered, not with time.** A wandering spider at
 * 1.2 m/s and a fleeing one at 3.6 m/s both put their legs down where they touch, which is
 * the difference between walking and skating. It is the same rule §4.3 uses for footsteps,
 * and for the same reason: a body stopped against a wall is not walking however hard it
 * pushes.
 *
 * **The attack's progress runs 0 → 1 across the wind-up, and the strike is at 1.** §5.3 is
 * explicit that the strike time belongs to the simulation, so an animation is authored *to*
 * this number: whatever the clip does, its contact frame is placed where `strike` reaches 1,
 * and re-exporting the art cannot move when damage lands.
 *
 * Pure, and with no Three.js in it, so the curve can be checked without a scene.
 */

export interface Pose {
  /** Cycle position, 0–1, wrapping. One cycle is one `strideMetres` of ground. */
  gait: number;
  /** Vertical bob in metres, above the body's rest height. */
  bob: number;
  /** Pitch in radians. Negative is nose-down; a wind-up rears it back. */
  pitch: number;
  /** Leg swing amplitude in radians, zero when the body is not travelling. */
  swing: number;
  /**
   * 0 before an attack's contact frame and 1 at it (§5.3). Held at 1 through the recoil
   * so a clip can play out past the strike it was authored to.
   */
  strike: number;
}

const STILL: Pose = { gait: 0, bob: 0, pitch: 0, swing: 0, strike: 0 };

export interface GaitProfile {
  /** Ground covered per cycle. Short legs take more steps to cross the same yard. */
  strideMetres: number;
  /** Bob at full swing, in metres. */
  bobMetres: number;
  /** Leg swing at full speed, in radians. */
  swingRadians: number;
  /** Speed at which the cycle is at full amplitude; below it, everything scales down. */
  fullSpeed: number;
  /** How far the body rears back during a wind-up, in radians. */
  windUpRadians: number;
}

export class Gait {
  private travelled = 0;
  private amplitude = 0;

  constructor(private readonly profile: GaitProfile) {}

  /**
   * Feed one simulation tick: the ground covered, and how fast the body is going.
   *
   * The amplitude is smoothed and the phase is not. A body that stops mid-stride should
   * settle out of its swing rather than snap flat, but its feet must stay where the ground
   * put them — easing the *phase* is what makes a stopping animation slide.
   */
  advance(distanceMoved: number, speed: number, dt: number): void {
    this.travelled += Math.max(0, distanceMoved);
    const target = Math.min(1, speed / this.profile.fullSpeed);
    const blend = 1 - Math.exp(-dt / 0.12);
    this.amplitude += (target - this.amplitude) * blend;
  }

  /** Back to standing — a body that has been picked up and put somewhere else. */
  reset(): void {
    this.travelled = 0;
    this.amplitude = 0;
  }

  /**
   * The pose to draw. `attackProgress` is 0 when nothing is winding up and runs to 1 at
   * §5.3's strike; anything past 1 is the recoil, where the clip has already landed.
   */
  pose(attackProgress = 0): Pose {
    if (attackProgress > 0) return this.attackPose(attackProgress);

    const gait = (this.travelled / this.profile.strideMetres) % 1;
    if (this.amplitude < 1e-3) return { ...STILL, gait };

    const angle = gait * Math.PI * 2;
    return {
      gait,
      // Twice the stride frequency: a body rises on each leg pair, not once per cycle.
      bob: Math.abs(Math.sin(angle)) * this.profile.bobMetres * this.amplitude,
      // Leaning into the run, and a little roll through the cycle.
      pitch: -0.12 * this.amplitude + Math.sin(angle * 2) * 0.03 * this.amplitude,
      swing: Math.sin(angle) * this.profile.swingRadians * this.amplitude,
      strike: 0,
    };
  }

  /**
   * The lunge. Rears back across the wind-up and is thrown forward exactly at the strike,
   * so the frame the player is being asked to react to is the frame the damage lands on.
   */
  private attackPose(progress: number): Pose {
    const wind = Math.min(1, progress);
    // Eased so the rear is slow and the throw is not: a telegraph the player can read has
    // to spend its time in the wind-up rather than in the strike.
    const reared = wind * wind;
    const gait = (this.travelled / this.profile.strideMetres) % 1;
    return {
      gait,
      bob: reared * this.profile.bobMetres * 1.6,
      pitch: reared * this.profile.windUpRadians,
      swing: reared * this.profile.swingRadians * 0.6,
      strike: progress >= 1 ? 1 : 0,
    };
  }
}
