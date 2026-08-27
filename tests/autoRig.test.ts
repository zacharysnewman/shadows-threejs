/**
 * The rig derived for unrigged player art (§3.1).
 *
 * Three things here can be silently wrong and are worth pinning: which axis the code decides
 * is *up*, how a vertex is shared between the hip and a leg, and which vertices it decides
 * are an arm. Get the first wrong and the character is rigged across its shoulders; get the
 * second wrong and the waist shears instead of bending; get the third wrong and the torso
 * goes with the hand when the player reaches for the torch (§4.1). None of them announces
 * itself — they look like bad art.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER_RIG } from '../src/config';
import {
  armWeightFor,
  axesOf,
  buildHumanoidRig,
  buildWalkClip,
  elbowBlend,
  weightFor,
} from '../src/player/autoRig';

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

describe('finding the arms in a bounding box (§3.1)', () => {
  const inset = 0.22;
  const band = 0.08;

  it('gives the torso to the body and the sleeve to the arm', () => {
    expect(armWeightFor(0.05, 0, inset, band)).toBe(0);
    expect(armWeightFor(0.6, 0, inset, band)).toBe(1);
  });

  it('shares the line rather than cutting on it', () => {
    expect(armWeightFor(inset, 0, inset, band)).toBeCloseTo(0.5, 6);
    expect(armWeightFor(inset - band / 4, 0, inset, band)).toBeLessThan(0.5);
    expect(armWeightFor(inset + band / 4, 0, inset, band)).toBeGreaterThan(0.5);
  });

  it('never claims a vertex the leg already has', () => {
    // A foot is as far off the centreline as a shoulder is, and the only thing separating
    // them is that the leg got there first. Claiming it twice scales the vertex.
    for (const legWeight of [0, 0.25, 0.5, 1]) {
      const arm = armWeightFor(0.6, legWeight, inset, band);
      expect(arm).toBeLessThanOrEqual(1 - legWeight + 1e-12);
      expect(legWeight + arm).toBeLessThanOrEqual(1 + 1e-12);
    }
    expect(armWeightFor(0.6, 1, inset, band)).toBe(0);
  });

  it('degrades to a hard line when there is no band', () => {
    expect(armWeightFor(inset + 0.01, 0, inset, 0)).toBe(1);
    expect(armWeightFor(inset - 0.01, 0, inset, 0)).toBe(0);
  });

  it('hands a vertex from the upper arm to the forearm across the elbow', () => {
    expect(elbowBlend(0, 0.5, 0.3)).toBe(0);
    expect(elbowBlend(0.5, 0.5, 0.3)).toBeCloseTo(0.5, 6);
    expect(elbowBlend(1, 0.5, 0.3)).toBe(1);
    expect(elbowBlend(0.6, 0.5, 0)).toBe(1);
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

  it('puts the lift at the pass and the low points at the footfalls (§3.1)', () => {
    // The one that was silently wrong: the body used to rise exactly where a leg reached
    // its forward extreme — highest at the moment the foot lands, which reads as bouncing
    // and, once §4.3's step is hung off the same phase, puts the sound on the wrong frame.
    // The lift belongs at the pass, where the legs are together and one carries the body.
    const clip = buildWalkClip(axes, 1.86, new THREE.Vector3());
    const hips = clip.tracks.find((track) => track.name === 'hips.position')!;
    const lift = (frame: number): number => hips.values[frame * 3 + 1]!;

    // Keys are at 0, 1/4, 1/2, 3/4, 1 of the stride, so the plant phases are frames 1 and
    // 3 — read off the config rather than assumed, since one number decides both.
    const plant = Math.round(PLAYER_RIG.footPlantPhase * 4);
    expect(lift(plant)).toBeLessThan(lift(0));
    expect(lift(plant + 2)).toBeLessThan(lift(0));
    // Up, down, up, down, up: the pass is the peak, twice per stride.
    expect(lift(2)).toBeCloseTo(lift(0));
    expect(lift(4)).toBeCloseTo(lift(0));
  });

  it('swings each leg to its forward extreme at a plant phase (§3.1, §4.3)', () => {
    // What makes the footfall phase mean anything: the step is played at
    // `footPlantPhase`, so a leg has to be at the end of its swing there. The two legs
    // are in antiphase, so one is at each of the two plants and neither is at the pass.
    const clip = buildWalkClip(axes, 1.86, new THREE.Vector3());
    const plant = Math.round(PLAYER_RIG.footPlantPhase * 4);
    const angleAt = (name: string, frame: number): number => {
      const track = clip.tracks.find((t) => t.name === `${name}.quaternion`)!;
      const q = new THREE.Quaternion().fromArray(Array.from(track.values), frame * 4);
      return 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), q.w);
    };

    const swing = THREE.MathUtils.degToRad(PLAYER_RIG.legSwingDegrees);
    expect(angleAt('legL', plant)).toBeCloseTo(swing);
    expect(angleAt('legR', plant + 2)).toBeCloseTo(swing);
    expect(angleAt('legL', 0)).toBeCloseTo(0);
    expect(angleAt('legR', 0)).toBeCloseTo(0);
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

  /** A figure with arms: a narrow standing body, and a sleeve out to each side. */
  function armed(): THREE.Object3D {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();

    const body = new THREE.BoxGeometry(0.4, 1.86, 0.3);
    body.translate(0, 0.93, 0);
    root.add(new THREE.Mesh(body, material));

    for (const sign of [-1, 1]) {
      // Out level from the shoulder, which is how the kit is authored. Segmented along its
      // length, because an arm has to *run* somewhere for the shoulder and the hand to be
      // different points — a single quad at the fingertips is a box, not a limb.
      const sleeve = new THREE.BoxGeometry(0.5, 0.12, 0.12, 6);
      sleeve.translate(sign * 0.45, 1.4, 0);
      root.add(new THREE.Mesh(sleeve, material));
    }
    return root;
  }

  it('builds an arm either side, elbow and hand included', () => {
    const rig = buildHumanoidRig(armed())!;
    expect(rig.arms.length).toBe(2);
    expect(rig.arms.map((arm) => arm.upper.name).sort()).toEqual(['armUpperL', 'armUpperR']);
    expect(rig.arms.map((arm) => arm.sideSign).sort()).toEqual([-1, 1]);
    for (const arm of rig.arms) {
      // A bone with no length cannot be aimed, and a rig carrying one is worse than none.
      expect(arm.upper.position.length()).toBeGreaterThan(0);
      expect(arm.lower.position.length()).toBeGreaterThan(0);
      expect(arm.hand.position.length()).toBeGreaterThan(0);
      expect(arm.upperAxis.length()).toBeCloseTo(1, 10);
      expect(arm.lowerAxis.length()).toBeCloseTo(1, 10);
    }
  });

  it('says no arms rather than inventing them', () => {
    // A body with nothing beyond the inset is a body with no sleeves. Two bones hung off a
    // torso would drag the ribcage along every time the player reached for the torch.
    const root = new THREE.Group();
    const narrow = new THREE.BoxGeometry(0.4, 1.86, 0.3);
    narrow.translate(0, 0.93, 0);
    root.add(new THREE.Mesh(narrow, new THREE.MeshStandardMaterial()));
    expect(buildHumanoidRig(root)!.arms).toEqual([]);
  });

  it('gives every vertex weights that sum to one, arms included', () => {
    // Four influences now — a leg, two arm bones and the hip — and anything that does not
    // sum to one scales the vertex, which reads as the character deflating.
    const root = armed();
    buildHumanoidRig(root);
    root.traverse((node) => {
      if (!(node instanceof THREE.SkinnedMesh)) return;
      const weight = node.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weight.count; i += 1) {
        const total = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
        expect(total, `vertex ${i}`).toBeCloseTo(1, 5);
      }
    });
  });

  it('leaves an armed figure exactly where it was, at rest', () => {
    // The same invariant the legs rest on, extended to the bones that move most: at rest,
    // skinning is a no-op. An arm bone measured in the wrong frame tears the sleeve off.
    const root = armed();
    root.updateMatrixWorld(true);

    const sleeve = root.children[1] as THREE.Mesh;
    const geometry = sleeve.geometry;
    const before = geometry.getAttribute('position');
    const unrigged = [0, 1, 2, 3].map((i) =>
      new THREE.Vector3().fromBufferAttribute(before, i).applyMatrix4(sleeve.matrixWorld),
    );

    expect(buildHumanoidRig(root)).not.toBeNull();
    root.updateMatrixWorld(true);

    // The skinned mesh keeps the geometry it replaced, so that is what identifies it.
    const skinned = root.children.find(
      (node): node is THREE.SkinnedMesh =>
        node instanceof THREE.SkinnedMesh && node.geometry === geometry,
    )!;
    for (const [i, expected] of unrigged.entries()) {
      const actual = skinned.getVertexPosition(i, new THREE.Vector3());
      actual.applyMatrix4(skinned.matrixWorld);
      expect(actual.x, `vertex ${i} x`).toBeCloseTo(expected.x, 5);
      expect(actual.y, `vertex ${i} y`).toBeCloseTo(expected.y, 5);
      expect(actual.z, `vertex ${i} z`).toBeCloseTo(expected.z, 5);
    }
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
