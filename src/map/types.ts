/**
 * Data shapes for the map pipeline (§2).
 *
 * `Raw*` types describe the on-disk JSON exactly as an editor exports it — every field
 * optional-or-unknown, because the file is untrusted input. The validator in
 * `validate.ts` is the only thing allowed to turn a `Raw*` into the checked types below.
 */

// ---------------------------------------------------------------------------
// On-disk shapes (untrusted)
// ---------------------------------------------------------------------------

export interface RawMapLayer {
  name?: unknown;
  data?: unknown;
}

export interface RawMapEntity {
  type?: unknown;
  x?: unknown;
  y?: unknown;
  properties?: unknown;
}

export interface RawMapFile {
  width?: unknown;
  height?: unknown;
  tileSize?: unknown;
  layers?: unknown;
  entities?: unknown;
}

export interface RawTilesetTile {
  prefab?: unknown;
  solid?: unknown;
}

export interface RawTilesetFile {
  tiles?: unknown;
}

// ---------------------------------------------------------------------------
// Checked shapes
// ---------------------------------------------------------------------------

export interface TilesetTile {
  /** `.glb` prefab name in the asset bundle; `null` renders nothing (§2). */
  prefab: string | null;
  /** Layer 1 solidity: blocks movement and walkability (§2, §3.1). */
  solid: boolean;
}

export interface Tileset {
  /** Tile id → definition. Ids are the integers appearing in layer `data` arrays. */
  tiles: ReadonlyMap<number, TilesetTile>;
  get(id: number): TilesetTile | undefined;
}

export interface MapLayer {
  name: string;
  /** Row-major, length `width × height`; index `i` is tile `(i % width, ⌊i / width⌋)`. */
  data: Int32Array;
}

/** Every entity `type` the loader accepts (§2, Entity Type Reference). */
export const ENTITY_TYPES = [
  'PlayerSpawn',
  'Flashlight',
  'Note',
  'PowerSwitch',
  'EnvironmentLight',
  'Landmark',
  'Gate',
  'ExitGate',
  'SpiderEnemy',
  'ShadowMonster',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type SwitchMode = 'toggle' | 'latch';

/** Fields every parsed entity carries, whatever its type. */
export interface EntityBase {
  /** Stable identity for this record within the run: `${type}@${x},${y}#${ordinal}`. */
  key: string;
  /** Index into the map file's `entities` array, for diagnostics. */
  index: number;
  /** Grid coordinates as authored (§2). */
  gx: number;
  gy: number;
  /** World-space tile centre, y = 0 (§2). */
  wx: number;
  wz: number;
}

export interface PlayerSpawnEntity extends EntityBase {
  type: 'PlayerSpawn';
  /** Facing in degrees (§2). */
  rotation: number;
}

export interface FlashlightEntity extends EntityBase {
  type: 'Flashlight';
}

export interface NoteEntity extends EntityBase {
  type: 'Note';
  /** Key into `notes.json` (§6). */
  noteId: string;
}

export interface PowerSwitchEntity extends EntityBase {
  type: 'PowerSwitch';
  /** Names a light group or gate (§2, §6). */
  targetId: string;
  mode: SwitchMode;
}

export interface EnvironmentLightEntity extends EntityBase {
  type: 'EnvironmentLight';
  groupId: string;
  /** Ground pool radius in metres (§4.2). */
  radius: number;
  intensity: number;
}

/**
 * §2 — decoration you navigate by: one model of any size at any angle.
 *
 * The entity carries the prefab name rather than a tile id because that is the whole point
 * of the tier — a tile is 2 m and has no rotation, and a landmark is neither.
 */
export interface LandmarkEntity extends EntityBase {
  type: 'Landmark';
  /** `.glb` prefab name, as in a tileset entry (§2). */
  prefab: string;
  /** Degrees clockwise from north (§2's convention). */
  rotation: number;
}

export interface GateEntity extends EntityBase {
  type: 'Gate';
  id: string;
  targetId: string;
  locked: boolean;
}

export interface ExitGateEntity extends EntityBase {
  type: 'ExitGate';
  id: string;
  locked: boolean;
  /** Distinct `latch` switches required to unlock (§6). */
  requiredSwitches: number;
}

export interface SpiderEnemyEntity extends EntityBase {
  type: 'SpiderEnemy';
}

export interface ShadowMonsterEntity extends EntityBase {
  type: 'ShadowMonster';
}

export type MapEntity =
  | PlayerSpawnEntity
  | FlashlightEntity
  | NoteEntity
  | PowerSwitchEntity
  | EnvironmentLightEntity
  | LandmarkEntity
  | GateEntity
  | ExitGateEntity
  | SpiderEnemyEntity
  | ShadowMonsterEntity;

/** Narrow `MapEntity` to one variant by its `type` tag. */
export type EntityOfType<T extends EntityType> = Extract<MapEntity, { type: T }>;

export interface GameMap {
  width: number;
  height: number;
  tileSize: number;
  layers: MapLayer[];
  entities: MapEntity[];
  /** Non-fatal problems: unknown entity types, unknown tile ids, coerced properties. */
  warnings: string[];
}

/**
 * What a collider is standing in for. Both block movement identically; they are
 * distinguished so the debug overlay can draw them apart and so a later phase can treat
 * them differently if it ever needs to (a gap is a hole, not a surface to hug).
 */
export type ColliderKind = 'obstacle' | 'gap';

/** Axis-aligned box collider generated from Layer 1, or from a hole in Layer 0 (§2, §3.1). */
export interface BoxCollider {
  kind: ColliderKind;
  /** Centre in world space. */
  cx: number;
  cz: number;
  /** Half-extents in world space. */
  hx: number;
  hz: number;
  /** Height in metres, for debug rendering and future capsule resolution. */
  height: number;
  /** Grid rectangle this collider covers, inclusive. */
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
}
