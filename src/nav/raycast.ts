/**
 * Segment occlusion against map obstacles (§4.1).
 *
 * What blocks light is what blocks walking (§3.1), and nothing else — a hole in the floor
 * casts no shadow, so gap colliders are skipped. The test is a segment against axis-aligned
 * boxes on the X/Z plane, which ignores height: a beam that would physically pass over a low
 * crate is treated as stopping at it. That is an approximation, and it errs towards
 * *shadowed*, which is the same way the shadow the player can see on the ground errs.
 *
 * Pure arithmetic over the collider index, so the whole illumination service can be tested
 * without a renderer.
 */

import type { BoxCollider } from '../map/types';
import type { ColliderIndex } from '../player/collision';

/** Slab test: whether the segment from A to B passes through this box. */
export function segmentHitsBox(
  collider: BoxCollider,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;

  let entering = 0;
  let leaving = 1;

  // One slab per axis: the segment is inside the box only where both overlap.
  for (const [origin, direction, centre, half] of [
    [ax, dx, collider.cx, collider.hx],
    [az, dz, collider.cz, collider.hz],
  ] as const) {
    const min = centre - half;
    const max = centre + half;

    if (Math.abs(direction) < 1e-9) {
      // Parallel to this slab: either it starts inside it or it never enters.
      if (origin < min || origin > max) return false;
      continue;
    }

    const near = (min - origin) / direction;
    const far = (max - origin) / direction;
    entering = Math.max(entering, Math.min(near, far));
    leaving = Math.min(leaving, Math.max(near, far));
    if (entering > leaving) return false;
  }

  return entering <= leaving;
}

/**
 * Whether anything stands between two points. `scratch` is reused by callers running this
 * at frequency, so a 10 Hz query per entity (§4.1) allocates nothing.
 */
export function segmentBlocked(
  index: ColliderIndex,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  scratch: BoxCollider[] = [],
): boolean {
  const candidates = index.queryBox(
    Math.min(ax, bx),
    Math.min(az, bz),
    Math.max(ax, bx),
    Math.max(az, bz),
    scratch,
  );

  for (const collider of candidates) {
    // A hole in the floor blocks walking but not light (§4.1).
    if (collider.kind !== 'obstacle') continue;
    if (segmentHitsBox(collider, ax, az, bx, bz)) return true;
  }
  return false;
}
