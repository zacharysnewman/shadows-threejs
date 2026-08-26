/**
 * The checked-in maps are data, and data rots. These load them through the real validator
 * so a bad hand-edit fails here rather than as a blank canvas in the browser.
 */

import { readFileSync } from 'node:fs';
import { ENEMY, RENDER } from '../src/config';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildColliders, buildFloorGapColliders } from '../src/map/colliders';
import { EntityRegistry } from '../src/map/EntityRegistry';
import { parseMap, parseTileset } from '../src/map/validate';
import { WalkabilityGrid } from '../src/map/WalkabilityGrid';
import { findPath } from '../src/nav/AStar';

function load(name: string) {
  const dir = resolve(__dirname, '../public/maps', name);
  const tileset = parseTileset(JSON.parse(readFileSync(resolve(dir, 'tileset.json'), 'utf8')));
  const map = parseMap(JSON.parse(readFileSync(resolve(dir, 'map.json'), 'utf8')), tileset);
  return { map, tileset, grid: new WalkabilityGrid(map, tileset), entities: new EntityRegistry(map.entities) };
}

describe('maps/example', () => {
  const { map, tileset, grid, entities } = load('example');

  it('loads clean, with no warnings', () => {
    expect(map.warnings).toEqual([]);
    expect(map.width).toBe(50);
    expect(map.height).toBe(50);
  });

  it('spawns the player, both enemy types and the exit', () => {
    expect(entities.byType('PlayerSpawn')).toHaveLength(1);
    expect(entities.byType('SpiderEnemy').length).toBeGreaterThan(0);
    expect(entities.byType('ShadowMonster').length).toBeGreaterThan(0);
    expect(entities.byType('ExitGate')).toHaveLength(1);
  });

  it('has enough latch switches to satisfy the exit gate (§6)', () => {
    const exit = entities.byType('ExitGate')[0]!;
    const latches = entities.switchesTargeting(exit.id).filter((s) => s.mode === 'latch');
    expect(latches.length).toBeGreaterThanOrEqual(exit.requiredSwitches);
  });

  it('groups its environmental lights so a switch has something to act on (§2)', () => {
    for (const sw of entities.byType('PowerSwitch').filter((s) => s.mode === 'toggle')) {
      expect(entities.lightsInGroup(sw.targetId).length).toBeGreaterThan(0);
    }
  });

  it('spawns everything that has to stand somewhere on walkable ground', () => {
    for (const entity of [
      ...entities.byType('PlayerSpawn'),
      ...entities.byType('SpiderEnemy'),
      ...entities.byType('ShadowMonster'),
    ]) {
      expect(grid.isWalkable(entity.gx, entity.gy)).toBe(true);
    }
  });

  it('is sealed by its perimeter fence, not by a wall at the map edge', () => {
    // The map used to be walled all the way round. It is not any more: the fence stands a
    // few tiles in, the ground beyond it is walkable, and the map's own edge is what holds
    // the player (§2, §3.2) — with the forest outside it doing the looking (§2's surround).
    const solid = (gx: number, gy: number) => !grid.isWalkable(gx, gy);

    // A continuous fence line, save for the one gate set into it.
    const fenceRow = Array.from({ length: map.width }, (_, x) => x).filter((x) => solid(x, 3));
    expect(fenceRow.length).toBeGreaterThan(map.width - 8);

    // And ground on the far side of it, which is where the exit is.
    const exit = entities.byType('ExitGate')[0]!;
    expect(exit.gy).toBeGreaterThan(map.height - 4);
    // The exit stands on a gate tile, so it is solid until the power routes (§6.5) — while
    // the ground it opens onto is walkable, which is how the player gets to stand there.
    expect(grid.isWalkable(exit.gx, exit.gy)).toBe(false);
    expect(grid.isWalkable(exit.gx, exit.gy - 1)).toBe(true);
  });

  it('stands the exit on a gate tile rather than on open floor (§6.5)', () => {
    // The bug this catches shipped here for several phases: the entity sat on plain floor,
    // so the exit was walkable from the first second and the run could be won by strolling
    // onto it with nothing routed.
    const exit = entities.byType('ExitGate')[0]!;
    const tileId = map.layers[1]!.data[exit.gy * map.width + exit.gx]!;
    expect(tileset.get(tileId)?.solid).toBe(true);
  });

  it('puts the only way through the fence where the exit is (§6)', () => {
    // The gate is in the fence line and the exit is straight out through it: opening the
    // one is what reaches the other, which is what the run's last objective is.
    const gate = entities.byType('Gate')[0]!;
    const exit = entities.byType('ExitGate')[0]!;
    expect(gate.gx).toBe(exit.gx);
    expect(gate.gy).toBeLessThan(exit.gy);
  });

  it('scatters a forest without standing a tree on anything (§2)', () => {
    const trees = entities.byType('Landmark');
    expect(trees.length).toBeGreaterThan(20);
    // Every tree on ground that was walkable before the trees themselves were placed: a
    // tree in a doorway or on a switch is a soft-locked level, and the audit that would
    // catch it runs over this map in `mapAudit.test.ts`.
    for (const tree of trees) {
      expect(map.layers[1]!.data[tree.gy * map.width + tree.gx]).toBe(0);
    }
  });

  it('merges its 2,500 tiles into far fewer colliders (§7)', () => {
    const colliders = buildColliders(map, tileset, () => 3);
    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.length).toBeLessThan(120);
  });
});

