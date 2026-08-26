/**
 * The flashlight rig, the environmental light shadow budget, and the visible beam
 * (§4, §4.1, §4.2, §7).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ENTITY_DEFAULTS,
  ENVIRONMENT_LIGHT,
  FLASHLIGHT,
  LIGHT_SHAFT,
  PLAYER,
  RENDER,
} from '../src/config';
import {
  EnvironmentLights,
  reachableLitCounts,
  selectShadowCasters,
} from '../src/lighting/EnvironmentLights';
import { Flashlight } from '../src/lighting/Flashlight';
import { LightShaft } from '../src/lighting/LightShaft';
import type { EnvironmentLightEntity } from '../src/map/types';

function lamp(
  gx: number,
  gy: number,
  groupId: string,
  radius = ENTITY_DEFAULTS.environmentLightRadius,
  intensity = 1,
): EnvironmentLightEntity {
  return {
    type: 'EnvironmentLight',
    key: `EnvironmentLight@${gx},${gy}#0`,
    index: 0,
    gx,
    gy,
    wx: (gx + 0.5) * 2,
    wz: (gy + 0.5) * 2,
    groupId,
    radius,
    intensity,
  };
}

describe('Flashlight', () => {
  it('builds the cone §4.1 specifies, halving the full angle for Three.js', () => {
    const light = new Flashlight(new THREE.Scene()).light;

    expect(THREE.MathUtils.radToDeg(light.angle)).toBeCloseTo(FLASHLIGHT.coneAngleDegrees / 2);
    expect(light.penumbra).toBeCloseTo(FLASHLIGHT.penumbra);
    // The light's range is the slant distance to a ground point at the spec's range.
    expect(light.distance).toBeCloseTo(Math.hypot(FLASHLIGHT.range, FLASHLIGHT.hold.height));
  });

  it('is the one shadow-casting spotlight, at the resolution §7 budgets for it', () => {
    const light = new Flashlight(new THREE.Scene()).light;

    expect(light.castShadow).toBe(true);
    expect(light.shadow.mapSize.width).toBe(RENDER.flashlightShadowMapSize);
    // Tightened to the beam, not left at Three's default far plane.
    expect(light.shadow.camera.far).toBeCloseTo(
      Math.hypot(FLASHLIGHT.range, FLASHLIGHT.hold.height),
    );
  });

  it('sits on the player and points along the aim, declined onto the floor', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.update(10, 20, 1, 0);

    // Just in front of the player, not inside them: a light at the capsule's centre is
    // shadowed by the capsule, which puts a black wedge across the player's own beam.
    expect(flashlight.light.position.x).toBeCloseTo(10 + FLASHLIGHT.hold.forward);
    expect(FLASHLIGHT.hold.forward).toBeGreaterThan(PLAYER.radius);
    expect(flashlight.light.position.z).toBe(20);
    expect(flashlight.light.position.y).toBe(FLASHLIGHT.hold.height);

    // Aimed east, at a point on the ground rather than level with the mount: a flat beam
    // lights walls and leaves the floor near the player dark under a pitched camera.
    expect(flashlight.target.position.z).toBe(20);
    expect(flashlight.target.position.y).toBe(0);
    expect(flashlight.target.position.x).toBeGreaterThan(10);
    expect(flashlight.target.position.x).toBeLessThan(10 + FLASHLIGHT.range);
  });

  it('declines the cone so its pool starts near the player and ends at the beam range', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.update(0, 0, 1, 0);

    const halfAngle = THREE.MathUtils.degToRad(FLASHLIGHT.coneAngleDegrees / 2);
    const declination = Math.atan2(
      FLASHLIGHT.hold.height,
      flashlight.target.position.x - flashlight.light.position.x,
    );

    // Upper edge of the cone meets the ground at the spec's 12 m, and the lower edge lands
    // just over a metre out — close enough that the pool reads as attached to the player.
    const far = FLASHLIGHT.hold.height / Math.tan(declination - halfAngle);
    const near = FLASHLIGHT.hold.height / Math.tan(declination + halfAngle);
    expect(far).toBeCloseTo(FLASHLIGHT.range, 1);
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeLessThan(2);
  });

  it('holds the torch to one side when told to, without turning the beam', () => {
    // §4.1's `hold` — moving where it is carried must not move where it points, or a torch
    // in the right hand would aim right of everything the player is looking at.
    const flashlight = new Flashlight(new THREE.Scene());
    const hold = FLASHLIGHT.hold as { lateral: number };
    const before = hold.lateral;
    try {
      hold.lateral = 0.4;
      // Aimed north: `-z`, which puts the player's right at `+x` (§3.2's camera never yaws).
      flashlight.update(0, 0, 0, -1);
      expect(flashlight.light.position.x).toBeCloseTo(0.4);
      expect(flashlight.light.position.z).toBeCloseTo(-FLASHLIGHT.hold.forward);
      // The aim point is straight ahead of the origin, not of the player.
      expect(flashlight.target.position.x).toBeCloseTo(0.4);
    } finally {
      hold.lateral = before;
    }
  });

  it('turns the beam off the aim by the yaw trim, and leaves the origin where it is', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    const hold = FLASHLIGHT.hold as { yawTrimDegrees: number };
    const before = hold.yawTrimDegrees;
    try {
      flashlight.update(0, 0, 0, -1);
      const origin = flashlight.light.position.clone();
      const straight = flashlight.target.position.clone();

      hold.yawTrimDegrees = 30;
      flashlight.update(0, 0, 0, -1);
      expect(flashlight.light.position.x).toBeCloseTo(origin.x);
      expect(flashlight.light.position.z).toBeCloseTo(origin.z);

      // Turned to the player's right — `+x` when aimed north — by the angle asked for.
      // Measured on the ground plane: the trim is a yaw, and the declination is untouched.
      const reach = new THREE.Vector2(straight.x - origin.x, straight.z - origin.z);
      const turned = new THREE.Vector2(
        flashlight.target.position.x - origin.x,
        flashlight.target.position.z - origin.z,
      );
      expect(turned.x).toBeGreaterThan(0);
      expect(turned.length()).toBeCloseTo(reach.length(), 4);
      // Signed on the x/z plane, where turning from `+x` towards `+z` is turning right.
      const cross = reach.x * turned.y - reach.y * turned.x;
      const dot = reach.dot(turned);
      expect(THREE.MathUtils.radToDeg(Math.atan2(cross, dot))).toBeCloseTo(30, 3);
    } finally {
      hold.yawTrimDegrees = before;
    }
  });

  it('pulls the pool in when the pitch is trimmed down, and pushes it out when up', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    const hold = FLASHLIGHT.hold as { pitchTrimDegrees: number };
    const before = hold.pitchTrimDegrees;
    const reach = (): number => {
      flashlight.refresh();
      flashlight.update(0, 0, 1, 0);
      return flashlight.target.position.x - flashlight.light.position.x;
    };
    try {
      const level = reach();
      hold.pitchTrimDegrees = 10;
      expect(reach()).toBeLessThan(level);
      hold.pitchTrimDegrees = -10;
      expect(reach()).toBeGreaterThan(level);
    } finally {
      hold.pitchTrimDegrees = before;
      flashlight.refresh();
    }
  });

  it('keeps a trimmed beam pointing at the ground rather than at the horizon', () => {
    // A slider that can aim the beam at nothing is a slider that makes the scene vanish
    // instead of showing you why the value is wrong.
    const flashlight = new Flashlight(new THREE.Scene());
    const hold = FLASHLIGHT.hold as { pitchTrimDegrees: number };
    const before = hold.pitchTrimDegrees;
    try {
      for (const trim of [-90, -30, 30, 90]) {
        hold.pitchTrimDegrees = trim;
        flashlight.refresh();
        flashlight.update(0, 0, 1, 0);
        const forward = flashlight.target.position.x - flashlight.light.position.x;
        expect(Number.isFinite(forward)).toBe(true);
        expect(forward).toBeGreaterThan(0);
      }
    } finally {
      hold.pitchTrimDegrees = before;
      flashlight.refresh();
    }
  });

  it('renders nothing at all while off, rather than a zero-intensity light', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.update(0, 0, 0, -1);

    // A visible light still costs a shadow map every frame; §7 has no budget for that.
    expect(flashlight.light.visible).toBe(false);
  });

  it('drives beam intensity from the battery', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.toggle();
    flashlight.update(0, 0, 0, -1);

    expect(flashlight.light.visible).toBe(true);
    expect(flashlight.light.intensity).toBeCloseTo(FLASHLIGHT.baseIntensity);

    flashlight.battery.set(0);
    flashlight.battery.turnOn();
    flashlight.update(0, 0, 0, -1);
    expect(flashlight.light.visible).toBe(false);
  });

  it('lets Phase 8 dim the beam without touching the charge (§5.2)', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.toggle();
    flashlight.intensityScale = 0.3;
    flashlight.update(0, 0, 0, -1);

    expect(flashlight.light.intensity).toBeCloseTo(FLASHLIGHT.baseIntensity * 0.3);
    expect(flashlight.battery.charge).toBe(1);
  });

  it('refuses to light while the battery is locked out (§4.1)', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.battery.set(0);

    expect(flashlight.toggle()).toBe(false);
    expect(flashlight.on).toBe(false);
  });
});

describe('selectShadowCasters', () => {
  it('takes the nearest lit lamps up to the budget (§7)', () => {
    const chosen = selectShadowCasters(
      [
        { lit: true, inFrustum: true, distanceSq: 400 },
        { lit: true, inFrustum: true, distanceSq: 100 },
        { lit: true, inFrustum: true, distanceSq: 25 },
      ],
      2,
    );
    expect(chosen).toEqual([2, 1]);
  });

  it('never spends a slot on a lamp that is off or off-screen', () => {
    const chosen = selectShadowCasters(
      [
        { lit: false, inFrustum: true, distanceSq: 1 },
        { lit: true, inFrustum: false, distanceSq: 2 },
        { lit: true, inFrustum: true, distanceSq: 900 },
      ],
      2,
    );
    expect(chosen).toEqual([2]);
  });

  it('defaults to the budget §7 sets', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      lit: true,
      inFrustum: true,
      distanceSq: i,
    }));
    expect(selectShadowCasters(many)).toHaveLength(RENDER.maxShadowCastingEnvironmentLights);
  });

  it('returns nothing when there is nothing to choose from', () => {
    expect(selectShadowCasters([], 2)).toEqual([]);
    expect(selectShadowCasters([{ lit: true, inFrustum: true, distanceSq: 0 }], 0)).toEqual([]);
  });
});

describe('EnvironmentLights', () => {
  it('shapes each cone to the ground pool its entity asks for (§4.2)', () => {
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard', 6)]);
    const light = lights.lamps[0]!.light;
    const height = ENTITY_DEFAULTS.environmentLightHeight;

    expect(light.position.y).toBe(height);
    // A 4 m mount throwing a 6 m radius pool, with range enough to reach the pool's rim.
    expect(THREE.MathUtils.radToDeg(light.angle)).toBeCloseTo(56.3, 1);
    expect(light.distance).toBeCloseTo(Math.hypot(height, 6));
    expect(light.target.position.y).toBe(0);
  });

  it('stands a fixture under every lamp, so an unpowered one is off rather than absent', () => {
    // §4.2 — the bug this is the fix for: a lamp placed with no switch wired to its group
    // is correctly dark, and used to be *nothing at all*, so a level with lamps and no
    // power looked like a level with no lamps in it.
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard')]);
    const meshes: THREE.Mesh[] = [];
    lights.root.traverse((node) => {
      // The fixture, not everything under the lamp: §4's visible cone is a mesh here too,
      // and it is placed per frame from the light rather than standing on the tile.
      if (node instanceof THREE.Mesh && node.name.startsWith('EnvironmentLightFixture:')) {
        meshes.push(node);
      }
    });

    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.position.x).toBeCloseTo((3 + 0.5) * 2);
      expect(mesh.position.z).toBeCloseTo((3 + 0.5) * 2);
      // The light is a point at the top of its own post: a post that cast would put a
      // black bar through the middle of the pool the lamp exists to throw.
      expect(mesh.castShadow).toBe(false);
    }
  });

  it('lights the lamp head with the lamp, and guts it as the lamp strains (§4.2)', () => {
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard')]);
    const head = lights.lamps[0]!.head;
    expect(head.emissiveIntensity).toBe(0);

    lights.setGroupPowered('Yard', true);
    expect(head.emissiveIntensity).toBeGreaterThan(0);
    expect(head.color.getHex()).toBe(ENVIRONMENT_LIGHT.fixture.litColour);

    // §4.2's tell: a lamp guttering across the map is what says where the monster is, and
    // a bulb that stayed bright while its pool flickered would deny the player it.
    const bright = head.emissiveIntensity;
    lights.lamps[0]!.flicker = 0.3;
    lights.setGroupPowered('Yard', true);
    expect(head.emissiveIntensity).toBeLessThan(bright);
  });

  it('starts every group off — a lamp is dark until its group is powered (§4.2)', () => {
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard'), lamp(9, 9, 'Hall')]);
    expect(lights.litCount).toBe(0);
    expect(lights.isGroupPowered('Yard')).toBe(false);
  });

  it('powers a whole group at once and leaves other groups alone (§2)', () => {
    const lights = new EnvironmentLights([
      lamp(1, 1, 'Yard'),
      lamp(5, 1, 'Yard'),
      lamp(9, 9, 'Hall'),
    ]);
    lights.setGroupPowered('Yard', true);

    expect(lights.litCount).toBe(2);
    expect(lights.isGroupPowered('Hall')).toBe(false);
  });

  it('scales brightness by the entity intensity override (§4.2)', () => {
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard', 6, 1), lamp(5, 1, 'Yard', 6, 0.5)]);
    expect(lights.lamps[1]!.light.intensity).toBeCloseTo(lights.lamps[0]!.light.intensity / 2);
  });

  it('gives shadow slots to at most two lit lamps near the camera (§7)', () => {
    const lights = new EnvironmentLights([
      lamp(2, 2, 'Yard'),
      lamp(4, 2, 'Yard'),
      lamp(6, 2, 'Yard'),
      lamp(60, 60, 'Yard'),
    ]);

    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    camera.position.set(8, 14, 20);
    camera.lookAt(8, 0, 6);
    camera.updateMatrixWorld();

    lights.update(camera);
    expect(lights.shadowCasterCount).toBe(0); // nothing is powered yet

    lights.setGroupPowered('Yard', true);
    lights.update(camera);
    expect(lights.shadowCasterCount).toBe(RENDER.maxShadowCastingEnvironmentLights);

    // The far lamp is outside the frustum, so it never takes a slot from a near one.
    expect(lights.lamps[3]!.light.castShadow).toBe(false);
  });

  it('releases the slots again when the group is switched off', () => {
    const lights = new EnvironmentLights([lamp(2, 2, 'Yard'), lamp(4, 2, 'Yard')]);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    camera.position.set(6, 14, 16);
    camera.lookAt(6, 0, 4);
    camera.updateMatrixWorld();

    lights.setGroupPowered('Yard', true);
    lights.update(camera);
    expect(lights.shadowCasterCount).toBeGreaterThan(0);

    lights.setGroupPowered('Yard', false);
    lights.update(camera);
    expect(lights.shadowCasterCount).toBe(0);
    expect(lights.lamps.every((l) => !l.light.castShadow)).toBe(true);
  });

  it('toggles every group at once for the debug harness, until Phase 9 wires switches', () => {
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard'), lamp(9, 9, 'Hall')]);

    expect(lights.toggleAll()).toBe(true);
    expect(lights.litCount).toBe(2);
    expect(lights.toggleAll()).toBe(false);
    expect(lights.litCount).toBe(0);
  });
});

describe('the sabotage lifecycle (§4.2)', () => {
  const TICK = 1 / 60;
  const SAB = ENVIRONMENT_LIGHT.sabotage;
  /** Fixed jitter, so these test the *lifecycle* and not the curve tested in monster.test. */
  const steady = () => 0.5;

  /** A powered lamp at world (7, 7) with a 6 m pool, and a monster standing under it. */
  function under() {
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard', 6)]);
    lights.setGroupPowered('Yard', true);
    return { lights, one: lights.lamps[0]!, here: [{ x: 7, z: 7 }] };
  }

  function run(lights: EnvironmentLights, occupants: { x: number; z: number }[], seconds: number) {
    const ticks = Math.round(seconds / TICK);
    for (let i = 0; i < ticks; i += 1) lights.tick(TICK, occupants, steady);
  }

  it('holds steady for the first two seconds of dwell', () => {
    const { lights, one, here } = under();
    run(lights, here, SAB.strainAfterSeconds - 0.1);
    expect(one.sabotage).toBe('steady');
    expect(one.light.visible).toBe(true);
    expect(one.light.intensity).toBeCloseTo(ENVIRONMENT_LIGHT.baseIntensity);
  });

  it('strains, then fails, then comes back on §4.2\'s timings', () => {
    const { lights, one, here } = under();

    run(lights, here, SAB.strainAfterSeconds + 0.1);
    expect(one.sabotage).toBe('strain');
    expect(one.light.visible).toBe(true);
    expect(one.light.intensity).toBeLessThan(ENVIRONMENT_LIGHT.baseIntensity);

    run(lights, here, SAB.failAfterStrainSeconds);
    expect(one.sabotage).toBe('failed');
    expect(one.light.visible).toBe(false);

    run(lights, here, SAB.recoverySeconds - 0.1);
    expect(one.sabotage).toBe('failed');

    run(lights, here, 0.2);
    // Back at full intensity with the dwell reset — and straight into another cycle,
    // because the monster never left (§4.2).
    expect(one.light.visible).toBe(true);
    expect(one.light.intensity).toBeCloseTo(ENVIRONMENT_LIGHT.baseIntensity);
    expect(one.dwell).toBeLessThan(SAB.strainAfterSeconds);
  });

  it('gets worse the closer it is to going out', () => {
    const { lights, one, here } = under();
    run(lights, here, SAB.strainAfterSeconds + 0.05);
    const early = one.flicker;
    run(lights, here, SAB.failAfterStrainSeconds - 0.2);
    // Severity has ramped, so a dip of the same shape now costs the lamp much more.
    expect(one.flicker).toBeLessThan(early);
  });

  it('resets the dwell the moment the monster steps out of the pool (§4.2)', () => {
    const { lights, one, here } = under();
    run(lights, here, SAB.strainAfterSeconds + 0.5);
    expect(one.sabotage).toBe('strain');

    run(lights, [{ x: 40, z: 40 }], TICK);
    expect(one.sabotage).toBe('steady');
    expect(one.dwell).toBe(0);
    expect(one.light.intensity).toBeCloseTo(ENVIRONMENT_LIGHT.baseIntensity);

    // And the count starts again from zero rather than resuming.
    run(lights, here, SAB.strainAfterSeconds - 0.1);
    expect(one.sabotage).toBe('steady');
  });

  it('counts dwell by the pool a monster is standing in, not by the nearest lamp', () => {
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard', 6), lamp(12, 12, 'Yard', 6)]);
    lights.setGroupPowered('Yard', true);
    run(lights, [{ x: 7, z: 7 }], SAB.strainAfterSeconds + SAB.failAfterStrainSeconds + 0.1);
    expect(lights.lamps[0]!.sabotage).toBe('failed');
    expect(lights.lamps[1]!.sabotage).toBe('steady');
    expect(lights.failedCount).toBe(1);
  });

  it('leaves the switch alone: a failure is a hazard, not lost progress (§4.2)', () => {
    const { lights, one, here } = under();
    run(lights, here, SAB.strainAfterSeconds + SAB.failAfterStrainSeconds + 0.1);
    expect(one.sabotage).toBe('failed');
    expect(one.light.visible).toBe(false);
    // The group is still powered throughout — the PowerSwitch never learns about this.
    expect(lights.isGroupPowered('Yard')).toBe(true);
    expect(one.powered).toBe(true);
  });

  it('does not strain a lamp whose group is switched off', () => {
    const lights = new EnvironmentLights([lamp(3, 3, 'Yard', 6)]);
    run(lights, [{ x: 7, z: 7 }], 10);
    expect(lights.lamps[0]!.sabotage).toBe('steady');
    expect(lights.lamps[0]!.light.visible).toBe(false);
  });

  it('comes back clean after its group is switched off mid-strain', () => {
    const { lights, one, here } = under();
    run(lights, here, SAB.strainAfterSeconds + 0.5);
    expect(one.sabotage).toBe('strain');

    lights.setGroupPowered('Yard', false);
    expect(one.sabotage).toBe('steady');
    lights.setGroupPowered('Yard', true);
    expect(one.light.intensity).toBeCloseTo(ENVIRONMENT_LIGHT.baseIntensity);
  });
});

