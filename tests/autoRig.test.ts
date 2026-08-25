/**
 * The rig derived for unrigged player art (§3.1).
 *
 * Two things here can be silently wrong and are worth pinning: which axis the code decides
 * is *up*, and how a vertex is shared between the hip and a leg. Get the first wrong and
 * the character is rigged across its shoulders; get the second wrong and the waist shears
 * instead of bending. Neither announces itself — they look like bad art.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER_RIG } from '../src/config';
import { axesOf, buildHumanoidRig, buildWalkClip, weightFor } from '../src/player/autoRig';

/** A box from extents, centred on the origin in side and forward, standing on zero. */
function box(x: number, y: number, z: number): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(-x / 2, -y / 2, -z / 2),
    new THREE.Vector3(x / 2, y / 2, z / 2),
  );
}

describe('measuring a model\'s axes (§3.1)', () => {
  it('calls the longest extent up and the next widest the shoulders', () => {
    // A Y-up humanoid: 1.3 wide, 1.86 tall, 0.3 deep.
    expect(axesOf(box(1.3, 1.86, 0.3))).toEqual({ up: 1, side: 0, forward: 2 });
  });

  it('finds up on Z for a kit authored that way', () => {
    // The player's kit, as its raw data reads: 1.334 × 0.293 × 1.860 with height on Z.
    // Assuming Y-up here is what rigs a character across its shoulders.
    expect(axesOf(box(1.334, 0.293, 1.86))).toEqual({ up: 2, side: 0, forward: 1 });
  });

  it('names three different axes whatever the shape', () => {
    for (const [x, y, z] of [
      [1, 2, 3],
      [3, 2, 1],
      [2, 3, 1],
      [1, 1, 1],
    ] as const) {
      const axes = axesOf(box(x, y, z));
      expect(new Set([axes.up, axes.side, axes.forward]).size).toBe(3);
    }
  });
});

