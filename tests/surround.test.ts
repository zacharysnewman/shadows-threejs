/**
 * The forest outside the map (§2, *Beyond the boundary*).
 *
 * Two things have to hold or the feature is worse than not having it. Nothing may land
 * *inside* the map — a tree out there has no collider and no walkability, so one standing on
 * playable ground is scenery the player walks through. And the band has to be at least as
 * deep as the camera can see past the boundary, because covering that ground is the entire
 * reason §3.2 was allowed to stop clamping.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, SURROUND } from '../src/config';
import type { Prefab } from '../src/core/AssetLoader';
import { Rng } from '../src/core/rng';
import { buildSurround, surroundDepth } from '../src/map/Surround';
import { groundFootprint } from '../src/player/CameraRig';

const TILE = 2;
const WIDTH = 20;
const HEIGHT = 16;

/** A prefab in the shape the loader returns, with geometry cheap enough to make per test. */
function fakePrefab(): Prefab {
  return {
    name: SURROUND.prefab,
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicMaterial(),
    height: 9,
    footprint: { x: 1, z: 1 },
    placeholder: false,
  };
}

function planted(rng = new Rng(1)) {
  const result = buildSurround(fakePrefab(), WIDTH, HEIGHT, TILE, rng);
  const mesh = result.object.getObjectByName('surround:trees') as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  const at: { x: number; z: number }[] = [];
  for (let i = 0; i < result.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    at.push({ x: position.x, z: position.z });
  }
  return { result, at };
}

describe('where the surround puts its trees (§2)', () => {
  it('plants nothing on ground the player can walk on', () => {
    // The rule that matters most: out there nothing has a collider, so a tree inside the
    // map is a tree the player walks straight through.
    const { at } = planted();
    const inside = at.filter(
      (p) => p.x > 0 && p.x < WIDTH * TILE && p.z > 0 && p.z < HEIGHT * TILE,
    );
    expect(inside).toEqual([]);
  });

  it('surrounds the map on all four sides, corners included', () => {
    const { at } = planted();
    const w = WIDTH * TILE;
    const h = HEIGHT * TILE;
    expect(at.some((p) => p.x < 0 && p.z > 0 && p.z < h), 'west').toBe(true);
    expect(at.some((p) => p.x > w && p.z > 0 && p.z < h), 'east').toBe(true);
    expect(at.some((p) => p.z < 0 && p.x > 0 && p.x < w), 'north').toBe(true);
    expect(at.some((p) => p.z > h && p.x > 0 && p.x < w), 'south').toBe(true);
    expect(at.some((p) => p.x < 0 && p.z < 0), 'north-west corner').toBe(true);
    expect(at.some((p) => p.x > w && p.z > h), 'south-east corner').toBe(true);
  });

  it('fills the whole band, not just its first ring', () => {
    const { result, at } = planted();
    const deepest = Math.max(...at.map((p) => -p.x));
    // Something is planted out near the far edge of the band, so a player at the boundary
    // sees trees behind trees rather than one row against void.
    expect(deepest).toBeGreaterThan(result.depthMetres / 2);
  });

  it('grows the same forest from the same seed, and a different one otherwise', () => {
    const a = planted(new Rng(42)).at;
    const b = planted(new Rng(42)).at;
    const c = planted(new Rng(43)).at;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('scatters rather than planting rows', () => {
    // Every tree on its exact grid point would read as a fence, which is the boundary this
    // is meant to disguise. Off-grid positions are what break it up.
    const { at } = planted();
    const offGrid = at.filter((p) => Math.abs(p.x % SURROUND.spacingMetres) > 1e-6);
    expect(offGrid.length).toBeGreaterThan(at.length / 2);
  });

  it('says how many it planted, so §7 can be checked from the readout', () => {
    const { result, at } = planted();
    expect(result.count).toBe(at.length);
    expect(result.count).toBeGreaterThan(0);
  });

  it('still lays the ground when the art is missing', () => {
    // No trees is survivable; no ground is not. A gap between canopies shows whatever is
    // under it, and with no plane under it that is the void the surround exists to cover.
    const result = buildSurround(undefined, WIDTH, HEIGHT, TILE, new Rng(1));
    expect(result.count).toBe(0);
    expect(result.object.getObjectByName('surround:ground')).toBeDefined();
    expect(result.object.getObjectByName('surround:trees')).toBeUndefined();
  });

  it('lays ground wider than the band of trees, so no gap shows through', () => {
    const { result } = planted();
    const ground = result.object.getObjectByName('surround:ground') as THREE.Mesh;
    const size = new THREE.Box3().setFromObject(ground).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(WIDTH * TILE + result.depthMetres * 2);
    expect(size.z).toBeGreaterThan(HEIGHT * TILE + result.depthMetres * 2);
  });
});

describe('how deep the band goes (§2, §3.2)', () => {
  it('covers everything the camera can see past the player', () => {
    // Derived from the camera rather than typed out: this is the assertion that fails if
    // §3.2's pitch or distance moves and the band is left behind.
    const footprint = groundFootprint(SURROUND.widestAspect);
    const seen = Math.max(
      footprint.halfWidth,
      Math.abs(footprint.minZ),
      Math.abs(footprint.maxZ),
    );
    expect(surroundDepth()).toBeGreaterThanOrEqual(seen);
  });

  it('grows when the camera is pulled further back', () => {
    const near = groundFootprint(SURROUND.widestAspect, CAMERA.fov, CAMERA.pitchDegrees, 10);
    const far = groundFootprint(SURROUND.widestAspect, CAMERA.fov, CAMERA.pitchDegrees, 20);
    expect(far.halfWidth).toBeGreaterThan(near.halfWidth);
  });

  it('is wider than it is far, because the frustum is', () => {
    // Worth stating: the band is square around the map while the camera's footprint is a
    // trapezoid, so the sideways reach is what sizes all four sides.
    const footprint = groundFootprint(SURROUND.widestAspect);
    expect(footprint.halfWidth).toBeGreaterThan(Math.abs(footprint.minZ));
  });
});
