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
 * Battery arithmetic lives in `Battery`; this class is the part that has to know about
 * Three.js. Phase 8's flicker (§5.2) modulates the rendered intensity through
 * `intensityScale` without touching the charge — a monster interfering with the beam is
 * not the same event as the beam running down.
 */

import * as THREE from 'three';
import { FLASHLIGHT, PLAYER, RENDER } from '../config';
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
  private readonly aimDistance: number;
  /** How far in front of the player the beam is emitted, clear of their own capsule. */
  private readonly originOffset = PLAYER.radius + 0.15;
  /** The target the `SpotLight` was constructed with, kept only so it can be removed. */
  private readonly defaultTarget: THREE.Object3D;

  constructor(scene: THREE.Scene) {
    // Three.js takes the half angle from the beam axis; §4.1 quotes the full cone.
    const halfAngle = THREE.MathUtils.degToRad(FLASHLIGHT.coneAngleDegrees / 2);
    const declination = halfAngle + Math.atan2(FLASHLIGHT.mountHeight, FLASHLIGHT.range);
    this.aimDistance = FLASHLIGHT.mountHeight / Math.tan(declination);

    // The spec's range is how far the beam reaches along the ground; the light's own
    // range is the slant distance from the mount to that point.
    const slantRange = Math.hypot(FLASHLIGHT.range, FLASHLIGHT.mountHeight);
    this.light = new THREE.SpotLight(0xffeecc, FLASHLIGHT.baseIntensity, slantRange);
    this.light.name = 'Flashlight';
    this.light.angle = halfAngle;
    this.light.penumbra = FLASHLIGHT.penumbra;
    this.light.decay = FLASHLIGHT.decay;
    this.light.castShadow = true;
    this.light.visible = false;

    // §7 — 2048² for the flashlight, with the shadow camera tightened to the beam's range
    // so the depth range is spent on the 12 m that can actually be lit.
    this.light.shadow.mapSize.set(RENDER.flashlightShadowMapSize, RENDER.flashlightShadowMapSize);
    this.light.shadow.camera.near = 0.4;
    this.light.shadow.camera.far = slantRange;
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.02;

    this.defaultTarget = this.light.target;
    scene.add(this.light, this.defaultTarget, this.target);
    this.light.target = this.target;
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
    const originX = playerX + aimX * this.originOffset;
    const originZ = playerZ + aimZ * this.originOffset;

    this.light.position.set(originX, FLASHLIGHT.mountHeight, originZ);
    this.target.position.set(
      originX + aimX * this.aimDistance,
      0,
      originZ + aimZ * this.aimDistance,
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
