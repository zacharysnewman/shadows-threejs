/**
 * Validation and parsing for `map.json` / `tileset.json` (§2).
 *
 * Two failure classes, deliberately different:
 *  - **Fatal** — the file is structurally unusable (bad dimensions, wrong `data` length,
 *    no player spawn). Every fatal issue found is collected and reported together, so a
 *    broken export is fixed in one pass rather than one message at a time.
 *  - **Warning** — the map still loads: unknown entity types, unknown tile ids, and
 *    missing optional properties. §2 requires an unknown entity type to log and skip so
 *    an older build can still open a newer map.
 */

import { ENTITY_DEFAULTS, MAP_LIMITS } from '../config';
import {
  ENTITY_TYPES,
  type EntityBase,
  type EntityType,
  type GameMap,
  type MapEntity,
  type MapLayer,
  type RawMapEntity,
  type RawMapFile,
  type RawTilesetFile,
  type RawTilesetTile,
  type SwitchMode,
  type Tileset,
  type TilesetTile,
} from './types';

export class MapValidationError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`${source}: ${issues.length} validation error(s)\n  - ${issues.join('\n  - ')}`);
    this.name = 'MapValidationError';
    this.issues = issues;
  }
}

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set<string>(ENTITY_TYPES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

// ---------------------------------------------------------------------------
// tileset.json
// ---------------------------------------------------------------------------

export function parseTileset(raw: RawTilesetFile | unknown, source = 'tileset.json'): Tileset {
  const issues: string[] = [];

  if (!isPlainObject(raw)) {
    throw new MapValidationError(source, ['root must be an object']);
  }

  const tiles = new Map<number, TilesetTile>();
  const rawTiles = (raw as RawTilesetFile).tiles;

  if (!isPlainObject(rawTiles)) {
    issues.push('`tiles` must be an object keyed by tile id');
  } else {
    for (const [key, value] of Object.entries(rawTiles)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0) {
        issues.push(`tile key "${key}" is not a non-negative integer`);
        continue;
      }
      if (!isPlainObject(value)) {
        issues.push(`tile ${id}: definition must be an object`);
        continue;
      }
      const tile = value as RawTilesetTile;
      const prefab = tile.prefab;
      if (prefab !== null && prefab !== undefined && typeof prefab !== 'string') {
        issues.push(`tile ${id}: \`prefab\` must be a string or null`);
        continue;
      }
      if (tile.solid !== undefined && typeof tile.solid !== 'boolean') {
        issues.push(`tile ${id}: \`solid\` must be a boolean`);
        continue;
      }
      tiles.set(id, {
        prefab: typeof prefab === 'string' ? prefab : null,
        solid: tile.solid === true,
      });
    }
  }

  // Tile id 0 is the universal "nothing here" id; §2's example tileset declares it and
  // the walkability rule in §2 depends on it meaning empty. Supply it if a map omits it.
  if (!tiles.has(0)) {
    tiles.set(0, { prefab: null, solid: false });
  }

  if (issues.length > 0) throw new MapValidationError(source, issues);

  return {
    tiles,
    get: (id) => tiles.get(id),
  };
}

// ---------------------------------------------------------------------------
// map.json
// ---------------------------------------------------------------------------

