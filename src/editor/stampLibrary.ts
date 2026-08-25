/**
 * The stamps the editor offers, and where they come from (§9.4).
 *
 * Three jobs, which are one job: merge the stamps that ship with the project with the ones
 * captured from the map, keep the captured ones between sessions, and move the whole set in
 * and out as JSON.
 *
 * **Capture, not a second canvas.** A stamp is made by drawing the arrangement in the level
 * with the ordinary tools and dragging a rectangle round it. A stamp is made of nothing but
 * tiles and entities — that is §9.4's whole point — so the map is already the right surface
 * to author one on, and a separate stamp editor would be a second canvas, a second tool set
 * and a second undo stack for drawing the same things the same way.
 *
 * Everything here is pure except the two functions that touch storage, and those are the
 * last four lines. The capture, the merge and the codec are testable without a browser.
 */

import type { AuthoredEntity } from './Document';
import { BUILT_IN_STAMPS, type Stamp, type StampEntity, type StampTile } from './stamps';

/** Where captured stamps live between sessions (§9.4). */
export const STAMPS_KEY = 'shadows.editor.stamps';

/** Enough of `EditorDocument` to capture from, so the capture can be tested without one. */
export interface StampSource {
  width: number;
  height: number;
  tileAt(layer: number, x: number, y: number): number;
  readonly entities: readonly AuthoredEntity[];
}

/** The layers a capture reads, which are the two §2 gives a map. */
const CAPTURED_LAYERS = [0, 1] as const;

/**
 * The angles a captured entity carries, lifted out of its properties (§9.4).
 *
 * `expandStamp` writes `rotation` from the stamp entity's own field, so leaving a copy in
 * `properties` as well would be one value in two places — and the one in `properties` would
 * be the stale one after a rotation.
 */
function splitRotation(entity: AuthoredEntity): {
  rotation: number;
  properties: Record<string, string | number | boolean>;
} {
  const { rotation, ...rest } = entity.properties;
  return { rotation: Number(rotation) || 0, properties: rest };
}

/**
 * Extract a rectangle of the map as a stamp (§9.4).
 *
 * Corners in either order; the rectangle is clamped to the map rather than refused, because
 * a drag that runs off the edge is a drag, not a mistake worth rejecting.
 *
 * **Every cell in the rectangle is taken, empty ones included.** A stamp captured from a
 * yard with no walls clears the walls where it lands, and that is what "a stamp writes over
 * what is under it" has to mean for laying ground to work at all.
 */
export function captureStamp(
  source: StampSource,
  corner: { x0: number; y0: number; x1: number; y1: number },
  id: string,
  label: string,
): Stamp {
  const x0 = Math.max(0, Math.min(corner.x0, corner.x1));
  const y0 = Math.max(0, Math.min(corner.y0, corner.y1));
  const x1 = Math.min(source.width - 1, Math.max(corner.x0, corner.x1));
  const y1 = Math.min(source.height - 1, Math.max(corner.y0, corner.y1));
  const width = Math.max(0, x1 - x0 + 1);
  const height = Math.max(0, y1 - y0 + 1);

  const tiles: StampTile[] = [];
  for (const layer of CAPTURED_LAYERS) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        tiles.push({ layer, x, y, id: source.tileAt(layer, x0 + x, y0 + y) });
      }
    }
  }

  const entities: StampEntity[] = source.entities
    .filter((e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1)
    .map((e) => {
      const split = splitRotation(e);
      return {
        type: e.type,
        x: e.x - x0,
        y: e.y - y0,
        rotation: split.rotation,
        properties: split.properties,
      };
    });

  return { id, label, width, height, tiles, entities };
}

