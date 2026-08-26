/**
 * The trees outside the map (§2, *Beyond the boundary*).
 *
 * The playable area ends at the map rectangle; the world does not. A band of small trees
 * fills the ground beyond it in every direction, and the reason is §3.2: the camera is
 * locked to the player, so it frames ground past the boundary whenever they walk near one.
 * Covering that ground costs one instanced draw. The alternative — sliding the camera off
 * the player near an edge — costs the meaning of the cursor's position in exactly the
 * corners where a player can least afford it.
 *
 * **The ground comes first, the trees second.** Ground covers the void in two triangles; the
 * trees are what make it read as a forest edge rather than a floor.
 *
 * **The tree is generated, not a kit prefab, and that is what buys the density.** A forest
 * edge has to be *thick* — more than one tree per tile of ground, crowns overlapping — and
 * the kit's tree is 3,104 triangles, so a band of thousands would be millions of triangles
 * for scenery nobody can reach (§7). Built here it is about fifty: a tapered trunk and two
 * faceted crowns, merged into one geometry with vertex colours so the whole band is one
 * material and one draw call.
 *
 * It is also the only way to get a *small* tree out of this kit. `PREFAB_FIT.fitHeight`
 * scales the Y axis alone — right for a wall, and for a tree it means a short one keeps the
 * model's 11.84 m canopy and comes out a pancake. A generated tree is authored at unit
 * height and scaled uniformly per instance, so short means small.
 *
 * **It is scenery and nothing else.** Outside the map is outside the walkability grid, the
 * collider set, the audit and every light's reach, so nothing here has a footprint, blocks
 * anything, or is ever reachable. It casts no shadows either: a shadow on the ground means
 * a light is on something (§4), and nothing out here is ever lit.
 *
 * **The depth is derived, not chosen.** How far a player standing on the edge tile can see
 * past it is exactly `groundFootprint`'s reach (§3.2), so that is what the band is, plus a
 * margin. Writing a number here instead would be a number that silently stops matching the
 * camera the first time §3.2's pitch or distance moves.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURROUND } from '../config';
import type { Rng } from '../core/rng';
import { groundFootprint } from '../player/CameraRig';

export interface SurroundResult {
  /** The ground plane and the trees on it. */
  object: THREE.Object3D;
  /** How many trees were planted — a §7 number, and what the tests count. */
  count: number;
  /** How far past the map the band reaches, in metres. */
  depthMetres: number;
}

/**
 * How far past the boundary the camera can see, in metres.
 *
 * The widest of the footprint's three reaches: sideways at the far edge, ahead of the
 * player, and behind them. One depth for all four sides — the band is not shaped to the
 * camera's trapezoid, because the player can stand at any edge facing any way, and the
 * trapezoid points a different direction relative to each of them.
 */
export function surroundDepth(
  aspect: number = SURROUND.widestAspect,
  margin: number = SURROUND.marginMetres,
): number {
  const footprint = groundFootprint(aspect);
  return (
    Math.max(footprint.halfWidth, Math.abs(footprint.minZ), Math.abs(footprint.maxZ)) + margin
  );
}

/**
 * Plant the band around a map of `width` × `height` tiles.
 *
 * Positions come from the run's `Rng` (Cross-Cutting: determinism), so a replayed seed grows
 * the same forest — a band that reshuffled every run would make a landmark of the boundary
 * one run and not the next.
 */
