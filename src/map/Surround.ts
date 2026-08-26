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
 * for scenery nobody can reach (§7). `GeneratedPrefabs` builds one for about fifty, and the
 * band is the same tree the map plants inside its own boundary at a larger size.
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
import { SURROUND } from '../config';
import { treeGeometry, treeMaterial } from '../core/GeneratedPrefabs';
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

  const mesh = new THREE.InstancedMesh(treeGeometry(), treeMaterial(), points.length);
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
    //
    // The turn comes from *where the tree stands* rather than from the next number in the
    // stream. A tree is a thing in a place, so its spin is a property of the place: it does
    // not shift because the loop visited the band in a different order, or because something
    // earlier drew one more number. The height still comes from the stream — it is a choice
    // about the tree rather than about the ground under it.
    matrix.multiply(rotation.makeRotationY(spinAt(point.x, point.z)));
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
 * A tree's spin, in radians, from the ground it stands on (§2).
 *
 * Position in, angle out, and nothing else: the same spot always grows the same tree,
 * whatever order the band was walked in and whatever else has drawn from the run's `Rng`.
 * That is worth more than it sounds — it makes a forest reproducible from its *layout*
 * rather than from a sequence, so moving one tree cannot re-spin every tree after it.
 *
 * The hash is a standard sine-fract scramble. It has to be well-mixed enough that
 * neighbouring trees do not face the same way, and it has to be nothing else.
 */
export function spinAt(x: number, z: number): number {
  const mixed = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return (mixed - Math.floor(mixed)) * Math.PI * 2;
}
