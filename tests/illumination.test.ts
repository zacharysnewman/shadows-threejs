/** The shared illumination query: cone, pool, occlusion and the raycast budget (§4.1, §4.2). */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLASHLIGHT, ILLUMINATION } from '../src/config';
import { EnvironmentLights } from '../src/lighting/EnvironmentLights';
import { Flashlight } from '../src/lighting/Flashlight';
import { coneStrength, IlluminationService, poolStrength } from '../src/lighting/Illumination';
import { buildColliders } from '../src/map/colliders';
import type { EnvironmentLightEntity } from '../src/map/types';
import { parseMap, parseTileset } from '../src/map/validate';
import { segmentBlocked, segmentHitsBox } from '../src/nav/raycast';
import { ColliderIndex } from '../src/player/collision';

const TILE = 2;
const TICK = 1 / 60;

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/** ASCII sketch: `#` wall, `.` a hole in the floor, anything else open. */
function collidersFrom(rows: string[]): ColliderIndex {
  const width = rows[0]!.length;
  const height = rows.length;
  const floor: number[] = [];
  const walls: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      floor.push(cell === '.' ? 0 : 1);
      walls.push(cell === '#' ? 2 : 0);
    }
  }
  const map = parseMap(
    {
      width,
      height,
      tileSize: TILE,
      layers: [
        { name: 'Floor', data: floor },
        { name: 'Walls', data: walls },
      ],
      entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }],
    },
    tileset,
  );
  return new ColliderIndex(buildColliders(map, tileset, () => 3), width, height, TILE);
}

function lamp(gx: number, gy: number, groupId = 'Yard', radius = 6, intensity = 1): EnvironmentLightEntity {
  return {
    type: 'EnvironmentLight',
    key: `EnvironmentLight@${gx},${gy}#0`,
    index: 0,
    gx,
    gy,
    wx: (gx + 0.5) * TILE,
    wz: (gy + 0.5) * TILE,
    groupId,
    radius,
    intensity,
  };
}

const HALF_ANGLE = THREE.MathUtils.degToRad(FLASHLIGHT.coneAngleDegrees / 2);
const OPEN = Array.from({ length: 14 }, () => ' '.repeat(14));

describe('coneStrength', () => {
  it('lights what is straight ahead and inside the range', () => {
    expect(coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, 4, 0)).toBeGreaterThan(0);
  });

  it('is zero past the range, however well aimed', () => {
    expect(coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, 12.5, 0)).toBe(0);
  });

  it('is zero outside the half angle, however close', () => {
    // 45° full cone means 22.5° either side; 40° off axis is outside it.
    const off = THREE.MathUtils.degToRad(40);
    const x = Math.cos(off) * 3;
    const z = Math.sin(off) * 3;
    expect(coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, x, z)).toBe(0);
  });

  it('falls off towards the rim and with distance', () => {
    const centre = coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, 4, 0);
    const nearRim = coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, 4, 4 * Math.tan(HALF_ANGLE * 0.9));
    const further = coneStrength(0, 0, 1, 0, HALF_ANGLE, 12, 9, 0);

    expect(nearRim).toBeLessThan(centre);
    expect(further).toBeLessThan(centre);
    expect(nearRim).toBeGreaterThan(0);
  });

  it('lights nothing from a beam with no direction', () => {
    expect(coneStrength(0, 0, 0, 0, HALF_ANGLE, 12, 1, 0)).toBe(0);
  });
});

describe('poolStrength', () => {
  it('is strongest under the lamp and zero at its rim (§4.2)', () => {
    expect(poolStrength(0, 0, 6, 1, 0, 0)).toBeCloseTo(1);
    expect(poolStrength(0, 0, 6, 1, 3, 0)).toBeCloseTo(0.5);
    expect(poolStrength(0, 0, 6, 1, 6, 0)).toBeCloseTo(0);
    expect(poolStrength(0, 0, 6, 1, 7, 0)).toBe(0);
  });

  it('scales with the entity\'s authored intensity', () => {
    expect(poolStrength(0, 0, 6, 0.5, 0, 0)).toBeCloseTo(0.5);
  });
});

