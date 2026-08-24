/**
 * Gates swinging open (§6.4).
 *
 * A gate is a tile, not an entity mesh: the `Gate` entity names a tile whose Layer 1 id is
 * a gate prefab, and opening it has to move three things that are normally static — the
 * instanced tile, the walkability grid (§2) and the collider index (§3.1).
 *
 * **Walkability and the collider flip when the swing completes**, not when it starts. A
 * gate that can be walked through while it still looks shut reads as broken, and 0.6 s is
 * short enough that waiting for it never feels like being held up. It also means an enemy's
 * A\* sees the new route at the same moment the player does, which is the honest ordering.
 *
 * The hinge is derived rather than authored: the map format has no hinge field, and a gate
 * filling a doorway always has a solid neighbour to hang off. Without one it turns in place,
 * which is the degenerate case and looks like nothing much.
 */

import * as THREE from 'three';
import { INTERACTION } from '../config';
import type { MapGeometry } from '../map/MapGeometry';
import type { ExitGateEntity, GateEntity } from '../map/types';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';
import type { ColliderIndex } from '../player/collision';

interface Swing {
  entity: GateEntity | ExitGateEntity;
  tileIndex: number;
  /** Hinge in world space — the tile edge the gate turns about. */
  hingeX: number;
  hingeZ: number;
  elapsed: number;
  settled: boolean;
}

export class Gates {
  private readonly swinging: Swing[] = [];
  private _opened = 0;

  constructor(
    private readonly geometry: MapGeometry,
    private readonly grid: WalkabilityGrid,
    private readonly colliders: ColliderIndex,
    private readonly mapWidth: number,
    private readonly tileSize: number,
  ) {}

  /** Gates part-way through their swing — the readout's number. */
  get swingingCount(): number {
    return this.swinging.filter((swing) => !swing.settled).length;
  }

  get openedCount(): number {
    return this._opened;
  }

  /** Start a gate swinging (§6.4). Called from `Objectives`' gate-open event. */
  open(entity: GateEntity | ExitGateEntity): void {
    if (this.swinging.some((swing) => swing.entity === entity)) return;
    const { hingeX, hingeZ } = this.hingeFor(entity.gx, entity.gy);
    this.swinging.push({
      entity,
      tileIndex: entity.gy * this.mapWidth + entity.gx,
      hingeX,
      hingeZ,
      elapsed: 0,
      settled: false,
    });
    this._opened += 1;
  }

  /**
   * The tile edge to turn about: the first solid neighbour in west, east, north, south
   * order. Fixed order rather than clever, because two neighbours is the normal case for a
   * gate in a wall run and the choice between them is arbitrary — what matters is that it
   * is the same every run (Cross-Cutting: determinism).
   */
  private hingeFor(gx: number, gy: number): { hingeX: number; hingeZ: number } {
    const centreX = (gx + 0.5) * this.tileSize;
    const centreZ = (gy + 0.5) * this.tileSize;
    const half = this.tileSize / 2;

    const candidates: [number, number, number, number][] = [
      [gx - 1, gy, centreX - half, centreZ],
      [gx + 1, gy, centreX + half, centreZ],
      [gx, gy - 1, centreX, centreZ - half],
      [gx, gy + 1, centreX, centreZ + half],
    ];
    for (const [nx, ny, hingeX, hingeZ] of candidates) {
      if (!this.grid.isWalkable(nx, ny)) return { hingeX, hingeZ };
    }
    return { hingeX: centreX, hingeZ: centreZ };
  }

  /** One simulation tick (§7): advance every swing, and settle the ones that finish. */
  tick(dt: number): void {
    for (const swing of this.swinging) {
      if (swing.settled) continue;
      swing.elapsed = Math.min(INTERACTION.gateSwingSeconds, swing.elapsed + dt);
      this.place(swing, swing.elapsed / INTERACTION.gateSwingSeconds);
      if (swing.elapsed < INTERACTION.gateSwingSeconds) continue;

      // §6.4 — the tile stops blocking only now. Both have to move together: the grid is
      // what A\* reads and the index is what walking hits, and a gate open to one and shut
      // to the other is a route enemies can take and the player cannot, or the reverse.
      swing.settled = true;
      this.grid.setOverride(swing.entity.gx, swing.entity.gy, true);
      this.colliders.removeAt(swing.entity.gx, swing.entity.gy);
    }
  }

  /** Rotate the tile `progress` of the way through a quarter turn about its hinge. */
  private place(swing: Swing, progress: number): void {
    // Eased, so the gate starts and stops rather than snapping into motion. Presentation
    // only: §6.4's timing is the 0.6 s, and the curve inside it is a look.
    const eased = progress * progress * (3 - 2 * progress);
    const angle = (Math.PI / 2) * eased;

    _matrix
      .makeTranslation(swing.hingeX, 0, swing.hingeZ)
      .multiply(_rotation.makeRotationY(angle))
      .multiply(_offset.makeTranslation(-swing.hingeX, 0, -swing.hingeZ))
      .multiply(_rest.copy(this.restFor(swing.tileIndex)));
    this.geometry.setObstacleTransform(swing.tileIndex, _matrix);
  }

  private restFor(tileIndex: number): THREE.Matrix4 {
    return this.geometry.obstacleInstances.get(tileIndex)?.rest ?? _identity;
  }
}

const _matrix = new THREE.Matrix4();
const _rotation = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _rest = new THREE.Matrix4();
const _identity = new THREE.Matrix4();
