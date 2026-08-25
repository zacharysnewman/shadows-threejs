/**
 * Landmarks (§2) — the footprint arithmetic, and the rule that the collider and the
 * walkability grid agree about the same ground.
 *
 * The disagreement is the failure worth testing for. If the grid lets an enemy path onto
 * ground the collider then refuses, the enemy walks into the goalpost and stays there, and
 * nothing about that reads as a footprint bug when you are watching it happen.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PREFAB_FOOTPRINT } from '../src/config';
import type { Prefab } from '../src/core/AssetLoader';
import { prefabHalfExtents, rotatedHalfExtents, tilesUnder } from '../src/map/Landmarks';
import type { GameMap } from '../src/map/types';

/** A prefab with the bounds of one box, which is all the footprint maths reads. */
function prefabOf(name: string, sizeX: number, sizeZ: number): Prefab {
  const geometry = new THREE.BoxGeometry(sizeX, 1, sizeZ);
  return {
    name,
    geometry,
    material: new THREE.MeshStandardMaterial(),
    height: 1,
    placeholder: false,
  };
}

/** Only the fields `tilesUnder` reads. */
const mapOf = (width: number, height: number, tileSize = 2): GameMap =>
  ({ width, height, tileSize }) as GameMap;

describe('a landmark footprint under rotation (§2)', () => {
  it('is the model itself at no rotation', () => {
    expect(rotatedHalfExtents(1.5, 0.5, 0)).toEqual({ hx: 1.5, hz: 0.5 });
  });

  it('swaps the axes at a quarter turn, exactly', () => {
    // Exactness matters here and nowhere else: quarter turns are what a stamp places
    // (§9.4), so this is the common case and it must not accumulate a rounding error that
    // makes a rotated goal block a strip of tile it does not stand on.
    const turned = rotatedHalfExtents(1.5, 0.5, 90);
    expect(turned.hx).toBeCloseTo(0.5, 10);
    expect(turned.hz).toBeCloseTo(1.5, 10);

    const half = rotatedHalfExtents(1.5, 0.5, 180);
    expect(half.hx).toBeCloseTo(1.5, 10);
    expect(half.hz).toBeCloseTo(0.5, 10);
  });

  it('contains the rotated model, never clips it', () => {
    // §2 — the collider is axis-aligned, so between quarter turns it is the box that
    // *contains* the rotated footprint. Conservative is the safe direction: blocking a
    // little more ground than the model covers beats a player walking through a goalpost.
    const hx = 1.5;
    const hz = 0.5;
    for (let degrees = 0; degrees <= 360; degrees += 7) {
      const box = rotatedHalfExtents(hx, hz, degrees);
      const radians = THREE.MathUtils.degToRad(degrees);
      // The four corners of the rotated rectangle must all land inside the reported box.
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const x = sx * hx;
        const z = sz * hz;
        const rx = x * Math.cos(radians) - z * Math.sin(radians);
        const rz = x * Math.sin(radians) + z * Math.cos(radians);
        expect(Math.abs(rx), `x at ${degrees}°`).toBeLessThanOrEqual(box.hx + 1e-9);
        expect(Math.abs(rz), `z at ${degrees}°`).toBeLessThanOrEqual(box.hz + 1e-9);
      }
    }
  });

  it('reads the same for a rotation and its opposite', () => {
    // 190° covers the ground 10° covers. Signed projections would give one of them
    // negative extents, which is a collider that blocks nothing.
    for (const degrees of [10, 33, 45, 88]) {
      const a = rotatedHalfExtents(2, 0.4, degrees);
      const b = rotatedHalfExtents(2, 0.4, degrees + 180);
      expect(b.hx).toBeCloseTo(a.hx, 10);
      expect(b.hz).toBeCloseTo(a.hz, 10);
      expect(a.hx).toBeGreaterThan(0);
    }
  });
});

describe('where a footprint comes from (§2)', () => {
  it('is the prefab\'s own bounds, so a swapped model moves its own collision', () => {
    // The alternative — a number authored beside each prefab name — is right until the art
    // changes and silently wrong afterwards, which nothing can catch.
    expect(prefabHalfExtents(prefabOf('prop_goal', 3, 1))).toEqual({ hx: 1.5, hz: 0.5 });
  });

  it('takes the override where the mesh lies', () => {
    // §2 — a hoop is a pole with a backboard three metres up; its bounds would fence off a
    // square of empty yard nobody can see a reason for.
    const override = PREFAB_FOOTPRINT['prop_hoop'];
    expect(override, 'prop_hoop has no override').toBeDefined();

    const derived = prefabHalfExtents(prefabOf('prop_hoop', 2, 3));
    expect(derived).toEqual({ hx: override!.hx, hz: override!.hz });
    // And it is the *smaller* answer — an override that blocked more than the mesh would
    // be a difficulty preference wearing a bug's clothes.
    expect(derived.hx).toBeLessThan(1);
  });
});

describe('the tiles a landmark blocks (§2)', () => {
  it('covers every tile the footprint touches, not only the ones it mostly covers', () => {
    // The collider and the grid have to refuse the same ground. Being generous to the grid
    // is the safe way to be wrong: an enemy walks around a little more than it had to,
    // rather than pathing into geometry and stopping there.
    const map = mapOf(10, 10);
    // Centred on the corner of four tiles, so it touches all four however small it is.
    expect(tilesUnder(map, 4, 4, 0.1, 0.1).sort()).toEqual([11, 12, 21, 22].sort());
  });

  it('spans a wide model across the tiles it really crosses', () => {
    const map = mapOf(10, 10);
    // 10.7 m of net centred at x = 10 covers x ∈ [4.65, 15.35]: tiles 2..7 on that row.
    const tiles = tilesUnder(map, 10, 5, 5.35, 0.15);
    const columns = [...new Set(tiles.map((index) => index % map.width))].sort((a, b) => a - b);
    expect(columns).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('clamps at the map edge rather than indexing off it', () => {
    const map = mapOf(4, 4);
    const tiles = tilesUnder(map, 0.5, 0.5, 4, 4);
    expect(Math.min(...tiles)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...tiles)).toBeLessThan(map.width * map.height);
    // A landmark hanging off the west edge still blocks the tiles it is actually on.
    expect(tiles).toContain(0);
  });
});
