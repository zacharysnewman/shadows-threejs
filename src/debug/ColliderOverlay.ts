/**
 * Debug visualisation of the merged Layer 1 colliders (§2, §3.1).
 *
 * Drawn as wireframe boxes so the greedy merge is inspectable: a long wall should be one
 * box, not one per tile, and Phase 2's capsule sliding is much easier to reason about when
 * the actual collision volumes are visible rather than inferred from the art.
 */

import * as THREE from 'three';
import type { BoxCollider } from '../map/types';

export class ColliderOverlay {
  readonly object: THREE.Object3D;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor(colliders: readonly BoxCollider[]) {
    const group = new THREE.Group();
    group.name = 'DebugColliders';
    group.visible = false;

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false });
    const edges = new THREE.EdgesGeometry(this.geometry);

    for (const collider of colliders) {
      const lines = new THREE.LineSegments(edges, this.material);
      lines.position.set(collider.cx, collider.height / 2, collider.cz);
      lines.scale.set(collider.hx * 2, collider.height, collider.hz * 2);
      lines.renderOrder = 3;
      group.add(lines);
    }

    this.object = group;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  toggle(): void {
    this.object.visible = !this.object.visible;
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.LineSegments) node.geometry.dispose();
    });
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
