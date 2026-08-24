/**
 * The map, drawn and touched (§9, Phase 12).
 *
 * A 2D canvas rather than the game's renderer: an editor wants a flat, legible plan view
 * with grid lines and labels, which is a different picture from the one the game draws and
 * a much cheaper one to keep at 60 fps on a phone.
 *
 * **One finger paints, two fingers move the map.** No mode switch between drawing and
 * panning, because a mode switch is a thing to forget mid-stroke and the gesture is already
 * universal in painting apps. Pinch zooms about the midpoint of the two fingers, so the map
 * moves under the fingers rather than under the screen's centre.
 */

import type { EditorDocument } from './Document';
import { entityChoice, missingProperties } from './palette';
import { FLOOR_TILES, OBSTACLE_TILES } from './palette';

export interface View {
  /** Pixels per tile. */
  zoom: number;
  /** Top-left of the view, in tile coordinates. */
  panX: number;
  panY: number;
}

export type PaintHandler = (x: number, y: number, phase: 'start' | 'move' | 'end') => void;

const MIN_ZOOM = 8;
const MAX_ZOOM = 96;

export class TileCanvas {
  readonly element: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private view: View = { zoom: 28, panX: 0, panY: 0 };

  /** Live pointers, so one-versus-two fingers can be told apart. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: { distance: number; centreX: number; centreY: number } | null = null;
  private painting = false;
  private lastPainted = '';

  onPaint: PaintHandler | null = null;
  /** Which layer is being edited; the other is drawn faded for reference (§9.1). */
  activeLayer = 1;
  /** Tile the entity tool is hovering, drawn as a target. */
  selected: { x: number; y: number } | null = null;
  /** A rectangle being dragged out, drawn as a preview until it is committed (§9.1). */
  preview: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /** Last tile a pointer was over, so the gesture can be finished where it ended. */
  private lastTile = { x: -1, y: -1 };

  constructor(private readonly document_: EditorDocument) {
    this.element = window.document.createElement('canvas');
    this.element.className = 'ed-canvas';
    // The browser's own pan/zoom would fight every gesture; this owns them all.
    this.element.style.touchAction = 'none';
    const context = this.element.getContext('2d');
    if (!context) throw new Error('no 2d context');
    this.context = context;

    this.element.addEventListener('pointerdown', (e) => this.down(e));
    this.element.addEventListener('pointermove', (e) => this.move(e));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.element.addEventListener(type, (e) => this.up(e));
    }
    this.element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  /** Fit the whole map on screen — where a session starts, and what "reset view" does. */
  fit(): void {
    const width = this.element.clientWidth || 1;
    const height = this.element.clientHeight || 1;
    const zoom = Math.min(width / this.document_.width, height / this.document_.height);
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.view.panX = this.document_.width / 2 - width / this.view.zoom / 2;
    this.view.panY = this.document_.height / 2 - height / this.view.zoom / 2;
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.element.width = Math.floor(this.element.clientWidth * ratio);
    this.element.height = Math.floor(this.element.clientHeight * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private tileAtClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return {
      x: Math.floor((clientX - rect.left) / this.view.zoom + this.view.panX),
      y: Math.floor((clientY - rect.top) / this.view.zoom + this.view.panY),
    };
  }

  private down(event: PointerEvent): void {
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      // A second finger cancels the stroke the first one started: the user is reaching for
      // the map, not drawing a line to where their thumb happened to land.
      this.painting = false;
      this.startGesture();
      return;
    }
    if (this.pointers.size > 2) return;

    this.painting = true;
    this.lastPainted = '';
    this.paintAt(event, 'start');
  }

