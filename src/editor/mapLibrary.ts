/**
 * The maps the editor can open, and where they come from (§9.3).
 *
 * Two sources, layered the way §9.4 layers stamps, and for the same reason: the project's
 * maps are in the repository and change through a commit, and a browser is where a level is
 * worked out before it gets there.
 *
 * - **The project's** — the directories in `public/maps/`, read-only. `example` is the one
 *   a fresh browser opens.
 * - **This browser's** — saved here, named, editable, deletable.
 *
 * Everything here is pure except the two functions that touch storage, so the naming and
 * precedence rules can be tested without a browser — which is the half that actually goes
 * wrong. A rule like "a project map is never overwritten" is one function returning the
 * wrong branch away from being false.
 */

import type { DocumentSnapshot } from './Document';

/** Where this browser's maps live (§9.3). Beside the draft and the stamp library. */
export const MAPS_KEY = 'shadows.editor.maps';

/** Longer than this is not a name, it is a sentence, and the list is a strip on a phone. */
const NAME_LIMIT = 40;

/**
 * §9.3 — the project's maps, derived from the tree at build time rather than listed in a
 * file somebody has to remember to update. Vite resolves the glob at build and only the
 * keys are read, so no map is bundled and nothing here is fetched until it is opened.
 */
export const PROJECT_MAPS: readonly string[] = Object.keys(
  import.meta.glob('/public/maps/*/map.json'),
)
  .map((path) => path.split('/').at(-2) ?? '')
  .filter((name) => name !== '')
  .sort();

/** §9.3 — what a fresh browser opens, and what a save is never allowed to overwrite. */
export const DEFAULT_MAP = 'example';

/** Which library a map came from. A project map is read-only; a browser map is not. */
export type MapSource = 'project' | 'browser';

/** What the editor has open, so the draft can be reopened as the map it belongs to. */
export interface OpenMap {
  source: MapSource;
  name: string;
}

/** A map saved in this browser. `map` is `map.json`'s shape, exactly as §2 gives it. */
export interface SavedMap {
  name: string;
  /** Epoch milliseconds, so the list can be ordered by most recently worked on. */
  savedAt: number;
  map: unknown;
}

export function isProjectMap(name: string): boolean {
  return PROJECT_MAPS.includes(name);
}

/**
 * §9.3 — whether a save may write over what is open, as opposed to having to name a new
 * one. False for the project's maps, and false when nothing is open yet.
 */
export function canOverwrite(open: OpenMap | null): boolean {
  return open !== null && open.source === 'browser';
}

/** Whitespace and length only — the shape of a name, with no rule about which are allowed. */
function tidyName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT);
}

/**
 * Trim a name to something that can be stored and shown. Returns null for a name that is
 * not one — empty, or a project map's, which would put two different things in the list
 * under one label.
 *
 * Separate from `tidyName` because a rejected name is still a good *starting point*: the
 * obvious name to offer when saving out of `example` is `example 2`, which means tidying
 * `example` without accepting it.
 */
export function normaliseMapName(raw: string): string | null {
  const name = tidyName(raw);
  if (name === '') return null;
  if (isProjectMap(name)) return null;
  return name;
}

/** Case-insensitive, because two maps called `Yard` and `yard` is a list nobody can read. */
export function findMap(maps: readonly SavedMap[], name: string): SavedMap | undefined {
  return maps.find((map) => map.name.toLowerCase() === name.toLowerCase());
}

/**
 * A name not already taken, by suffixing a number. Used by "Save a copy" and by saving out
 * of a project map, where the obvious name is the one that is not available.
 */
export function uniqueMapName(maps: readonly SavedMap[], base: string): string {
  const stem = tidyName(base) || 'map';
  if (!findMap(maps, stem) && !isProjectMap(stem)) return stem;
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} ${n}`.slice(0, NAME_LIMIT);
    if (!findMap(maps, candidate) && !isProjectMap(candidate)) return candidate;
  }
}

/**
 * Write `map` under `name`, replacing a map of that name rather than sitting beside it —
 * the same one-name-one-thing rule §9.4 gives stamps. Returns a new list, most recently
 * saved first.
 */
export function putMap(maps: readonly SavedMap[], name: string, map: unknown): SavedMap[] {
  const entry: SavedMap = { name, savedAt: Date.now(), map };
  return [entry, ...maps.filter((m) => m.name.toLowerCase() !== name.toLowerCase())];
}

export function deleteMap(maps: readonly SavedMap[], name: string): SavedMap[] {
  return maps.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
}

/**
 * Rename in place, keeping the map's position in the list. Returns the list unchanged if
 * the new name is not usable or is already another map's.
 */
export function renameMap(maps: readonly SavedMap[], from: string, to: string): SavedMap[] {
  const name = normaliseMapName(to);
  if (name === null) return [...maps];
  const clash = findMap(maps, name);
  if (clash && clash.name.toLowerCase() !== from.toLowerCase()) return [...maps];
  return maps.map((m) => (m.name.toLowerCase() === from.toLowerCase() ? { ...m, name } : m));
}

/**
 * Read a stored library, dropping anything that is not a map rather than throwing. A
 * half-written entry costs that entry; it does not cost the editor.
 */
export function mapsFromJson(raw: unknown): SavedMap[] {
  const list = Array.isArray(raw) ? raw : (raw as { maps?: unknown[] })?.maps;
  if (!Array.isArray(list)) return [];
  const out: SavedMap[] = [];
  for (const item of list) {
    const entry = item as Partial<SavedMap>;
    const name = typeof entry?.name === 'string' ? normaliseMapName(entry.name) : null;
    if (name === null || entry.map == null) continue;
    if (findMap(out, name)) continue;
    out.push({ name, savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0, map: entry.map });
  }
  return out;
}

export function loadSavedMaps(store: Storage | null = safeStorage()): SavedMap[] {
  try {
    const raw = store?.getItem(MAPS_KEY);
    return raw ? mapsFromJson(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveSavedMaps(maps: readonly SavedMap[], store: Storage | null = safeStorage()): void {
  try {
    store?.setItem(MAPS_KEY, JSON.stringify(maps));
  } catch {
    // A full or disabled store is not a reason to stop editing (§9.3).
  }
}

/**
 * §9.3 — a project map's `map.json`, or null.
 *
 * The same posture as `loadProjectStamps`: every failure there is — no directory, a static
 * host answering an unknown path with `index.html` and a 200, a half-written commit — costs
 * the map and never the editor, which falls back to a blank level.
 */
export async function loadProjectMap(name: string, base: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${base}maps/${encodeURIComponent(name)}/map.json`);
    if (!response.ok) return null;
    const json: unknown = await response.json();
    // A map has layers; an index page parsed as JSON does not. Cheaper than a content-type
    // probe and it is the thing actually being relied on.
    return json && typeof json === 'object' && 'layers' in json ? json : null;
  } catch {
    return null;
  }
}

/** What the draft records: the open document, and which map it belongs to (§9.3). */
export interface Draft {
  open: OpenMap | null;
  snapshot: DocumentSnapshot;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
