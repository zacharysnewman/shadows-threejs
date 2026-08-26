/**
 * Circle-versus-box collision resolution for the player capsule (§3.1).
 *
 * The capsule is resolved as a circle on the X/Z plane — Layer 1 colliders are prisms with
 * no ceilings or ledges to climb (§2), so height never changes the answer and a 2D test is
 * the whole of the problem.
 *
 * Contacts are resolved by pushing out along the contact normal and keeping the tangential
 * component of the move, which is what §3.1 means by "sliding along contact normals": a
 * player walking into a wall at an angle keeps the along-wall part of their speed instead
 * of stopping dead. Resolving per-axis instead would be cheaper but would push a player
 * who clips a corner straight back out of it, which reads as catching.
 *
 * Nothing here touches Three.js or the DOM: it is plain arithmetic over `BoxCollider`
 * records so it can be exercised directly in tests.
 */

import type { BoxCollider } from '../map/types';

/** Colliders overlapping a query circle, plus the push that resolved a move. */
export interface MoveResult {
  x: number;
  z: number;
  /** True when at least one collider pushed back during this move. */
  hit: boolean;
  /**
   * Unit normal of the accumulated push, pointing away from the surfaces touched, or
   * `(0, 0)` when nothing was hit. Callers cancel the inward component of their velocity
   * against this so speed does not build up into a wall the player is leaning on.
   */
  normalX: number;
  normalZ: number;
}

/**
 * Tile-bucketed broad phase over the merged Layer 1 colliders.
 *
 * Colliders already carry the grid rectangle they cover, so bucketing them by tile is
 * exact rather than approximate, and a query touches only the handful of tiles the circle
 * spans. A 50×50 map has a few hundred colliders; scanning all of them 60 times a second
 * would work today and stop working on the real map (Phase 11).
 */
export class ColliderIndex {
  private readonly buckets: BoxCollider[][];

  constructor(
    colliders: readonly BoxCollider[],
    readonly width: number,
    readonly height: number,
    readonly tileSize: number,
  ) {
    this.buckets = Array.from({ length: width * height }, (): BoxCollider[] => []);
    for (const collider of colliders) {
      const gx0 = Math.max(0, collider.gx0);
      const gy0 = Math.max(0, collider.gy0);
      const gx1 = Math.min(width - 1, collider.gx1);
      const gy1 = Math.min(height - 1, collider.gy1);
      for (let gy = gy0; gy <= gy1; gy += 1) {
        for (let gx = gx0; gx <= gx1; gx += 1) {
          this.buckets[gy * width + gx]?.push(collider);
        }
      }
    }
  }

  /**
   * Drop every collider covering a tile (§6 — a gate that has swung open).
   *
   * Removed from every bucket it was filed under rather than from the one asked for: a
   * collider spans a merged run of tiles, and leaving it in the neighbouring buckets would
   * leave a gate that is open from one side and shut from the other.
   */
  removeAt(gx: number, gy: number): number {
    const bucket = this.buckets[gy * this.width + gx];
    if (!bucket || bucket.length === 0) return 0;

    const doomed = new Set(bucket);
    for (const other of this.buckets) {
      for (let i = other.length - 1; i >= 0; i -= 1) {
        if (doomed.has(other[i]!)) other.splice(i, 1);
      }
    }
    return doomed.size;
  }

  /** Every collider whose tiles intersect the circle's bounding square, without repeats. */
  query(x: number, z: number, radius: number, out: BoxCollider[] = []): BoxCollider[] {
    out.length = 0;
    const gx0 = Math.max(0, Math.floor((x - radius) / this.tileSize));
    const gy0 = Math.max(0, Math.floor((z - radius) / this.tileSize));
    const gx1 = Math.min(this.width - 1, Math.floor((x + radius) / this.tileSize));
    const gy1 = Math.min(this.height - 1, Math.floor((z + radius) / this.tileSize));

    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const bucket = this.buckets[gy * this.width + gx];
        if (!bucket) continue;
        for (const collider of bucket) {
          // A merged collider spans many tiles and so sits in many buckets; the candidate
          // lists are short enough that a linear check beats a per-query Set.
          if (!out.includes(collider)) out.push(collider);
        }
      }
    }
    return out;
  }

  /**
   * Every collider whose tiles intersect a world-space rectangle, without repeats. Used by
   * the illumination raycast (§4.1), which tests a segment rather than a circle.
   */
  queryBox(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    out: BoxCollider[] = [],
  ): BoxCollider[] {
    out.length = 0;
    const gx0 = Math.max(0, Math.floor(minX / this.tileSize));
    const gy0 = Math.max(0, Math.floor(minZ / this.tileSize));
    const gx1 = Math.min(this.width - 1, Math.floor(maxX / this.tileSize));
    const gy1 = Math.min(this.height - 1, Math.floor(maxZ / this.tileSize));

    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const bucket = this.buckets[gy * this.width + gx];
        if (!bucket) continue;
        for (const collider of bucket) {
          if (!out.includes(collider)) out.push(collider);
        }
      }
    }
    return out;
  }

  /**
   * Hold a circle inside the tile grid. The map's outer edge stops the player whether or
   * not the author walled it, because off-map tiles are unwalkable by definition (§2).
   *
   * This is the *only* thing keeping the player on the map now. The camera used to clamp to
   * the same bounds and no longer does (§3.2) — it follows the player anywhere — so what is
   * beyond the edge is a forest the player can see and cannot enter (§2).
   */
  clampInside(x: number, z: number, radius: number): { x: number; z: number } {
    const limitX = this.width * this.tileSize - radius;
    const limitZ = this.height * this.tileSize - radius;
    return {
      x: radius > limitX ? limitX / 2 + radius / 2 : Math.min(Math.max(x, radius), limitX),
      z: radius > limitZ ? limitZ / 2 + radius / 2 : Math.min(Math.max(z, radius), limitZ),
    };
  }
}

