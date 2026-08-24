/**
 * Note bodies (§6.2).
 *
 * Text lives in `notes.json` keyed by `noteId`, deliberately outside the map file, so
 * writing and level design stay independent: a level designer places a `Note` entity with
 * an id, and whoever writes the words never opens a map again.
 *
 * A missing id degrades to a placeholder rather than failing the load, on the same terms
 * as a missing prefab or a missing sound (§2). A map whose notes have not been written yet
 * is a map that should still be playable.
 */

export interface NoteText {
  title: string;
  body: string;
  /** True when this is the stand-in for an id `notes.json` has no entry for. */
  placeholder: boolean;
}

export class NoteLibrary {
  private readonly notes = new Map<string, NoteText>();
  /** Ids asked for that were not in the file — surfaced in the readout, not thrown. */
  readonly missing = new Set<string>();

  constructor(entries: Record<string, { title?: unknown; body?: unknown }> = {}) {
    for (const [id, entry] of Object.entries(entries)) {
      this.notes.set(id, {
        title: typeof entry?.title === 'string' ? entry.title : id,
        body: typeof entry?.body === 'string' ? entry.body : '',
        placeholder: false,
      });
    }
  }

  get count(): number {
    return this.notes.size;
  }

  get(noteId: string): NoteText {
    const note = this.notes.get(noteId);
    if (note) return note;
    this.missing.add(noteId);
    return {
      title: noteId,
      body: `(no text for “${noteId}” in notes.json)`,
      placeholder: true,
    };
  }
}

/** Fetch the library. A missing or malformed file is an empty library, not a failed run. */
export async function loadNotes(url: string): Promise<NoteLibrary> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null) throw new Error('not an object');
    return new NoteLibrary(raw as Record<string, { title?: unknown; body?: unknown }>);
  } catch (error) {
    console.warn(`[notes] ${url} — ${String(error)}; notes will read as placeholders`);
    return new NoteLibrary();
  }
}
