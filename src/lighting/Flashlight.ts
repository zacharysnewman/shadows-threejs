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
 * The *derived* declination — the fallback, with no pointer to follow — tilts the axis
 * until the cone's *upper* edge meets the ground exactly at the beam's range. Any flatter
 * and the top of the cone sails over the floor and is spent on walls; any steeper and the
 * pool stops short of the range §4.1 gives it. What falls out is a pool running from a
 * little over a metre in front of the player out to the full 12 m.
 *
 * With a settled pointer aim, `update` pitches the beam at the ground point under the
 * cursor instead: the same axis, aimed further out or pulled in along it, clamped so the
 * beam can neither point behind the player nor flatten past the spec's range. The point
 * comes from the caller pre-projected onto the y=0 plane — this class never raycasts the
 * scene, so a tree under the cursor cannot pitch the beam at the sky the way an occluder
 * hit would. Eased on the render delta (`FLASHLIGHT.pointerAim.smoothingTime`) rather than
 * snapped, so the pitch does not visibly step at display refresh rate.
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
 *
 * Two things hang off the beam and are drawn from it rather than the other way round: the
 * haze inside the cone (`LightShaft`) and the torch itself (`TorchBody`). Both read the
 * origin and the axis derived here, and neither can move them — §4.1 decides where the
 * light is, and everything else follows it, the player's own hand included (`ArmIk`).
 */

import * as THREE from 'three';
import { FLASHLIGHT, LIGHT_SHAFT, RENDER } from '../config';
import { Damped } from '../core/Damped';
import { Battery } from './Battery';
import { LightShaft } from './LightShaft';
import { TorchBody } from './TorchBody';

/**
 * Distance along the beam axis to the ground point under the cursor, clamped to what the
 * declination can usably reach (§4.1).
 *
 * Projected onto the axis rather than measured directly to the point: `hold.lateral` and
 * the yaw trim already turn the origin and the axis off the player's aim, so the distance a
 * *pitch* is derived from has to be measured along the axis the beam actually travels along
 * — otherwise those two knobs would fight the cursor for where the beam points. Only the
 * along-axis component matters; the cursor's sideways offset from the beam says nothing
 * about how steeply the beam should decline; that is decided by yaw, not pitch.
 *
 * Pure arithmetic on the four numbers involved, so the clamp can be checked without a
 * scene, a camera, or a light (§ testing).
 */
