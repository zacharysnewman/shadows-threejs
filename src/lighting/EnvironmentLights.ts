/**
 * Environmental lights (§4.2, §7).
 *
 * One downward `THREE.SpotLight` per `EnvironmentLight` entity, mounted at 4 m and shaped
 * so its cone pools to the entity's ground radius, and a post and shade under it so there
 * is a lamp to see as well as a pool to stand in. They are off until their group is
 * powered — a `PowerSwitch` acts on every light sharing a `groupId` (§2, §6). Phase 9
 * wires the switches; until then the debug harness powers them all at once.
 *
 * **A lamp with no switch never lights**, and that is the design (§4.2) rather than a
 * fault: power is something the player routes. What it must not be is invisible, which is
 * what it was before the fixture existed — an author who placed lamps and no switch got a
 * level that looked like it had no lamps in it. The map audit says so too
 * (`group-no-switch`), and the editor shows it while the level is being built (§9).
 *
 * §7 caps the shadow budget at two of them at a time, chosen each frame by proximity to
 * the camera, with the rest illuminating without casting. That cap is a design constraint
 * rather than an optimisation: the flashlight's shadows are the mechanic, and a map with
 * a dozen lit lamps must not spend the frame rendering shadow maps for lamps that are
 * off-screen or across the level.
 *
 * Each lamp also runs §4.2's sabotage lifecycle: a Shadow Monster standing in its pool
 * strains it, then puts it out, then it comes back. Powered and working are kept as two
 * separate facts here, because §4.2 is explicit that an outage is a rolling hazard and not
 * lost progress — the group stays powered through a failure and the `PowerSwitch` never
 * learns about it.
 *
 * The lifecycle lives on the lamp rather than on the monster for the same reason §5.3's
 * contact check lives on the manager: several monsters can be under one lamp, one monster
 * can cross several, and the dwell being the *lamp's* is what makes both of those behave.
 */

import * as THREE from 'three';
import { ENTITY_DEFAULTS, ENVIRONMENT_LIGHT, RENDER } from '../config';
import type { EnvironmentLightEntity } from '../map/types';
import { drawJitter, flickerFraction, severityAt } from './flicker';

/** §4.2 — where a lamp is in the sabotage lifecycle. */
export type SabotageState = 'steady' | 'strain' | 'failed';

export interface EnvironmentLamp {
  entity: EnvironmentLightEntity;
  light: THREE.SpotLight;
  /** §4.2 — the head of the fixture, which lights up with the lamp. */
  head: THREE.MeshStandardMaterial;
  /** §4.2 — the switch's answer. Untouched by a failure. */
  powered: boolean;
  sabotage: SabotageState;
  /** Continuous seconds a Shadow Monster has stood in this pool. Leaving resets it. */
  dwell: number;
  /** Seconds in the current `strain` or `failed` phase. */
  phaseFor: number;
  /** Rendered intensity fraction, 1 unless it is straining (§5.2's curve). */
  flicker: number;
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

      const head = this.addFixture(entity, height);

