/**
 * Stamps (§9.4) — an arrangement of tiles and entities placed in one action.
 *
 * A soccer field is pitch tiles, a goal at each end and a net. It is a way of *drawing*,
 * not a kind of thing a level contains: placing one expands it into ordinary tiles and
 * ordinary entities, and `map.json` has no trace that a field was ever placed. Move one
 * goal afterwards and you have a field with a goal moved, not a broken instance.
 *
 * That is what keeps §2's format flat. A stamp surviving into the file would be a
 * container, and the walkability derivation, the pathfinder, the reachability audit, the
 * validator and undo itself would each have to learn about containers. Expanding at author
 * time costs the editor a feature and costs the game nothing.
 *
 * The cost is real and is the right one: there is no way to change every field in a level
 * at once, because after placement there are no fields. A level is authored once and played
 * many times, and a format that is simple to *read* is worth more than one convenient to
 * bulk-edit.
 *
 * Everything here is pure. The editor's DOM is somebody else's problem, and the expansion —
 * which is the part with rotation arithmetic in it, and therefore the part that can be
 * wrong — is checkable without one.
 */

import type { AuthoredEntity } from './Document';

/** A tile the stamp writes, in stamp-local coordinates with the origin at its top-left. */
export interface StampTile {
  layer: number;
  x: number;
  y: number;
  id: number;
}

/** An entity the stamp places, in the same local coordinates. */
export interface StampEntity {
  type: string;
  x: number;
  y: number;
  properties?: Record<string, string | number | boolean>;
  /**
   * Degrees clockwise from north (§2), *before* the stamp's own rotation. Quarter turns are
   * added to this, so a goal authored facing south still faces across the pitch whichever
   * way the field is laid down.
   */
  rotation?: number;
}

export interface Stamp {
  id: string;
  label: string;
  /** Footprint in tiles, unrotated. */
  width: number;
  height: number;
  tiles: readonly StampTile[];
  entities: readonly StampEntity[];
}

/**
 * Rotate a stamp-local cell by quarter turns clockwise, within a `w × h` footprint.
 *
 * The footprint's own dimensions swap on odd turns, which is why this takes them: a cell at
 * the east end of a 12-wide pitch has to land at the south end of a 12-tall one, and an
 * expression that forgets the swap puts half the field outside its own bounds.
 */
export function rotateCell(
  x: number,
  y: number,
  width: number,
  height: number,
  turns: number,
): { x: number; y: number } {
  const t = ((turns % 4) + 4) % 4;
  switch (t) {
    case 1:
      return { x: height - 1 - y, y: x };
    case 2:
      return { x: width - 1 - x, y: height - 1 - y };
    case 3:
      return { x: y, y: width - 1 - x };
    default:
      return { x, y };
  }
}

/** The footprint a stamp covers once rotated. Odd turns swap the axes. */
export function rotatedFootprint(
  stamp: Stamp,
  turns: number,
): { width: number; height: number } {
  const odd = (((turns % 4) + 4) % 4) % 2 === 1;
  return odd
    ? { width: stamp.height, height: stamp.width }
    : { width: stamp.width, height: stamp.height };
}

export interface ExpandedStamp {
  tiles: Array<{ layer: number; x: number; y: number; id: number }>;
  entities: AuthoredEntity[];
}

/**
 * What a stamp becomes when it is placed: absolute tiles and absolute entities, and nothing
 * that refers back to the stamp.
 *
 * `originX`/`originY` are the map cell the rotated footprint's top-left corner lands on.
 * Nothing is clamped here — a stamp that would fall outside the map is refused by the
 * caller rather than clipped, because half a soccer field is not a thing anybody meant to
 * place (§9.4).
 */
