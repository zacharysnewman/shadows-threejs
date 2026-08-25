/** The flashlight rig and the environmental light shadow budget (§4.1, §4.2, §7). */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENTITY_DEFAULTS, ENVIRONMENT_LIGHT, FLASHLIGHT, PLAYER, RENDER } from '../src/config';
import { EnvironmentLights, selectShadowCasters } from '../src/lighting/EnvironmentLights';
import { Flashlight } from '../src/lighting/Flashlight';
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
      if (node instanceof THREE.Mesh) meshes.push(node);
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
