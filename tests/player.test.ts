/** Player movement, wall sliding and the spawn facing (§3.1, §3.4). */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY, PLAYER } from '../src/config';
import { buildColliders } from '../src/map/colliders';
import { parseMap, parseTileset } from '../src/map/validate';
import type { PlayerSpawnEntity } from '../src/map/types';
import { ColliderIndex } from '../src/player/collision';
import { directionFromRotation, Player } from '../src/player/Player';

const TILE = 2;
const TICK = 1 / 60;

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_grass', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/** Same ASCII sketch convention as the collision tests: `#` is a wall, space is floor. */
function indexFrom(rows: string[]): ColliderIndex {
  const width = rows[0]!.length;
  const height = rows.length;
  const floor: number[] = [];
  const walls: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      floor.push(1);
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

function spawnAt(wx: number, wz: number, rotation = 0): PlayerSpawnEntity {
  return {
    type: 'PlayerSpawn',
    key: `PlayerSpawn@0,0#0`,
    index: 0,
    gx: Math.floor(wx / TILE),
    gy: Math.floor(wz / TILE),
    wx,
    wz,
    rotation,
  };
}

/** Open floor big enough that nothing in these tests reaches an edge. */
function openField(): ColliderIndex {
  return indexFrom(Array.from({ length: 10 }, () => '          '));
}

function run(
  player: Player,
  seconds: number,
  moveX: number,
  moveZ: number,
  sprint = false,
): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) player.tick(TICK, moveX, moveZ, sprint);
}

describe('directionFromRotation', () => {
  it('reads 0° as north — screen-up under the un-rotated camera (§2, §3.2)', () => {
    const north = directionFromRotation(0);
    expect(north.x).toBeCloseTo(0);
    expect(north.z).toBeCloseTo(-1);
  });

  it('turns clockwise, so 90° is east', () => {
    const east = directionFromRotation(90);
    expect(east.x).toBeCloseTo(1);
    expect(east.z).toBeCloseTo(0);
  });
});