export function expandStamp(
  stamp: Stamp,
  originX: number,
  originY: number,
  turns: number,
): ExpandedStamp {
  const quarter = ((turns % 4) + 4) % 4;

  const tiles = stamp.tiles.map((tile) => {
    const cell = rotateCell(tile.x, tile.y, stamp.width, stamp.height, quarter);
    return { layer: tile.layer, x: originX + cell.x, y: originY + cell.y, id: tile.id };
  });

  const entities = stamp.entities.map((entity): AuthoredEntity => {
    const cell = rotateCell(entity.x, entity.y, stamp.width, stamp.height, quarter);
    const properties: Record<string, string | number | boolean> = { ...entity.properties };
    // §9.4 — the stamp rotates by rotating both its tiles and the entities inside it, and
    // an entity's own rotation is part of what gets rotated. A goal authored facing south
    // faces across the pitch however the pitch is laid down.
    if (entity.rotation !== undefined || quarter !== 0) {
      properties['rotation'] = (((entity.rotation ?? 0) + quarter * 90) % 360 + 360) % 360;
    }
    return { type: entity.type, x: originX + cell.x, y: originY + cell.y, properties };
  });

  return { tiles, entities };
}

/** True when every cell of the rotated footprint is inside a `width × height` map. */
export function stampFits(
  stamp: Stamp,
  originX: number,
  originY: number,
  turns: number,
  mapWidth: number,
  mapHeight: number,
): boolean {
  const size = rotatedFootprint(stamp, turns);
  return (
    originX >= 0 &&
    originY >= 0 &&
    originX + size.width <= mapWidth &&
    originY + size.height <= mapHeight
  );
}

// --- The stamps themselves ---------------------------------------------------
//
// Definitions rather than a feature (§9.4): a new one is data here, not code in the editor.
// Tile ids are the standard palette every `tileset.json` defines — 1 concrete, 2 wall,
// 4 dirt (§9.1).

const DIRT = 4;
const CONCRETE = 1;

/** A rectangle of one tile id on one layer. */
function fill(layer: number, id: number, w: number, h: number): StampTile[] {
  const tiles: StampTile[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) tiles.push({ layer, x, y, id });
  }
  return tiles;
}

/**
 * A soccer pitch: 12 × 8 tiles of ground, a goal at each end facing in, and a net down one
 * touchline.
 *
 * §2's landmarks are what the goals and the net are — models bigger than a tile, at their
 * own angles — and this is the arrangement that motivated stamps in the first place. The
 * goals face each other rather than both facing the same way, which is the thing a rotation
 * has to preserve and the reason `expandStamp` rotates entity `rotation` as well as
 * position.
 */
const SOCCER_FIELD: Stamp = {
  id: 'soccer-field',
  label: 'Soccer field',
  width: 12,
  height: 8,
  tiles: fill(0, DIRT, 12, 8),
  entities: [
    { type: 'Landmark', x: 1, y: 4, properties: { prefab: 'prop_goal' }, rotation: 90 },
    { type: 'Landmark', x: 10, y: 4, properties: { prefab: 'prop_goal' }, rotation: 270 },
    { type: 'Landmark', x: 6, y: 0, properties: { prefab: 'prop_net' }, rotation: 0 },
  ],
};

/** A little playground: hard ground, a slide, a swing set and a hoop. */
const PLAYGROUND: Stamp = {
  id: 'playground',
  label: 'Playground',
  width: 8,
  height: 6,
  tiles: fill(0, CONCRETE, 8, 6),
  entities: [
    { type: 'Landmark', x: 1, y: 1, properties: { prefab: 'prop_slide' }, rotation: 0 },
    { type: 'Landmark', x: 4, y: 2, properties: { prefab: 'prop_swing' }, rotation: 90 },
    { type: 'Landmark', x: 6, y: 4, properties: { prefab: 'prop_hoop' }, rotation: 0 },
  ],
};

/** A stand of trees — the landmark case §2 is really about (§9.4). */
const GROVE: Stamp = {
  id: 'grove',
  label: 'Grove',
  width: 7,
  height: 7,
  tiles: fill(0, DIRT, 7, 7),
  entities: [
    { type: 'Landmark', x: 1, y: 1, properties: { prefab: 'prop_tree' }, rotation: 0 },
    { type: 'Landmark', x: 5, y: 2, properties: { prefab: 'prop_tree' }, rotation: 37 },
    { type: 'Landmark', x: 2, y: 5, properties: { prefab: 'prop_tree' }, rotation: 154 },
    { type: 'Landmark', x: 5, y: 5, properties: { prefab: 'prop_tree' }, rotation: 71 },
  ],
};

export const STAMPS: readonly Stamp[] = [SOCCER_FIELD, PLAYGROUND, GROVE];

export function stampById(id: string): Stamp | undefined {
  return STAMPS.find((stamp) => stamp.id === id);
}