describe('maps/phase1-test', () => {
  const { map, entities } = load('phase1-test');

  it('loads despite its deliberate authoring errors', () => {
    expect(entities.byType('PlayerSpawn')).toHaveLength(1);
  });

  it('exercises every skip path the loader has to survive (§2)', () => {
    const warnings = map.warnings.join('\n');
    expect(warnings).toContain('unknown type "TeleportPad"');
    expect(warnings).toContain('missing required string property `noteId`');
    expect(warnings).toContain('outside the 12×8 map');
    expect(warnings).toContain('tile id(s) 9');
  });

  it('defaults an omitted switch mode to toggle', () => {
    const sw = entities.byType('PowerSwitch').find((s) => s.gx === 3 && s.gy === 5)!;
    expect(sw.mode).toBe('toggle');
  });
});

describe('maps/phase2-test', () => {
  const { map, tileset, grid, entities } = load('phase2-test');

  it('loads clean, with no warnings', () => {
    expect(map.warnings).toEqual([]);
    expect(entities.byType('PlayerSpawn')).toHaveLength(1);
  });

  it('gives the player capsule the shapes it has to survive (§3.1)', () => {
    const colliders = buildColliders(map, tileset, () => 3);

    // The pillar staircase: five single-tile boxes on a diagonal, each unmerged, which is
    // the arrangement that catches a per-axis resolver.
    const pillars = colliders.filter((c) => c.gx0 === c.gx1 && c.gy0 === c.gy1);
    expect(pillars.length).toBeGreaterThanOrEqual(5);

    // A fence run at a different tile id to the brick, so the merge cannot swallow it.
    const fence = colliders.filter((c) => c.gy0 === 13 && c.gy1 === 13);
    expect(fence.length).toBeGreaterThanOrEqual(2);
  });

  it('has a hole in the floor for the player to be stopped by (§2, §3.1)', () => {
    const gaps = buildFloorGapColliders(map, tileset);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.kind).toBe('gap');
    expect(grid.isWalkable(gaps[0]!.gx0, gaps[0]!.gy0)).toBe(false);
  });

  it('keeps its doorways passable, so the map is one connected space', () => {
    // The two dividers each carry exactly one gap; without them the west room is a box.
    for (const x of [8, 16]) {
      const openings = [];
      for (let y = 1; y < map.height - 1; y += 1) if (grid.isWalkable(x, y)) openings.push(y);
      expect(openings).toHaveLength(1);
    }
  });

  it('puts walkable floor against every map edge, so every camera clamp is reachable', () => {
    expect(grid.isWalkable(1, 1)).toBe(true);
    expect(grid.isWalkable(map.width - 2, 1)).toBe(true);
    expect(grid.isWalkable(1, map.height - 2)).toBe(true);
    expect(grid.isWalkable(map.width - 2, map.height - 2)).toBe(true);
  });
});