describe('Player', () => {
  it('spawns on its tile facing the authored rotation', () => {
    const player = new Player(spawnAt(9, 9, 90), openField());
    expect(player.position.x).toBe(9);
    expect(player.position.y).toBe(9);
    expect(player.aim.x).toBeCloseTo(1);
    expect(player.aim.y).toBeCloseTo(0);
  });

  it('accelerates towards walk speed rather than snapping to it (§3.1)', () => {
    const player = new Player(spawnAt(9, 9), openField());

    player.tick(TICK, 1, 0);
    // One tick into a 0.1 s ramp: moving, but nowhere near full speed.
    expect(player.speed).toBeGreaterThan(0);
    expect(player.speed).toBeLessThan(PLAYER.walkSpeed * 0.2);

    run(player, 1, 1, 0);
    expect(player.speed).toBeCloseTo(PLAYER.walkSpeed, 2);
  });

  it('decelerates to a stop when the input is released', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 0.5, 1, 0);
    const moving = player.speed;

    player.tick(TICK, 0, 0);
    expect(player.speed).toBeLessThan(moving);

    run(player, 0.5, 0, 0);
    expect(player.speed).toBeLessThan(0.05);
  });

  it('scales speed with the magnitude of the input, so half a stick is half speed', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 1, 0.5, 0);
    expect(player.speed).toBeCloseTo(PLAYER.walkSpeed / 2, 2);
  });

  it('covers walk speed × time across open floor', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 2, 1, 0);
    // Two seconds at 3 m/s, less the fraction of a metre lost to the initial ramp.
    expect(player.position.x - 9).toBeGreaterThan(2 * PLAYER.walkSpeed - 0.4);
    expect(player.position.x - 9).toBeLessThan(2 * PLAYER.walkSpeed);
  });

  it('slides along a wall it is pushed into instead of catching on it (§3.1)', () => {
    // Wall along the top row (world z 0..2); walk north-east into it.
    const player = new Player(spawnAt(9, 2.5), indexFrom(['##########', '          ', '          ']));
    run(player, 1.5, Math.SQRT1_2, -Math.SQRT1_2);

    expect(player.touchingWall).toBe(true);
    expect(player.position.y).toBeCloseTo(2 + PLAYER.radius, 2);
    // Still travelling along the wall rather than stalled against it. Expressed against
    // walk speed, not as a coordinate: the distance covered is a speed times a time, and a
    // literal here is a test that fails the next time §3.1 is tuned.
    const ideal = PLAYER.walkSpeed * Math.SQRT1_2 * 1.5;
    expect(player.position.x - 9).toBeGreaterThan(ideal * 0.8);
    expect(player.speed).toBeGreaterThan(PLAYER.walkSpeed * 0.5);
  });

  it('does not build up speed into a wall it is held against', () => {
    const player = new Player(spawnAt(9, 2.5), indexFrom(['##########', '          ', '          ']));
    run(player, 2, 0, -1);

    expect(player.position.y).toBeCloseTo(2 + PLAYER.radius, 2);
    // The velocity into the wall is cancelled every tick, so releasing does not launch the
    // player back the way they came.
    expect(player.speed).toBeLessThan(0.2);
  });

  it('never crosses a wall it walks into head-on', () => {
    // Wall run across grid row 1 (world z 2..4), approached from the south.
    const player = new Player(spawnAt(5, 7), indexFrom(['     ', ' ### ', '     ', '     ']));
    run(player, 3, 0, -1);
    expect(player.position.y).toBeGreaterThanOrEqual(4 + PLAYER.radius - 1e-6);
  });

  it('threads a one-tile doorway', () => {
    const player = new Player(
      spawnAt(9, 7),
      indexFrom(['     ', '     ', '#### ', '#### ', '     ']),
    );
    // The doorway is the open column at grid x = 4; walk north through it.
    run(player, 3, 0, -1);
    expect(player.position.y).toBeLessThan(4);
  });

  it('runs the health pool on the same tick as movement (§3.4, §7)', () => {
    const player = new Player(spawnAt(9, 9), openField());
    player.health.damage();
    run(player, 8, 1, 0);

    expect(player.health.regenerating).toBe(true);
    expect(player.health.value).toBeGreaterThan(0.66);
  });

  it('interpolates the mesh between ticks without moving the simulation (§7)', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 0.5, 1, 0);
    const simX = player.position.x;

    player.render(0);
    const atTickStart = player.object.position.x;
    player.render(1);

    expect(atTickStart).toBeLessThan(simX);
    expect(player.object.position.x).toBeCloseTo(simX);
    expect(player.position.x).toBe(simX);
  });
});