export function parseMap(raw: RawMapFile | unknown, tileset: Tileset, source = 'map.json'): GameMap {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(raw)) {
    throw new MapValidationError(source, ['root must be an object']);
  }
  const file = raw as RawMapFile;

  const width = file.width;
  const height = file.height;
  if (!isInteger(width) || width <= 0 || width > MAP_LIMITS.maxWidth) {
    issues.push(`\`width\` must be an integer in 1..${MAP_LIMITS.maxWidth} (got ${String(width)})`);
  }
  if (!isInteger(height) || height <= 0 || height > MAP_LIMITS.maxHeight) {
    issues.push(
      `\`height\` must be an integer in 1..${MAP_LIMITS.maxHeight} (got ${String(height)})`,
    );
  }

  const tileSize = file.tileSize;
  if (typeof tileSize !== 'number' || !Number.isFinite(tileSize) || tileSize <= 0) {
    issues.push(`\`tileSize\` must be a positive number (got ${String(tileSize)})`);
  }

  // Dimensions gate everything below, so stop here if they are unusable.
  if (issues.length > 0) throw new MapValidationError(source, issues);

  const w = width as number;
  const h = height as number;
  const expected = w * h;

  const layers: MapLayer[] = [];
  if (!Array.isArray(file.layers) || file.layers.length === 0) {
    issues.push('`layers` must be a non-empty array');
  } else {
    file.layers.forEach((rawLayer, i) => {
      if (!isPlainObject(rawLayer)) {
        issues.push(`layer ${i}: must be an object`);
        return;
      }
      const name = typeof rawLayer['name'] === 'string' ? (rawLayer['name'] as string) : `Layer${i}`;
      const data = rawLayer['data'];
      if (!Array.isArray(data)) {
        issues.push(`layer ${i} ("${name}"): \`data\` must be an array`);
        return;
      }
      if (data.length !== expected) {
        issues.push(
          `layer ${i} ("${name}"): \`data\` has ${data.length} entries, expected ${expected} (${w}×${h})`,
        );
        return;
      }
      const typed = new Int32Array(expected);
      let badCells = 0;
      const unknownIds = new Set<number>();
      for (let idx = 0; idx < expected; idx += 1) {
        const cell = data[idx];
        if (!isInteger(cell) || cell < 0) {
          badCells += 1;
          typed[idx] = 0;
          continue;
        }
        if (!tileset.get(cell)) unknownIds.add(cell);
        typed[idx] = cell;
      }
      if (badCells > 0) {
        issues.push(
          `layer ${i} ("${name}"): ${badCells} cell(s) are not non-negative integers`,
        );
        return;
      }
      if (unknownIds.size > 0) {
        // Non-fatal by the same reasoning as unknown entity types: a newer map opened by
        // an older tileset should render what it can rather than refuse the file.
        warnings.push(
          `layer ${i} ("${name}"): tile id(s) ${[...unknownIds].sort((a, b) => a - b).join(', ')} are not in the tileset; treated as empty`,
        );
      }
      layers.push({ name, data: typed });
    });
  }

  if (layers.length <= MAP_LIMITS.floorLayerIndex) {
    issues.push(`missing floor layer (index ${MAP_LIMITS.floorLayerIndex})`);
  }
  if (layers.length <= MAP_LIMITS.obstacleLayerIndex) {
    warnings.push(
      `no obstacle layer (index ${MAP_LIMITS.obstacleLayerIndex}); the map has no colliders`,
    );
  }

  if (issues.length > 0) throw new MapValidationError(source, issues);

  const entities = parseEntities(file.entities, {
    width: w,
    height: h,
    tileSize: tileSize as number,
    issues,
    warnings,
  });

  const spawnCount = entities.filter((e) => e.type === 'PlayerSpawn').length;
  if (spawnCount !== 1) {
    // §2: "Exactly one required per map." Without it there is nothing to spawn against,
    // so this is fatal rather than a warning.
    issues.push(`expected exactly one PlayerSpawn entity, found ${spawnCount}`);
  }

  if (issues.length > 0) throw new MapValidationError(source, issues);

  return { width: w, height: h, tileSize: tileSize as number, layers, entities, warnings };
}

interface EntityParseContext {
  width: number;
  height: number;
  tileSize: number;
  issues: string[];
  warnings: string[];
}

