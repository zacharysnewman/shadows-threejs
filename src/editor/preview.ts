/**
 * A whole map drawn small, for the library to show what it is about to open (§9.3).
 *
 * Not a second canvas implementation: it draws the same tile colours `TileCanvas` does, at
 * whatever zoom fits, with no panning, no grid and no selection — a picture rather than a
 * surface. What it is for is telling `phase5-test` from `phase8-test` at a glance, which a
 * list of names cannot do.
 *
 * The fit is separated from the drawing because the fit is the part that can be wrong in a
 * way nobody notices: a map that overflows its box, or one that is not centred in it.
 */

import type { DocumentSnapshot } from './Document';
import { FLOOR_TILES, OBSTACLE_TILES, entityChoice } from './palette';

/** Breathing room so a map's edge tiles are not flush against the border. */
const PADDING = 6;

export interface PreviewFit {
  /** Pixels per tile. */
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit `mapWidth × mapHeight` tiles inside `width × height` pixels, centred, whole.
 *
 * The smaller of the two ratios, so the long side is what decides — the other way round is
 * how a wide map ends up with its bottom rows outside the box.
 */
export function previewFit(
  mapWidth: number,
  mapHeight: number,
  width: number,
  height: number,
): PreviewFit {
  const usableWidth = Math.max(0, width - PADDING * 2);
  const usableHeight = Math.max(0, height - PADDING * 2);
  const zoom = Math.max(0, Math.min(usableWidth / mapWidth, usableHeight / mapHeight));
  return {
    zoom,
    offsetX: (width - mapWidth * zoom) / 2,
    offsetY: (height - mapHeight * zoom) / 2,
  };
}

/**
 * Draw the map into the whole of `context`'s canvas.
 *
 * Both layers, then the entities as dots — the same three passes and the same colours the
 * editor's canvas uses, so a preview and the thing it previews look like each other.
 */
export function drawMapPreview(
  context: CanvasRenderingContext2D,
  snapshot: DocumentSnapshot,
  width: number,
  height: number,
): void {
  context.fillStyle = '#0a0c11';
  context.fillRect(0, 0, width, height);

  const { zoom, offsetX, offsetY } = previewFit(snapshot.width, snapshot.height, width, height);
  if (zoom <= 0) return;

  const floorLayer = snapshot.layers[0] ?? [];
  const wallLayer = snapshot.layers[1] ?? [];

  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const index = y * snapshot.width + x;
      const sx = offsetX + x * zoom;
      const sy = offsetY + y * zoom;

      const floor = FLOOR_TILES.find((t) => t.id === floorLayer[index]);
      context.fillStyle = floor?.colour ?? '#0b0d12';
      // Overdrawn by a hair, or the rounding between neighbours leaves a grid of seams at
      // the sub-pixel zooms a thumbnail runs at.
      context.fillRect(sx, sy, zoom + 0.5, zoom + 0.5);

      const obstacle = OBSTACLE_TILES.find((t) => t.id === wallLayer[index]);
      if (obstacle && obstacle.id !== 0) {
        context.fillStyle = obstacle.colour;
        context.fillRect(sx, sy, zoom + 0.5, zoom + 0.5);
      }
    }
  }

  // Big enough to see at a thumbnail's zoom, which is what they are here for: where the
  // spawn, the exit and the enemies are is most of what tells two maps apart.
  const radius = Math.max(1.5, zoom * 0.6);
  for (const entity of snapshot.entities) {
    const choice = entityChoice(entity.type);
    if (!choice) continue;
    context.fillStyle = choice.colour;
    context.beginPath();
    context.arc(offsetX + (entity.x + 0.5) * zoom, offsetY + (entity.y + 0.5) * zoom, radius, 0, Math.PI * 2);
    context.fill();
  }
}