describe('sprint (§3.1)', () => {
  it('runs at sprint speed while it is held', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 1.5, 1, 0, true);

    expect(player.sprinting).toBe(true);
    expect(player.speed).toBeCloseTo(PLAYER.sprintSpeed, 1);
    expect(PLAYER.sprintSpeed).toBeGreaterThan(PLAYER.walkSpeed);
  });

  it('drops back to a walk the moment it is released', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 1.5, 1, 0, true);
    run(player, 1.5, 1, 0, false);

    expect(player.sprinting).toBe(false);
    expect(player.speed).toBeCloseTo(PLAYER.walkSpeed, 1);
  });

  it('does nothing when the player is not moving — there is no sprint in place', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 1, 0, 0, true);

    expect(player.sprinting).toBe(false);
    expect(player.speed).toBeLessThan(0.05);
  });

  it('does not sprint on a barely-touched stick', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 1, 0.2, 0, true);

    expect(player.sprinting).toBe(false);
    // Still walking at its share of walk speed, not of sprint speed.
    expect(player.speed).toBeCloseTo(PLAYER.walkSpeed * 0.2, 1);
  });

  it('turns the aim onto the direction of travel, which is the price of the speed', () => {
    const player = new Player(spawnAt(9, 9, 90), openField()); // facing east
    expect(player.aim.x).toBeCloseTo(1);

    // Sprint north: the beam has to come round with the player.
    run(player, 0.5, 0, -1, true);
    expect(player.aim.y).toBeCloseTo(-1, 1);
    expect(Math.abs(player.aim.x)).toBeLessThan(0.1);
  });

  it('turns at the specified rate rather than snapping (§3.1)', () => {
    const player = new Player(spawnAt(9, 9, 90), openField()); // facing east
    // One tick of a 540°/s turn is 9°, so the beam has barely moved off east.
    player.tick(TICK, 0, -1, true);

    const turned = Math.abs(THREE.MathUtils.radToDeg(Math.atan2(player.aim.x, player.aim.y)) - 90);
    expect(turned).toBeGreaterThan(PLAYER.aimTurnDegreesPerSecond * TICK * 0.8);
    expect(turned).toBeLessThan(PLAYER.aimTurnDegreesPerSecond * TICK * 1.2);
  });

  it('takes a third of a second to reverse, and no longer', () => {
    const player = new Player(spawnAt(9, 9, 90), openField());
    // East to west is 180°; at 540°/s that is a third of a second.
    run(player, 0.34, -1, 0, true);
    expect(player.aim.x).toBeCloseTo(-1, 1);
  });

  it('turns back onto the pointer after a sprint instead of whipping round', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 0.5, 1, 0, true); // sprinting east, aim locked east
    expect(player.aim.x).toBeCloseTo(1);

    // Release with the cursor behind: the beam sweeps back rather than cutting.
    player.tick(TICK, 0, 0, false);
    player.aimTowards(-1, 0);
    player.tick(TICK, 0, 0, false);
    expect(player.aim.x).toBeGreaterThan(0.9);

    // ...and gets there under its own steam.
    for (let i = 0; i < 30; i += 1) {
      player.aimTowards(-1, 0);
      player.tick(TICK, 0, 0, false);
    }
    expect(player.aim.x).toBeCloseTo(-1, 1);
  });

  it('goes back to direct aiming once the turn has caught up', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 0.5, 1, 0, true);
    for (let i = 0; i < 60; i += 1) {
      player.aimTowards(1, 0);
      player.tick(TICK, 0, 0, false);
    }

    // Caught up: aiming is immediate again, with no lag between cursor and beam.
    player.aimTowards(0, -1);
    expect(player.aim.y).toBeCloseTo(-1);
  });

  it('refuses pointer and stick aim while sprinting (§3.1)', () => {
    const player = new Player(spawnAt(9, 9), openField());
    run(player, 0.5, 1, 0, true);
    const locked = player.aim.clone();

    // Both aim paths are ignored: the lock is not a suggestion.
    player.aimAt(9, 0);
    player.aimTowards(0, -1);
    expect(player.aim.x).toBeCloseTo(locked.x);
    expect(player.aim.y).toBeCloseTo(locked.y);

    // Released, aim answers again — by turning towards the request rather than jumping to
    // it (§3.1), and arriving under its own steam.
    player.tick(TICK, 0, 0, false);
    player.aimTowards(0, -1);
    player.tick(TICK, 0, 0, false);
    expect(player.aim.y).toBeLessThan(0);
    expect(player.aim.y).toBeGreaterThan(-0.9);

    for (let i = 0; i < 30; i += 1) {
      player.aimTowards(0, -1);
      player.tick(TICK, 0, 0, false);
    }
    expect(player.aim.y).toBeCloseTo(-1, 1);
  });

  it('outruns everything on the map, and a walk outruns everything but a fleeing spider (§5)', () => {
    // The interlock §5 depends on: speed is never what makes an enemy dangerous.
    expect(PLAYER.sprintSpeed).toBeGreaterThan(ENEMY.spider.fleeSpeed);
    expect(PLAYER.walkSpeed).toBeGreaterThan(ENEMY.spider.pursueSpeed);
    expect(PLAYER.walkSpeed).toBeGreaterThan(ENEMY.shadowMonster.pursueSpeed);
    expect(ENEMY.spider.fleeSpeed).toBeGreaterThan(PLAYER.walkSpeed);
  });

  it('keeps §5\'s ratios through a tuning pass', () => {
    // §5 states these as design, not as consequences of six numbers that happen to be
    // where they are — so a pass that rescales the game has to keep them (§5, Phase 11).
    expect(ENEMY.shadowMonster.pursueSpeed / PLAYER.walkSpeed).toBeCloseTo(0.6, 5);
    expect(ENEMY.spider.fleeSpeed).toBeCloseTo(ENEMY.spider.pursueSpeed * 1.5, 5);
    // The monster ambles faster than a spider does, which is how it closes on a player who
    // has stopped to read (§5.2).
    expect(ENEMY.shadowMonster.wanderSpeed).toBeGreaterThan(ENEMY.spider.wanderSpeed);
  });
});

