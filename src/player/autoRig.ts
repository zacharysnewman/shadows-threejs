/**
 * A humanoid rig built at load time, for art that ships without one (§3.1).
 *
 * The player's kit is a posed mesh: no skeleton, no clips. Unrigged, the character slides
 * across the ground like furniture, which reads worse than the capsule it replaced —
 * the capsule at least did not promise legs.
 *
 * So the rig is derived from the mesh. A hip that carries everything above it, a leg either
 * side that swings beneath it, and an arm either side that reaches. Vertices are assigned by
 * height and by which side of centre they sit on, blended through a band around the hip so
 * the join bends rather than shears.
 *
 * The arms are found by the one thing that separates them from a torso in a bounding box: a
 * standing figure's arms are the outermost thing above its waist. Anything beyond a fraction
 * of the half-width and above the hip is an arm, blended across that line the same way the
 * waist is. What they are *for* is §4.1's flashlight — the hand goes where the beam is
 * emitted, and `ArmIk` solves the rest.
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
  /** Hips, legs, then each arm's three bones — the order the skin indices refer to. */
  bones: THREE.Bone[];
  /** One stride's worth of animation, in the model's own units. */
  walk: THREE.AnimationClip;
  /** The arms, if the model turned out to have any. Empty is a valid answer. */
  arms: ArmChain[];
}

/**
 * One arm: two bones that move, and a third that only marks where the hand is.
 *
 * The hand bone carries no vertices. It exists so the forearm has a measurable length and
 * so there is something to ask "where did the hand end up" of — which is what places the
 * torch (§4.1). A wrist that articulated would be a fourth thing to solve for and nothing
 * at §3.2's distance could see it.
 */