/**
 * Depth and direction of the overlap between a circle and one box, or `null` when they do
 * not overlap. The normal points from the box towards the circle.
 */
export function circleBoxContact(
  collider: BoxCollider,
  x: number,
  z: number,
  radius: number,
): { nx: number; nz: number; depth: number } | null {
  const minX = collider.cx - collider.hx;
  const maxX = collider.cx + collider.hx;
  const minZ = collider.cz - collider.hz;
  const maxZ = collider.cz + collider.hz;

  const closestX = Math.min(Math.max(x, minX), maxX);
  const closestZ = Math.min(Math.max(z, minZ), maxZ);

  const dx = x - closestX;
  const dz = z - closestZ;
  const distanceSq = dx * dx + dz * dz;

  if (distanceSq > radius * radius) return null;

  if (distanceSq > 1e-12) {
    const distance = Math.sqrt(distanceSq);
    return { nx: dx / distance, nz: dz / distance, depth: radius - distance };
  }

  // Centre is inside the box — no closest-point direction to use. Leave along the face it
  // is nearest to, which is the shortest way out and the only one that cannot shove the
  // player through the far side of a thick wall.
  const left = x - minX;
  const right = maxX - x;
  const up = z - minZ;
  const down = maxZ - z;
  const smallest = Math.min(left, right, up, down);
  if (smallest === left) return { nx: -1, nz: 0, depth: left + radius };
  if (smallest === right) return { nx: 1, nz: 0, depth: right + radius };
  if (smallest === up) return { nx: 0, nz: -1, depth: up + radius };
  return { nx: 0, nz: 1, depth: down + radius };
}

/** How many depenetration passes one position gets. Enough for a corner of two walls. */
const RESOLVE_PASSES = 4;

/**
 * Push a circle out of everything it overlaps at `(x, z)`. Deepest contact first, so a
 * player wedged into a corner leaves along the surface that has the most to say about it.
 */
function depenetrate(
  index: ColliderIndex,
  x: number,
  z: number,
  radius: number,
  accumulator: { nx: number; nz: number; hit: boolean },
  scratch: BoxCollider[],
): { x: number; z: number } {
  for (let pass = 0; pass < RESOLVE_PASSES; pass += 1) {
    const candidates = index.query(x, z, radius, scratch);
    let deepest: { nx: number; nz: number; depth: number } | null = null;

    for (const collider of candidates) {
      const contact = circleBoxContact(collider, x, z, radius);
      if (contact && (!deepest || contact.depth > deepest.depth)) deepest = contact;
    }

    if (!deepest) break;

    x += deepest.nx * deepest.depth;
    z += deepest.nz * deepest.depth;
    accumulator.nx += deepest.nx * deepest.depth;
    accumulator.nz += deepest.nz * deepest.depth;
    accumulator.hit = true;
  }

  return { x, z };
}

/**
 * Move a circle by `(dx, dz)` and resolve it against the colliders it runs into.
 *
 * The move is split into steps no longer than the radius so a fast mover cannot pass
 * through a thin wall between two samples. At the player's 3 m/s and a 60 Hz tick this is
 * always one step; it matters for knockback (§5.3) and for a time-scaled debug session.
 */
export function moveCircle(
  index: ColliderIndex,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): MoveResult {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / Math.max(radius, 1e-3)));
  const accumulator = { nx: 0, nz: 0, hit: false };
  const scratch: BoxCollider[] = [];

  for (let step = 0; step < steps; step += 1) {
    const resolved = depenetrate(
      index,
      x + dx / steps,
      z + dz / steps,
      radius,
      accumulator,
      scratch,
    );
    const bounded = index.clampInside(resolved.x, resolved.z, radius);
    x = bounded.x;
    z = bounded.z;
  }

  const length = Math.hypot(accumulator.nx, accumulator.nz);
  return {
    x,
    z,
    hit: accumulator.hit,
    normalX: length > 1e-9 ? accumulator.nx / length : 0,
    normalZ: length > 1e-9 ? accumulator.nz / length : 0,
  };
}
