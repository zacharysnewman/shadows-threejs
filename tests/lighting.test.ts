/** The flashlight rig and the environmental light shadow budget (§4.1, §4.2, §7). */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENTITY_DEFAULTS, FLASHLIGHT, PLAYER, RENDER } from '../src/config';
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
    expect(light.distance).toBeCloseTo(Math.hypot(FLASHLIGHT.range, FLASHLIGHT.mountHeight));
  });

  it('is the one shadow-casting spotlight, at the resolution §7 budgets for it', () => {
    const light = new Flashlight(new THREE.Scene()).light;

    expect(light.castShadow).toBe(true);
    expect(light.shadow.mapSize.width).toBe(RENDER.flashlightShadowMapSize);
    // Tightened to the beam, not left at Three's default far plane.
    expect(light.shadow.camera.far).toBeCloseTo(
      Math.hypot(FLASHLIGHT.range, FLASHLIGHT.mountHeight),
    );
  });

  it('sits on the player and points along the aim, declined onto the floor', () => {
    const flashlight = new Flashlight(new THREE.Scene());
    flashlight.update(10, 20, 1, 0);

    // Just in front of the player, not inside them: a light at the capsule's centre is
    // shadowed by the capsule, which puts a black wedge across the player's own beam.
    expect(flashlight.light.position.x).toBeGreaterThan(10 + PLAYER.radius);
    expect(flashlight.light.position.x).toBeLessThan(10 + PLAYER.radius + 0.5);
    expect(flashlight.light.position.z).toBe(20);
    expect(flashlight.light.position.y).toBe(FLASHLIGHT.mountHeight);

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
      FLASHLIGHT.mountHeight,
      flashlight.target.position.x - flashlight.light.position.x,
    );

    // Upper edge of the cone meets the ground at the spec's 12 m, and the lower edge lands
    // just over a metre out — close enough that the pool reads as attached to the player.
    const far = FLASHLIGHT.mountHeight / Math.tan(declination - halfAngle);
    const near = FLASHLIGHT.mountHeight / Math.tan(declination + halfAngle);
    expect(far).toBeCloseTo(FLASHLIGHT.range, 1);
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeLessThan(2);
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
