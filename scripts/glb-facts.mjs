/**
 * What a `.glb` is, read out of the file (§1).
 *
 * The map indexes every tracked file, and until this existed it indexed the art with a line
 * count — the number of `\n` bytes that happen to fall inside a binary. That is not a fact
 * about a model, and an index that answers a real question with a meaningless number is
 * worse than one that says nothing: somebody eventually believes it.
 *
 * What is worth knowing about a model without opening a browser is how big it is, whether
 * it is skinned, and what it can be animated with. All three decide how it is used here: a
 * character's authored height is what its in-game scale is divided by (§5), a skinned mesh
 * cannot go through `AssetLoader` at all (§1, and see `CharacterLoader`), and a clip list is
 * the difference between art that walks and art that slides.
 *
 * **The bounds are the ones Three will report**, because the number worth having is the one
 * the game acts on. That is not the same as the one the file states:
 *
 * - Each primitive's `POSITION` accessor carries its own min/max, and those corners have to
 *   be pushed through the node's world matrix. Node transforms are the whole difficulty for
 *   a static prop — a kit that models in centimetres and carries a 0.01 scale on its root
 *   reads as a hundred-metre prop from the accessors alone.
 * - **A skinned mesh is measured at its bind pose, vertex by vertex.** Three skins every
 *   vertex (`SkinnedMesh.getVertexPosition`) before measuring, and a rest pose that is not
 *   the bind pose moves them: on this project's spider the accessors say 1.949 m tall and
 *   the loaded model is 1.931 m. Small, and it is the number the game divides an enemy's
 *   configured height by, so the index carrying the other one would be quietly wrong in
 *   exactly the case anyone consults it for.
 *
 * Bind pose, not animated: a clip can take a model outside these bounds, which is why the
 * loader turns off frustum culling on skinned meshes rather than trusting them.
 */

/** glTF's chunk type tags, little-endian `JSON` and `BIN\0`. */
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** `glTF`, the container's magic number. */
const MAGIC = 0x46546c67;
/** glTF primitive mode 4 — triangles, and the default when `mode` is absent. */
const TRIANGLES = 4;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const READERS = {
  5120: { bytes: 1, read: (view, at) => view.getInt8(at), max: 127 },
  5121: { bytes: 1, read: (view, at) => view.getUint8(at), max: 255 },
  5122: { bytes: 2, read: (view, at) => view.getInt16(at, true), max: 32767 },
  5123: { bytes: 2, read: (view, at) => view.getUint16(at, true), max: 65535 },
  5125: { bytes: 4, read: (view, at) => view.getUint32(at, true), max: 1 },
  5126: { bytes: 4, read: (view, at) => view.getFloat32(at, true), max: 1 },
};

/**
 * The facts, or null if the buffer is not glTF binary.
 *
 * Null rather than a throw: the map runs over every file in the tree, and a `.glb` that
 * turns out to be a git-lfs pointer or a half-finished download should leave one record
 * thin, not stop the index being generated at all.
 */
export function glbFacts(buffer) {
  const container = readContainer(buffer);
  if (!container) return null;

  const { json, bin } = container;
  const scene = json.scenes?.[json.scene ?? 0];
  if (!scene) return null;

  const world = worldMatrices(json, scene);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let triangles = 0;
  let skinned = false;

  for (const [index, node] of (json.nodes ?? []).entries()) {
    if (node.mesh === undefined || !world.has(index)) continue;
    const matrix = world.get(index);
    const skin = node.skin !== undefined ? json.skins?.[node.skin] : undefined;
    if (skin) skinned = true;

    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      triangles += trianglesIn(json, primitive);
      const bones = skin ? boneMatrices(json, bin, skin, world) : null;
      if (!bones || !expandBySkin(bounds, json, bin, primitive, bones)) {
        expandByCorners(bounds, json, primitive, matrix);
      }
    }
  }

  if (!Number.isFinite(bounds.min[0])) return null;

  return {
    bytes: buffer.length,
    size: [0, 1, 2].map((axis) => round(bounds.max[axis] - bounds.min[axis])),
    triangles,
    skinned,
    // As the exporter wrote them. `CharacterLoader.clipKey` is the one place that decides
    // what this game calls them, and a second copy of that rule here would be a second
    // thing to keep in step with it.
    clips: (json.animations ?? []).map((clip, index) => clip.name ?? `clip${index}`),
  };
}

/** The 12-byte header and the chunks behind it. */
function readContainer(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== MAGIC) return null;

  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > buffer.length) break;
    if (type === CHUNK_JSON) json = JSON.parse(buffer.toString('utf8', start, start + length));
    if (type === CHUNK_BIN) bin = buffer.subarray(start, start + length);
    // Chunks are four-byte aligned; the padding is not part of the declared length.
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  return json ? { json, bin } : null;
}

/**
 * Every node's world matrix, keyed by node index.
 *
 * Walked from the scene roots rather than read off the nodes, because a node's transform is
 * relative to its parent and a joint's parent is usually several bones up. Nodes outside the
 * scene graph are left out: they are not drawn, and a joint that is not in the scene has no
 * world transform to give.
 */