export interface ArmChain {
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  /** Unit direction from this bone to the next at rest, in the bone's own space. */
  upperAxis: THREE.Vector3;
  lowerAxis: THREE.Vector3;
  /** -1 for the arm on the negative side of centre, +1 for the other. */
  sideSign: -1 | 1;
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
 * How much of a vertex belongs to an arm rather than to the torso.
 *
 * `lateral` is its distance from the model's centreline; beyond `inset` and above the waist
 * it is an arm. Both edges are ramps rather than cuts, for the same reason the waist is one:
 * a hard line at the shoulder tears the sleeve off the body the first time the arm moves.
 *
 * Multiplied by whatever the hip band left over, so a vertex is never claimed twice — the
 * arm ramps in exactly where the leg ramps out.
 */
export function armWeightFor(
  lateral: number,
  legWeight: number,
  inset: number,
  band: number,
): number {
  const across = band <= 0 ? (lateral >= inset ? 1 : 0) : (lateral - (inset - band / 2)) / band;
  return (1 - legWeight) * Math.min(1, Math.max(0, across));
}

/**
 * How much of an arm vertex belongs to the forearm rather than the upper arm.
 *
 * `along` is where it sits between shoulder (0) and hand (1). Zero is all upper arm, one is
 * all forearm, and the band across the elbow is what makes it bend.
 */
export function elbowBlend(along: number, elbow: number, band: number): number {
  if (band <= 0) return along >= elbow ? 1 : 0;
  return Math.min(1, Math.max(0, (along - (elbow - band / 2)) / band));
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

  // --- Arms ----------------------------------------------------------------
  // Measured before the bones exist, because where the shoulder and the hand are is a
  // question about the mesh: a bounding box says how wide the model is, not where along
  // that width the body stops and the sleeve starts.
  const halfWidth = (max[axes.side]! - min[axes.side]!) / 2;
  const armInset = halfWidth * PLAYER_RIG.armInsetFraction;
  const armBand = halfWidth * PLAYER_RIG.armInsetBandFraction;
  const measured = measureArms(meshes, placements, axes, sideCentre, hip, armInset);

  const bones = [hips, legL, legR];
  const arms: ArmChain[] = [];
  const geometryOf = new Map<-1 | 1, ArmGeometry>();

  for (const span of measured) {
    const shoulder = place(span.shoulderUp, sideCentre + span.sideSign * span.shoulderLateral);
    const hand = place(span.handUp, sideCentre + span.sideSign * span.handLateral);
    // The forward axis is left at zero, as it is for the legs: a kit's arms hang within a
    // few centimetres of the body's plane, and the IK moves the hand anyway (§4.1).
    const elbow = shoulder.clone().lerp(hand, PLAYER_RIG.elbowFraction);

    const side = span.sideSign < 0 ? 'L' : 'R';
    const upper = new THREE.Bone();
    upper.name = `armUpper${side}`;
    upper.position.copy(shoulder).sub(hips.position);
    const lower = new THREE.Bone();
    lower.name = `armLower${side}`;
    lower.position.copy(elbow).sub(shoulder);
    const wrist = new THREE.Bone();
    wrist.name = `hand${side}`;
    wrist.position.copy(hand).sub(elbow);

    // A bone with no length cannot be aimed and cannot be measured, and a rig carrying one
    // is worse than a body with no arms at all.
    if (lower.position.lengthSq() < 1e-12 || wrist.position.lengthSq() < 1e-12) continue;

    upper.add(lower);
    lower.add(wrist);
    hips.add(upper);

    arms.push({
      upper,
      lower,
      hand: wrist,
      upperAxis: lower.position.clone().normalize(),
      lowerAxis: wrist.position.clone().normalize(),
      sideSign: span.sideSign,
    });
    geometryOf.set(span.sideSign, {
      shoulder,
      direction: hand.clone().sub(shoulder).normalize(),
      length: hand.distanceTo(shoulder),
      upper: bones.length,
      lower: bones.length + 1,
    });
    bones.push(upper, lower, wrist);
  }

  // Into the graph once, not once per mesh: an `Object3D` has one parent, so adding it in
  // the loop below would silently re-parent it to whichever mesh happened to be last.
  boneParent.add(hips);
  root.updateMatrixWorld(true);

  // Built *after* the bones are in the graph, because the inverses it takes are of their
  // world matrices. A skeleton constructed from parentless bones describes the rest pose of
  // a model that is not where this one is.
  const skeleton = new THREE.Skeleton(bones);

  // --- Skinning ------------------------------------------------------------
  const vertex = new THREE.Vector3();
  const _fromShoulder = new THREE.Vector3();
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

      const arm = geometryOf.get(side < 0 ? -1 : 1);
      const armWeight = arm ? armWeightFor(Math.abs(side), legWeight, armInset, armBand) : 0;
      // Where along the arm it sits, projected onto the shoulder-to-hand line rather than
      // read off the width: an arm that hangs rather than reaching out has its hand at the
      // *bottom*, and a split by lateral distance would put the elbow in the shoulder.
      const along = arm
        ? THREE.MathUtils.clamp(
            _fromShoulder.copy(vertex).sub(arm.shoulder).dot(arm.direction) / arm.length,
            0,
            1,
          )
        : 0;
      const bend = arm ? elbowBlend(along, PLAYER_RIG.elbowFraction, PLAYER_RIG.armBlendFraction) : 0;

      // Four influences, and they always sum to one: the leg takes its share first, the arm
      // takes a share of what is left, and the hip keeps the remainder. Anything that does
      // not sum to one scales the vertex, which reads as the character deflating.
      indices[i * 4] = bone;
      indices[i * 4 + 1] = arm ? arm.upper : 0;
      indices[i * 4 + 2] = arm ? arm.lower : 0;
      indices[i * 4 + 3] = 0;
      weights[i * 4] = legWeight;
      weights[i * 4 + 1] = armWeight * (1 - bend);
      weights[i * 4 + 2] = armWeight * bend;
      weights[i * 4 + 3] = 1 - legWeight - armWeight;
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

  return { skeleton, bones, arms, walk: buildWalkClip(axes, height, hips.position.clone()) };
}

/** Where one arm runs from and to, in the model's own units. */
interface ArmSpan {
  sideSign: -1 | 1;
  shoulderLateral: number;
  shoulderUp: number;
  handLateral: number;
  handUp: number;
}

/** What the skinning pass needs to know about an arm it has already built bones for. */
interface ArmGeometry {
  shoulder: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  upper: number;
  lower: number;
}

/**
 * Find where each arm starts and ends, from the vertices themselves.
 *
 * The bounding box says the model is 1.33 m wide and 1.86 m tall; it does not say that the
 * outer 0.45 m of that width is two sleeves. So the vertices beyond the inset and above the
 * waist are swept twice: once to find how far out they run, and once to take the centroid of
 * the innermost and outermost slices of that run. Those two points are the shoulder and the
 * hand, and everything else about the arm follows from them.
 *
 * Centroids of slices rather than extreme vertices, because a single vertex is a fingertip
 * or a shoulder pad and either one puts the joint in the wrong place by a few centimetres —
 * which on an arm half a metre long is most of a forearm.
 *
 * Returns an empty list when the model does not look like it has arms: nothing beyond the
 * inset, or a run too short to hang two bones off. A body with no arms is a fine answer, and
 * a rig that invents them is not.
 */
function measureArms(
  meshes: readonly THREE.Mesh[],
  placements: readonly THREE.Matrix4[],
  axes: Axes,
  sideCentre: number,
  hip: number,
  inset: number,
): ArmSpan[] {
  const sides: Array<-1 | 1> = [-1, 1];
  const range = new Map<-1 | 1, { min: number; max: number }>();
  const vertex = new THREE.Vector3();

  const sweep = (visit: (sideSign: -1 | 1, lateral: number, up: number) => void): void => {
    meshes.forEach((mesh, index) => {
      const position = mesh.geometry.getAttribute('position');
      const placement = placements[index]!;
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(placement);
        const up = vertex.getComponent(axes.up);
        if (up <= hip) continue;
        const side = vertex.getComponent(axes.side) - sideCentre;
        const lateral = Math.abs(side);
        if (lateral <= inset) continue;
        visit(side < 0 ? -1 : 1, lateral, up);
      }
    });
  };

