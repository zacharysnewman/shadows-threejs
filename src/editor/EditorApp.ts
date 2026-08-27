/**
 * The editor's chrome and wiring (§9).
 *
 * Touch-first, because §9 exists to be usable on a phone (Phase 12): every control is a
 * button big enough for a thumb, nothing needs a hover state to be discoverable, and the
 * map gets the whole screen with the tools along the bottom where a thumb already is.
 *
 * The audit runs on every change (§9, reason 2). That is the difference between this and a
 * generic tile editor: it knows what a level *is*, so it can say "the exit needs three
 * latch switches and this map has two" while you are placing them.
 */

import { auditMap, type AuditResult } from '../map/audit';
import { EntityRegistry } from '../map/EntityRegistry';
import { parseMap, parseTileset } from '../map/validate';
import { EditorDocument, type AuthoredEntity } from './Document';
import { TileCanvas } from './TileCanvas';
import {
  ENTITIES,
  FLOOR_TILES,
  OBSTACLE_TILES,
  type EntityChoice,
  entityChoice,
  facingIsVisible,
  missingProperties,
  mountOptions,
  nameSuggestions,
  normalise,
} from './palette';
import { EDITOR_STYLE } from './style';
import { expandStamp, rotatedFootprint, stampFits } from './stamps';
import {
  StampLibrary,
  captureStamp,
  formatStampFile,
  loadProjectStamps,
  loadStamps,
  saveStamps,
  stampsFromJson,
  uniqueStampId,
} from './stampLibrary';
import {
  DEFAULT_MAP,
  PROJECT_MAPS,
  type OpenMap,
  type SavedMap,
  canOverwrite,
  deleteMap,
  findMap,
  isProjectMap,
  loadProjectMap,
  loadSavedMaps,
  normaliseMapName,
  putMap,
  renameMap,
  saveSavedMaps,
  uniqueMapName,
} from './mapLibrary';

type Tool = 'paint' | 'erase' | 'rect' | 'entity' | 'stamp';

/**
 * Where the open document lives between sessions (§9.3).
 *
 * Not one of the saved maps: it is whatever is open, saved or not, so closing the browser
 * mid-edit loses nothing. It records which map it came from, or reopening a draft would
 * forget which map a later Save is meant to write to.
 */
const AUTOSAVE_KEY = 'shadows.editor.draft';
/** Where a playtest hands the level to the game (§9.3). */
export const PLAYTEST_KEY = 'shadows.editor.playtest';

export class EditorApp {
  private readonly doc: EditorDocument;
  private readonly canvas: TileCanvas;
  private readonly root: HTMLDivElement;

  private tool: Tool = 'paint';
  /** §9.4 — the project's stamps and the ones captured here, merged. */
  private readonly stamps: StampLibrary = loadStamps();
  /** §9.4 — which stamp is armed, and how far it is turned. */
  private stampId: string;
  private stampTurns = 0;
  /**
   * §9.4 — true while the stamp tool is dragging out a rectangle to capture rather than
   * placing. The same drag either way; what differs is what happens on release.
   */
  private capturing = false;
  /**
   * §9.4 — the stamp the next capture replaces, or null to add a new one. Set by "Replace
   * from selection", which is what makes a captured piece editable rather than a thing you
   * can only delete and re-make under a different name.
   */
  private capturingInto: string | null = null;
  /** §9.3 — which map is open, or null for a level that has never been saved. */
  private open: OpenMap | null = null;
  /** §9.3 — this browser's maps. The project's are read-only and are not in here. */
  private maps: SavedMap[] = loadSavedMaps();
  /**
   * §9.3 — `doc.version` as of the last save or open, so the menu can say whether there is
   * anything to lose. Not a boolean: undoing back to the saved state is not a change.
   */
  private savedVersion = 0;
  private layer = 1;
  private tileId = 2;
  private entityType = 'SpiderEnemy';
  private rectStart: { x: number; y: number } | null = null;
  private selected: AuthoredEntity | null = null;
  private audit: AuditResult | null = null;
  private lastAudited = -1;

  private readonly statusBar: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private readonly palette: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    const draft = loadDraft();
    this.doc = draft?.doc ?? EditorDocument.blank();
    this.open = draft?.open ?? null;
    this.savedVersion = this.doc.version;
    this.stampId = this.stamps.all[0]?.id ?? '';

    this.root = document.createElement('div');
    this.root.className = 'ed';
    this.root.innerHTML = EDITOR_STYLE;

    this.canvas = new TileCanvas(this.doc);
    this.canvas.onPaint = (x, y, phase) => this.paint(x, y, phase);

    const stage = document.createElement('div');
    stage.className = 'ed-stage';
    stage.append(this.canvas.element);

    this.statusBar = document.createElement('div');
    this.statusBar.className = 'ed-status';

    this.sheet = document.createElement('div');
    this.sheet.className = 'ed-sheet';
    this.sheet.hidden = true;

    this.palette = document.createElement('div');
    this.palette.className = 'ed-palette';

    this.root.append(stage, this.statusBar, this.sheet, this.palette, this.buildToolbar());
    parent.append(this.root);

    this.canvas.resize();
    this.canvas.fit();
    window.addEventListener('resize', () => this.canvas.resize());

    this.refreshPalette();
    this.frame();

    // §9.4 — the level's pieces, without waiting for them. The editor is usable the moment
    // it opens and the project's stamps appear a moment later, which is the right way round:
    // a slow or missing `stamps.json` costs the pieces in it and never the tools.
    // §9.3 — a fresh browser opens the project's default map rather than an empty grid.
    // Only when there is no draft: work in progress outranks the default, and it is the
    // one case where opening something would throw away an edit nobody asked to discard.
    if (!draft) void this.openProject(DEFAULT_MAP, { silent: true });