export function pointerAimDistance(
  originX: number,
  originZ: number,
  axisX: number,
  axisZ: number,
  targetX: number,
  targetZ: number,
  nearDistance: number,
  farDistance: number,
): number {
  const along = (targetX - originX) * axisX + (targetZ - originZ) * axisZ;
  return Math.min(farDistance, Math.max(nearDistance, along));
}

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

  /** Where the beam is emitted, in world space — §4.1's mounting point. */
  readonly origin = new THREE.Vector3();
  /** Unit direction the beam is thrown along, declined onto the floor per §4.1. */
  readonly axis = new THREE.Vector3(0, 0, 1);

  /** §4 — the beam you can see in the air. */
  private readonly shaft: LightShaft;
  /** §4.1 — the thing in the hand the beam comes out of. */
  private readonly body = new TorchBody();

  /**
   * Ground distance the beam axis is aimed at when there is no pointer to follow — see the
   * declination note above. The fallback `distance` eases towards, and (with no pointer
   * ever aimed) the only value it ever takes.
   */
  private derivedAimDistance = 0;
  /**
   * The distance actually placed each frame — the pointer's ground point, projected and
   * clamped by `pointerAimDistance`, or `derivedAimDistance` with no pointer to follow.
   * Eased rather than snapped so the pitch does not step at display refresh rate; `refresh`
   * snaps it, so a config change lands immediately rather than easing in from wherever it
   * was.
   */
  private readonly distance = new Damped();
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

    this.shaft = new LightShaft(this.light, {
      steps: LIGHT_SHAFT.flashlightSteps,
      density: LIGHT_SHAFT.flashlightDensity,
    });

    this.refresh();

    this.defaultTarget = this.light.target;
    scene.add(this.light, this.defaultTarget, this.target, this.shaft.mesh, this.body.root);
    this.light.target = this.target;
  }

  /** Haze per metre of visible beam — the debug tuner's knob (§8.3). */
  get shaftDensity(): number {
    return this.shaft.density;
  }

  set shaftDensity(value: number) {
    this.shaft.density = value;
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
    this.derivedAimDistance = hold.height / Math.tan(declination);
    // A config change lands on the next `update` rather than easing in from wherever the
    // pointer last left it — the tuner's slider is meant to be felt immediately (§8.3).
    this.distance.snap(this.derivedAimDistance);

    // The spec's range is how far the beam reaches along the ground; the light's own range
    // is the slant distance from the mount to that point.
    const slantRange = Math.hypot(FLASHLIGHT.range, hold.height);
    this.light.angle = halfAngle;
    this.light.distance = slantRange;
    this.light.shadow.camera.far = slantRange;
    this.light.shadow.camera.updateProjectionMatrix();
    // The shaft is the same cone, so it is re-derived from the same three numbers.
    this.shaft.refresh();
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
   *
   * `pointerGround` is the ground point under the cursor, on the y=0 plane and nothing
   * else — never a raycast against the scene, or a tree under the cursor would pitch the
   * beam at the sky instead of the ground it stands on (§4.1). Null falls back to the
   * derived declination: no pointer, a stick or gamepad aiming instead, or the aim not
   * settled (mid-sprint or sweeping back from one, §3.1) — the caller decides which.
   * `realDeltaSeconds` is the render delta the pitch eases towards it on; 0 leaves the
   * distance wherever it already was, which is what every caller that does not carry a
   * delta (tests, a paused frame) gets for free.
   */
  update(
    playerX: number,
    playerZ: number,
    aimX: number,
    aimZ: number,
    pointerGround: { x: number; z: number } | null = null,
    realDeltaSeconds = 0,
  ): void {
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

    this.origin.set(originX, hold.height, originZ);
    this.light.position.copy(this.origin);

    const targetDistance = pointerGround
      ? pointerAimDistance(
          originX,
          originZ,
          beamX,
          beamZ,
          pointerGround.x,
          pointerGround.z,
          FLASHLIGHT.pointerAim.nearDistance,
          FLASHLIGHT.range,
        )
      : this.derivedAimDistance;
    const distance = this.distance.step(
      targetDistance,
      FLASHLIGHT.pointerAim.smoothingTime,
      realDeltaSeconds,
    );

    this.target.position.set(originX + beamX * distance, 0, originZ + beamZ * distance);
    this.target.updateMatrixWorld();
    this.axis.subVectors(this.target.position, this.origin).normalize();

    const fraction = this.battery.intensityFraction * this.intensityScale;
    // Hidden rather than zero-intensity when off: an invisible light still costs a shadow
    // map render every frame, and §7 has no budget to waste on a light that is off.
    this.light.visible = fraction > 0;
    this.light.intensity = FLASHLIGHT.baseIntensity * fraction;
    this.shaft.update(fraction);
  }

  /**
   * Draw the torch, now that whatever is carrying it has been asked where its hand ended up.
   *
   * Called after `update` and after the arm has reached (`ArmIk`), because the hand is
   * solved *against* the beam's origin and cannot be known before it. `grip` is null when
   * there is no rigged hand — a placeholder body, or art the rig declined.
   */
  carry(grip: THREE.Vector3 | null): void {
    if (!this.held) {
      this.body.hide();
      return;
    }
    this.body.place(
      this.origin,
      this.axis,
      grip,
      this.battery.intensityFraction * this.intensityScale,
    );
  }

  dispose(): void {
    // Three separate objects went into the scene, and the third is easy to miss: a
    // `SpotLight` is built with a default target, which is what gets added on the line
    // below before `this.target` replaces it. Leaving it behind is an empty `Object3D`
    // accumulating one per run (§6, Run Structure).
    this.defaultTarget.removeFromParent();
    this.light.removeFromParent();
    this.target.removeFromParent();
    this.shaft.dispose();
    this.body.dispose();
    this.light.dispose();
  }
}