describe('sharing a vertex between hip and leg (§3.1)', () => {
  const hip = 0.9;
  const band = 0.22;

  it('puts a foot entirely on its own leg', () => {
    expect(weightFor(0.05, -0.2, hip, band)).toEqual({ bone: 1, legWeight: 1 });
    expect(weightFor(0.05, 0.2, hip, band)).toEqual({ bone: 2, legWeight: 1 });
  });

  it('puts the head entirely on the hips', () => {
    expect(weightFor(1.8, -0.1, hip, band).legWeight).toBe(0);
    expect(weightFor(1.8, 0.1, hip, band).legWeight).toBe(0);
  });

  it('shares the band, so the waist bends instead of shearing', () => {
    // Exactly at the hip the two halve it; a hard cut here is the shear this avoids.
    expect(weightFor(hip, -0.1, hip, band).legWeight).toBeCloseTo(0.5, 6);
    // And it is monotonic through the band rather than jumping.
    const above = weightFor(hip + band / 4, -0.1, hip, band).legWeight;
    const below = weightFor(hip - band / 4, -0.1, hip, band).legWeight;
    expect(above).toBeLessThan(0.5);
    expect(below).toBeGreaterThan(0.5);
  });

  it('always produces weights that sum to one', () => {
    // Anything else scales the vertex: skinning weights that do not sum to 1 shrink or
    // stretch the mesh, which reads as the character deflating rather than as a rig bug.
    for (let up = 0; up <= 1.86; up += 0.06) {
      for (const side of [-0.3, -0.01, 0.01, 0.3]) {
        const { legWeight } = weightFor(up, side, hip, band);
        expect(legWeight + (1 - legWeight)).toBeCloseTo(1, 10);
        expect(legWeight).toBeGreaterThanOrEqual(0);
        expect(legWeight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('degrades to a hard split when there is no band', () => {
    expect(weightFor(0.5, -0.1, hip, 0).legWeight).toBe(1);
    expect(weightFor(1.5, -0.1, hip, 0).legWeight).toBe(0);
  });
});

describe('the walk clip (§3.1)', () => {
  const axes = { up: 1, side: 0, forward: 2 } as const;

  it('is one stride long and drives both legs and the hips', () => {
    const clip = buildWalkClip(axes, 1.86, new THREE.Vector3(0, 0.9, 0));
    expect(clip.duration).toBeCloseTo(PLAYER_RIG.strideSeconds);
    expect(clip.tracks.map((track) => track.name).sort()).toEqual([
      'hips.position',
      'legL.quaternion',
      'legR.quaternion',
    ]);
  });

  it('swings the legs in antiphase', () => {
    // Both legs forward at once is a hop, not a walk.
    const clip = buildWalkClip(axes, 1.86, new THREE.Vector3());
    const left = clip.tracks.find((t) => t.name === 'legL.quaternion')!;
    const right = clip.tracks.find((t) => t.name === 'legR.quaternion')!;

    const angleAt = (track: THREE.KeyframeTrack, frame: number): number => {
      const v = track.values;
      const q = new THREE.Quaternion(v[frame * 4]!, v[frame * 4 + 1]!, v[frame * 4 + 2]!, v[frame * 4 + 3]!);
      // Signed angle about the side axis.
      return new THREE.Euler().setFromQuaternion(q).x;
    };

    // A quarter through the stride is the widest part of the swing.
    expect(angleAt(left, 1)).toBeCloseTo(-angleAt(right, 1), 6);
    expect(Math.abs(angleAt(left, 1))).toBeGreaterThan(0.1);
  });

  it('carries the hips\' rest position, rather than snapping them to the origin', () => {
    // A position track is absolute. Writing the lift alone would drop the hips to the
    // model's origin on the first frame of the walk.
    const rest = new THREE.Vector3(0, 0.9, 0);
    const clip = buildWalkClip(axes, 1.86, rest);
    const hips = clip.tracks.find((track) => track.name === 'hips.position')!;

    // Keyframe buffers are `Float32Array`, so an exact bound would fail on 0.9 alone.
    const epsilon = 1e-6;
    for (let frame = 0; frame * 3 < hips.values.length; frame += 1) {
      const y = hips.values[frame * 3 + 1]!;
      expect(y).toBeGreaterThanOrEqual(rest.y - epsilon);
      expect(y).toBeLessThanOrEqual(rest.y + 1.86 * PLAYER_RIG.bobFraction + epsilon);
    }
  });

  it('lifts the body twice per stride, once over each foot', () => {
    const clip = buildWalkClip(axes, 1.86, new THREE.Vector3());
    const hips = clip.tracks.find((track) => track.name === 'hips.position')!;
    const ys = [0, 1, 2, 3, 4].map((frame) => hips.values[frame * 3 + 1]!);
    // Down, up, down, up, down across the five keys.
    expect(ys[1]).toBeGreaterThan(ys[0]!);
    expect(ys[2]).toBeLessThan(ys[1]!);
    expect(ys[3]).toBeGreaterThan(ys[2]!);
    expect(ys[4]).toBeLessThan(ys[3]!);
  });
});

describe('building the rig onto a model (§3.1)', () => {
  /** A crude two-legged figure: a tall box, Y-up, with a foot either side of centre. */
  function figure(): THREE.Object3D {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1.3, 1.86, 0.3);
    geometry.translate(0, 0.93, 0);
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    return root;
  }

  it('replaces every mesh with a skinned one bound to the shared skeleton', () => {
    const root = figure();
    const rig = buildHumanoidRig(root);
    expect(rig).not.toBeNull();

    const skinned: THREE.SkinnedMesh[] = [];
    const plain: THREE.Mesh[] = [];
    root.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) skinned.push(node);
      else if (node instanceof THREE.Mesh) plain.push(node);
    });

    expect(skinned.length).toBe(1);
    expect(plain.length).toBe(0);
    for (const mesh of skinned) expect(mesh.skeleton).toBe(rig!.skeleton);
  });

  it('gives every vertex skin attributes', () => {
    const root = figure();
    buildHumanoidRig(root);
    root.traverse((node) => {
      if (!(node instanceof THREE.SkinnedMesh)) return;
      const index = node.geometry.getAttribute('skinIndex');
      const weight = node.geometry.getAttribute('skinWeight');
      expect(index.count).toBe(node.geometry.getAttribute('position').count);
      expect(weight.count).toBe(index.count);
    });
  });

  it('puts the skeleton in the graph exactly once', () => {
    // An `Object3D` has one parent, so adding it per mesh would silently re-parent it to
    // whichever mesh happened to be last.
    const root = figure();
    const rig = buildHumanoidRig(root)!;
    let hips = 0;
    root.traverse((node) => {
      if (node === rig.bones[0]) hips += 1;
    });
    expect(hips).toBe(1);
  });

  it('declines rather than producing a bad rig', () => {
    expect(buildHumanoidRig(new THREE.Group())).toBeNull();
  });

  it('leaves the model exactly where it was, under the loader\'s wrapper nodes', () => {
    // The invariant the whole rig rests on: at rest, skinning is a no-op. Break it and the
    // character does not disappear cleanly — it renders in some other space, which on a
    // Z-up kit means lying flat on the floor a few metres from the player, and from §3.2's
    // camera that reads as "the art is broken" rather than as a binding bug.
    //
    // It only shows up under the nesting `CharacterLoader` builds: root → stand → orient →
    // model. With the meshes directly under the node the bones go in, every wrong answer
    // happens to agree with the right one.
    const model = figure();
    const orient = new THREE.Group();
    orient.rotation.x = -Math.PI / 2;
    orient.add(model);
    const lift = new THREE.Group();
    lift.position.y = 0.93;
    lift.add(orient);
    const root = new THREE.Group();
    root.position.set(5, 0, 5);
    root.scale.setScalar(0.97);
    root.add(lift);
    root.updateMatrixWorld(true);

    const mesh = model.children[0] as THREE.Mesh;
    const before = mesh.geometry.getAttribute('position');
    const unrigged = [0, 1, 2, 3].map((i) =>
      new THREE.Vector3().fromBufferAttribute(before, i).applyMatrix4(mesh.matrixWorld),
    );

    expect(buildHumanoidRig(root)).not.toBeNull();
    root.updateMatrixWorld(true);

    const skinned = root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    for (const [i, expected] of unrigged.entries()) {
      const actual = skinned.getVertexPosition(i, new THREE.Vector3());
      actual.applyMatrix4(skinned.matrixWorld);
      expect(actual.x, `vertex ${i} x`).toBeCloseTo(expected.x, 5);
      expect(actual.y, `vertex ${i} y`).toBeCloseTo(expected.y, 5);
      expect(actual.z, `vertex ${i} z`).toBeCloseTo(expected.z, 5);
    }
  });

  it('measures the figure in the space its bones live in', () => {
    // Same nesting, and the check that the measurement moved with the binding: the kit is
    // authored Y-up but the wrapper turns it, so a rig measured in world space would call
    // the model's depth its height and put the hips through its chest.
    const model = figure();
    const orient = new THREE.Group();
    orient.rotation.x = -Math.PI / 2;
    orient.add(model);
    const root = new THREE.Group();
    root.add(orient);
    root.updateMatrixWorld(true);

    const rig = buildHumanoidRig(root)!;
    const [hips] = rig.bones;
    // 1.86 tall, hips at PLAYER_RIG.hipFraction of that, in the model's own frame — which
    // after the wrapper's turn is the y axis of the node the bones sit in.
    expect(hips!.position.y).toBeCloseTo(1.86 * PLAYER_RIG.hipFraction, 5);
  });
});