    void loadProjectStamps(`${import.meta.env.BASE_URL}stamps.json`).then((stamps) => {
      if (stamps.length === 0) return;
      this.stamps.setProject(stamps);
      if (!this.stamps.byId(this.stampId)) this.stampId = this.stamps.all[0]?.id ?? '';
      saveStamps(this.stamps);
      if (this.tool === 'stamp') this.refreshPalette();
    });
  }

  // --- Chrome --------------------------------------------------------------

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'ed-bar';

    const group = (children: HTMLElement[]): HTMLDivElement => {
      const div = document.createElement('div');
      div.className = 'ed-group';
      div.append(...children);
      return div;
    };
    const button = (label: string, onClick: () => void, name?: string): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      if (name) element.dataset['name'] = name;
      element.addEventListener('click', onClick);
      return element;
    };

    const tools: Tool[] = ['paint', 'erase', 'rect', 'entity', 'stamp'];
    const toolButtons = tools.map((tool) =>
      button(
        { paint: 'Paint', erase: 'Erase', rect: 'Rect', entity: 'Place', stamp: 'Stamp' }[tool],
        () => {
          this.tool = tool;
          this.rectStart = null;
          this.capturing = false;
          this.capturingInto = null;
          this.canvas.preview = null;
          this.refreshPalette();
          this.refreshToolbar();
        },
        `tool-${tool}`,
      ),
    );

    const layerButton = button(
      'Walls',
      () => {
        this.layer = this.layer === 1 ? 0 : 1;
        this.canvas.activeLayer = this.layer;
        this.tileId = this.layer === 1 ? 2 : 1;
        this.refreshPalette();
        this.refreshToolbar();
      },
      'layer',
    );

    bar.append(
      group([layerButton]),
      group(toolButtons),
      group([
        button('↶', () => this.doc.undo(), 'undo'),
        button('↷', () => this.doc.redo(), 'redo'),
        button('Fit', () => this.canvas.fit()),
      ]),
      group([
        button('Maps', () => this.showMaps(), 'maps'),
        button('Checks', () => this.showChecks(), 'checks'),
        button('Copy', () => void this.copy(), 'copy'),
        button('Stamps', () => this.showStampJson(), 'stamps'),
        button('Play', () => this.play(), 'play'),
      ]),
    );
    this.toolbar = bar;
    this.refreshToolbar();
    return bar;
  }

  private toolbar!: HTMLDivElement;

  private refreshToolbar(): void {
    for (const element of this.toolbar.querySelectorAll('button')) {
      const name = element.dataset['name'] ?? '';
      if (name.startsWith('tool-')) {
        element.classList.toggle('is-on', name === `tool-${this.tool}`);
      }
      if (name === 'layer') element.textContent = this.layer === 1 ? 'Walls' : 'Floor';
      // §9.3 — the open map's name on the button, because which level you are editing is
      // not something to have to open a menu to find out. `•` is unsaved work.
      if (name === 'maps') element.textContent = `Maps: ${this.openLabel()}`;
      if (name === 'undo') element.disabled = !this.doc.canUndo;
      if (name === 'redo') element.disabled = !this.doc.canRedo;
      if (name === 'checks') {
        const findings = this.audit?.findings.length ?? 0;
        element.textContent = findings === 0 ? 'Checks' : `Checks ${findings}`;
        element.classList.toggle('is-bad', (this.audit?.blocking.length ?? 0) > 0);
      }
    }
  }

  /** The swatches, which are the tiles of the active layer or the entity list (§9.1). */
  private refreshPalette(): void {
    this.palette.textContent = '';
    if (this.tool === 'entity') {
      for (const choice of ENTITIES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ed-chip';
        button.style.setProperty('--chip', choice.colour);
        button.innerHTML = `<span class="ed-glyph">${choice.glyph}</span>${choice.label}`;
        button.dataset['entity'] = choice.type;
        button.classList.toggle('is-on', choice.type === this.entityType);
        button.addEventListener('click', () => {
          this.entityType = choice.type;
          this.refreshPalette();
        });
        this.palette.append(button);
      }
      return;
    }

    if (this.tool === 'stamp') {
      const chip = (label: string, name: string, onClick: () => void, on = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ed-chip';
        button.textContent = label;
        button.dataset['stamp'] = name;
        button.classList.toggle('is-on', on);
        button.addEventListener('click', onClick);
        this.palette.append(button);
        return button;
      };

      // §9.4 — capture first, because it is the one control that is not obvious from the
      // others, and on a phone the palette scrolls: what is off the left edge is not found.
      const capturingLabel = this.capturingInto
        ? `✕ Cancel replace`
        : this.capturing
          ? '✕ Cancel capture'
          : '＋ New from selection';
      chip(capturingLabel, 'capture', () => {
        this.capturing = !this.capturing;
        if (!this.capturing) this.capturingInto = null;
        this.rectStart = null;
        this.canvas.preview = null;
        this.refreshPalette();
      }, this.capturing);

      for (const stamp of this.stamps.all) {
        const size = rotatedFootprint(stamp, this.stampTurns);
        chip(
          `${stamp.label} ${size.width}×${size.height}`,
          stamp.id,
          () => {
            this.stampId = stamp.id;
            this.refreshPalette();
          },
          stamp.id === this.stampId,
        );
      }

      // §9.4 — quarter turns, because the grid is square and free angles would mean tiles
      // at an angle, which it cannot express.
      chip(`Rotate ${this.stampTurns * 90}°`, 'rotate', () => {
        this.stampTurns = (this.stampTurns + 1) % 4;
        this.refreshPalette();
      });

      // Every stamp is editable, including the project's — editing one takes a copy into
      // this browser first (§9.4), which is what keeps the file the source of truth while
      // still letting a committed piece be fixed.
      if (this.stamps.byId(this.stampId)) {
        chip('Edit', 'edit', () => this.showStampSheet(this.stampId));
      }
      return;
    }

    for (const tile of this.layer === 0 ? FLOOR_TILES : OBSTACLE_TILES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ed-chip';
      button.style.setProperty('--chip', tile.colour);
      button.innerHTML = `<span class="ed-swatch"></span>${tile.label}`;
      button.dataset['tile'] = String(tile.id);
      button.classList.toggle('is-on', tile.id === this.tileId);
      button.addEventListener('click', () => {
        this.tileId = tile.id;
        this.refreshPalette();
      });
      this.palette.append(button);
    }
  }

  // --- Editing -------------------------------------------------------------

  private paint(x: number, y: number, phase: 'start' | 'move' | 'end'): void {
    if (phase === 'end') {
      // The rectangle is one edit, applied on release: dragging out a building should cost
      // a single undo, not one per tile the finger crossed (§9.1).
      // §9.4 — the capture drag ends by naming what it selected, rather than by writing.
      if (this.tool === 'stamp' && this.capturing && this.rectStart) {
        const start = this.rectStart;
        this.rectStart = null;
        this.canvas.preview = null;
        this.showCaptureSheet({ x0: start.x, y0: start.y, x1: x, y1: y });
        return;
      }
      if (this.tool === 'rect' && this.rectStart && this.doc.inBounds(x, y)) {
        const start = this.rectStart;
        this.doc.edit((draft) => {
          for (let ty = Math.min(start.y, y); ty <= Math.max(start.y, y); ty += 1) {
            for (let tx = Math.min(start.x, x); tx <= Math.max(start.x, x); tx += 1) {
              draft.layers[this.layer]![ty * draft.width + tx] = this.tileId;
            }
          }
        });
      }
      this.rectStart = null;
      this.canvas.preview = null;
      return;
    }
    if (!this.doc.inBounds(x, y)) return;

    switch (this.tool) {
      case 'paint':
        this.doc.edit((draft) => {
          draft.layers[this.layer]![y * draft.width + x] = this.tileId;
        });
        break;

      case 'erase':
        this.doc.edit((draft) => {
          draft.layers[this.layer]![y * draft.width + x] = this.layer === 0 ? 0 : 0;
          // On the obstacle layer an entity on the tile goes with it: erasing is what a
          // designer reaches for to clear a mistake, and leaving the entity behind on a
          // tile that no longer holds anything is a surprise.
          draft.entities = draft.entities.filter((e) => e.x !== x || e.y !== y);
        });
        break;

      case 'rect':
        // Corner to corner: the first touch sets one corner and the drag only previews, so
        // a building is drawn where the designer can see it before it lands (§9.1).
        if (phase === 'start') this.rectStart = { x, y };
        if (this.rectStart) {
          this.canvas.preview = { x0: this.rectStart.x, y0: this.rectStart.y, x1: x, y1: y };
        }
        break;

      case 'entity':
        if (phase === 'start') this.placeOrSelect(x, y);
        break;

      case 'stamp':
        if (this.capturing) {
          // The same corner-to-corner drag `rect` uses (§9.1): one touch sets a corner and
          // the drag previews, so what is about to be captured is visible before it is.
          if (phase === 'start') this.rectStart = { x, y };
          if (this.rectStart) {
            this.canvas.preview = { x0: this.rectStart.x, y0: this.rectStart.y, x1: x, y1: y };
          }
          break;
        }
        this.previewStamp(x, y);
        if (phase === 'start') this.placeStamp(x, y);
        break;
    }
    this.canvas.selected = this.tool === 'entity' ? { x, y } : null;
  }

  /** §9.4 — show the footprint before the click, so what it covers is visible first. */
  private previewStamp(x: number, y: number): void {
    const stamp = this.stamps.byId(this.stampId);
    if (!stamp) return;
    const size = rotatedFootprint(stamp, this.stampTurns);
    this.canvas.preview = { x0: x, y0: y, x1: x + size.width - 1, y1: y + size.height - 1 };
  }

  /**
   * §9.4 — expand the stamp into ordinary tiles and entities, in one edit.
   *
   * One `doc.edit` call, so one undo step: the placement was one action and takes one
   * action to take back. After that the contents are ordinary map content — move a goal and
   * it is a field with a goal moved, not a broken instance of anything.
   *
   * Refused rather than clipped when it would fall off the map: half a soccer field is not
   * a thing anybody meant to place.
   */
  private placeStamp(x: number, y: number): void {
    const stamp = this.stamps.byId(this.stampId);
    if (!stamp) return;
    if (!stampFits(stamp, x, y, this.stampTurns, this.doc.width, this.doc.height)) {
      this.flash(`${stamp.label} does not fit there`);
      return;
    }

    const expanded = expandStamp(stamp, x, y, this.stampTurns);
    this.doc.edit((draft) => {
      for (const tile of expanded.tiles) {
        const layer = draft.layers[tile.layer];
        if (layer) layer[tile.y * draft.width + tile.x] = tile.id;
      }
      // A stamp writes over what is under it (§9.4) — that is what makes it useful for
      // laying ground — and an entity it covers goes with the tile it stood on.
      const covered = new Set(expanded.entities.map((e) => `${e.x},${e.y}`));
      draft.entities = draft.entities.filter((e) => !covered.has(`${e.x},${e.y}`));
      draft.entities.push(...expanded.entities);
    });

    // §9.4 — a quarter turn can point a note at the camera's blind side. Saying so here is
    // the whole reason `facing` rotates with the stamp rather than staying put: a note
    // silently left unreadable is the failure §9.2 exists to prevent.
    const hidden = expanded.entities.filter(
      (entity) =>
        entityChoice(entity.type)?.mustBeVisible === true &&
        !facingIsVisible(Number(entity.properties['facing'] ?? 0)),
    ).length;
    this.flash(
      hidden > 0
        ? `${stamp.label} placed · ${hidden} note(s) now face north, where the camera cannot read them (§9.2)`
        : `${stamp.label} placed`,
    );
  }

  /**
   * §9.4 — what can be done to one stamp: rename it, re-cut it from the map, throw it away.
   *
   * A sheet rather than more chips in the palette, because the palette is a strip a thumb
   * flicks through and three destructive-ish buttons hiding at the end of it is how the wrong
   * one gets pressed.
   *
   * The project's pieces get one action — take a copy — and everything else follows from
   * there. That copy keeps the id, so what comes out of the export lands back in
   * `stamps.json` over the entry it came from rather than beside it.
   */
  private showStampSheet(id: string): void {
    const stamp = this.stamps.byId(id);
    if (!stamp) return;

    const origin = this.stamps.origin(id);
    const shadows = this.stamps.shadows(id);

    this.selected = null;
    this.sheet.hidden = false;
    this.sheet.textContent = '';

    const title = document.createElement('div');
    title.className = 'ed-sheet-title';
    title.textContent = `${stamp.label} · ${stamp.width}×${stamp.height}`;
    this.sheet.append(title);

    const note = document.createElement('div');
    note.className = 'ed-hint';
    note.textContent =
      origin !== 'custom'
        ? `From the ${origin === 'project' ? 'project' : 'defaults'}. Take a copy to edit it; the copy keeps its name, so the export drops back over the original.`
        : shadows
          ? `Your copy of a ${shadows === 'project' ? 'project' : 'default'} piece. Exported under the same name, so it replaces the original.`
          : 'Captured in this browser. Exported with the library.';
    this.sheet.append(note);

    const close = (): void => {
      this.sheet.hidden = true;
    };
    const action = (
      label: string,
      name: string,
      onClick: () => void,
      danger = false,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset['name'] = name;
      button.textContent = label;
      if (danger) button.className = 'ed-danger';
      button.addEventListener('click', onClick);
      return button;
    };

    if (origin !== 'custom') {
      const actions = document.createElement('div');
      actions.className = 'ed-row';
      actions.append(
        action('Take a copy to edit', 'stamp-fork', () => {
          this.stamps.override(id);
          saveStamps(this.stamps);
          this.flash(`Editing your copy of ${stamp.label}`);
          this.refreshPalette();
          this.showStampSheet(id);
        }),
        action('Close', 'stamp-close', close),
      );
      this.sheet.append(actions);
      return;
    }

    const row = document.createElement('label');
    row.className = 'ed-row';
    row.append(Object.assign(document.createElement('span'), { textContent: 'name' }));
    const input = document.createElement('input');
    input.dataset['prop'] = 'stamp-rename';
    input.value = stamp.label;
    input.addEventListener('change', () => {
      if (!this.stamps.relabel(id, input.value)) return;
      saveStamps(this.stamps);
      this.flash(`Renamed to ${input.value.trim()}`);
      this.refreshPalette();
    });
    row.append(input);
    this.sheet.append(row);

    const actions = document.createElement('div');
    actions.className = 'ed-row';
    actions.append(
      action('Replace from selection', 'stamp-replace', () => {
        // Arms the same capture drag, pointed at this stamp: draw the fixed version in the
        // map, drag a rectangle round it, and this one becomes that.
        this.tool = 'stamp';
        this.capturing = true;
        this.capturingInto = id;
        this.rectStart = null;
        this.canvas.preview = null;
        close();
        this.flash(`Drag a rectangle to replace ${stamp.label}`);
        this.refreshPalette();
        this.refreshToolbar();
      }),
      action(
        shadows ? 'Revert' : 'Delete',
        'stamp-delete',
        () => {
          this.stamps.remove(id);
          saveStamps(this.stamps);
          if (!this.stamps.byId(this.stampId)) this.stampId = this.stamps.all[0]?.id ?? '';
          close();
          // Named after the revert, not before: the label being reverted *to* is the one
          // underneath, and saying the name that just went away reads as a failed delete.
          const revealed = this.stamps.byId(id);
          this.flash(
            revealed ? `Reverted to the ${shadows} ${revealed.label}` : `${stamp.label} deleted`,
          );
          this.refreshPalette();
        },
        true,
      ),
      action('Close', 'stamp-close', close),
    );
    this.sheet.append(actions);
  }

  /** §9.4 — name what the drag selected, and keep it. */
  private showCaptureSheet(rect: { x0: number; y0: number; x1: number; y1: number }): void {
    const width = Math.abs(rect.x1 - rect.x0) + 1;
    const height = Math.abs(rect.y1 - rect.y0) + 1;

    this.selected = null;
    this.sheet.hidden = false;
    this.sheet.textContent = '';

    const replacing = this.capturingInto ? this.stamps.byId(this.capturingInto) : null;

    const title = document.createElement('div');
    title.className = 'ed-sheet-title';
    title.textContent = replacing
      ? `Replace ${replacing.label} with ${width}×${height} tiles`
      : `New stamp from ${width}×${height} tiles`;

    const row = document.createElement('label');
    row.className = 'ed-row';
    row.append(Object.assign(document.createElement('span'), { textContent: 'name' }));
    const input = document.createElement('input');
    input.dataset['prop'] = 'stamp-label';
    input.placeholder = 'required';
    input.value = replacing?.label ?? '';
    row.append(input);

    const actions = document.createElement('div');
    actions.className = 'ed-row';
    const save = document.createElement('button');
    save.type = 'button';
    save.dataset['name'] = 'stamp-save';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const label = input.value.trim();
      if (!label) {
        this.flash('A stamp needs a name');
        return;
      }
      const target = this.capturingInto;
      if (target) {
        // §9.4 — replacing keeps the id, which is what lets an edited copy of a committed
        // piece drop back into `stamps.json` over the entry it came from.
        this.stamps.replace(target, captureStamp(this.doc, rect, target, label));
        this.stampId = target;
      } else {
        const id = uniqueStampId(label, this.stamps.all.map((stamp) => stamp.id));
        this.stampId = this.stamps.add(captureStamp(this.doc, rect, id, label));
      }
      saveStamps(this.stamps);
      this.capturing = false;
      this.capturingInto = null;
      this.sheet.hidden = true;
      this.flash(`${label} ${target ? 'replaced' : 'captured'} · ${width}×${height}`);
      this.refreshPalette();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.sheet.hidden = true;
    });
    actions.append(save, cancel);

    this.sheet.append(title, row, actions);
    input.focus();
  }

  private placeOrSelect(x: number, y: number): void {
    const existing = this.doc.entityAt(x, y);
    if (existing) {
      this.selected = existing;
      this.showSheet();
      return;
    }

    const choice = entityChoice(this.entityType);
    if (!choice) return;

    const properties: Record<string, string | number> = { ...choice.defaults };
    if (choice.mounts) {
      const options = mountOptions(
        x,
        y,
        (tx, ty) => isSolid(this.doc.tileAt(1, tx, ty)),
        choice.mustBeVisible === true,
      );
      if (options.length === 0) {
        // §9.2 — refused rather than written. A note with nowhere readable to mount is a
        // note the player can never read, and finding that out in a playthrough is exactly
        // what this editor exists to prevent.
        this.flash(
          choice.mustBeVisible === true
            ? `A note needs a wall to its north, east or west — a wall to the south hides it from the camera (§9.2)`
            : `A ${choice.label.toLowerCase()} needs a solid neighbour to mount on (§9.2)`,
        );
        return;
      }
      properties['facing'] = options[0]!;
    }

    this.doc.edit((draft) => {
      if (choice.unique) draft.entities = draft.entities.filter((e) => e.type !== choice.type);
      draft.entities = draft.entities.filter((e) => e.x !== x || e.y !== y);
      draft.entities.push({ type: choice.type, x, y, properties });
    });
    this.selected = this.doc.entityAt(x, y) ?? null;
    this.showSheet();
  }

  /** The properties §2 requires, as a form (§9.1). */
  private showSheet(): void {
    const entity = this.selected;
    if (!entity) {
      this.sheet.hidden = true;
      return;
    }
    const choice = entityChoice(entity.type);
    if (!choice) return;

    this.sheet.hidden = false;
    this.sheet.textContent = '';

    const title = document.createElement('div');
    title.className = 'ed-sheet-title';
    title.textContent = `${choice.label} at ${entity.x}, ${entity.y}`;
    this.sheet.append(title);

    const keys = [...new Set([...choice.required, ...Object.keys(choice.defaults)])];
    for (const key of keys) {
      const row = document.createElement('label');
      row.className = 'ed-row';
      row.append(Object.assign(document.createElement('span'), { textContent: key }));

      const options = choice.choices?.[key];
      if (key === 'facing' && choice.mounts) {
        row.append(this.facingControl(entity, choice));
      } else if (options) {
        row.append(this.choiceControl(entity, key, options));
      } else {
        const input = document.createElement('input');
        input.dataset['prop'] = key;
        input.value = String(entity.properties[key] ?? '');
        input.placeholder = choice.required.includes(key) ? 'required' : '';
        // §9.1 — the names already on the map, so a switch is wired to a lamp by picking
        // its group rather than by remembering how it was spelled.
        const role = choice.namesEntity?.[key];
        const suggestions = role ? nameSuggestions(this.doc.entities, role) : [];
        if (suggestions.length > 0) {
          const list = document.createElement('datalist');
          list.id = `ed-names-${key}`;
          for (const name of suggestions) {
            list.append(Object.assign(document.createElement('option'), { value: name }));
          }
          input.setAttribute('list', list.id);
          row.append(list);
        }
        input.addEventListener('change', () => {
          const raw = input.value;
          const numeric = Number(raw);
          this.doc.edit((draft) => {
            const target = draft.entities.find((e) => e.x === entity.x && e.y === entity.y);
            if (target) target.properties[key] = raw !== '' && !Number.isNaN(numeric) ? numeric : raw;
          });
          this.selected = this.doc.entityAt(entity.x, entity.y) ?? null;
        });
        row.append(input);
      }
      this.sheet.append(row);
    }

    const actions = document.createElement('div');
    actions.className = 'ed-row';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ed-danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      this.doc.edit((draft) => {
        draft.entities = draft.entities.filter((e) => e.x !== entity.x || e.y !== entity.y);
      });
      this.selected = null;
      this.sheet.hidden = true;
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      this.selected = null;
      this.sheet.hidden = true;
    });
    actions.append(remove, close);
    this.sheet.append(actions);
  }

  /**
   * A property with a fixed set of values, as buttons (§9.1).
   *
   * The same shape as the facing control, and for the same reason: on a phone a row of
   * buttons is one tap and a text field is a keyboard, a guess and a typo.
   */
  private choiceControl(
    entity: AuthoredEntity,
    key: string,
    options: readonly string[],
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ed-facing';
    const current = String(entity.properties[key] ?? '');
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset['choice'] = `${key}:${option}`;
      button.textContent = option;
      button.classList.toggle('is-on', option === current);
      button.addEventListener('click', () => {
        this.doc.edit((draft) => {
          const target = draft.entities.find((e) => e.x === entity.x && e.y === entity.y);
          if (target) target.properties[key] = option;
        });
        this.selected = this.doc.entityAt(entity.x, entity.y) ?? null;
        this.showSheet();
      });
      wrap.append(button);
    }
    return wrap;
  }

  /** Turning a mounted entity, restricted to the walls it could actually be on (§9.2). */
  private facingControl(entity: AuthoredEntity, choice: EntityChoice): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ed-facing';
    const options = mountOptions(
      entity.x,
      entity.y,
      (tx, ty) => isSolid(this.doc.tileAt(1, tx, ty)),
      choice.mustBeVisible === true,
    );
    const current = normalise(Number(entity.properties['facing'] ?? 0));

    if (options.length === 0) {
      wrap.textContent = 'no wall to mount on';
      wrap.classList.add('is-bad');
      return wrap;
    }
    for (const degrees of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[degrees] ?? String(degrees);
      button.classList.toggle('is-on', degrees === current);
      button.addEventListener('click', () => {
        this.doc.edit((draft) => {
          const target = draft.entities.find((e) => e.x === entity.x && e.y === entity.y);
          if (target) target.properties['facing'] = degrees;
        });
        this.selected = this.doc.entityAt(entity.x, entity.y) ?? null;
        this.showSheet();
      });
      wrap.append(button);
    }
    return wrap;
  }

  // --- The map library (§9.3) ---------------------------------------------

  /** The open map's name, with `•` for work that is not in the library yet. */
  private openLabel(): string {
    const name = this.open?.name ?? 'untitled';
    return this.isDirty() ? `${name} •` : name;
  }

  private isDirty(): boolean {
    return this.doc.version !== this.savedVersion;
  }

  /**
   * Put a document on screen as `open` (§9.3). One path for every way a map arrives — the
   * default at startup, a project map, one of this browser's — so "opening" means the same
   * thing each time: the undo stack goes, and what is on screen is what was saved.
   */
  private openDocument(map: unknown, open: OpenMap | null): void {
    this.doc.replace(EditorDocument.fromJson(map).toSnapshot());
    this.open = open;
    this.savedVersion = this.doc.version;
    this.selected = null;
    this.rectStart = null;
    this.canvas.preview = null;
    this.canvas.fit();
    this.refreshToolbar();
    // Written now rather than at the next edit: `frame` only autosaves when the document
    // version moves, and opening or saving changes which map the draft belongs to without
    // changing the document at all. A reload in between would come back under the old name.
    saveDraft(this.doc, this.open);
  }

  /**
   * §9.3 — open one of the project's maps, which are fetched rather than stored. A failure
   * leaves what is open alone: falling back to a blank grid would be discarding the
   * author's level because a network request did not land.
   */
  private async openProject(name: string, options: { silent?: boolean } = {}): Promise<void> {
    const map = await loadProjectMap(name, import.meta.env.BASE_URL);
    if (!map) {
      if (!options.silent) this.flash(`Could not load ${name}`);
      return;
    }
    this.openDocument(map, { source: 'project', name });
    if (!options.silent) this.flash(`Opened ${name} · read-only, Save makes a copy`);
  }

  /** §9.3 — anything that would lose work asks first, and only when there is work to lose. */
  private confirmDiscard(): boolean {
    if (!this.isDirty()) return true;
    return confirm(`${this.open?.name ?? 'This level'} has unsaved changes.\n\nDiscard them?`);
  }

  /**
   * §9.3 — write the open document into this browser's library under `name`, which is the
   * one operation that makes a map exist outside the draft.
   */
  private saveAs(name: string): void {
    this.maps = putMap(this.maps, name, this.doc.toMapJson());
    saveSavedMaps(this.maps);
    this.open = { source: 'browser', name };
    this.savedVersion = this.doc.version;
    this.refreshToolbar();
    saveDraft(this.doc, this.open);
    this.flash(`Saved ${name}`);
  }

  /**
   * §9.3 — the menu.
   *
   * A sheet like the rest of the editor's panels: on a phone a file dialog is not available
   * and a row of chips is not enough, since a map has to be opened, renamed and deleted.
   */
  private showMaps(): void {
    this.sheet.hidden = false;
    this.sheet.textContent = '';

    const title = document.createElement('div');
    title.className = 'ed-sheet-title';
    title.textContent = 'Maps';
    this.sheet.append(title);

    const hint = document.createElement('div');
    hint.className = 'ed-hint';
    hint.textContent = this.open
      ? this.open.source === 'project'
        ? `Editing ${this.open.name} — the project's, read-only. Saving makes a new map.`
        : `Editing ${this.open.name}${this.isDirty() ? ' — unsaved changes' : ' — saved'}`
      : 'Unsaved level. Give it a name to keep it in this browser.';
    this.sheet.append(hint);

    // --- Save --------------------------------------------------------------
    const nameRow = document.createElement('div');
    nameRow.className = 'ed-row';
    nameRow.append(Object.assign(document.createElement('span'), { textContent: 'Name' }));
    const input = document.createElement('input');
    input.value = canOverwrite(this.open)
      ? this.open!.name
      : uniqueMapName(this.maps, this.open?.name ?? 'untitled');
    input.placeholder = 'map name';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const name = normaliseMapName(input.value);
      if (name === null) {
        // §9.3 — the project's names are taken. Saying so beats writing a second `example`
        // into the list beside the one that cannot be changed.
        this.flash(
          isProjectMap(input.value.trim())
            ? `${input.value.trim()} is the project's — pick another name`
            : 'That name cannot be used',
        );
        return;
      }
      const existing = findMap(this.maps, name);
      const replacing = existing && name.toLowerCase() !== this.open?.name.toLowerCase();
      if (replacing && !confirm(`${existing.name} already exists.\n\nReplace it?`)) return;
      this.saveAs(name);
      this.showMaps();
    });
    nameRow.append(input, save);
    this.sheet.append(nameRow);

    // --- This browser's ----------------------------------------------------
    const mine = document.createElement('div');
    mine.className = 'ed-sheet-title';
    mine.textContent = 'In this browser';
    this.sheet.append(mine);

    if (this.maps.length === 0) {
      const none = document.createElement('div');
      none.className = 'ed-hint';
      none.textContent = 'Nothing saved here yet.';
      this.sheet.append(none);
    }

    for (const map of this.maps) {
      const row = document.createElement('div');
      row.className = 'ed-row ed-maprow';

      const openIt = document.createElement('button');
      openIt.type = 'button';
      openIt.className = 'ed-mapname';
      openIt.textContent = map.name;
      openIt.classList.toggle('is-on', this.open?.source === 'browser' && this.open.name === map.name);
      openIt.addEventListener('click', () => {
        if (!this.confirmDiscard()) return;
        this.openDocument(map.map, { source: 'browser', name: map.name });
        this.flash(`Opened ${map.name}`);
        this.showMaps();
      });

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = 'Rename';
      rename.addEventListener('click', () => {
        const to = prompt(`Rename ${map.name} to`, map.name);
        if (to === null) return;
        const next = renameMap(this.maps, map.name, to);
        const named = normaliseMapName(to);
        if (named === null || next === this.maps) {
          this.flash(`Could not rename to "${to.trim()}"`);
          return;
        }
        this.maps = next;
        saveSavedMaps(this.maps);
        if (this.open?.source === 'browser' && this.open.name === map.name) {
          this.open = { source: 'browser', name: named };
        }
        this.refreshToolbar();
        this.showMaps();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ed-danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        if (!confirm(`Delete ${map.name}?\n\nThis browser is the only place it exists.`)) return;
        this.maps = deleteMap(this.maps, map.name);
        saveSavedMaps(this.maps);
        // What is on screen stays on screen: deleting the entry a document came from does
        // not close it, it just leaves it unsaved again.
        if (this.open?.source === 'browser' && this.open.name === map.name) {
          this.open = null;
          saveDraft(this.doc, null);
        }
        this.refreshToolbar();
        this.showMaps();
      });

      row.append(openIt, rename, remove);
      this.sheet.append(row);
    }

    // --- The project's -----------------------------------------------------
    const theirs = document.createElement('div');
    theirs.className = 'ed-sheet-title';
    theirs.textContent = 'In the project';
    const theirsHint = document.createElement('div');
    theirsHint.className = 'ed-hint';
    theirsHint.textContent = 'Read-only. Open one to work from it; saving writes a new map.';
    this.sheet.append(theirs, theirsHint);

    const chips = document.createElement('div');
    chips.className = 'ed-row ed-mapchips';
    for (const name of PROJECT_MAPS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = name;
      chip.classList.toggle('is-on', this.open?.source === 'project' && this.open.name === name);
      chip.addEventListener('click', () => {
        if (!this.confirmDiscard()) return;
        void this.openProject(name).then(() => this.showMaps());
      });
      chips.append(chip);
    }
    this.sheet.append(chips);

    const actions = document.createElement('div');
    actions.className = 'ed-row';
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.textContent = 'New';
    blank.addEventListener('click', () => {
      if (!this.confirmDiscard()) return;
      this.openDocument(EditorDocument.blank().toMapJson(), null);
      this.flash('New level');
      this.showMaps();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      this.sheet.hidden = true;
    });
    actions.append(blank, close);
    this.sheet.append(actions);
  }

  // --- Getting it out ------------------------------------------------------

  /** §9.3 — the whole map.json as text, in one action. */
  private async copy(): Promise<void> {
    const text = JSON.stringify(this.doc.toMapJson(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.flash(`Copied ${text.length.toLocaleString()} characters`);
    } catch {
      // iOS refuses the clipboard outside a user gesture it recognises; a selectable
      // textarea is the fallback that always works.
      this.showDump(text, null);
    }
  }

  /**
   * §9.4 — the captured stamps, out and back in.
   *
   * One panel for both directions because they are one workflow: the text you copy out is
   * the text you paste back, and a screen that showed you the export but made you find
   * another button to import would be two ways of looking at the same field.
   *
   * The built-ins are not in it. They are in the project already, and exporting them would
   * mean importing them back as duplicates of themselves.
   */
  private showStampJson(): void {
    const text = formatStampFile(this.stamps.toJson());
    const count = this.stamps.custom.length;
    this.showDump(text, (edited) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(edited);
      } catch (error) {
        this.flash(`That is not JSON: ${String(error)}`);
        return false;
      }
      const incoming = stampsFromJson(parsed);
      if (incoming.length === 0) {
        this.flash('No stamps in that');
        return false;
      }
      const loaded = this.stamps.merge(incoming);
      saveStamps(this.stamps);
      if (!this.stamps.byId(this.stampId)) this.stampId = this.stamps.all[0]?.id ?? '';
      this.flash(`${loaded} stamp(s) loaded`);
      this.refreshPalette();
      return true;
    }, count === 0 ? 'No stamps captured yet — paste some here to load them' : undefined);
    void navigator.clipboard?.writeText(text).then(
      () => this.flash(`Copied ${count} stamp(s)`),
      () => undefined,
    );
  }

  /**
   * A full-screen text panel: the export you can select, and — when `onApply` is given — the
   * field you paste back into.
   *
   * The one path that always works on a phone (§9.3): no file system, no download
   * permission, and no clipboard permission needed to *read* the text out.
   */
  private showDump(
    text: string,
    onApply: ((edited: string) => boolean) | null,
    placeholder?: string,
  ): void {
    const area = document.createElement('textarea');
    area.className = 'ed-dump';
    area.value = text;
    area.readOnly = onApply === null;
    if (placeholder) area.placeholder = placeholder;

    const actions = document.createElement('div');
    actions.className = 'ed-dumpbar';

    if (onApply) {
      const load = document.createElement('button');
      load.type = 'button';
      load.dataset['name'] = 'dump-load';
      load.textContent = 'Load';
      load.addEventListener('click', () => {
        if (onApply(area.value)) wrap.remove();
      });
      actions.append(load);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.dataset['name'] = 'dump-done';
    close.textContent = 'Done';
    close.addEventListener('click', () => wrap.remove());
    actions.append(close);

    const wrap = document.createElement('div');
    wrap.className = 'ed-dumpwrap';
    wrap.append(area, actions);
    this.root.append(wrap);
    area.select();
  }

  /** §9.3 — hand the level to the game without a round trip through the repository. */
  private play(): void {
    const blocking = this.audit?.blocking ?? [];
    if (blocking.length > 0 && !confirm(`${blocking[0]!.message}\n\nPlay anyway?`)) return;
    localStorage.setItem(PLAYTEST_KEY, JSON.stringify(this.doc.toMapJson()));
    window.location.search = '?map=playtest&debug=1';
  }

  private flash(message: string): void {
    this.statusBar.dataset['flash'] = message;
    window.setTimeout(() => delete this.statusBar.dataset['flash'], 4000);
  }

  // --- The loop ------------------------------------------------------------

  private frame(): void {
    if (this.doc.version !== this.lastAudited) {
      this.lastAudited = this.doc.version;
      this.audit = this.runAudit();
      this.refreshToolbar();
      // Autosaved here rather than at each call site, for the same reason history is
      // recorded in one place: undo and redo change the document too, and a draft saved
      // only where an edit happens comes back with the undone edit still in it.
      saveDraft(this.doc, this.open);
    }
    this.statusBar.textContent = this.statusText();
    this.canvas.draw();
    requestAnimationFrame(() => this.frame());
  }

  /**
   * §9 — the audit, live. Runs through the game's own validator, so what the editor calls
   * a level and what the game calls one cannot drift apart.
   */
  private runAudit(): AuditResult | null {
    try {
      const tileset = parseTileset({
        tiles: Object.fromEntries(
          [...FLOOR_TILES, ...OBSTACLE_TILES].map((tile) => [
            tile.id,
            { prefab: tile.id === 0 ? null : tile.label.toLowerCase(), solid: tile.solid },
          ]),
        ),
      });
      const map = parseMap(this.doc.toMapJson(), tileset);
      return auditMap(map, tileset, new EntityRegistry(map.entities));
    } catch (error) {
      this.flash(String(error));
      return null;
    }
  }

  private statusText(): string {
    const flash = this.statusBar.dataset['flash'];
    if (flash) return flash;

    const incomplete = this.doc.entities.filter((e) => missingProperties(e).length > 0).length;
    if (incomplete > 0) return `${incomplete} entity(s) missing a required property`;

    if (!this.audit) return `${this.doc.width}×${this.doc.height}`;
    const blocking = this.audit.blocking;
    if (blocking.length > 0) {
      const more = blocking.length > 1 ? ` (+${blocking.length - 1})` : '';
      return `⚠ ${blocking[0]!.message}${more}`;
    }
    // §9 — the first warning in full, not a tally of them. A count is a number you learn
    // to ignore: "3 warning(s)" is what an author reads while placing lamps that will
    // never come on, and the sentence that would have told them so is one the editor
    // already has. `Checks` has the rest.
    const warnings = this.audit.findings;
    const first = warnings[0];
    if (first) {
      const more = warnings.length > 1 ? ` (+${warnings.length - 1})` : '';
      return `${first.message}${more}`;
    }
    return `clean · ${this.audit.reachableTiles} tiles reachable`;
  }

  /** §9 — everything the audit found, as a list rather than as the one line that fits. */
  private showChecks(): void {
    this.selected = null;
    this.sheet.hidden = false;
    this.sheet.textContent = '';

    const title = document.createElement('div');
    title.className = 'ed-sheet-title';
    const findings = this.audit?.findings ?? [];
    title.textContent = findings.length === 0 ? 'Checks — nothing to report' : 'Checks';
    this.sheet.append(title);

    const incomplete = this.doc.entities.filter((e) => missingProperties(e).length > 0);
    for (const entity of incomplete) {
      const row = document.createElement('div');
      row.className = 'ed-note is-bad';
      row.textContent = `${entity.type} at ${entity.x}, ${entity.y}: ${missingProperties(entity).join(', ')} not set`;
      this.sheet.append(row);
    }

    for (const finding of findings) {
      const row = document.createElement('div');
      row.className = 'ed-note';
      if (finding.severity === 'blocking') row.classList.add('is-bad');
      row.textContent = `${finding.severity === 'blocking' ? '⚠ ' : ''}${finding.message}`;
      this.sheet.append(row);
    }

    if (this.audit) {
      const row = document.createElement('div');
      row.className = 'ed-note';
      row.textContent = `${this.audit.reachableTiles} tiles reachable · ${this.audit.strandedTiles} stranded`;
      this.sheet.append(row);
    }

    const actions = document.createElement('div');
    actions.className = 'ed-row';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      this.sheet.hidden = true;
    });
    actions.append(close);
    this.sheet.append(actions);
  }
}

function isSolid(tileId: number): boolean {
  return [...FLOOR_TILES, ...OBSTACLE_TILES].find((t) => t.id === tileId)?.solid === true;
}

function saveDraft(doc: EditorDocument, open: OpenMap | null): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ open, map: doc.toMapJson() }));
  } catch {
    // A full or disabled store is not a reason to stop editing.
  }
}

function loadDraft(): { doc: EditorDocument; open: OpenMap | null } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const wrapper = parsed as { open?: unknown; map?: unknown };
    // A draft written before there was a library is the bare `map.json`. Read it as one
    // rather than dropping it: it is unsaved work, and it is the only copy of it.
    const map = wrapper?.map ?? parsed;
    return { doc: EditorDocument.fromJson(map), open: readOpen(wrapper?.open) };
  } catch {
    return null;
  }
}

/** A stored `open` is only believed if it still describes a map that could exist (§9.3). */
function readOpen(raw: unknown): OpenMap | null {
  const open = raw as Partial<OpenMap> | null | undefined;
  if (!open || typeof open.name !== 'string') return null;
  if (open.source === 'project') return isProjectMap(open.name) ? { source: 'project', name: open.name } : null;
  if (open.source === 'browser') return { source: 'browser', name: open.name };
  return null;
}
