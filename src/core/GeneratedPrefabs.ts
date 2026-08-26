/**
 * Art the game builds instead of loading (§1, §2).
 *
 * Almost everything is a `.glb` from a kit, and that is the right default: a prefab with a
 * file is art somebody can open and change. These are the exceptions, where what is needed
 * is not in any kit and is *cheaper described than modelled*.
 *
 * **The small tree is the case that forced this.** A forest wants two things the kit's tree
 * cannot give at once. It has to read as a tree from a camera pitched 72° and 14 m up —
 * where a 26 m trunk is not a tree but a long dark streak radiating off the screen — and
 * there have to be *many*, which at 3,104 triangles apiece there cannot be. `fitHeight`
 * cannot rescue it either: it scales the Y axis alone (right for a wall), so a short kit
 * tree keeps its 11.84 m canopy and comes out a pancake that roofs the ground the player and
 * every enemy are standing on.
 *
 * Fifty triangles, scaled uniformly, gets a tree that looks like a tree from above, leaves
 * the ground visible, and can be planted two hundred at a time.
 *
 * A generated prefab is a prefab in every other respect: the loader returns one where it
 * would return a loaded file, so maps place it, `PREFAB_FOOTPRINT` sizes what it blocks, and
 * landmarks, colliders and walkability treat it exactly as they treat the kit's models.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREES } from '../config';

/**
 * A tree of **unit height**, so a caller's scale is its size in metres.
 *
 * A tapered trunk and two faceted crowns, merged into one geometry carrying its colours per
 * vertex — one material, one draw call however it is used, and no texture to load. At the
 * distance and the light this game is played at, the silhouette is the whole of what reads.
 *
 * Open-ended trunk and `detail: 0` crowns are deliberate: nobody sees a tree from below here,
 * and the caps and subdivisions would be triangles spent on that.
 */
export function treeGeometry(): THREE.BufferGeometry {
  const trunkHeight = 0.45;
  // Non-indexed throughout: `mergeGeometries` refuses a mix, and Three builds a cylinder
  // indexed and an icosahedron not. Converting costs vertices, never triangles.
  const trunk = new THREE.CylinderGeometry(0.05, 0.09, trunkHeight, 5, 1, true).toNonIndexed();
  trunk.translate(0, trunkHeight / 2, 0);

  const lower = new THREE.IcosahedronGeometry(0.34, 0).toNonIndexed();
  lower.scale(1, 0.85, 1);
  lower.translate(0, trunkHeight + 0.22, 0);

  const upper = new THREE.IcosahedronGeometry(0.24, 0).toNonIndexed();
  upper.scale(1, 0.9, 1);
  upper.translate(0, trunkHeight + 0.52, 0);

  paint(trunk, TREES.trunkColour);
  paint(lower, TREES.canopyColour);
  paint(upper, TREES.canopyColour);

  const merged = mergeGeometries([trunk, lower, upper], false);
  for (const part of [trunk, lower, upper]) part.dispose();
  if (!merged) throw new Error('generated tree: parts would not merge');

  // Normalised so "height 1" stays true whatever the proportions above become: callers
  // multiply by a height in metres, and that only means metres if this does.
  merged.computeBoundingBox();
  const top = merged.boundingBox?.max.y ?? 1;
  if (top > 0) merged.scale(1 / top, 1 / top, 1 / top);
  merged.computeVertexNormals();
  return merged;
}

/** The one material every generated tree shares, wherever it is planted. */
export function treeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: TREES.roughness,
    metalness: 0,
  });
}

/** Give every vertex of a part the same colour, so the merged tree needs one material. */
function paint(geometry: THREE.BufferGeometry, colour: number): void {
  const count = geometry.getAttribute('position').count;
  const rgb = new THREE.Color(colour);
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colours[i * 3] = rgb.r;
    colours[i * 3 + 1] = rgb.g;
    colours[i * 3 + 2] = rgb.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** What the loader needs to hand back, without importing the loader's own module. */
export interface GeneratedPrefab {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  height: number;
  footprint: { x: number; z: number };
}

/**
 * Prefab names the loader builds rather than fetches.
 *
 * The footprint is the *trunk*, not the crown — the same call §2 makes for the kit's tree,
 * and for the same reason: a crown is something you walk under, and blocking the ground
 * beneath it would fence off the part of a wood that makes it a wood.
 */
export const GENERATED_PREFABS: Readonly<Record<string, () => GeneratedPrefab>> = {
  tree_small: () => {
    const height = TREES.smallHeightMetres;
    const geometry = treeGeometry();
    geometry.scale(height, height, height);
    return {
      geometry,
      material: treeMaterial(),
      height,
      footprint: { x: TREES.trunkHalfWidth * 2, z: TREES.trunkHalfWidth * 2 },
    };
  },
};
