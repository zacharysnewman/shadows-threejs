/**
 * Environmental lights (§4.2, §7).
 *
 * One downward `THREE.SpotLight` per `EnvironmentLight` entity, mounted at 4 m and shaped
 * so its cone pools to the entity's ground radius. They are off until their group is
 * powered — a `PowerSwitch` acts on every light sharing a `groupId` (§2, §6). Phase 9
 * wires the switches; until then the debug harness powers them all at once.
 *
 * §7 caps the shadow budget at two of them at a time, chosen each frame by proximity to
 * the camera, with the rest illuminating without casting. That cap is a design constraint
 * rather than an optimisation: the flashlight's shadows are the mechanic, and a map with
 * a dozen lit lamps must not spend the frame rendering shadow maps for lamps that are
 * off-screen or across the level.
 */

import * as THREE from 'three';
import { ENTITY_DEFAULTS, ENVIRONMENT_LIGHT, RENDER } from '../config';
import type { EnvironmentLightEntity } from '../map/types';

export interface EnvironmentLamp {
  entity: EnvironmentLightEntity;
  light: THREE.SpotLight;
}

/** What the shadow-budget choice needs to know about one lamp, and nothing more. */
export interface ShadowCandidate {
  lit: boolean;
  inFrustum: boolean;
  distanceSq: number;
}

/**
 * Indices of the lamps that should cast shadows this frame: the `max` nearest lit lamps
 * inside the camera frustum (§7). A lamp that is off, or off-screen, never wins a slot —
 * its shadows could not be seen, and the budget is small enough that a wasted slot shows.
 */
export function selectShadowCasters(
  candidates: readonly ShadowCandidate[],
  max: number = RENDER.maxShadowCastingEnvironmentLights,
): number[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.lit && candidate.inFrustum)
    .sort((a, b) => a.candidate.distanceSq - b.candidate.distanceSq)
    .slice(0, Math.max(0, max))
    .map(({ index }) => index);
}

export class EnvironmentLights {
  readonly lamps: EnvironmentLamp[] = [];
  readonly root = new THREE.Group();

  /** `groupId` → powered. Absent means never powered, which is the same as off. */
  private readonly powered = new Map<string, boolean>();
  private readonly casting = new Set<number>();

  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly candidates: ShadowCandidate[] = [];

  constructor(entities: readonly EnvironmentLightEntity[]) {
    this.root.name = 'EnvironmentLights';

    for (const entity of entities) {
      const height = ENTITY_DEFAULTS.environmentLightHeight;
      // The cone is shaped by the pool it has to make: a lamp 4 m up throwing a 6 m radius
      // is a 56° half angle, and its range is the slant distance to the rim of that pool.
      const angle = Math.atan2(entity.radius, height);
      const range = Math.hypot(height, entity.radius);

      const light = new THREE.SpotLight(
        0xfff2d8,
        ENVIRONMENT_LIGHT.baseIntensity * entity.intensity,
        range,
        angle,
        ENVIRONMENT_LIGHT.penumbra,
        ENVIRONMENT_LIGHT.decay,
      );
      light.name = `EnvironmentLight:${entity.groupId}@${entity.gx},${entity.gy}`;
      light.position.set(entity.wx, height, entity.wz);
      light.visible = false;
      light.castShadow = false;

      // §7 — 1024² when it does get a shadow slot, with the shadow camera tightened to the
      // cone it lights rather than left at the default 0.5–500 m.
      light.shadow.mapSize.set(
        RENDER.environmentShadowMapSize,
        RENDER.environmentShadowMapSize,
      );
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = range;
      light.shadow.bias = -0.0008;
      light.shadow.normalBias = 0.02;

      light.target.position.set(entity.wx, 0, entity.wz);

      this.root.add(light, light.target);
      this.lamps.push({ entity, light });
      if (!this.powered.has(entity.groupId)) this.powered.set(entity.groupId, false);
    }
  }

  get groupIds(): string[] {
    return [...this.powered.keys()];
  }

  isGroupPowered(groupId: string): boolean {
    return this.powered.get(groupId) === true;
  }

  /** Count of lamps currently throwing light — the debug readout's number. */
  get litCount(): number {
    return this.lamps.filter((lamp) => lamp.light.visible).length;
  }

  get shadowCasterCount(): number {
    return this.casting.size;
  }

  /** A `PowerSwitch` acts on a whole group at once (§2); Phase 9 calls this. */
  setGroupPowered(groupId: string, on: boolean): void {
    if (!this.powered.has(groupId)) return;
    this.powered.set(groupId, on);
    for (const lamp of this.lamps) {
      if (lamp.entity.groupId === groupId) lamp.light.visible = on;
    }
  }

  /** Debug stand-in for the switches that do not exist until Phase 9. */
  toggleAll(): boolean {
    const anyOff = [...this.powered.values()].some((on) => !on);
    for (const groupId of this.powered.keys()) this.setGroupPowered(groupId, anyOff);
    return anyOff;
  }

  /**
   * Re-choose which lamps hold the two shadow slots (§7). Per rendered frame: the choice
   * depends on where the camera is, which is a render-time fact, and a lamp that gains or
   * loses shadows between frames is invisible to the simulation.
   */
  update(camera: THREE.Camera): void {
    if (this.lamps.length === 0) return;

    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    const cameraPosition = camera.getWorldPosition(_cameraPosition);

    this.candidates.length = 0;
    for (const lamp of this.lamps) {
      // Tested as the sphere the lamp can light rather than as its mounting point, so a
      // lamp whose pool is on screen still counts when its post is not.
      _sphere.center.copy(lamp.light.position);
      _sphere.radius = lamp.light.distance;
      this.candidates.push({
        lit: lamp.light.visible,
        inFrustum: this.frustum.intersectsSphere(_sphere),
        distanceSq: lamp.light.position.distanceToSquared(cameraPosition),
      });
    }

    const chosen = selectShadowCasters(this.candidates);
    if (chosen.length === this.casting.size && chosen.every((i) => this.casting.has(i))) {
      return;
    }

    for (const index of this.casting) {
      const lamp = this.lamps[index];
      if (lamp) lamp.light.castShadow = false;
    }
    this.casting.clear();
    for (const index of chosen) {
      const lamp = this.lamps[index];
      if (!lamp) continue;
      lamp.light.castShadow = true;
      this.casting.add(index);
    }
  }

  dispose(): void {
    for (const lamp of this.lamps) lamp.light.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}

const _cameraPosition = new THREE.Vector3();
const _sphere = new THREE.Sphere();
