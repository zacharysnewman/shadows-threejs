/**
 * Debug visualisation of enemy paths (Cross-Cutting: entity state labels).
 *
 * One line per enemy, from where it stands to each remaining waypoint, coloured by state.
 * §5's behaviour is a route being recomputed on a timer — without seeing the route, a
 * repath and a wander leg look identical from outside, and "it went the wrong way round
 * the building" is not a debuggable statement.
 */

import * as THREE from 'three';
import type { Enemy, EnemyState } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';

const STATE_COLORS: Record<EnemyState, number> = {
  wander: 0x6fb1ff,
  pursue: 0xff6b6b,
  flee: 0xffd166,
  frozen: 0xa0e7e5,
  recoil: 0xd39bff,
};

/** Waypoints per enemy the buffer has room for; paths longer than this are clipped. */
const MAX_POINTS = 64;

export class PathOverlay {
  readonly object = new THREE.Group();

  private readonly lines = new Map<Enemy, THREE.Line>();
  private readonly materials = new Map<EnemyState, THREE.LineBasicMaterial>();

  constructor(
    private readonly manager: EnemyManager,
    private readonly grid: WalkabilityGrid,
  ) {
    this.object.name = 'DebugEnemyPaths';
    this.object.visible = false;

    for (const [state, color] of Object.entries(STATE_COLORS) as [EnemyState, number][]) {
      this.materials.set(state, new THREE.LineBasicMaterial({ color, depthTest: false }));
    }
  }

  get visible(): boolean {
    return this.object.visible;
  }

  toggle(): void {
    this.object.visible = !this.object.visible;
  }

  /** Rebuild the lines from the enemies' current paths. Per rendered frame, when visible. */
  update(): void {
    if (!this.object.visible) return;

    for (const enemy of this.manager.enemies) {
      let line = this.lines.get(enemy);
      if (!line) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3),
        );
        line = new THREE.Line(geometry, this.materials.get('wander')!);
        line.renderOrder = 4;
        line.frustumCulled = false;
        this.object.add(line);
        this.lines.set(enemy, line);
      }

      line.material = this.materials.get(enemy.state)!;

      const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      // Always starts at the enemy, so a stale path shows as a line to nowhere rather than
      // as a line that merely looks short.
      array[0] = enemy.position.x;
      array[1] = 0.15;
      array[2] = enemy.position.y;

      let count = 1;
      for (const waypoint of enemy.waypoints) {
        if (count >= MAX_POINTS) break;
        const world = this.grid.gridToWorld(waypoint.x, waypoint.y);
        array[count * 3] = world.wx;
        array[count * 3 + 1] = 0.15;
        array[count * 3 + 2] = world.wz;
        count += 1;
      }

      attribute.needsUpdate = true;
      line.geometry.setDrawRange(0, count);
    }
  }

  dispose(): void {
    for (const line of this.lines.values()) line.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.lines.clear();
    this.object.removeFromParent();
  }
}
