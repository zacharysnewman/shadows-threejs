/**
 * Debug visualisation of the walkability grid (§2, Cross-Cutting).
 *
 * One flat instanced quad per tile, green for walkable and red for blocked, floating a
 * few centimetres above the floor. It subscribes to the grid's change event, so a gate
 * flipping a tile at runtime (§6) is visible immediately without anyone re-driving it.
 */

import * as THREE from 'three';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';

const WALKABLE = new THREE.Color(0x2f9e5f);
const BLOCKED = new THREE.Color(0xb02f3a);

export class WalkabilityOverlay {
  readonly object: THREE.Object3D;

  private readonly mesh: THREE.InstancedMesh;
  private readonly unsubscribe: () => void;

  constructor(private readonly grid: WalkabilityGrid) {
    const count = grid.width * grid.height;
    const size = grid.tileSize * 0.92;

    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = 'DebugWalkability';
    this.mesh.frustumCulled = false;
    // Debug-only geometry must never influence the shadow budget it exists to inspect.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;

    const matrix = new THREE.Matrix4();
    for (let gy = 0; gy < grid.height; gy += 1) {
      for (let gx = 0; gx < grid.width; gx += 1) {
        const { wx, wz } = grid.gridToWorld(gx, gy);
        matrix.makeTranslation(wx, 0.05, wz);
        this.mesh.setMatrixAt(grid.index(gx, gy), matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.object = this.mesh;
    this.refresh();
    this.unsubscribe = grid.onChange(() => this.refresh());
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  toggle(): void {
    this.mesh.visible = !this.mesh.visible;
  }

  refresh(): void {
    for (let gy = 0; gy < this.grid.height; gy += 1) {
      for (let gx = 0; gx < this.grid.width; gx += 1) {
        const i = this.grid.index(gx, gy);
        this.mesh.setColorAt(i, this.grid.isWalkable(gx, gy) ? WALKABLE : BLOCKED);
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.unsubscribe();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