      this.root.add(light, light.target);
      this.lamps.push({
        entity,
        light,
        head,
        powered: false,
        sabotage: 'steady',
        dwell: 0,
        phaseFor: 0,
        flicker: 1,
      });
      if (!this.powered.has(entity.groupId)) this.powered.set(entity.groupId, false);
      // Put the lamp in its off state explicitly rather than relying on the state a fresh
      // material happens to start in: unlit is a look this owns, and it is the look every
      // lamp has until the player finds its switch (§4.2, §6.3).
      this.applyLamp(this.lamps[this.lamps.length - 1]!);
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
      if (lamp.entity.groupId !== groupId) continue;
      lamp.powered = on;
      // Switching a group off ends any sabotage in progress: there is nothing left to
      // strain, and a lamp that comes back on should come back clean.
      if (!on) this.resetSabotage(lamp);
      this.applyLamp(lamp);
    }
  }

  /** How many lamps are dark because of a monster rather than because of a switch. */
  get failedCount(): number {
    return this.lamps.filter((lamp) => lamp.sabotage === 'failed').length;
  }

  get strainingCount(): number {
    return this.lamps.filter((lamp) => lamp.sabotage === 'strain').length;
  }

  /**
   * §4.2's sabotage lifecycle, one simulation tick (§7).
   *
   * `occupants` is where the Shadow Monsters are. A lamp is occupied when one stands
   * inside the ground radius its cone pools to — the same disc §4.1 lights, and no
   * occlusion test, because a lamp is four metres straight up and there is nothing between
   * it and something standing under it.
   */
  tick(dt: number, occupants: readonly { x: number; z: number }[], random: () => number): void {
    for (const lamp of this.lamps) {
      if (lamp.sabotage === 'failed') {
        lamp.phaseFor += dt;
        if (lamp.phaseFor < ENVIRONMENT_LIGHT.sabotage.recoverySeconds) continue;
        // §4.2 — back at full intensity with the dwell reset, and straight into another
        // cycle if the monster never left.
        this.resetSabotage(lamp);
        this.applyLamp(lamp);
        continue;
      }

      if (!lamp.powered) {
        this.resetSabotage(lamp);
        continue;
      }

      const occupied = occupants.some(
        (occupant) =>
          Math.hypot(occupant.x - lamp.entity.wx, occupant.z - lamp.entity.wz) <=
          lamp.entity.radius,
      );
      if (!occupied) {
        // §4.2 — leaving the cone resets the dwell to zero, so a monster passing through
        // costs the lamp nothing and only one standing under it does.
        this.resetSabotage(lamp);
        this.applyLamp(lamp);
        continue;
      }

      lamp.dwell += dt;
      if (lamp.dwell < ENVIRONMENT_LIGHT.sabotage.strainAfterSeconds) {
        lamp.flicker = 1;
        this.applyLamp(lamp);
        continue;
      }

      if (lamp.sabotage !== 'strain') {
        lamp.sabotage = 'strain';
        lamp.phaseFor = 0;
      }
      lamp.phaseFor += dt;

      if (lamp.phaseFor >= ENVIRONMENT_LIGHT.sabotage.failAfterStrainSeconds) {
        lamp.sabotage = 'failed';
        lamp.phaseFor = 0;
        lamp.flicker = 0;
        this.applyLamp(lamp);
        continue;
      }

      // §4.2 — the same curve as §5.2's beam interference, ramping across the strain so
      // the lamp is visibly worse the closer it is to going out.
      const severity = severityAt(
        lamp.phaseFor,
        ENVIRONMENT_LIGHT.sabotage.failAfterStrainSeconds,
        ENVIRONMENT_LIGHT.sabotage.severity.from,
        ENVIRONMENT_LIGHT.sabotage.severity.to,
      );
      lamp.flicker = flickerFraction(lamp.phaseFor, severity, drawJitter(random));
      this.applyLamp(lamp);
    }
  }

  private resetSabotage(lamp: EnvironmentLamp): void {
    lamp.sabotage = 'steady';
    lamp.dwell = 0;
    lamp.phaseFor = 0;
    lamp.flicker = 1;
  }

  /**
   * Powered *and* working is what makes a lamp light anything. Kept in one place because
   * §4.1's query reads `light.visible` to decide whether the lamp lights an entity at all,
   * and a failed lamp has to stop freezing the monster on the tick it dies (§4.2, §5.2).
   */
  private applyLamp(lamp: EnvironmentLamp): void {
    lamp.light.visible = lamp.powered && lamp.sabotage !== 'failed';
    lamp.light.intensity =
      ENVIRONMENT_LIGHT.baseIntensity * lamp.entity.intensity * lamp.flicker;

    // §4.2 — the head follows the light it is the source of, flicker and all: a lamp
    // straining across the map is the clearest tell the player gets about where the
    // monster is, and a bulb that stayed lit while its pool guttered would deny them it.
    const fixture = ENVIRONMENT_LIGHT.fixture;
    const lit = lamp.light.visible;
    lamp.head.color.setHex(lit ? fixture.litColour : fixture.headColour);
    lamp.head.emissive.setHex(lit ? fixture.litColour : 0x000000);
    lamp.head.emissiveIntensity = lit ? fixture.litEmissive * lamp.flicker : 0;
  }

  /**
   * §4.2 — the post and head, at the entity's tile. Returns the head's material, which is
   * what `applyLamp` drives.
   *
   * Neither piece casts a shadow. The light is a point at the top of its own post, so a
   * post that cast would put a black bar through the middle of the pool it exists to
   * throw — the one shadow in the game that would be an artefact rather than information.
   */
  private addFixture(
    entity: EnvironmentLightEntity,
    mountHeight: number,
  ): THREE.MeshStandardMaterial {
    const fixture = ENVIRONMENT_LIGHT.fixture;

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(fixture.postRadius, fixture.postRadius, mountHeight, 8),
      new THREE.MeshStandardMaterial({
        color: fixture.postColour,
        roughness: 0.8,
        metalness: 0.3,
      }),
    );
    post.position.set(entity.wx, mountHeight / 2, entity.wz);

    const head = new THREE.MeshStandardMaterial({
      color: fixture.headColour,
      roughness: 0.5,
      metalness: 0.1,
    });
    const shade = new THREE.Mesh(
      // Wider at the bottom: a shade, so which way it throws is readable from above.
      new THREE.ConeGeometry(fixture.headRadius, fixture.headDepth, 10, 1, true),
      head,
    );
    shade.material.side = THREE.DoubleSide;
    shade.position.set(entity.wx, mountHeight + fixture.headDepth / 2, entity.wz);

    for (const piece of [post, shade]) {
      piece.name = `EnvironmentLightFixture:${entity.groupId}@${entity.gx},${entity.gy}`;
      piece.castShadow = false;
      piece.receiveShadow = true;
      this.root.add(piece);
    }
    return head;
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
    // The fixtures own their geometry and materials outright — nothing is shared with the
    // asset cache — so a run that left them behind would leak one set per lamp per life.
    this.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const material of [node.material].flat()) material.dispose();
    });
    this.root.clear();
    this.root.removeFromParent();
  }
}

const _cameraPosition = new THREE.Vector3();
const _sphere = new THREE.Sphere();