describe('the visible beam (§4)', () => {
  /** A spotlight has no shadow map until something renders it; this is what one looks like. */
  function withShadowMap(light: THREE.SpotLight): THREE.SpotLight {
    (light.shadow as unknown as { map: unknown }).map = { texture: {} };
    return light;
  }

  function shaft(light: THREE.SpotLight): LightShaft {
    return new LightShaft(light, { steps: 8, density: 0.05 });
  }

  it('wraps the cone the light actually throws, and grows it rather than shrinking it', () => {
    // The proxy is the only thing deciding which pixels are considered, so a polygonal cone
    // built the usual way — inscribed — would clip the shaft's own edge off.
    const light = new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3);
    const geometry = shaft(light).mesh.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    expect(box.max.y).toBeCloseTo(0, 6);
    expect(box.min.y).toBeCloseTo(-light.distance, 5);
    expect(Math.max(box.max.x, box.max.z)).toBeGreaterThan(light.distance * Math.tan(light.angle));
  });

  it('follows the light when the beam is re-shaped (§8.3)', () => {
    const light = new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3);
    const beam = shaft(light);
    light.distance = 20;
    light.angle = Math.PI / 5;
    beam.refresh();

    beam.mesh.geometry.computeBoundingBox();
    expect(beam.mesh.geometry.boundingBox!.min.y).toBeCloseTo(-20, 5);
  });

  it('is drawn only where there is a shadow map to cut it with', () => {
    // §4 — an unshadowed shaft passes through the wall the light stops at, and glows on the
    // far side. Nothing is better than that.
    const light = new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3);
    light.visible = true;

    const beam = shaft(light);
    beam.update(1);
    expect(beam.mesh.visible).toBe(false);

    withShadowMap(light);
    beam.update(1);
    expect(beam.mesh.visible).toBe(true);
  });

  it('takes the light\'s own shadow map and matrix, which is what cuts it', () => {
    // The clipping *is* this wiring: the march tests every sample against the depth the
    // light already drew, so a shaft holding a stale matrix or no map is a shaft that
    // shines through the wall the beam stops at, silently and without an error anywhere.
    const light = withShadowMap(new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3));
    light.visible = true;
    light.shadow.bias = -0.0006;
    light.shadow.matrix.makeTranslation(1, 2, 3);

    const beam = shaft(light);
    const uniforms = (beam.mesh.material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uShadowed!.value).toBe(0);

    beam.update(1);
    expect(uniforms.uShadowed!.value).toBe(1);
    expect(uniforms.uShadowMap!.value).toBe(light.shadow.map!.texture);
    expect((uniforms.uShadowMatrix!.value as THREE.Matrix4).elements).toEqual(
      light.shadow.matrix.elements,
    );
    // The light's own bias plus the extra a mid-air sample needs. Positive would push
    // samples towards shadowed and eat the beam; too negative leaks it past the occluder.
    expect(uniforms.uShadowBias!.value).toBeCloseTo(light.shadow.bias + LIGHT_SHAFT.shadowBias, 10);
    expect(uniforms.uShadowBias!.value).toBeLessThan(0);
    // The floor receives shadows but never casts them (§7), so the map cannot stop the
    // march at the ground and this is what does.
    expect(uniforms.uFloor!.value).toBe(LIGHT_SHAFT.floorHeight);
    expect(uniforms.uFloor!.value).toBeGreaterThanOrEqual(0);
  });

  it('goes out with the light it belongs to', () => {
    // §4.1's flat battery and §5.2's blink both arrive as a zero here, and a beam emitting
    // nothing has to have no haze in it either — otherwise the monster's blink leaves a
    // cone of light hanging in the air with nothing lighting it.
    const light = withShadowMap(new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3));
    light.visible = true;
    const beam = shaft(light);

    beam.update(0);
    expect(beam.mesh.visible).toBe(false);

    light.visible = false;
    beam.update(1);
    expect(beam.mesh.visible).toBe(false);
  });

  it('points down the beam, wherever the beam is pointing', () => {
    const light = withShadowMap(new THREE.SpotLight(0xffffff, 1, 12, Math.PI / 8, 0.3));
    light.visible = true;
    light.position.set(3, 1.6, 4);
    light.target.position.set(3, 0, 9);
    light.target.updateMatrixWorld();

    const beam = shaft(light);
    beam.update(1);

    expect(beam.mesh.position.toArray()).toEqual([3, 1.6, 4]);
    // The proxy opens along its own -Y, so that is what the beam's axis has to land on.
    const opening = new THREE.Vector3(0, -1, 0).applyQuaternion(beam.mesh.quaternion);
    const axis = new THREE.Vector3(3, 0, 9).sub(new THREE.Vector3(3, 1.6, 4)).normalize();
    expect(opening.distanceTo(axis)).toBeCloseTo(0, 6);
  });
});