function parseEntities(raw: unknown, ctx: EntityParseContext): MapEntity[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.issues.push('`entities` must be an array');
    return [];
  }

  const out: MapEntity[] = [];
  const ordinals = new Map<string, number>();

  raw.forEach((value, index) => {
    if (!isPlainObject(value)) {
      ctx.warnings.push(`entity ${index}: not an object; skipped`);
      return;
    }
    const rawEntity = value as RawMapEntity;
    const type = rawEntity.type;

    if (typeof type !== 'string' || !ENTITY_TYPE_SET.has(type)) {
      // §2 — unknown types log and skip so an older build can open a newer map.
      ctx.warnings.push(`entity ${index}: unknown type "${String(type)}"; skipped`);
      return;
    }

    const gx = rawEntity.x;
    const gy = rawEntity.y;
    if (!isInteger(gx) || !isInteger(gy)) {
      ctx.warnings.push(`entity ${index} (${type}): \`x\`/\`y\` must be integers; skipped`);
      return;
    }
    if (gx < 0 || gx >= ctx.width || gy < 0 || gy >= ctx.height) {
      ctx.warnings.push(
        `entity ${index} (${type}): position (${gx}, ${gy}) is outside the ${ctx.width}×${ctx.height} map; skipped`,
      );
      return;
    }

    const props = isPlainObject(rawEntity.properties) ? rawEntity.properties : {};
    if (rawEntity.properties !== undefined && !isPlainObject(rawEntity.properties)) {
      ctx.warnings.push(`entity ${index} (${type}): \`properties\` is not an object; using defaults`);
    }

    const ordinalKey = `${type}@${gx},${gy}`;
    const ordinal = ordinals.get(ordinalKey) ?? 0;
    ordinals.set(ordinalKey, ordinal + 1);

    const base = {
      key: `${ordinalKey}#${ordinal}`,
      index,
      gx,
      gy,
      // §2 — grid → world, offset to the tile centre.
      wx: (gx + 0.5) * ctx.tileSize,
      wz: (gy + 0.5) * ctx.tileSize,
    };

    const entity = buildEntity(type as EntityType, base, props, index, ctx);
    if (entity) out.push(entity);
  });

  return out;
}

function buildEntity(
  type: EntityType,
  base: EntityBase,
  props: Record<string, unknown>,
  index: number,
  ctx: EntityParseContext,
): MapEntity | null {
  const warn = (message: string) => ctx.warnings.push(`entity ${index} (${type}): ${message}`);

  const str = (name: string): string | null => {
    const value = props[name];
    if (typeof value === 'string' && value.length > 0) return value;
    warn(`missing required string property \`${name}\`; skipped`);
    return null;
  };

  const num = (name: string, fallback: number): number => {
    const value = props[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value !== undefined) warn(`\`${name}\` is not a finite number; using ${fallback}`);
    return fallback;
  };

  const bool = (name: string, fallback: boolean): boolean => {
    const value = props[name];
    if (typeof value === 'boolean') return value;
    if (value !== undefined) warn(`\`${name}\` is not a boolean; using ${fallback}`);
    return fallback;
  };

  switch (type) {
    case 'PlayerSpawn':
      return { ...base, type, rotation: num('rotation', ENTITY_DEFAULTS.playerSpawnRotation) };

    case 'Flashlight':
      return { ...base, type };

    case 'Note': {
      const noteId = str('noteId');
      return noteId === null ? null : { ...base, type, noteId };
    }

    case 'PowerSwitch': {
      const targetId = str('targetId');
      if (targetId === null) return null;
      const rawMode = props['mode'];
      let mode: SwitchMode = ENTITY_DEFAULTS.switchMode;
      if (rawMode === 'toggle' || rawMode === 'latch') {
        mode = rawMode;
      } else if (rawMode !== undefined) {
        warn(`\`mode\` must be "toggle" or "latch"; using "${mode}"`);
      }
      return { ...base, type, targetId, mode };
    }

    case 'EnvironmentLight': {
      const groupId = str('groupId');
      if (groupId === null) return null;
      return {
        ...base,
        type,
        groupId,
        radius: num('radius', ENTITY_DEFAULTS.environmentLightRadius),
        intensity: num('intensity', ENTITY_DEFAULTS.environmentLightIntensity),
      };
    }

    case 'Gate': {
      const id = str('id');
      const targetId = str('targetId');
      if (id === null || targetId === null) return null;
      return { ...base, type, id, targetId, locked: bool('locked', ENTITY_DEFAULTS.gateLocked) };
    }

    case 'ExitGate': {
      const id = str('id');
      if (id === null) return null;
      const required = Math.max(
        0,
        Math.round(num('requiredSwitches', ENTITY_DEFAULTS.exitRequiredSwitches)),
      );
      return {
        ...base,
        type,
        id,
        locked: bool('locked', ENTITY_DEFAULTS.gateLocked),
        requiredSwitches: required,
      };
    }

    case 'SpiderEnemy':
    case 'ShadowMonster':
      return { ...base, type };
  }
}