  sweep((sideSign, lateral) => {
    const seen = range.get(sideSign);
    if (!seen) range.set(sideSign, { min: lateral, max: lateral });
    else {
      seen.min = Math.min(seen.min, lateral);
      seen.max = Math.max(seen.max, lateral);
    }
  });

  const ends = new Map<
    -1 | 1,
    { inner: { lateral: number; up: number; n: number }; outer: { lateral: number; up: number; n: number } }
  >();
  for (const sideSign of sides) {
    const seen = range.get(sideSign);
    // A run with no width is a torso the inset failed to exclude, not an arm.
    if (!seen || seen.max - seen.min < 1e-6) continue;
    ends.set(sideSign, {
      inner: { lateral: 0, up: 0, n: 0 },
      outer: { lateral: 0, up: 0, n: 0 },
    });
  }
  if (ends.size === 0) return [];

  sweep((sideSign, lateral, up) => {
    const seen = range.get(sideSign)!;
    const end = ends.get(sideSign);
    if (!end) return;
    const slice = (seen.max - seen.min) * PLAYER_RIG.armEndFraction;
    const bucket =
      lateral <= seen.min + slice ? end.inner : lateral >= seen.max - slice ? end.outer : null;
    if (!bucket) return;
    bucket.lateral += lateral;
    bucket.up += up;
    bucket.n += 1;
  });

  const spans: ArmSpan[] = [];
  for (const sideSign of sides) {
    const end = ends.get(sideSign);
    if (!end || end.inner.n === 0 || end.outer.n === 0) continue;
    const shoulderLateral = end.inner.lateral / end.inner.n;
    const shoulderUp = end.inner.up / end.inner.n;
    const handLateral = end.outer.lateral / end.outer.n;
    const handUp = end.outer.up / end.outer.n;
    if (Math.hypot(handLateral - shoulderLateral, handUp - shoulderUp) < 1e-4) continue;
    spans.push({ sideSign, shoulderLateral, shoulderUp, handLateral, handUp });
  }
  return spans;
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

  // Twice per stride: the body lifts over each supporting leg. `cos`, not `sin`, and that
  // is the whole of it — the peak belongs at the pass, where the legs are together and one
  // of them is carrying the body, not at the two moments the legs are furthest apart and
  // the weight is being handed over. Inverted, the body rose exactly when a foot landed,
  // which reads as bouncing rather than walking and puts §4.3's step on the wrong frame.
  const bobTimes = [0, period / 4, period / 2, (period * 3) / 4, period];
  const bobValues: number[] = [];
  for (const time of bobTimes) {
    const lift = Math.abs(Math.cos((time / period) * Math.PI * 2)) * bob;
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
