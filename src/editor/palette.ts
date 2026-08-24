/**
 * What can be placed, and the rules about where (§9.1, §9.2).
 *
 * The tile ids are §2's, and they have to match the `tileset.json` a level ships beside —
 * so the palette is derived from a tileset rather than written out twice. The entity list
 * is §2's entity table, with the required properties the editor has to collect before it
 * will write one.
 */

import type { AuthoredEntity } from './Document';

export interface TileChoice {
  id: number;
  label: string;
  /** Swatch colour in the editor. Not the game's colour — a legibility choice. */
  colour: string;
  solid: boolean;
}

export interface EntityChoice {
  type: string;
  label: string;
  /** Single glyph drawn on the tile. Readable at thumb size, unlike a label. */
  glyph: string;
  colour: string;
  /** Properties §2 requires; the editor refuses to write one that is unset. */
  required: string[];
  /** Defaults filled in on placement, so a fresh entity is already valid where it can be. */
  defaults: Record<string, string | number>;
  /** §9.2 — mounts on a solid neighbour, and carries a `facing`. */
  mounts?: boolean;
  /** §9.2 — must face the camera, so its solid neighbour cannot be to the south. */
  mustBeVisible?: boolean;
  /** At most one of these on a map (§2). */
  unique?: boolean;
}

/** The floor layer's choices. `0` is a pit: light crosses it, walking does not (§2, §4.1). */
export const FLOOR_TILES: TileChoice[] = [
  { id: 0, label: 'Pit', colour: '#0b0d12', solid: false },
  { id: 1, label: 'Concrete', colour: '#5b6169', solid: false },
  { id: 4, label: 'Dirt', colour: '#6b5a44', solid: false },
];

export const OBSTACLE_TILES: TileChoice[] = [
  { id: 0, label: 'Clear', colour: '#141821', solid: false },
  { id: 2, label: 'Wall', colour: '#9aa3ae', solid: true },
  { id: 3, label: 'Fence', colour: '#7d8794', solid: true },
  { id: 5, label: 'Gate', colour: '#b08a4a', solid: true },
  { id: 6, label: 'Crate', colour: '#8a7355', solid: true },
];

export const ENTITIES: EntityChoice[] = [
  {
    type: 'PlayerSpawn',
    label: 'Spawn',
    glyph: '@',
    colour: '#7fc7ff',
    required: [],
    defaults: { rotation: 0 },
    unique: true,
  },
  { type: 'Flashlight', label: 'Torch', glyph: 'T', colour: '#f2e2b0', required: [], defaults: {} },
  {
    type: 'Note',
    label: 'Note',
    glyph: 'N',
    colour: '#d8d2c0',
    required: ['noteId'],
    defaults: { noteId: '', facing: 0 },
    mounts: true,
    mustBeVisible: true,
  },
  {
    type: 'PowerSwitch',
    label: 'Switch',
    glyph: 'S',
    colour: '#63d18a',
    required: ['targetId'],
    defaults: { targetId: '', mode: 'toggle', facing: 0 },
    mounts: true,
  },
  {
    type: 'EnvironmentLight',
    label: 'Lamp',
    glyph: 'L',
    colour: '#ffe9a8',
    required: ['groupId'],
    defaults: { groupId: '', radius: 6, intensity: 1 },
  },
  {
    type: 'Gate',
    label: 'Gate',
    glyph: 'G',
    colour: '#c79a52',
    required: ['id', 'targetId'],
    defaults: { id: '', targetId: '', locked: 'true' },
  },
  {
    type: 'ExitGate',
    label: 'Exit',
    glyph: 'X',
    colour: '#8ff0b4',
    required: ['id'],
    defaults: { id: 'MainExit', locked: 'true', requiredSwitches: 3 },
    unique: true,
  },
  { type: 'SpiderEnemy', label: 'Spider', glyph: 'sp', colour: '#c86a6a', required: [], defaults: {} },
  { type: 'ShadowMonster', label: 'Shade', glyph: 'Sh', colour: '#b38bd6', required: [], defaults: {} },
];

export function entityChoice(type: string): EntityChoice | undefined {
  return ENTITIES.find((choice) => choice.type === type);
}

/** North, east, south, west, in §2's clockwise-from-north order. */
export const DIRECTIONS = [
  { name: 'north', degrees: 0, dx: 0, dy: -1 },
  { name: 'east', degrees: 90, dx: 1, dy: 0 },
  { name: 'south', degrees: 180, dx: 0, dy: 1 },
  { name: 'west', degrees: 270, dx: -1, dy: 0 },
] as const;

/**
 * §9.2 — a note has to face the camera to be readable at all.
 *
 * The camera is pitched down with no yaw and sits on the `+Z` side of the player (§3.2), so
 * the only surfaces ever seen are the ones facing south. A note mounted on the *north* face
 * of a wall — that is, on a wall to the south of where you stand — is behind that wall from
 * every angle the game can be viewed from.
 *
 * `facing` is the direction the note points, so a readable note points south, east or west,
 * and its solid neighbour is correspondingly to its north, east or west.
 */
export function facingIsVisible(degrees: number): boolean {
  return normalise(degrees) !== 0;
}

/** Which way an entity at this tile should face, given where the solid neighbours are. */
export function mountOptions(
  x: number,
  y: number,
  isSolid: (x: number, y: number) => boolean,
  mustBeVisible: boolean,
): number[] {
  const options: number[] = [];
  for (const direction of DIRECTIONS) {
    if (!isSolid(x + direction.dx, y + direction.dy)) continue;
    // Facing is *away* from the wall it is mounted on: a note on a wall to the north faces
    // south, which is the way the camera looks from.
    const facing = normalise(direction.degrees + 180);
    if (mustBeVisible && !facingIsVisible(facing)) continue;
    options.push(facing);
  }
  return options;
}

export function normalise(degrees: number): number {
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

/** Whether every property §2 marks required has been filled in (§9.1). */
export function missingProperties(entity: AuthoredEntity): string[] {
  const choice = entityChoice(entity.type);
  if (!choice) return [];
  return choice.required.filter((key) => {
    const value = entity.properties[key];
    return value === undefined || value === null || value === '';
  });
}
