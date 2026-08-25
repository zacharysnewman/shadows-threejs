/**
 * The flashlight (§4.1, §7).
 *
 * One `THREE.SpotLight` bound to the player's position and the aim direction, and the only
 * light in the game guaranteed to cast shadows — §7 spends exactly one shadow-casting
 * spotlight on it, because the beam's hard floor shadows are the mechanic rather than an
 * effect.
 *
 * The beam is mounted at chest height and declined onto the ground rather than pointed
 * flat along the aim vector. A horizontal beam lights walls and leaves the floor dark for
 * the first few metres, which under a pitched top-down camera (§3.2) reads as a hole
 * around the player rather than as a torch.
 *
 * The declination is derived, not chosen: tilt the axis until the cone's *upper* edge
 * meets the ground exactly at the beam's range. Any flatter and the top of the cone sails
 * over the floor and is spent on walls; any steeper and the pool stops short of the range
 * §4.1 gives it. What falls out is a pool running from a little over a metre in front of
 * the player out to the full 12 m.
 *
 * The beam also originates just clear of the player's capsule rather than at its centre.
 * A light inside the player's own mesh is shadowed by it, and the player's shoulders throw
 * a black wedge across their own pool — the most conspicuous artefact this phase produced,
 * and the reason a torch is held out in front rather than swallowed.
 *
 * **Where it is held is `FLASHLIGHT.hold`, and every part of it is a knob** (§4.1, §8.3):
 * height, how far forward, how far to the hand's side, and a trim on both the declination
 * and the aim. The defaults are the beam described above — the trims are zero and the
 * offsets are the capsule clearance — so the spec's beam is what the knobs start at rather
 * than a pose they happen to reach. `refresh` re-derives the shape; the placement is read
 * every frame, so moving the torch about while the game runs costs nothing.
 *
 * Battery arithmetic lives in `Battery`; this class is the part that has to know about
 * Three.js. Phase 8's flicker (§5.2) modulates the rendered intensity through
 * `intensityScale` without touching the charge — a monster interfering with the beam is
 * not the same event as the beam running down.
 */

import * as THREE from 'three';
import { FLASHLIGHT, RENDER } from '../config';
import { Battery } from './Battery';

export class Flashlight {
  readonly battery = new Battery();
  readonly light: THREE.SpotLight;
  /** The object the spotlight points at; moved with the player's aim each frame. */
  readonly target = new THREE.Object3D();

  /**
   * Multiplier on the rendered beam intensity, on top of the battery's own falloff.
   * Phase 8's light interference (§5.2) drives this; nothing else should.
   */
  intensityScale = 1;

  /** True once the player is carrying the flashlight; the pick-up is Phase 9 (§6). */
  held = true;

  /** Ground distance the beam axis is aimed at; see the declination note above. */
  private aimDistance = 0;
  /** The target the `SpotLight` was constructed with, kept only so it can be removed. */
  private readonly defaultTarget: THREE.Object3D;

  constructor(scene: THREE.Scene) {
    this.light = new THREE.SpotLight(0xffeecc, FLASHLIGHT.baseIntensity);
    this.light.name = 'Flashlight';
    this.light.penumbra = FLASHLIGHT.penumbra;
    this.light.decay = FLASHLIGHT.decay;
    this.light.castShadow = true;
    this.light.visible = false;

    // §7 — 2048² for the flashlight. The shadow camera's far plane is tightened to the
    // beam's reach in `refresh`, so the depth range is spent on what can actually be lit.
    this.light.shadow.mapSize.set(RENDER.flashlightShadowMapSize, RENDER.flashlightShadowMapSize);
    this.light.shadow.camera.near = 0.4;
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.02;

    this.refresh();

    this.defaultTarget = this.light.target;
    scene.add(this.light, this.defaultTarget, this.target);
    this.light.target = this.target;
  }