  private move(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      this.pinch();
      return;
    }
    if (this.painting) this.paintAt(event, 'move');
  }

  private up(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pointers.size < 2) this.gesture = null;
    if (this.pointers.size === 0 && this.painting) {
      this.painting = false;
      // Reported at the tile the gesture ended on, not at a sentinel: a rectangle is
      // committed on release, and it needs to know which corner the finger lifted from.
      this.onPaint?.(this.lastTile.x, this.lastTile.y, 'end');
    }
  }

  private paintAt(event: PointerEvent, phase: 'start' | 'move'): void {
    const { x, y } = this.tileAtClient(event.clientX, event.clientY);
    // One callback per tile entered, not per pointer event: a slow drag across one tile
    // fires dozens of moves, and each would otherwise be an undo step.
    this.lastTile = { x, y };
    const key = `${x},${y}`;
    if (phase === 'move' && key === this.lastPainted) return;
    this.lastPainted = key;
    this.onPaint?.(x, y, phase);
  }

  private startGesture(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.gesture = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      centreX: (a.x + b.x) / 2,
      centreY: (a.y + b.y) / 2,
    };
  }

  private pinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b || !this.gesture) return;

    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const centreX = (a.x + b.x) / 2;
    const centreY = (a.y + b.y) / 2;
    const rect = this.element.getBoundingClientRect();

    // Zoom about the fingers' midpoint: the tile under the pinch has to stay under it, or
    // the map slides away while being scaled and the gesture feels like it is fighting back.
    const before = {
      x: (centreX - rect.left) / this.view.zoom + this.view.panX,
      y: (centreY - rect.top) / this.view.zoom + this.view.panY,
    };
    if (this.gesture.distance > 0) {
      const scale = distance / this.gesture.distance;
      this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * scale));
    }
    this.view.panX = before.x - (centreX - rect.left) / this.view.zoom;
    this.view.panY = before.y - (centreY - rect.top) / this.view.zoom;

    this.gesture = { distance, centreX, centreY };
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const before = {
      x: (event.clientX - rect.left) / this.view.zoom + this.view.panX,
      y: (event.clientY - rect.top) / this.view.zoom + this.view.panY,
    };
    const scale = Math.exp(-event.deltaY * 0.0015);
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * scale));
    this.view.panX = before.x - (event.clientX - rect.left) / this.view.zoom;
    this.view.panY = before.y - (event.clientY - rect.top) / this.view.zoom;
  }

  /** Draw the whole map. Called per frame; at 50×50 that is 2,500 rectangles and cheap. */
  draw(): void {
    const doc = this.document_;
    const { zoom, panX, panY } = this.view;
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;

    this.context.fillStyle = '#0a0c11';
    this.context.fillRect(0, 0, width, height);

    // Only the tiles actually on screen, so a big map does not cost more to edit than a
    // small one.
    const x0 = Math.max(0, Math.floor(panX));
    const y0 = Math.max(0, Math.floor(panY));
    const x1 = Math.min(doc.width, Math.ceil(panX + width / zoom) + 1);
    const y1 = Math.min(doc.height, Math.ceil(panY + height / zoom) + 1);

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const sx = (x - panX) * zoom;
        const sy = (y - panY) * zoom;

        const floor = FLOOR_TILES.find((t) => t.id === doc.tileAt(0, x, y));
        this.context.fillStyle = floor?.colour ?? '#0b0d12';
        this.context.globalAlpha = this.activeLayer === 0 ? 1 : 0.55;
        this.context.fillRect(sx, sy, zoom, zoom);

        const obstacle = OBSTACLE_TILES.find((t) => t.id === doc.tileAt(1, x, y));
        if (obstacle && obstacle.id !== 0) {
          this.context.globalAlpha = this.activeLayer === 1 ? 1 : 0.5;
          this.context.fillStyle = obstacle.colour;
          this.context.fillRect(sx + zoom * 0.06, sy + zoom * 0.06, zoom * 0.88, zoom * 0.88);
        }
        this.context.globalAlpha = 1;
      }
    }

    if (zoom >= 14) {
      this.context.strokeStyle = 'rgba(255,255,255,0.06)';
      this.context.lineWidth = 1;
      this.context.beginPath();
      for (let x = x0; x <= x1; x += 1) {
        const sx = Math.floor((x - panX) * zoom) + 0.5;
        this.context.moveTo(sx, 0);
        this.context.lineTo(sx, height);
      }
      for (let y = y0; y <= y1; y += 1) {
        const sy = Math.floor((y - panY) * zoom) + 0.5;
        this.context.moveTo(0, sy);
        this.context.lineTo(width, sy);
      }
      this.context.stroke();
    }

    for (const entity of doc.entities) {
      const choice = entityChoice(entity.type);
      if (!choice) continue;
      const sx = (entity.x - panX) * zoom;
      const sy = (entity.y - panY) * zoom;
      if (sx < -zoom || sy < -zoom || sx > width || sy > height) continue;

      const incomplete = missingProperties(entity).length > 0;
      this.context.fillStyle = incomplete ? '#ff5c5c' : choice.colour;
      this.context.beginPath();
      this.context.arc(sx + zoom / 2, sy + zoom / 2, zoom * 0.34, 0, Math.PI * 2);
      this.context.fill();

      // §9.2 — which way it faces, as a notch, so a mounted note reads at a glance.
      const facing = Number(entity.properties['facing'] ?? NaN);
      if (Number.isFinite(facing)) {
        const radians = (facing * Math.PI) / 180;
        this.context.strokeStyle = '#0a0c11';
        this.context.lineWidth = Math.max(2, zoom * 0.09);
        this.context.beginPath();
        this.context.moveTo(sx + zoom / 2, sy + zoom / 2);
        this.context.lineTo(
          sx + zoom / 2 + Math.sin(radians) * zoom * 0.42,
          sy + zoom / 2 - Math.cos(radians) * zoom * 0.42,
        );
        this.context.stroke();
      }

      if (zoom >= 18) {
        this.context.fillStyle = '#0a0c11';
        this.context.font = `600 ${Math.floor(zoom * 0.36)}px ui-sans-serif, system-ui, sans-serif`;
        this.context.textAlign = 'center';
        this.context.textBaseline = 'middle';
        this.context.fillText(choice.glyph, sx + zoom / 2, sy + zoom / 2 + 1);
      }
    }

    if (this.preview) {
      const { x0, y0, x1, y1 } = this.preview;
      this.context.fillStyle = 'rgba(122,178,255,0.28)';
      this.context.strokeStyle = '#7ab2ff';
      this.context.lineWidth = 2;
      const left = (Math.min(x0, x1) - panX) * zoom;
      const top = (Math.min(y0, y1) - panY) * zoom;
      const w = (Math.abs(x1 - x0) + 1) * zoom;
      const h = (Math.abs(y1 - y0) + 1) * zoom;
      this.context.fillRect(left, top, w, h);
      this.context.strokeRect(left + 1, top + 1, w - 2, h - 2);
    }

    if (this.selected) {
      this.context.strokeStyle = '#ffffff';
      this.context.lineWidth = 2;
      this.context.strokeRect(
        (this.selected.x - panX) * zoom + 1,
        (this.selected.y - panY) * zoom + 1,
        zoom - 2,
        zoom - 2,
      );
    }
  }
}
