/**
 * Art the game builds rather than loads (§1, §2), and the props that stand on it.
 *
 * Two things worth pinning. A generated prefab has to be a prefab in every respect the rest
 * of the pipeline cares about — a footprint, a height, geometry — or landmarks, colliders and
 * walkability quietly disagree with what is drawn. And it has to be *cheap*, because being
 * cheap is the entire reason it is generated instead of modelled.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { TREES } from '../src/config';
import {
  GENERATED_PREFABS,
  repaintTrees,
  treeGeometry,
  treeMaterial,
} from '../src/core/GeneratedPrefabs';
import { TUNABLES, resetTuning } from '../src/debug/Tuning';
import { Props } from '../src/world/Props';

const tunable = (key: string) => {
  const found = TUNABLES.find((entry) => entry.key === key);
  if (!found) throw new Error(`no tunable "${key}"`);
  return found;
};

// The colour test moves live config (§8.3), so every test puts it back.
afterEach(() => resetTuning());

function triangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

describe('the generated tree (§2)', () => {
  it('is authored at unit height, so a caller scaling it gets metres', () => {
    const geometry = treeGeometry();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1, 5);
    // Standing on the floor, not sunk into it or hovering over it.
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 2);
  });

  it('carries its colours per vertex, so a forest of them is one material', () => {
    // The whole reason a band of thousands is affordable: one material, one draw call.
    expect(treeGeometry().getAttribute('color')).toBeDefined();
  });

  it('costs a fraction of the kit tree it stands in for (§7)', () => {
    // `docs/project-map.jsonl` records `prop_tree` at 3,104 triangles. §2's band plants
    // trees in five figures, which at that cost is a budget nobody has — that, and showing
    // a crown to the camera at all, is the whole reason this exists.
    expect(triangles(treeGeometry())).toBeLessThan(120);
  });

  it('takes new colours without being built again (§8.3)', () => {
    // The colours are baked into a vertex attribute because that is what makes a band of
    // ten thousand trees one draw call (§2) — so the tuner's push has to rewrite the
    // attribute, and it has to know which vertices are trunk and which are crown. A push
    // that got the split wrong paints a brown canopy, which reads as the colours simply
    // not working.
    const geometry = treeGeometry();
    const scene = new THREE.Scene().add(new THREE.Mesh(geometry, treeMaterial()));
    const colours = geometry.getAttribute('color');
    const authored = (colours.array as Float32Array).slice();

    tunable('trees.trunk').set(0xff0000);
    tunable('trees.canopy').set(0x0000ff);
    repaintTrees(scene);

    const trunk = new THREE.Color(0xff0000);
    const canopy = new THREE.Color(0x0000ff);
    expect(colours.getX(0)).toBeCloseTo(trunk.r, 5);
    expect(colours.getZ(0)).toBeCloseTo(trunk.b, 5);
    expect(colours.getZ(colours.count - 1)).toBeCloseTo(canopy.b, 5);
    expect(colours.getX(colours.count - 1)).toBeCloseTo(canopy.r, 5);

    // And back, exactly: a tuning session is a series of absolute answers, not a drift.
    resetTuning();
    repaintTrees(scene);
    expect(colours.array).toEqual(authored);
  });

  it('is a tree at every size, because it scales uniformly', () => {
    // `PREFAB_FIT.fitHeight` scales the Y axis alone — right for a wall, and the reason a
    // short kit tree is a pancake with an 11.84 m canopy. This one keeps its proportions.
    const geometry = treeGeometry();
    geometry.computeBoundingBox();
    const unit = geometry.boundingBox!.getSize(new THREE.Vector3());
    geometry.scale(4, 4, 4);
    geometry.computeBoundingBox();
    const scaled = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(scaled.x / scaled.y).toBeCloseTo(unit.x / unit.y, 5);
  });
});

describe('`tree_small` as a prefab (§1, §2)', () => {
  const built = GENERATED_PREFABS.tree_small!();

  it('stands at the height §2 asks for', () => {
    expect(built.height).toBe(TREES.smallHeightMetres);
    built.geometry.computeBoundingBox();
    expect(built.geometry.boundingBox!.max.y).toBeCloseTo(TREES.smallHeightMetres, 4);
  });

  it('blocks its trunk and not its crown', () => {
    // The same call §2 makes for the kit's tree: a crown is something you walk under, and
    // blocking the ground under it would fence off most of a wood.
    built.geometry.computeBoundingBox();
    const crownWidth = built.geometry.boundingBox!.getSize(new THREE.Vector3()).x;
    expect(built.footprint.x).toBeCloseTo(TREES.trunkHalfWidth * 2, 5);
    expect(built.footprint.x).toBeLessThan(crownWidth);
  });

  it('is short enough to be seen whole from the §3.2 camera', () => {
    // The camera eye sits 13.31 m up. A tree taller than that shows the frame a trunk and
    // keeps its canopy above the eye — which is exactly what the kit's 26 m landmark tree is
    // for inside a map (§2), and exactly what a band meant to *cover* ground must not do.
    expect(TREES.smallHeightMetres).toBeLessThan(13.31);
  });
});

describe('the props the player interacts with stand on something (§6)', () => {
  /** Only the fields `Props` reads off an interactable. */
  const at = (type: string, key: string) =>
    ({ type, key, wx: 4, wz: 4, gx: 2, gy: 2 }) as never;

  /** The lowest point of everything a prop draws, in metres above the floor. */
  function lowestPoint(object: THREE.Object3D): number {
    object.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(object).min.y;
  }

  it('gives a note and a switch a stand, rather than floating them at chest height', () => {
    // Every note and switch in this game hung in mid-air. §9.2 has the *editor* mount them
    // against a solid neighbour, which is a placement rule and not something the renderer
    // can lean on — and a map whose interior is forest (§2) has no neighbour to mount on.
    const props = new Props([at('Note', 'note#0'), at('PowerSwitch', 'switch#0')]);
    for (const child of props.root.children) {
      expect(lowestPoint(child)).toBeLessThan(0.1);
    }
    props.dispose();
  });

  it('leaves the flashlight on the floor, where a pick-up belongs', () => {
    // The exception that shows the rule: §6.1's torch is lying on the ground already, and a
    // post under it would be a torch mounted on a pole.
    const props = new Props([at('Flashlight', 'torch#0')]);
    expect(props.root.children[0]!.children).toHaveLength(1);
    props.dispose();
  });
});