function worldMatrices(json, scene) {
  const world = new Map();
  const visit = (index, parent) => {
    const node = json.nodes?.[index];
    if (!node || world.has(index)) return;
    const matrix = multiply(parent, localMatrix(node));
    world.set(index, matrix);
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const root of scene.nodes ?? []) visit(root, IDENTITY);
  return world;
}

/**
 * `boneWorld · inverseBind` per joint — the matrix that takes a bind-pose vertex to where
 * this pose puts it. At a rest pose that *is* the bind pose every one of these is the
 * identity, which is the case that makes skinning look unnecessary until it is not.
 */
function boneMatrices(json, bin, skin, world) {
  const inverses = readAccessor(json, bin, skin.inverseBindMatrices);
  if (!inverses) return null;
  return skin.joints.map((joint, index) =>
    multiply(world.get(joint) ?? IDENTITY, inverses.slice(index * 16, index * 16 + 16)),
  );
}

/**
 * Skin every vertex and measure the result, the way `SkinnedMesh.computeBoundingBox` does.
 *
 * **A skinned primitive's own node transform is ignored**, which glTF requires and which is
 * the whole trap here. The joints carry it already: this project's spider hangs its armature
 * and its mesh off nodes that both scale by 100 and correct Z-up, so `jointWorld ·
 * inverseBind` comes out as that 100× correction rather than as the identity a bind pose
 * suggests. Skinning the vertex and *then* placing it with the node's matrix applies that
 * correction twice and reports a 594 m spider lying on its side. The blended joints alone
 * land it in world space.
 *
 * Returns false if the primitive is not actually skinnable, so the caller can fall back to
 * the accessor's own bounds rather than silently reporting nothing.
 */
function expandBySkin(bounds, json, bin, primitive, bones) {
  const positions = readAccessor(json, bin, primitive.attributes?.POSITION);
  const joints = readAccessor(json, bin, primitive.attributes?.JOINTS_0);
  const weights = readAccessor(json, bin, primitive.attributes?.WEIGHTS_0);
  if (!positions || !joints || !weights) return false;

  const count = positions.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const base = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    const skinnedPoint = [0, 0, 0];
    let total = 0;
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = weights[vertex * 4 + influence];
      if (weight === 0) continue;
      const bone = bones[joints[vertex * 4 + influence]];
      if (!bone) continue;
      const moved = apply(bone, base);
      for (let axis = 0; axis < 3; axis += 1) skinnedPoint[axis] += moved[axis] * weight;
      total += weight;
    }
    // An unweighted vertex is not skinned at all — it stays where the mesh put it, rather
    // than collapsing to the origin and dragging the bounds to it.
    const point = total === 0 ? base : skinnedPoint;
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
    }
  }
  return true;
}

/**
 * A primitive's eight corners, transformed and unioned in — the cheap path, for anything
 * not skinned.
 *
 * The corners rather than the min/max pair: a rotated node turns a box into a box with a
 * different extent, and transforming only two opposite corners gives an answer that is
 * wrong in exactly the cases the transform was there for.
 */
function expandByCorners(bounds, json, primitive, matrix) {
  const accessor = json.accessors?.[primitive.attributes?.POSITION];
  if (!accessor?.min || !accessor?.max) return;

  const [minX, minY, minZ] = accessor.min;
  const [maxX, maxY, maxZ] = accessor.max;
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) {
        const point = apply(matrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
        }
      }
    }
  }
}

/**
 * An accessor's values, flattened.
 *
 * `byteStride` is the part worth spelling out: an exporter is free to interleave attributes
 * in one buffer view, so consecutive vertices are not consecutive floats and reading them as
 * if they were gives a model made of noise. Sparse accessors are not handled — nothing in
 * this project's kits uses one, and returning null puts the caller on the corner path rather
 * than on a wrong answer.
 */
function readAccessor(json, bin, index) {
  if (index === undefined || !bin) return null;
  const accessor = json.accessors?.[index];
  if (!accessor || accessor.sparse) return null;
  const reader = READERS[accessor.componentType];
  const components = COMPONENTS[accessor.type];
  if (!reader || !components) return null;

  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const stride = view.byteStride ?? components * reader.bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const out = new Array(accessor.count * components);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      const at = start + element * stride + component * reader.bytes;
      if (at + reader.bytes > bin.byteLength) return null;
      const value = reader.read(data, at);
      // Normalized integer attributes — the usual encoding for skin weights — are a
      // fraction of their type's range, not the raw count.
      out[element * components + component] = accessor.normalized ? value / reader.max : value;
    }
  }
  return out;
}

function trianglesIn(json, primitive) {
  if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) return 0;
  const count =
    primitive.indices !== undefined
      ? json.accessors?.[primitive.indices]?.count
      : json.accessors?.[primitive.attributes?.POSITION]?.count;
  return Math.floor((count ?? 0) / 3);
}

/** Column-major 4×4, the layout glTF stores `node.matrix` in. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A node's own transform: an explicit matrix, or the TRS glTF gives instead. */
function localMatrix(node) {
  if (node.matrix) return node.matrix;

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function apply(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Millimetres. Enough to size a model against a 2 m tile, and short enough that a
 * regenerated map does not churn on the last bits of a float.
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}