describe('knockback and damage (§5.3)', () => {
  it('shoves the player directly away from the spider that hit them', () => {
    const player = new Player(spawnAt(9, 9, 0), openField());
    // Spider due south: the shove is due north, a metre of it.
    player.knockBack(9, 10, ENEMY.spider.attack.playerKnockback);

    expect(player.position.x).toBeCloseTo(9);
    expect(player.position.y).toBeCloseTo(9 - ENEMY.spider.attack.playerKnockback);
  });

  it('resolves the shove against geometry rather than through it', () => {
    // A wall along the north edge; the player is pressed up against it already.
    const index = indexFrom([
      '##########',
      '          ',
      '          ',
      '          ',
      '          ',
    ]);
    const player = new Player(spawnAt(9, 2.5, 0), index);
    player.knockBack(9, 6, 3);

    // Pushed north, but stopped at the wall's face rather than posted through it.
    expect(player.position.y).toBeGreaterThanOrEqual(2 + PLAYER.radius - 1e-6);
  });

  it('leaves velocity alone: it is a knockback, not a stagger (§5.3)', () => {
    const player = new Player(spawnAt(9, 9, 0), openField());
    run(player, 1, 1, 0);
    const speed = player.speed;
    expect(speed).toBeGreaterThan(1);

    player.knockBack(9, 10, 1);
    expect(player.speed).toBeCloseTo(speed, 6);
  });

  it('deducts through the pool, and reports the deduction that kills', () => {
    const player = new Player(spawnAt(9, 9, 0), openField());
    expect(player.damage(0.34)).toBe(false);
    expect(player.damage(0.34)).toBe(false);
    expect(player.damage(0.34)).toBe(true);
    expect(player.health.dead).toBe(true);
  });
});

describe('being visible in the dark without lighting anything (§4)', () => {
  /** Every standard material on the player's body, art or placeholder. */
  function materials(player: Player): THREE.MeshStandardMaterial[] {
    const found: THREE.MeshStandardMaterial[] = [];
    player.object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of [node.material].flat()) {
        if (material instanceof THREE.MeshStandardMaterial) found.push(material);
      }
    });
    return found;
  }

  it('lifts each surface by a fraction of its own colour, not by a colour of its own', () => {
    // A flat emissive is the same grey wherever it lands, and at §4's ambient it is most of
    // what an unlit body is: a red shirt, bare arms and black shorts all come out one pale
    // blue-grey. Scaling their own colours is what a very dim light on them would do.
    const player = new Player(spawnAt(9, 9, 0), openField());
    const found = materials(player);
    expect(found.length).toBeGreaterThan(0);

    for (const material of found) {
      const expected = material.color.clone().multiplyScalar(PLAYER.readabilityLift);
      expect(material.emissive.r).toBeCloseTo(expected.r, 6);
      expect(material.emissive.g).toBeCloseTo(expected.g, 6);
      expect(material.emissive.b).toBeCloseTo(expected.b, 6);
    }
  });

  it('keeps a hue rather than washing it out', () => {
    const player = new Player(spawnAt(9, 9, 0), openField());
    const material = materials(player)[0]!;
    material.color.setRGB(0.8, 0.1, 0.1);
    player.lift();

    // The red stays red: that is the whole difference from the wash it replaced.
    expect(material.emissive.r).toBeGreaterThan(material.emissive.g * 4);
    expect(material.emissive.b).toBeCloseTo(material.emissive.g, 6);
  });

  it('re-reads the fraction, so the debug tuner can move it (§8.3)', () => {
    const player = new Player(spawnAt(9, 9, 0), openField());
    const material = materials(player)[0]!;
    const before = material.emissive.clone();

    const original = PLAYER.readabilityLift;
    try {
      (PLAYER as unknown as { readabilityLift: number }).readabilityLift = original * 2;
      player.lift();
      expect(material.emissive.r).toBeCloseTo(before.r * 2, 6);
    } finally {
      (PLAYER as unknown as { readabilityLift: number }).readabilityLift = original;
    }
  });
});