describe('a lamp handing its shadow slot on (§4.2, §7)', () => {
  function lit(count: number): EnvironmentLights {
    const lights = new EnvironmentLights(
      Array.from({ length: count }, (_, i) => lamp(i * 4, 0, 'grid')),
    );
    lights.setGroupPowered('grid', true);
    for (const one of lights.lamps) {
      (one.light.shadow as unknown as { map: unknown }).map = { texture: {} };
    }
    return lights;
  }

  /** A camera that puts every lamp in frustum, so proximity is the only thing choosing. */
  function camera(x: number): THREE.PerspectiveCamera {
    const view = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    view.position.set(x, 20, 40);
    view.lookAt(x, 0, 0);
    view.updateMatrixWorld(true);
    return view;
  }

  it('fades the shaft in rather than popping it on across the room', () => {
    // §7 hands the two slots round as the camera moves, and a shaft that arrived on the
    // frame a lamp won one would flash on at whatever distance that happened.
    const lights = lit(3);
    const near = camera(0);

    lights.update(near, 0);
    expect(lights.shadowCasterCount).toBe(RENDER.maxShadowCastingEnvironmentLights);
    expect(lights.lamps.filter((one) => one.shaft.mesh.visible).length).toBe(0);

    lights.update(near, LIGHT_SHAFT.handoverSeconds / 2);
    const half = lights.lamps.filter((one) => one.shaftFade > 0 && one.shaftFade < 1);
    expect(half.length).toBe(RENDER.maxShadowCastingEnvironmentLights);

    lights.update(near, LIGHT_SHAFT.handoverSeconds);
    expect(lights.lamps.filter((one) => one.shaftFade === 1).length).toBe(
      RENDER.maxShadowCastingEnvironmentLights,
    );
    expect(lights.lamps.filter((one) => one.shaft.mesh.visible).length).toBe(
      RENDER.maxShadowCastingEnvironmentLights,
    );
  });

  it('fades it back out when the slot goes to somebody else', () => {
    const lights = lit(3);
    lights.update(camera(0), LIGHT_SHAFT.handoverSeconds);
    // The nearest lamp to the near end, and the furthest from the far one.
    expect(lights.lamps[0]!.shaftFade).toBe(1);

    // Walk the camera to the far end; the two slots go to the other two lamps.
    lights.update(camera(20), 0);
    expect(lights.lamps[0]!.light.castShadow).toBe(false);
    lights.update(camera(20), LIGHT_SHAFT.handoverSeconds);

    expect(lights.lamps[0]!.shaftFade).toBe(0);
    expect(lights.lamps[0]!.shaft.mesh.visible).toBe(false);
  });

  it('takes the shaft with a lamp that a monster puts out (§4.2)', () => {
    const lights = lit(1);
    lights.update(camera(0), LIGHT_SHAFT.handoverSeconds);
    expect(lights.lamps[0]!.shaft.mesh.visible).toBe(true);

    lights.setGroupPowered('grid', false);
    lights.update(camera(0), 0);
    expect(lights.lamps[0]!.shaft.mesh.visible).toBe(false);
  });
});