export function buildSurround(
  width: number,
  height: number,
  tileSize: number,
  rng: Rng,
): SurroundResult {
  const depth = surroundDepth();
  const mapWidth = width * tileSize;
  const mapHeight = height * tileSize;
  const spacing = SURROUND.spacingMetres;

  const root = new THREE.Group();
  root.name = 'surround';
  root.add(groundPlane(mapWidth, mapHeight, depth));

  // Grid points across the whole outer rectangle, keeping the ones outside the map. Walking
  // the full rectangle and discarding the middle is what makes the corners come out right;
  // four separate strips have to agree about where they overlap, and they never quite do.
  const points: { x: number; z: number }[] = [];
  for (let z = -depth; z <= mapHeight + depth; z += spacing) {
    for (let x = -depth; x <= mapWidth + depth; x += spacing) {
      const jx = x + (rng.float() * 2 - 1) * SURROUND.jitterMetres;
      const jz = z + (rng.float() * 2 - 1) * SURROUND.jitterMetres;
      // Jittered position decides, not the grid point: a tree that jittered *into* the map
      // would stand on ground the player walks, with no collider and no way to explain it.
      if (jx > 0 && jx < mapWidth && jz > 0 && jz < mapHeight) continue;
      points.push({ x: jx, z: jz });
    }
  }

  const mesh = new THREE.InstancedMesh(
    treeGeometry(),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: SURROUND.treeRoughness,
      metalness: 0,
    }),
    points.length,
  );
  mesh.name = 'surround:trees';
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // §2 — never lit, so never casting; and nothing out here receives either.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The band is wider than any frustum test Three will do on it cheaply, and it is always
  // at least partly in view, so culling it whole is only ever wrong.
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  points.forEach((point, index) => {
    matrix.makeTranslation(point.x, 0, point.z);
    // A turn each, and a size each: one geometry repeated thousands of times reads as
    // wallpaper otherwise, and a forest is the one thing that must not.
    matrix.multiply(rotation.makeRotationY(rng.float() * Math.PI * 2));
    const height =
      SURROUND.treeHeightMetres *
      (1 + (rng.float() * 2 - 1) * SURROUND.heightVariation);
    // Uniform: the geometry is authored at unit height, so this is the tree's real size and
    // its crown stays in proportion to it.
    matrix.multiply(scale.makeScale(height, height, height));
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);

  return { object: root, count: points.length, depthMetres: depth };
}

/**
 * Ground for the trees to stand on, and the reason the band can be sparse.
 *
 * Trees alone do not cover the outside: the gap between two canopies is the void again, so
 * hiding it with foliage means enough foliage to be opaque, which is a great many instances
 * of a 3,104-triangle model (§7). Two triangles of ground does the covering, and the trees
 * go back to doing what trees are for — depth, and something for the eye to stop on.
 *
 * **Lit, not painted.** The obvious colour for it is the fog's, and that is the one colour
 * it must not be: the fog is also the background (§7), so fog-coloured ground is ground you
 * cannot tell from the void. It is a standard material instead, so §4's night ambient and
 * moon light it exactly as they light the map's own floor — it reads as ground because it
 * *is* being lit like ground — and the fog carries it into the distance from there.
 *
 * It sits just below the floor so it cannot z-fight with the map's own tiles, and neither
 * casts nor receives: nothing out there is ever lit by a lamp or the beam (§2, §4).
 */
function groundPlane(mapWidth: number, mapHeight: number, depth: number): THREE.Mesh {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(mapWidth + depth * 2 + SURROUND.spacingMetres * 2, mapHeight + depth * 2 + SURROUND.spacingMetres * 2),
    new THREE.MeshStandardMaterial({ color: SURROUND.groundColour, roughness: 1, metalness: 0 }),
  );
  plane.name = 'surround:ground';
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(mapWidth / 2, -0.05, mapHeight / 2);
  plane.castShadow = false;
  plane.receiveShadow = false;
  return plane;
}

/**
 * One tree, authored at **unit height** so an instance's scale is its size in metres.
 *
 * A tapered trunk and two faceted crowns, merged into a single geometry carrying its colours
 * per vertex — so the band is one material, one draw call, and about fifty triangles a tree
 * instead of three thousand. At this size and this distance, under §4's night ambient and
 * §7's fog, the silhouette is the whole of what reads: crowns overlapping into a dark mass
 * with a suggestion of trunks under it.
 *
 * Open-ended trunk and `detail: 0` crowns are deliberate. Nobody can get out there to look
 * at a tree from below, and the caps and subdivisions would be triangles spent on it.
 */
function treeGeometry(): THREE.BufferGeometry {
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

  paint(trunk, SURROUND.trunkColour);
  paint(lower, SURROUND.canopyColour);
  paint(upper, SURROUND.canopyColour);

  const merged = mergeGeometries([trunk, lower, upper], false);
  for (const part of [trunk, lower, upper]) part.dispose();
  if (!merged) throw new Error('surround: tree parts would not merge');

  // Normalised so "height 1" is true whatever the proportions above become: the instance
  // matrix multiplies by a height in metres, and that only means metres if this does.
  merged.computeBoundingBox();
  const top = merged.boundingBox?.max.y ?? 1;
  if (top > 0) merged.scale(1 / top, 1 / top, 1 / top);
  merged.computeVertexNormals();
  return merged;
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
