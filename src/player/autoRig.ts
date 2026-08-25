/**
 * A humanoid rig built at load time, for art that ships without one (§3.1).
 *
 * The player's kit is a posed mesh: no skeleton, no clips. Unrigged, the character slides
 * across the ground like furniture, which reads worse than the capsule it replaced —
 * the capsule at least did not promise legs.
 *
 * So the rig is derived from the mesh. Three bones, because three is what this camera can
 * see: a hip that carries everything above it, and a leg either side that swings beneath.
 * Vertices are assigned by height and by which side of centre they sit on, blended through
 * a band around the hip so the join bends rather than shears.
 *
 * **This is an approximation and is meant to be replaced.** A rig authored with the model
 * knows where the knee is; this one guesses from a bounding box. What makes the guess safe
 * enough is the camera: §3.2 looks down from 14 m at 72°, so a leg is a handful of pixels
 * and what actually reads is the *cadence* — the body rising and falling in time with the
 * ground it covers. The moment the art arrives with its own skeleton, this becomes dead
 * code and should go.
 *
 * The geometry is read in the model's own axes rather than the game's. A kit is free to be
 * authored Z-up — this one is, and the node above it carries the conversion — so the up
 * axis is *measured* as the longest extent rather than assumed. Getting that wrong rigs a
 * character across its shoulders.
 */

import * as THREE from 'three';
import { PLAYER_RIG } from '../config';

export interface HumanoidRig {
  skeleton: THREE.Skeleton;
  /** Hips, left leg, right leg — the order the skin indices refer to. */
  bones: THREE.Bone[];
  /** One stride's worth of animation, in the model's own units. */
  walk: THREE.AnimationClip;
}

/** Which axis of a bounding box is up, sideways and forward, longest to shortest. */
export interface Axes {
  up: 0 | 1 | 2;
  side: 0 | 1 | 2;
  forward: 0 | 1 | 2;
}

/**
 * Measure the axes from a bounding box.
 *
 * A standing humanoid is tallest along up and widest along its shoulders, so ordering the
 * extents identifies both — and the remaining axis is depth. Assuming Y-up would be right
 * for most kits and silently wrong for this one.
 */
export function axesOf(box: THREE.Box3): Axes {
  const extent = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const order = [0, 1, 2].sort((a, b) => extent[b]! - extent[a]!) as Array<0 | 1 | 2>;
  return { up: order[0]!, side: order[1]!, forward: order[2]! };
}

/**
 * Weight one vertex between the hip bone and a leg.
 *
 * Returns the bone index and its weight against the hip. Above the band it is all hip;
 * below, all leg; through the band the two share it, which is what turns a hard cut at the
 * waist into a bend.
 */
export function weightFor(
  up: number,
  side: number,
  hip: number,
  band: number,
): { bone: number; legWeight: number } {
  const bone = side < 0 ? 1 : 2;
  if (band <= 0) return { bone, legWeight: up < hip ? 1 : 0 };
  // 1 well below the hip, 0 well above, linear through the band.
  const t = (hip + band / 2 - up) / band;
  return { bone, legWeight: Math.min(1, Math.max(0, t)) };
}

/**
 * Build the rig and turn every mesh under `root` into a `SkinnedMesh` bound to it.
 *
 * Returns null when there is nothing to rig — no meshes, or a model too flat to be a
 * standing figure — because a bad rig is worse than none, and the caller still has a
 * perfectly good unrigged body to fall back on.
 */
