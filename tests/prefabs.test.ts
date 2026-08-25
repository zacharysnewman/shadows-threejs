/**
 * Fitting third-party prefabs to this project's grid (§1).
 *
 * The cases here are the ones a real kit actually presents: a wall modelled from x = 0
 * rather than centred, a floor slab whose surface sits above the ground plane, a module
 * that is the wrong height. Each is fine of the kit and wrong here, and each is something
 * the loader has to fix on load rather than the files being edited.
 */

import * as THREE from 'three';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PREFAB_FIT, PREFAB_KITS } from '../src/config';
import { normalisePrefab } from '../src/core/AssetLoader';

/** A box with explicit bounds, standing in for a loaded prefab's merged geometry. */
function box(
  x: [number, number],
  y: [number, number],
  z: [number, number],
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x[1] - x[0], y[1] - y[0], z[1] - z[0]);
  geometry.translate((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2);
  return geometry;
}

/** Tuples rather than arrays, so `bounds(g).x[1]` is a number and not `number | undefined`. */
function bounds(geometry: THREE.BufferGeometry): {
  x: [number, number];
  y: [number, number];
  z: [number, number];
} {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  return {
    x: [+b.min.x.toFixed(4), +b.max.x.toFixed(4)],
    y: [+b.min.y.toFixed(4), +b.max.y.toFixed(4)],
    z: [+b.min.z.toFixed(4), +b.max.z.toFixed(4)],
  };
}

describe('normalisePrefab (§1)', () => {
  it('centres a wall that was modelled from one end', () => {
    // KayKit's `wall_half`: 2 m wide, but running x = 0 → 2. Placed at a tile centre
    // unchanged, every wall in the level would sit a metre east of its tile.
    const geometry = box([0, 2], [0, 4], [-0.5, 0.5]);
    normalisePrefab(geometry, 'wall_brick');
    expect(bounds(geometry).x).toEqual([-1, 1]);
  });

  it('stands upright geometry on the ground plane', () => {
    const geometry = box([0, 2], [0.4, 4.4], [-0.5, 0.5]);
    normalisePrefab(geometry, 'wall_brick');
    expect(bounds(geometry).y[0]).toBe(0);
  });

  it('sinks a floor so its surface is the ground plane, not something above it', () => {
    // KayKit's floor slab tops out at +0.05. Left there, the player walks 5 cm underground
    // and every upright prefab floats.
    const geometry = box([-1, 1], [-0.1, 0.05], [-1, 1]);
    normalisePrefab(geometry, 'floor_concrete');
    const after = bounds(geometry);
    expect(after.y[1]).toBe(0);
    expect(after.y[0]).toBe(-0.15);
  });

  it('sinks a bumpy floor by its highest point, so nothing pokes through', () => {
    // The dirt tile is uneven: 0.186 tall, topping out at +0.086.
    const geometry = box([-1, 1], [-0.1, 0.086], [-1, 1]);
    normalisePrefab(geometry, 'floor_dirt');
    expect(bounds(geometry).y[1]).toBe(0);
  });

  it('fits height without touching the footprint', () => {
    // The whole point: a 2 m module has to stay 2 m wide or a run of them has a gap
    // between every tile. Scaling uniformly to 3/4 would make this 1.5 m.
    const geometry = box([0, 2], [0, 4], [-0.5, 0.5]);
    const height = normalisePrefab(geometry, 'wall_brick', 3);
    const after = bounds(geometry);
    expect(height).toBe(3);
    expect(after.y).toEqual([0, 3]);
    expect(after.x[1] - after.x[0]).toBe(2);
    expect(after.z[1] - after.z[0]).toBe(1);
  });

  it('reports the height it ended up at, which the colliders are built from', () => {
    const unfitted = box([0, 2], [0, 4], [-0.5, 0.5]);
    expect(normalisePrefab(unfitted, 'wall_brick')).toBe(4);
    const fitted = box([0, 2], [0, 4], [-0.5, 0.5]);
    // Close rather than exact: vertex positions are `Float32Array`, so a height of 1.6
    // comes back as 1.6000000238. Nothing downstream cares, and a test that demanded
    // exactness here would be testing IEEE 754 rather than the fit.
    expect(normalisePrefab(fitted, 'fence_chainlink', 1.6)).toBeCloseTo(1.6, 5);
  });

  it('leaves a prefab already on the convention alone', () => {
    // A crate: 1 m, centred, sitting on the ground. Nothing to do.
    const geometry = box([-0.5, 0.5], [0, 1], [-0.5, 0.5]);
    const before = bounds(geometry);
    normalisePrefab(geometry, 'prop_crate');
    expect(bounds(geometry)).toEqual(before);
  });

  it('refits every prefab the config names, to the height it names', () => {
    for (const [name, fit] of Object.entries(PREFAB_FIT)) {
      if (fit.fitHeight === undefined) continue;
      const geometry = box([0, 2], [0, 4], [-0.5, 0.5]);
      expect(normalisePrefab(geometry, name, fit.fitHeight)).toBeCloseTo(fit.fitHeight, 5);
      const [minX, maxX] = bounds(geometry).x;
      expect(maxX - minX).toBe(2);
    }
  });
});

describe('prefab provenance (§1, §8.2)', () => {
  it('records where every kit came from, since a licence will not remind anyone', () => {
    expect(PREFAB_KITS.length).toBeGreaterThan(0);
    for (const kit of PREFAB_KITS) {
      expect(kit.kit, 'kit name').not.toBe('');
      expect(kit.author, `${kit.kit} author`).not.toBe('');
      // Somewhere the exact files can be fetched again from.
      expect(kit.source, `${kit.kit} source`).toMatch(/\S/);
      expect(kit.prefabs.length, `${kit.kit} claims no prefabs`).toBeGreaterThan(0);
    }
  });

  it('treats an unstated licence as attribution-required, not as permission', () => {
    // The conservative reading, and the only one available: a kit that states no terms has
    // not granted any. Recording it as `false` would be inventing a permission.
    for (const kit of PREFAB_KITS) {
      if (kit.licence === null) {
        expect(kit.attributionRequired, `${kit.kit} states no licence`).toBe(true);
      }
    }
  });

  it('claims each prefab exactly once, and claims the ones that are shipped', () => {
    // The failure this catches: art added to `public/prefabs/` and credited nowhere, which
    // is how a kit ends up shipped with nobody able to say whose it is.
    const claimed = PREFAB_KITS.flatMap((kit) => kit.prefabs);
    expect(new Set(claimed).size, 'a prefab claimed by two kits').toBe(claimed.length);

    // Both places art ships from: prefabs are merged static geometry (§1) and characters
    // keep their skeletons (§5.1), but they are equally somebody's art and equally shipped.
    const shipped = ['../public/prefabs/', '../public/characters/'].flatMap((dir) =>
      readdirSync(new URL(dir, import.meta.url))
        .filter((file) => file.endsWith('.glb'))
        .map((file) => file.replace(/\.glb$/, '')),
    );
    expect([...claimed].sort()).toEqual([...shipped].sort());
  });
});
