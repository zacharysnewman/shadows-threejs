/**
 * Measuring a `.glb` without a browser (§1).
 *
 * The project map carries each model's size, and the whole value of that is being able to
 * trust it: "how tall is the spider" is what an enemy's scale is divided by (§5), and a
 * number that is quietly 1% out is worse than no number, because nobody re-checks an index.
 *
 * The skinned path is what these guard. A skinned mesh is not measured where its vertices
 * say it is — the joints move them, and the node the mesh hangs off is *ignored* rather
 * than applied. Getting that backwards does not fail loudly: it reports a model that is
 * plausible and wrong, or in this kit's case a 594 m spider on its side.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glbFacts } from '../scripts/glb-facts.mjs';

const ROOT = resolve(__dirname, '..');
const model = (path: string) => glbFacts(readFileSync(resolve(ROOT, path)));

describe('what the checked-in art measures (§1)', () => {
  it('reads a kit prefab at the size the kit authored it', () => {
    // The wall is the one prefab whose authored size is a stated fact rather than an
    // observation: `PREFAB_FIT` scales it *from* 4 m *to* 3, so a change here is a change
    // to what that entry means.
    expect(model('public/prefabs/wall_brick.glb')?.size).toEqual([2, 4, 1]);
  });

  it('knows the spider is skinned and what it can be animated with', () => {
    const spider = model('public/characters/spider.glb');
    // §1 — a skinned mesh cannot go through `AssetLoader`, so this flag is the difference
    // between a character and a prefab, not a detail.
    expect(spider?.skinned).toBe(true);
    // Names as the exporter wrote them; `clipKey` is what turns them into the game's.
    expect(spider?.clips).toContain('HumanArmature|Spider_Walk');
  });

  it('measures a skinned model where the skeleton puts it, not where the vertices are', () => {
    // Both numbers are real: the raw accessors bound this model at 1.949 m, and Three
    // reports 1.931 m once the bind pose is applied. The map owes the second one.
    expect(model('public/characters/spider.glb')?.size[1]).toBeCloseTo(1.931, 3);
  });

  it('says nothing rather than something wrong when handed a file that is not glTF', () => {
    expect(glbFacts(Buffer.from('not a model, just some bytes'))).toBeNull();
  });
});

describe('the skinning transform (§1)', () => {
  /**
   * The trap, minimised: a mesh node and an armature that both scale by 100, one joint, one
   * triangle a metre on a side.
   *
   * With an inverse bind matrix that undoes the joint's world transform, the skinned vertex
   * lands exactly where the file stores it — so the triangle is 1 m, and any implementation
   * that also applies the *mesh node's* 100× scale reports 100 m instead.
   */
  it('ignores the node a skinned mesh hangs off, because the joints already carry it', () => {
    const glb = synthesise({ inverseBind: scaleMatrix(0.01) });
    expect(glbFacts(glb)?.size).toEqual([1, 1, 0]);
  });

  it('follows the joints when they do move the vertex', () => {
    // The same file with an identity inverse bind matrix: now `jointWorld · inverseBind` is
    // the armature's 100× scale, exactly as it is in this project's spider, and the model
    // really is a hundred times its stored size.
    const glb = synthesise({ inverseBind: scaleMatrix(1) });
    expect(glbFacts(glb)?.size).toEqual([100, 100, 0]);
  });

  it('counts triangles and skinning independently of any of that', () => {
    const facts = glbFacts(synthesise({ inverseBind: scaleMatrix(0.01) }));
    expect(facts?.triangles).toBe(1);
    expect(facts?.skinned).toBe(true);
  });
});

/** Column-major uniform scale, the layout glTF stores matrices in. */
function scaleMatrix(scale: number): number[] {
  return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
}

/**
 * A one-triangle skinned `.glb`, built here rather than checked in as a fixture.
 *
 * A fixture would be a binary nobody can read in a diff, and the thing under test is a
 * *relationship* between a node transform and an inverse bind matrix — which is exactly
 * what is invisible in a checked-in file and legible in ten lines of JSON.
 */
function synthesise({ inverseBind }: { inverseBind: number[] }): Buffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const inverses = new Float32Array(inverseBind);

  const parts = [positions, joints, weights, indices, inverses];
  const views: { byteOffset: number; byteLength: number }[] = [];
  let offset = 0;
  for (const part of parts) {
    views.push({ byteOffset: offset, byteLength: part.byteLength });
    // Four-byte alignment, which glTF requires of every buffer view.
    offset += part.byteLength + ((4 - (part.byteLength % 4)) % 4);
  }
  const bin = Buffer.alloc(offset);
  parts.forEach((part, index) => {
    const into = views[index]?.byteOffset ?? 0;
    Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(bin, into);
  });

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      // The armature: everything under it is a hundred times its stored size.
      { name: 'armature', scale: [100, 100, 100], children: [1, 2] },
      { name: 'joint' },
      // The mesh, carrying the same scale — the transform a correct reader ignores.
      { name: 'mesh', mesh: 0, skin: 0, scale: [100, 100, 100] },
    ],
    skins: [{ joints: [1], inverseBindMatrices: 4 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 1, type: 'MAT4' },
    ],
    bufferViews: views.map((view) => ({ buffer: 0, ...view })),
    buffers: [{ byteLength: bin.byteLength }],
  };

  return pack(Buffer.from(JSON.stringify(json), 'utf8'), bin);
}

/** The glTF binary container: a 12-byte header, then a JSON chunk and a BIN chunk. */
function pack(json: Buffer, bin: Buffer): Buffer {
  const pad = (buffer: Buffer, filler: number) =>
    Buffer.concat([buffer, Buffer.alloc((4 - (buffer.byteLength % 4)) % 4, filler)]);
  // The spec pads the JSON chunk with spaces and the binary one with zeroes.
  const jsonChunk = pad(json, 0x20);
  const binChunk = pad(bin, 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength, 8);

  const chunk = (payload: Buffer, type: number) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(payload.byteLength, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, payload]);
  };

  return Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]);
}
