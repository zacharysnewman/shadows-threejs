/**
 * Placeholder markers for parsed map entities (§2).
 *
 * Phase 1 stops short of spawning real entities — that is Phases 5, 7, 8 and 9 — but the
 * records still need to be visible on the map to confirm the grid→world mapping and the
 * tile-centre offset. Each marker is a coloured post at its entity's tile centre, tagged
 * with the entity record in `userData` so later phases can replace them in place.
 */

import * as THREE from 'three';
import type { EntityType, MapEntity } from '../map/types';
import type { EntityRegistry } from '../map/EntityRegistry';

const COLORS: Record<EntityType, number> = {
  PlayerSpawn: 0x4fc3f7,
  Flashlight: 0xffe082,
  Note: 0xf5f5f5,
  PowerSwitch: 0x81c784,
  EnvironmentLight: 0xfff176,
  Gate: 0xba68c8,
  ExitGate: 0xff8a65,
  SpiderEnemy: 0xe57373,
  ShadowMonster: 0x7e57c2,
};

const MARKER_HEIGHT = 1.2;
const MARKER_RADIUS = 0.22;

export class EntityMarkers {
  readonly object: THREE.Object3D;

  private readonly geometry: THREE.CylinderGeometry;
  private readonly materials: THREE.MeshBasicMaterial[] = [];

  constructor(registry: EntityRegistry) {
    const group = new THREE.Group();
    group.name = 'DebugEntityMarkers';

    this.geometry = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 8);
    this.geometry.translate(0, MARKER_HEIGHT / 2, 0);

    const byType = new Map<EntityType, THREE.MeshBasicMaterial>();
    for (const entity of registry.all) {
      let material = byType.get(entity.type);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color: COLORS[entity.type] });
        byType.set(entity.type, material);
        this.materials.push(material);
      }
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.name = entity.key;
      mesh.position.set(entity.wx, 0, entity.wz);
      if (entity.type === 'PlayerSpawn') {
        mesh.rotation.y = THREE.MathUtils.degToRad(entity.rotation);
      }
      mesh.userData['entity'] = entity satisfies MapEntity;
      group.add(mesh);
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
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.removeFromParent();
  }
}