describe('segment occlusion', () => {
  it('finds a box the segment passes through', () => {
    const box = {
      kind: 'obstacle' as const,
      cx: 5, cz: 0, hx: 1, hz: 1, height: 3, gx0: 2, gy0: 0, gx1: 2, gy1: 0,
    };
    expect(segmentHitsBox(box, 0, 0, 10, 0)).toBe(true);
    expect(segmentHitsBox(box, 0, 5, 10, 5)).toBe(false);
    // Stops short of the box.
    expect(segmentHitsBox(box, 0, 0, 3, 0)).toBe(false);
  });

  it('is blocked by a wall and clear across open ground', () => {
    const index = collidersFrom(['              ', '     #        ', '              ']);
    // The wall tile spans world x 10..12, z 2..4.
    expect(segmentBlocked(index, 11, 1, 11, 5)).toBe(true);
    expect(segmentBlocked(index, 3, 1, 3, 5)).toBe(false);
  });

  it('is not blocked by a hole in the floor — a gap casts no shadow (§4.1)', () => {
    const index = collidersFrom(['              ', '     .        ', '              ']);
    expect(segmentBlocked(index, 11, 1, 11, 5)).toBe(false);
  });
});

describe('IlluminationService', () => {
  function build(rows: string[] = OPEN, lamps: EnvironmentLightEntity[] = []) {
    const scene = new THREE.Scene();
    const flashlight = new Flashlight(scene);
    const environment = new EnvironmentLights(lamps);
    const service = new IlluminationService(flashlight, environment, collidersFrom(rows));
    return { flashlight, environment, service };
  }

  /** Point the beam from a world position along a direction, as the render loop does. */
  function aim(flashlight: Flashlight, x: number, z: number, dx: number, dz: number): void {
    flashlight.update(x, z, dx, dz);
  }

  it('reports nothing lit with the torch off and no lamps on', () => {
    const { flashlight, service } = build();
    aim(flashlight, 4, 4, 1, 0);

    const sample = service.sample('a', 8, 4);
    expect(sample.lit).toBe(false);
    expect(sample.source).toBeNull();
  });

  it('lights what the beam is on', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, 1, 0);

    const sample = service.sample('a', 9, 4);
    expect(sample.lit).toBe(true);
    expect(sample.source).toBe('flashlight');
    expect(sample.amount).toBeGreaterThan(0);
  });

  it('does not light through a wall (§4.1)', () => {
    // Wall tile at grid (3,2): world x 6..8, z 4..6.
    const rows = [...OPEN];
    rows[2] = '   #          ';
    const { flashlight, service } = build(rows);
    flashlight.toggle();
    aim(flashlight, 3, 5, 1, 0);

    expect(service.sample('a', 11, 5).lit).toBe(false);
    // ...but the same beam lights something on its own side of it.
    expect(service.sample('b', 5.5, 5).lit).toBe(true);
  });

  it('unlights the instant the beam leaves, without waiting for a confirmation', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, 1, 0);
    expect(service.sample('a', 9, 4).lit).toBe(true);

    // Swing the beam away and ask again on the very next tick.
    aim(flashlight, 4, 4, -1, 0);
    service.tick(TICK);
    expect(service.sample('a', 9, 4).lit).toBe(false);
  });

  it('lights the instant the beam arrives, because §5.1 says "the instant"', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, -1, 0);
    expect(service.sample('a', 9, 4).lit).toBe(false);

    // Entering the cone confirms on the same tick rather than at the next interval.
    aim(flashlight, 4, 4, 1, 0);
    service.tick(TICK);
    expect(service.sample('a', 9, 4).lit).toBe(true);
  });

  it('goes dark when the battery does', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, 1, 0);
    expect(service.sample('a', 9, 4).lit).toBe(true);

    flashlight.battery.set(0); // drained and locked out (§4.1)
    aim(flashlight, 4, 4, 1, 0);
    expect(service.sample('a', 9, 4).lit).toBe(false);
  });

  it('reports a lamp pool as lit, identically to a beam (§4.2)', () => {
    const { environment, service } = build(OPEN, [lamp(4, 4)]);
    const under = { x: 9, z: 9 };

    expect(service.sample('a', under.x, under.z).lit).toBe(false); // unpowered
    environment.setGroupPowered('Yard', true);

    const sample = service.sample('a', under.x, under.z);
    expect(sample.lit).toBe(true);
    expect(sample.source).toBe('environment');
  });

  it('does not light through a wall from a lamp either', () => {
    const rows = [...OPEN];
    rows[5] = '    #         ';
    const { environment, service } = build(rows, [lamp(4, 4)]);
    environment.setGroupPowered('Yard', true);

    // Lamp at world (9,9); target at (9,13) with a wall tile at world x 8..10, z 10..12.
    expect(service.sample('a', 9, 13).lit).toBe(false);
  });

  it('is dark outside the pool radius', () => {
    const { environment, service } = build(OPEN, [lamp(4, 4, 'Yard', 6)]);
    environment.setGroupPowered('Yard', true);
    expect(service.sample('a', 9 + 7, 9).lit).toBe(false);
  });

  it('reports whichever source is doing more where the two overlap', () => {
    const { flashlight, environment, service } = build(OPEN, [lamp(4, 4)]);
    environment.setGroupPowered('Yard', true);
    flashlight.toggle();

    // Directly under the lamp, at full pool strength, with the beam arriving from 3.5 m
    // away and already down to about 0.7: the lamp is doing more, and says so.
    aim(flashlight, 5, 9, 1, 0);
    const underLamp = service.sample('a', 9, 9);
    expect(underLamp.lit).toBe(true);
    expect(underLamp.source).toBe('environment');

    // Out at the rim of the pool, where the lamp has almost nothing left, with the beam
    // close and on axis: now the beam is doing more.
    aim(flashlight, 13, 9, 1, 0);
    const atRim = service.sample('b', 14.5, 9);
    expect(atRim.lit).toBe(true);
    expect(atRim.source).toBe('flashlight');
  });

  it('keeps to the raycast budget while an entity sits in the beam (§4.1)', () => {
    const { flashlight, service } = build();
    flashlight.toggle();

    // One subject, one second of ticks, sitting still inside the cone.
    for (let i = 0; i < 60; i += 1) {
      aim(flashlight, 4, 4, 1, 0);
      service.sample('a', 9, 4);
      service.tick(TICK);
    }
    // Entry confirmation plus one per interval, and nothing like one per tick.
    expect(service.raycastsPerSecond).toBeLessThanOrEqual(ILLUMINATION.raycastHz + 1);
    expect(service.raycastsPerSecond).toBeGreaterThanOrEqual(ILLUMINATION.raycastHz - 1);
  });

  it('scales the budget with the number of entities, not with the tick rate', () => {
    const { flashlight, service } = build();
    flashlight.toggle();

    for (let i = 0; i < 60; i += 1) {
      aim(flashlight, 4, 4, 1, 0);
      for (const key of ['a', 'b', 'c', 'd']) service.sample(key, 9, 4);
      service.tick(TICK);
    }
    expect(service.subjectCount).toBe(4);
    expect(service.raycastsPerSecond).toBeLessThanOrEqual(4 * ILLUMINATION.raycastHz + 4);
  });

  it('staggers the first confirmation so a crowd does not raycast on one tick', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, 1, 0);

    // Ten subjects entering the cone together: their *repeat* confirmations should not all
    // land on the same tick afterwards.
    const keys = Array.from({ length: 10 }, (_, i) => `e${i}`);
    for (const key of keys) service.sample(key, 9, 4);

    const perTick: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const before = service.raycastsPerSecond;
      service.tick(TICK);
      for (const key of keys) service.sample(key, 9, 4);
      perTick.push(service.raycastsPerSecond - before);
    }
    // No single tick after the entry burst re-confirms the whole crowd.
    expect(Math.max(...perTick)).toBeLessThan(keys.length);
  });

  it('forgets a subject when it is gone', () => {
    const { flashlight, service } = build();
    flashlight.toggle();
    aim(flashlight, 4, 4, 1, 0);
    service.sample('a', 9, 4);
    expect(service.subjectCount).toBe(1);

    service.forget('a');
    expect(service.subjectCount).toBe(0);
  });
});