describe('maps/phase3-test', () => {
  const { map, grid, entities } = load('phase3-test');

  it('loads clean, with no warnings', () => {
    expect(map.warnings).toEqual([]);
    expect(entities.byType('PlayerSpawn')).toHaveLength(1);
  });

  it('has more lit lamps than §7 has shadow slots, so the budget has to choose', () => {
    const lamps = entities.byType('EnvironmentLight');
    expect(lamps.length).toBeGreaterThan(RENDER.maxShadowCastingEnvironmentLights);

    // In more than one group, so powering them is visibly per-group rather than global.
    const groups = new Set(lamps.map((l) => l.groupId));
    expect(groups.size).toBeGreaterThan(1);
  });

  it('gives every lamp group a switch for Phase 9 to find (§6)', () => {
    for (const lamp of entities.byType('EnvironmentLight')) {
      expect(entities.switchesTargeting(lamp.groupId).length).toBeGreaterThan(0);
    }
  });

  it('stands props in open ground for the beam to throw shadows from (§4.1)', () => {
    // Solid tiles with walkable floor on every side: a wall casts a shadow too, but only a
    // free-standing prop shows the shape of one.
    const walls = map.layers[1]!;
    let freeStanding = 0;
    for (let y = 1; y < map.height - 1; y += 1) {
      for (let x = 1; x < map.width - 1; x += 1) {
        if (walls.data[y * map.width + x] === 0) continue;
        const open =
          grid.isWalkable(x - 1, y) &&
          grid.isWalkable(x + 1, y) &&
          grid.isWalkable(x, y - 1) &&
          grid.isWalkable(x, y + 1);
        if (open) freeStanding += 1;
      }
    }
    expect(freeStanding).toBeGreaterThanOrEqual(8);
  });

  it('keeps one corridor no lamp reaches, where the beam is the only light', () => {
    const lamps = entities.byType('EnvironmentLight');
    // The corridor between the two dividers, walked north to south.
    for (let gy = 1; gy < map.height - 1; gy += 1) {
      const { wx, wz } = grid.gridToWorld(14, gy);
      const nearest = Math.min(...lamps.map((l) => Math.hypot(l.wx - wx, l.wz - wz) - l.radius));
      expect(nearest).toBeGreaterThan(0);
    }
  });
});

describe('maps/phase7-test', () => {
  const { map, grid, entities } = load('phase7-test');

  it('loads clean, and is a spiders-only map (§5.1, §5.3)', () => {
    expect(map.warnings).toEqual([]);
    expect(entities.byType('PlayerSpawn')).toHaveLength(1);
    expect(entities.byType('SpiderEnemy')).toHaveLength(4);
    // Phase 8's kill is not written; an invisible thing that always knows where you are is
    // not something to be debugging a spider next to.
    expect(entities.byType('ShadowMonster')).toHaveLength(0);
  });

  it('opens on a wander: every spider starts beyond its detect radius (§5)', () => {
    const spawn = entities.playerSpawn;
    for (const spider of entities.byType('SpiderEnemy')) {
      expect(Math.hypot(spider.wx - spawn.wx, spider.wz - spawn.wz)).toBeGreaterThan(
        ENEMY.spider.detectRadius,
      );
    }
  });

  it('gives the flee lane more clear ground than §5.1 will use', () => {
    // Straight north from the lane spider, walled either side the whole way.
    const spider = entities.byType('SpiderEnemy')[0]!;
    let clear = 0;
    for (let y = spider.gy - 1; y >= 0; y -= 1) {
      if (!grid.isWalkable(spider.gx, y)) break;
      expect(grid.isWalkable(2, y)).toBe(false);
      expect(grid.isWalkable(7, y)).toBe(false);
      clear += 1;
    }
    expect(clear * map.tileSize).toBeGreaterThan(ENEMY.spider.light.fleeSearchDistance);
  });

  it('puts a wall in one spider\'s way out, with open ground behind it', () => {
    // The search has to stop at row 9 rather than aiming through it at the yard beyond.
    const spider = entities.byType('SpiderEnemy')[1]!;
    expect(grid.isWalkable(spider.gx, spider.gy - 1)).toBe(true);
    expect(grid.isWalkable(spider.gx, spider.gy - 2)).toBe(false);
    expect(grid.isWalkable(spider.gx, spider.gy - 3)).toBe(true);
  });

  it('leaves the pocket a dead end, so its spider has nowhere to run (§5.1)', () => {
    const mouths = [];
    for (let x = 26; x <= 29; x += 1) {
      for (const y of [2, 5]) if (grid.isWalkable(x, y)) mouths.push([x, y]);
    }
    for (let y = 2; y <= 5; y += 1) {
      for (const x of [26, 29]) if (grid.isWalkable(x, y)) mouths.push([x, y]);
    }
    expect(mouths).toHaveLength(1);

    const spider = entities.byType('SpiderEnemy')[2]!;
    expect(grid.isWalkable(spider.gx, spider.gy)).toBe(true);
    // Its back is in the corner: north and east of it are both wall.
    expect(grid.isWalkable(spider.gx, spider.gy - 1)).toBe(false);
    expect(grid.isWalkable(spider.gx + 1, spider.gy)).toBe(false);
  });
});