  /**
   * Re-derive everything that comes from §4.1's cone — the half angle, the declination and
   * the reach — from the current config.
   *
   * Called once at construction, and again by the debug tuner when somebody moves the
   * range or the angle (§8.3). Split out for exactly that: these are the beam's *shape*,
   * read once at build time, so nothing else would notice them changing.
   */
  refresh(): void {
    const hold = FLASHLIGHT.hold;
    // Three.js takes the half angle from the beam axis; §4.1 quotes the full cone.
    const halfAngle = THREE.MathUtils.degToRad(FLASHLIGHT.coneAngleDegrees / 2);
    const derived = halfAngle + Math.atan2(hold.height, FLASHLIGHT.range);
    // §4.1 — the trim is an offset on the declination the spec derives, so zero is the
    // spec's beam. Clamped clear of the horizon and of straight down: at either the aim
    // point stops existing, and a slider that can produce a beam pointing at nothing is a
    // slider that makes the scene disappear rather than one that shows you why.
    const declination = THREE.MathUtils.clamp(
      derived + THREE.MathUtils.degToRad(hold.pitchTrimDegrees),
      0.02,
      Math.PI / 2 - 0.02,
    );
    this.aimDistance = hold.height / Math.tan(declination);

    // The spec's range is how far the beam reaches along the ground; the light's own range
    // is the slant distance from the mount to that point.
    const slantRange = Math.hypot(FLASHLIGHT.range, hold.height);
    this.light.angle = halfAngle;
    this.light.distance = slantRange;
    this.light.shadow.camera.far = slantRange;
    this.light.shadow.camera.updateProjectionMatrix();
  }

  get on(): boolean {
    return this.battery.on;
  }

  /** Toggle, refusing once the battery is flat (§4.1) — which is for good. */
  toggle(): boolean {
    if (!this.held) return false;
    return this.battery.toggle();
  }

  /** Battery timers run on the simulation clock, like everything else with a timer (§7). */
  tick(dt: number): void {
    this.battery.tick(dt);
  }

  /**
   * Place the beam. Called per rendered frame from the interpolated player position, so
   * the light does not visibly step at the 60 Hz tick rate.
   */
  update(playerX: number, playerZ: number, aimX: number, aimZ: number): void {
    const hold = FLASHLIGHT.hold;
    // Screen-right of the aim direction, which is the player's right: the camera never
    // yaws (§3.2), so `+x` is right on screen and this is the hand the torch is in.
    const rightX = -aimZ;
    const rightZ = aimX;

    const originX = playerX + aimX * hold.forward + rightX * hold.lateral;
    const originZ = playerZ + aimZ * hold.forward + rightZ * hold.lateral;

    // The beam may be turned off the aim direction (§4.1's `hold`); the origin is not,
    // because where the torch is held and where it points are two separate questions.
    const yaw = THREE.MathUtils.degToRad(hold.yawTrimDegrees);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const beamX = aimX * cos + rightX * sin;
    const beamZ = aimZ * cos + rightZ * sin;

    this.light.position.set(originX, hold.height, originZ);
    this.target.position.set(
      originX + beamX * this.aimDistance,
      0,
      originZ + beamZ * this.aimDistance,
    );
    this.target.updateMatrixWorld();

    const fraction = this.battery.intensityFraction * this.intensityScale;
    // Hidden rather than zero-intensity when off: an invisible light still costs a shadow
    // map render every frame, and §7 has no budget to waste on a light that is off.
    this.light.visible = fraction > 0;
    this.light.intensity = FLASHLIGHT.baseIntensity * fraction;
  }

  dispose(): void {
    // Three separate objects went into the scene, and the third is easy to miss: a
    // `SpotLight` is built with a default target, which is what gets added on the line
    // below before `this.target` replaces it. Leaving it behind is an empty `Object3D`
    // accumulating one per run (§6, Run Structure).
    this.defaultTarget.removeFromParent();
    this.light.removeFromParent();
    this.target.removeFromParent();
    this.light.dispose();
  }
}
