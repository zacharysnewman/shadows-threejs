/** Validator behaviour required by §2 and by Phase 1's exit criteria. */

import { describe, expect, it, vi } from 'vitest';
import { MapValidationError, parseMap, parseTileset } from '../src/map/validate';
import { ENTITY_DEFAULTS } from '../src/config';

const TILESET = {
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_grass', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
};

/** 3×3, floor everywhere, one solid wall in the middle. */
function minimalMap(overrides: Record<string, unknown> = {}) {
  return {
    width: 3,
    height: 3,
    tileSize: 2.0,
    layers: [
      { name: 'Floor', data: [1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { name: 'Walls', data: [0, 0, 0, 0, 2, 0, 0, 0, 0] },
    ],
    entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: { rotation: 90 } }],
    ...overrides,
  };
}

describe('parseTileset', () => {
  it('parses tile definitions and defaults `solid` to false', () => {
    const tileset = parseTileset({ tiles: { '1': { prefab: 'floor_grass' } } });
    expect(tileset.get(1)).toEqual({ prefab: 'floor_grass', solid: false });
  });

  it('supplies the empty tile 0 when a tileset omits it', () => {
    const tileset = parseTileset({ tiles: { '2': { prefab: 'wall_brick', solid: true } } });
    expect(tileset.get(0)).toEqual({ prefab: null, solid: false });
  });

  it('rejects a malformed tile definition', () => {
    expect(() => parseTileset({ tiles: { '1': { prefab: 7 } } })).toThrow(MapValidationError);
  });
});

describe('parseMap', () => {
  const tileset = parseTileset(TILESET);

  it('maps grid coordinates to tile centres in world space (§2)', () => {
    const map = parseMap(minimalMap(), tileset);
    const spawn = map.entities[0]!;
    expect(spawn.wx).toBe(1.0);
    expect(spawn.wz).toBe(1.0);
  });

  it('reports every structural error at once rather than the first', () => {
    let issues: readonly string[] = [];
    try {
      parseMap(minimalMap({ layers: [{ name: 'Floor', data: [1, 1] }, { name: 'Walls', data: [0] }] }), tileset);
    } catch (error) {
      issues = (error as MapValidationError).issues;
    }
    // Both layers are reported, not just the first one to fail.
    expect(issues.filter((i) => i.includes('expected 9'))).toHaveLength(2);
    expect(issues[0]).toContain('"Floor"');
    expect(issues[1]).toContain('"Walls"');
  });

  it('rejects a map without exactly one PlayerSpawn (§2)', () => {
    expect(() => parseMap(minimalMap({ entities: [] }), tileset)).toThrow(/exactly one PlayerSpawn/);
    const two = minimalMap({
      entities: [
        { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
        { type: 'PlayerSpawn', x: 1, y: 0, properties: {} },
      ],
    });
    expect(() => parseMap(two, tileset)).toThrow(/found 2/);
  });

  it('logs and skips an unknown entity type without throwing (§2)', () => {
    const map = parseMap(
      minimalMap({
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'TeleportPad', x: 1, y: 1, properties: {} },
        ],
      }),
      tileset,
    );
    expect(map.entities).toHaveLength(1);
    expect(map.warnings.join('\n')).toContain('unknown type "TeleportPad"');
  });

  it('skips an out-of-bounds entity with a warning', () => {
    const map = parseMap(
      minimalMap({
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'SpiderEnemy', x: 99, y: 0, properties: {} },
        ],
      }),
      tileset,
    );
    expect(map.entities).toHaveLength(1);
    expect(map.warnings.join('\n')).toContain('outside the 3×3 map');
  });

  it('skips an entity missing a required property', () => {
    const map = parseMap(
      minimalMap({
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'Note', x: 1, y: 1, properties: {} },
        ],
      }),
      tileset,
    );
    expect(map.entities).toHaveLength(1);
    expect(map.warnings.join('\n')).toContain('missing required string property `noteId`');
  });

  it('defaults omitted optional properties to the spec values', () => {
    const map = parseMap(
      minimalMap({
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'PowerSwitch', x: 1, y: 1, properties: { targetId: 'Group' } },
          { type: 'EnvironmentLight', x: 2, y: 2, properties: { groupId: 'Group' } },
        ],
      }),
      tileset,
    );
    const spawn = map.entities.find((e) => e.type === 'PlayerSpawn')!;
    const sw = map.entities.find((e) => e.type === 'PowerSwitch')!;
    const light = map.entities.find((e) => e.type === 'EnvironmentLight')!;
    expect(spawn.type === 'PlayerSpawn' && spawn.rotation).toBe(ENTITY_DEFAULTS.playerSpawnRotation);
    expect(sw.type === 'PowerSwitch' && sw.mode).toBe(ENTITY_DEFAULTS.switchMode);
    expect(light.type === 'EnvironmentLight' && light.radius).toBe(
      ENTITY_DEFAULTS.environmentLightRadius,
    );
  });

  it('warns but does not throw on a tile id the tileset does not define', () => {
    const map = parseMap(
      minimalMap({ layers: [{ name: 'Floor', data: [1, 1, 1, 1, 9, 1, 1, 1, 1] }, { name: 'Walls', data: new Array(9).fill(0) }] }),
      tileset,
    );
    expect(map.warnings.join('\n')).toContain('tile id(s) 9');
  });

  it('rejects a data array of the wrong length', () => {
    expect(() =>
      parseMap(minimalMap({ layers: [{ name: 'Floor', data: new Array(8).fill(1) }] }), tileset),
    ).toThrow(/expected 9/);
  });

  it('gives repeated entities on one tile distinct keys', () => {
    const map = parseMap(
      minimalMap({
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'SpiderEnemy', x: 2, y: 2, properties: {} },
          { type: 'SpiderEnemy', x: 2, y: 2, properties: {} },
        ],
      }),
      tileset,
    );
    const keys = map.entities.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('console noise', () => {
  it('does not log during parsing — callers decide how to surface warnings', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseMap(minimalMap(), parseTileset(TILESET));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