describe('maps/phase8-test', () => {
  const { map, tileset, grid, entities } = load('phase8-test');

  it('loads clean, with both enemies on it for the comparison (§5.2)', () => {
    expect(map.warnings).toEqual([]);
    expect(entities.byType('ShadowMonster')).toHaveLength(2);
    expect(entities.byType('SpiderEnemy')).toHaveLength(2);
    expect(entities.byType('EnvironmentLight')).toHaveLength(2);
  });

  it('has a pit that light crosses and walking does not (§4.1, §3.1)', () => {
    const gaps = buildFloorGapColliders(map, tileset);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.kind).toBe('gap');
    // Unwalkable, so §5.2's blink march has to stop at its edge...
    expect(grid.isWalkable(16, 11)).toBe(false);
    // ...but not an obstacle, so §4.1's occlusion test lets the beam over it and the
    // monster on the far side is lit.
    expect(buildColliders(map, tileset, () => 3).some((c) => c.kind === 'gap')).toBe(false);
  });

  it('puts a monster across the pit from the yard, and one at the far corner', () => {
    // Picked by where they are rather than by entity order: the map file's order is not
    // something a reader of this test should have to know.
    const monsters = entities.byType('ShadowMonster');
    const acrossThePit = monsters.find((m) => m.gx > 12 && m.gx < 21)!;
    const farCorner = monsters.find((m) => m !== acrossThePit)!;

    expect(grid.isWalkable(acrossThePit.gx, acrossThePit.gy)).toBe(true);
    // North of the pit rows, with the yard and the hole between it and the player.
    expect(acrossThePit.gy).toBeLessThan(10);
    expect(farCorner.gx).toBeGreaterThan(map.width - 6);
    expect(farCorner.gy).toBeLessThan(4);
  });

  it('puts one lamp on the monster\'s route and one away from it (§4.2)', () => {
    const [route, control] = entities.byType('EnvironmentLight');
    expect(route!.groupId).not.toBe(control!.groupId);
    for (const light of [route, control]) {
      expect(grid.isWalkable(light!.gx, light!.gy)).toBe(true);
    }
    // The control is in the player's corner, the far side of the map from the spawn the
    // monster walks from — so a flicker there is never sabotage.
    const monsters = entities.byType('ShadowMonster');
    const farCorner = monsters.find((m) => m.gx > map.width - 6)!;
    expect(Math.hypot(control!.wx - farCorner.wx, control!.wz - farCorner.wz)).toBeGreaterThan(
      Math.hypot(route!.wx - farCorner.wx, route!.wz - farCorner.wz),
    );
  });

  it('leaves a route round both ends of the pit, so the map is one space', () => {
    // A path from the player's corner to the far monster exists at all.
    const spawn = entities.playerSpawn;
    for (const monster of entities.byType('ShadowMonster')) {
      expect(findPath(grid, spawn.gx, spawn.gy, monster.gx, monster.gy)).not.toBeNull();
    }
  });
});
