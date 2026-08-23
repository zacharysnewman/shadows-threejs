/**
 * The checked-in maps are data, and data rots. These load them through the real validator
 * so a bad hand-edit fails here rather than as a blank canvas in the browser.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildColliders } from '../src/map/colliders';
import { EntityRegistry } from '../src/map/EntityRegistry';
import { parseMap, parseTileset } from '../src/map/validate';
import { WalkabilityGrid } from '../src/map/WalkabilityGrid';

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

  it('is sealed by its boundary wall', () => {
    for (let x = 0; x < map.width; x += 1) {
      expect(grid.isWalkable(x, 0)).toBe(false);
      expect(grid.isWalkable(x, map.height - 1)).toBe(false);
    }
    for (let y = 0; y < map.height; y += 1) {
      expect(grid.isWalkable(0, y)).toBe(false);
      expect(grid.isWalkable(map.width - 1, y)).toBe(false);
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