/** A label turned into an id nothing else in `taken` is using. */
export function uniqueStampId(label: string, taken: Iterable<string>): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stamp';
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const candidate = `${slug}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// --- The exchange format -----------------------------------------------------
//
// Compact rather than pretty, because the point of it is being pasteable (§9.4). A captured
// 12 × 8 yard is 192 cells that are almost all the same tile; written out one object per
// cell it is six kilobytes of `{"layer":0,"x":3,"y":1,"id":4}`, and run-length encoded over
// the row-major index it is `[0, 96, 4]`.
//
// Lossless in both directions, which is the part that matters: a stamp that touches one
// layer has to come back touching one layer, or a grove imported from a file would start
// flattening the walls a grove defined in the project leaves alone.

/** Run-length encode one layer's cells as `[startIndex, count, tileId, …]`. */
export function encodeRuns(tiles: readonly StampTile[], width: number): number[] {
  const byIndex = new Map<number, number>();
  for (const tile of tiles) byIndex.set(tile.y * width + tile.x, tile.id);

  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  const runs: number[] = [];
  let i = 0;
  while (i < indices.length) {
    const start = indices[i]!;
    const id = byIndex.get(start)!;
    let length = 1;
    while (
      i + length < indices.length &&
      indices[i + length] === start + length &&
      byIndex.get(start + length) === id
    ) {
      length += 1;
    }
    runs.push(start, length, id);
    i += length;
  }
  return runs;
}

/** The inverse: runs back into cells on one layer. */
export function decodeRuns(runs: readonly number[], layer: number, width: number): StampTile[] {
  const tiles: StampTile[] = [];
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const start = runs[i]!;
    const length = runs[i + 1]!;
    const id = runs[i + 2]!;
    for (let n = 0; n < length; n += 1) {
      const index = start + n;
      tiles.push({ layer, x: index % width, y: Math.floor(index / width), id });
    }
  }
  return tiles;
}

/**
 * Pretty-print a stamp library, with the runs kept on one line each.
 *
 * `JSON.stringify(…, null, 2)` puts every number of a run on its own line, which turns a
 * 12 × 10 yard into seven hundred characters that are mostly newlines and a 30 × 30 one into
 * something nobody pastes into a message. Indenting the structure and not the numbers is the
 * difference between a readable file and a wall — and the runs are not text a person reads
 * anyway, they are the part the codec writes.
 */
export function formatStampFile(file: StampFile): string {
  return JSON.stringify(file, null, 2).replace(
    /\[\s*(-?\d[\d,\s-]*?)\s*\]/g,
    (_match, body: string) => `[${body.replace(/\s+/g, ' ').replace(/,\s/g, ', ')}]`,
  );
}

export interface StampFile {
  version: 1;
  stamps: unknown[];
}

/** The library as text, in the shape `stampsFromJson` reads back (§9.4). */
export function stampsToJson(stamps: readonly Stamp[]): StampFile {
  return {
    version: 1,
    stamps: stamps.map((stamp) => {
      const layers: Record<string, number[]> = {};
      for (const layer of new Set(stamp.tiles.map((tile) => tile.layer))) {
        const runs = encodeRuns(
          stamp.tiles.filter((tile) => tile.layer === layer),
          stamp.width,
        );
        if (runs.length > 0) layers[String(layer)] = runs;
      }
      return {
        id: stamp.id,
        label: stamp.label,
        width: stamp.width,
        height: stamp.height,
        layers,
        entities: stamp.entities.map((entity) => ({
          type: entity.type,
          x: entity.x,
          y: entity.y,
          rotation: entity.rotation ?? 0,
          properties: { ...entity.properties },
        })),
      };
    }),
  };
}

/**
 * Parse a pasted library, skipping anything that is not a stamp.
 *
 * Tolerant on purpose: this is text a person pasted, and one malformed entry should cost
 * that entry rather than the file. A stamp with no id, no footprint or no contents is not
 * something the editor could place, so it is dropped rather than repaired into something
 * nobody authored.
 */
export function stampsFromJson(raw: unknown): Stamp[] {
  const file = raw as { stamps?: unknown[] } | unknown[];
  const list = Array.isArray(file) ? file : (file?.stamps ?? []);
  if (!Array.isArray(list)) return [];

  const out: Stamp[] = [];
  for (const item of list) {
    const record = item as {
      id?: unknown;
      label?: unknown;
      width?: unknown;
      height?: unknown;
      layers?: Record<string, number[]>;
      entities?: unknown[];
    };
    const id = typeof record.id === 'string' ? record.id : '';
    const width = Number(record.width);
    const height = Number(record.height);
    if (!id || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      continue;
    }

    const tiles: StampTile[] = [];
    for (const [key, runs] of Object.entries(record.layers ?? {})) {
      const layer = Number(key);
      if (!Number.isFinite(layer) || !Array.isArray(runs)) continue;
      tiles.push(...decodeRuns(runs, layer, width));
    }

    const entities: StampEntity[] = [];
    for (const entry of record.entities ?? []) {
      const entity = entry as {
        type?: unknown;
        x?: unknown;
        y?: unknown;
        rotation?: unknown;
        properties?: Record<string, string | number | boolean>;
      };
      if (typeof entity.type !== 'string') continue;
      entities.push({
        type: entity.type,
        x: Number(entity.x) || 0,
        y: Number(entity.y) || 0,
        rotation: Number(entity.rotation) || 0,
        properties: { ...entity.properties },
      });
    }

    // Nothing to place is not a stamp. An empty entry would sit in the palette as a chip
    // that does nothing, which reads as the editor being broken.
    if (tiles.length === 0 && entities.length === 0) continue;

    out.push({
      id,
      label: typeof record.label === 'string' && record.label ? record.label : id,
      width,
      height,
      tiles,
      entities,
    });
  }
  return out;
}

// --- The library ------------------------------------------------------------

/**
 * The stamps the editor offers, from three places, layered (§9.4).
 *
 * - **The defaults**, from source, so a fresh clone has something to place and a failed load
 *   still leaves a working palette.
 * - **The project's**, from `public/stamps.json` — the level's pieces, committed.
 * - **The captured**, from this browser.
 *
 * Later layers *replace earlier ones of the same id* rather than sitting beside them, and
 * that is the whole design. One id is one stamp, so the palette never shows two things with
 * the same name and no operation has to guess which one was meant.
 *
 * What it buys is the thing a level designer actually needs: a committed piece can be
 * edited. Capture over `loading-bay` and you have your own `loading-bay` shadowing the
 * project's; fix it, export it, and it drops straight back into `stamps.json` over the entry
 * it came from, because it kept the id. Delete the override and the committed one is back.
 * Without layering, editing a project piece would mean a `loading-bay-2` that has to be
 * renamed by hand on the way into the file.
 *
 * Only the top layer is deletable and only the top layer is exported. Deleting a project
 * stamp outright would be undone by the next reload, and exporting one would mean importing
 * it back as a duplicate of itself.
 */
export type StampOrigin = 'default' | 'project' | 'custom';

export class StampLibrary {
  private customStamps: Stamp[];
  private projectStamps: Stamp[] = [];

  constructor(custom: Stamp[] = []) {
    this.customStamps = custom;
  }

  /**
   * One entry per id, each resolved to its topmost layer.
   *
   * Order is where an id *first* appears, not which layer won it: overriding the soccer
   * field leaves it where the soccer field was, rather than moving it to the end of the
   * palette every time it is edited.
   */
  get all(): Stamp[] {
    const order: string[] = [];
    for (const stamp of [...BUILT_IN_STAMPS, ...this.projectStamps, ...this.customStamps]) {
      if (!order.includes(stamp.id)) order.push(stamp.id);
    }
    return order.map((id) => this.resolve(id)!);
  }

  get custom(): readonly Stamp[] {
    return this.customStamps;
  }

  get project(): readonly Stamp[] {
    return this.projectStamps;
  }

  /** §9.4 — the level's pieces, once they have loaded. */
  setProject(stamps: readonly Stamp[]): void {
    this.projectStamps = [...stamps];
  }

  byId(id: string): Stamp | undefined {
    return this.resolve(id);
  }

  /** Which layer the visible stamp of this id comes from. */
  origin(id: string): StampOrigin | null {
    if (this.customStamps.some((stamp) => stamp.id === id)) return 'custom';
    if (this.projectStamps.some((stamp) => stamp.id === id)) return 'project';
    if (BUILT_IN_STAMPS.some((stamp) => stamp.id === id)) return 'default';
    return null;
  }

  /** What a captured stamp of this id is covering up, if anything. */
  shadows(id: string): StampOrigin | null {
    if (this.origin(id) !== 'custom') return null;
    if (this.projectStamps.some((stamp) => stamp.id === id)) return 'project';
    if (BUILT_IN_STAMPS.some((stamp) => stamp.id === id)) return 'default';
    return null;
  }

  isCustom(id: string): boolean {
    return this.origin(id) === 'custom';
  }

  /**
   * Add a new one, renaming its id if anything already has it. Returns the id it got.
   *
   * A *new* capture never silently replaces a piece — typing a name that happens to collide
   * should not quietly rewrite the soccer field. Replacing one is `replace`, which is a
   * different action reached from a different button.
   */
  add(stamp: Stamp): string {
    const id = uniqueStampId(
      stamp.id || stamp.label,
      this.all.map((existing) => existing.id),
    );
    this.customStamps.push({ ...stamp, id });
    return id;
  }

  /** Write a captured stamp at exactly this id, replacing whatever was there. */
  replace(id: string, stamp: Stamp): void {
    const next = { ...stamp, id };
    const at = this.customStamps.findIndex((existing) => existing.id === id);
    if (at >= 0) this.customStamps[at] = next;
    else this.customStamps.push(next);
  }

  /**
   * Take a copy of a project or default stamp into the captured layer, so it can be edited.
   *
   * The copy keeps the id, which is what makes the round trip work: export it and it lands
   * back in `stamps.json` over the entry it came from.
   */
  override(id: string): boolean {
    const stamp = this.resolve(id);
    if (!stamp || this.origin(id) === 'custom') return false;
    this.customStamps.push({ ...stamp });
    return true;
  }

  /** Rename a captured stamp. The id is its identity and does not move with the label. */
  relabel(id: string, label: string): boolean {
    const at = this.customStamps.findIndex((stamp) => stamp.id === id);
    if (at < 0 || !label.trim()) return false;
    this.customStamps[at] = { ...this.customStamps[at]!, label: label.trim() };
    return true;
  }

  /** Drop the captured stamp. If it was covering a committed one, that one comes back. */
  remove(id: string): void {
    this.customStamps = this.customStamps.filter((stamp) => stamp.id !== id);
  }

  /**
   * Merge a pasted library in, by id. Returns how many arrived.
   *
   * Replacing rather than appending is what makes the export a round trip: paste back what
   * you exported and you have what you exported, not two of everything. A paste naming a
   * project piece becomes an override of it, which is the same thing capture-over does and
   * the same thing somebody pasting an edited piece meant.
   */
  merge(incoming: readonly Stamp[]): number {
    for (const stamp of incoming) this.replace(stamp.id, stamp);
    return incoming.length;
  }

  private resolve(id: string): Stamp | undefined {
    return (
      this.customStamps.find((stamp) => stamp.id === id) ??
      this.projectStamps.find((stamp) => stamp.id === id) ??
      BUILT_IN_STAMPS.find((stamp) => stamp.id === id)
    );
  }

  /** §9.4 — the captured stamps as text. The built-ins are in the project already. */
  toJson(): StampFile {
    return stampsToJson(this.customStamps);
  }
}

/** §9.4 — captured stamps survive the browser closing. A full or disabled store does not. */
export function saveStamps(library: StampLibrary, store: Storage | null = safeStorage()): void {
  try {
    store?.setItem(STAMPS_KEY, JSON.stringify(library.toJson()));
  } catch {
    // Losing a stamp is not a reason to stop editing.
  }
}

export function loadStamps(store: Storage | null = safeStorage()): StampLibrary {
  try {
    const raw = store?.getItem(STAMPS_KEY);
    return new StampLibrary(raw ? stampsFromJson(JSON.parse(raw)) : []);
  } catch {
    return new StampLibrary();
  }
}

/**
 * §9.4 — the level's pieces, from `public/stamps.json`.
 *
 * Returns an empty list rather than throwing, on every failure there is: no file, a static
 * host answering an unknown path with `index.html` and a 200, a half-written commit. A
 * missing or malformed file costs the pieces in it and never the editor.
 *
 * No content-type probe, unlike the loaders for `.glb` (§1): parsing JSON *is* the reliable
 * test here, because a page of HTML fails it immediately and for free.
 */
export async function loadProjectStamps(url: string): Promise<Stamp[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    return stampsFromJson(await response.json());
  } catch {
    return [];
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