export function buildHumanoidRig(root: THREE.Object3D): HumanoidRig | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh)) meshes.push(node);
  });
  if (meshes.length === 0) return null;

  // Everything below is measured in one space: that of the node the meshes hang from. A
  // loader wraps a model in orientation and grounding nodes, so a vertex's own coordinates,
  // its mesh's coordinates and the character root's are three different frames, and mixing
  // them is how a rig ends up describing a shape the model does not have.
  root.updateMatrixWorld(true);
  const boneParent = meshes[0]!.parent ?? root;
  const intoRigSpace = new THREE.Matrix4().copy(boneParent.matrixWorld).invert();
  const placements = meshes.map((mesh) =>
    new THREE.Matrix4().multiplyMatrices(intoRigSpace, mesh.matrixWorld),
  );

  const box = new THREE.Box3();
  meshes.forEach((mesh, index) => {
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(placements[index]!));
    }
  });
  if (box.isEmpty()) return null;

  const axes = axesOf(box);
  const min = box.min.toArray();
  const max = box.max.toArray();
  const height = max[axes.up]! - min[axes.up]!;
  if (height <= 0) return null;

  const hip = min[axes.up]! + height * PLAYER_RIG.hipFraction;
  const band = height * PLAYER_RIG.blendFraction;
  const sideCentre = (min[axes.side]! + max[axes.side]!) / 2;

  // --- Bones ---------------------------------------------------------------
  const place = (u: number, s: number): THREE.Vector3 => {
    const v = new THREE.Vector3();
    v.setComponent(axes.up, u);
    v.setComponent(axes.side, s);
    v.setComponent(axes.forward, 0);
    return v;
  };

  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.copy(place(hip, sideCentre));

  const legSpread = (max[axes.side]! - min[axes.side]!) * PLAYER_RIG.legSpreadFraction;
  const legL = new THREE.Bone();
  legL.name = 'legL';
  legL.position.copy(place(0, -legSpread));
  const legR = new THREE.Bone();
  legR.name = 'legR';
  legR.position.copy(place(0, legSpread));
  hips.add(legL, legR);

  // Into the graph once, not once per mesh: an `Object3D` has one parent, so adding it in
  // the loop below would silently re-parent it to whichever mesh happened to be last.
  boneParent.add(hips);
  root.updateMatrixWorld(true);

  // Built *after* the bones are in the graph, because the inverses it takes are of their
  // world matrices. A skeleton constructed from parentless bones describes the rest pose of
  // a model that is not where this one is.
  const bones = [hips, legL, legR];
  const skeleton = new THREE.Skeleton(bones);

  // --- Skinning ------------------------------------------------------------
  const vertex = new THREE.Vector3();
  meshes.forEach((mesh, index) => {
    const placement = placements[index]!;
    const position = mesh.geometry.getAttribute('position');
    const count = position.count;
    const indices = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);

    for (let i = 0; i < count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(placement);
      const up = vertex.getComponent(axes.up);
      const side = vertex.getComponent(axes.side) - sideCentre;
      const { bone, legWeight } = weightFor(up, side, hip, band);

      // Two influences: the leg and the hip. Everything else is zero, which keeps the
      // buffers small and the falloff readable.
      indices[i * 4] = bone;
      indices[i * 4 + 1] = 0;
      weights[i * 4] = legWeight;
      weights[i * 4 + 1] = 1 - legWeight;
    }

    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));

    const skinned = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
    skinned.name = mesh.name;
    skinned.castShadow = mesh.castShadow;
    skinned.receiveShadow = mesh.receiveShadow;
    // An animated mesh can leave its bind-pose bounds; culling against them makes a walking
    // player vanish at the edge of the frustum.
    skinned.frustumCulled = false;
    skinned.position.copy(mesh.position);
    skinned.quaternion.copy(mesh.quaternion);
    skinned.scale.copy(mesh.scale);

    (mesh.parent ?? root).add(skinned);
    mesh.removeFromParent();
    skinned.updateMatrixWorld(true);
    // The bind matrix is the mesh's *world* matrix, and that is not a detail to shortcut.
    // Three renders a skinned vertex as `boneWorldNow · boneInverseAtBind · bindMatrix · v`,
    // re-deriving the mesh's own inverse every frame, so the bind matrix is the only thing
    // carrying the geometry into the space the bones were measured in. An identity here
    // renders the model in its raw authored coordinates — for a Z-up kit, flat on its back.
    skinned.bind(skeleton, skinned.matrixWorld.clone());
  });

  return { skeleton, bones, walk: buildWalkClip(axes, height, hips.position.clone()) };
}

/**
 * One stride, as a clip.
 *
 * The legs swing in antiphase about the side axis and the hips rise twice per stride —
 * once per foot — which is the part that actually reads from §3.2's camera. Amplitudes are
 * fractions of the model's height, so the same clip suits a character of any size.
 */
export function buildWalkClip(
  axes: Axes,
  height: number,
  hipRest: THREE.Vector3,
): THREE.AnimationClip {
  const period = PLAYER_RIG.strideSeconds;
  const swing = THREE.MathUtils.degToRad(PLAYER_RIG.legSwingDegrees);
  const bob = height * PLAYER_RIG.bobFraction;

  const axis = new THREE.Vector3();
  axis.setComponent(axes.side, 1);

  const quaternionTrack = (name: string, phase: number): THREE.QuaternionKeyframeTrack => {
    const times = [0, period / 4, period / 2, (period * 3) / 4, period];
    const values: number[] = [];
    for (const time of times) {
      const angle = Math.sin((time / period) * Math.PI * 2 + phase) * swing;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
  };

  // Twice per stride: the body lifts over each supporting leg.
  const bobTimes = [0, period / 4, period / 2, (period * 3) / 4, period];
  const bobValues: number[] = [];
  for (const time of bobTimes) {
    const lift = Math.abs(Math.sin((time / period) * Math.PI * 2)) * bob;
    // A position track is absolute, not additive, so the rest position has to be in it —
    // otherwise the first frame of the walk snaps the hips to the model's origin.
    const v = hipRest.clone();
    v.setComponent(axes.up, v.getComponent(axes.up) + lift);
    bobValues.push(v.x, v.y, v.z);
  }

  return new THREE.AnimationClip('walk', period, [
    quaternionTrack('legL', 0),
    quaternionTrack('legR', Math.PI),
    new THREE.VectorKeyframeTrack('hips.position', bobTimes, bobValues),
  ]);
}