describe('warming the lamp shaders before a switch is thrown (§7)', () => {
  /**
   * The bug this exists for: a shader program is keyed on how many spot lights are visible
   * and how many of them cast, so the first time a `PowerSwitch` routed power, every
   * material in the scene was recompiled inside that one frame — and no toggle afterwards
   * ever was again. One stall, at the moment the player did the thing the level is about.
   *
   * Nothing here needs a GPU. The claim under test is about *which light configurations the
   * warm-up poses*, and that is arithmetic: miss one and it is compiled during play.
   */
  describe('reachableLitCounts', () => {
    it('is the subset sums of the groups, because a switch acts on a whole group', () => {
      // Three and two can be lit 0, 2, 3 or 5 at a time. Never 1, and never 4.
      expect(reachableLitCounts([3, 2])).toEqual([0, 2, 3, 5]);
    });

    it('counts a repeated size once, since these are counts and not subsets', () => {
      expect(reachableLitCounts([2, 2, 2])).toEqual([0, 2, 4, 6]);
    });

    it('is just "off" for a map with no lamps at all', () => {
      expect(reachableLitCounts([])).toEqual([0]);
    });
  });

  /** Every pose a `compile` callback was handed, as `spots:shadows`. */
  function poses(lights: EnvironmentLights, torch?: THREE.SpotLight): Set<string> {
    const seen = new Set<string>();
    lights.precompile(() => {
      const spots =
        lights.lamps.filter((l) => l.light.visible).length + (torch?.visible ? 1 : 0);
      const shadows =
        lights.lamps.filter((l) => l.light.visible && l.light.castShadow).length +
        (torch?.visible && torch.castShadow ? 1 : 0);
      seen.add(`${spots}:${shadows}`);
    }, torch);
    return seen;
  }

  it('poses every light count a run can reach, shadow slots included', () => {
    const lights = new EnvironmentLights([
      lamp(1, 1, 'Yard'),
      lamp(5, 1, 'Yard'),
      lamp(9, 1, 'Yard'),
      lamp(1, 9, 'Gate'),
      lamp(5, 9, 'Gate'),
    ]);
    const seen = poses(lights);

    // Derived here rather than copied from the implementation: a lamp only holds a slot
    // while it is on screen (§7), so any number of the lit lamps from none up to the budget
    // may be casting, and every one of those is a different program.
    const wanted = new Set<string>();
    for (const count of [0, 2, 3, 5]) {
      const slots = Math.min(count, RENDER.maxShadowCastingEnvironmentLights);
      for (let casting = 0; casting <= slots; casting += 1) wanted.add(`${count}:${casting}`);
    }
    for (const pose of wanted) expect(seen, pose).toContain(pose);
    lights.dispose();
  });

  it('poses each of those twice when the torch is in play, lit and dark', () => {
    // §4.1's flashlight is a visible spot light of its own and goes out with the battery,
    // so it shifts every count above by one — a different key, not the same one.
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard'), lamp(5, 1, 'Yard')]);
    const torch = new THREE.SpotLight(0xffffff);
    torch.castShadow = true;
    torch.visible = false;
    const seen = poses(lights, torch);

    expect(seen).toContain('2:2');
    expect(seen).toContain('3:3');
    expect(seen).toContain('2:0');
    expect(seen).toContain('1:1');
    lights.dispose();
  });

  it('leaves every light exactly as it found it', () => {
    // The failure this guards against is not a slow frame but a lit map: a pose left behind
    // is a lamp burning with nothing powering it, and §4.1's query would agree with it.
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard'), lamp(5, 1, 'Gate')]);
    lights.setGroupPowered('Yard', true);
    const before = lights.lamps.map((l) => [l.light.visible, l.light.castShadow]);
    const torch = new THREE.SpotLight(0xffffff);
    torch.visible = true;

    lights.precompile(() => {}, torch);

    expect(lights.lamps.map((l) => [l.light.visible, l.light.castShadow])).toEqual(before);
    expect(torch.visible).toBe(true);
    expect(lights.litCount).toBe(1);
    lights.dispose();
  });

  it('restores them even if the compile throws', () => {
    const lights = new EnvironmentLights([lamp(1, 1, 'Yard')]);
    const torch = new THREE.SpotLight(0xffffff);
    torch.visible = true;

    expect(() =>
      lights.precompile(() => {
        throw new Error('context lost');
      }, torch),
    ).toThrow('context lost');

    expect(lights.lamps[0]!.light.visible).toBe(false);
    expect(torch.visible).toBe(true);
    lights.dispose();
  });
});
