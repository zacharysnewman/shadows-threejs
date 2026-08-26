/**
 * Types for `glb-facts.mjs`, which the tests and the map generator both consume.
 *
 * The generator scripts are plain `.mjs` — they run under bare `node`, with no build step
 * between writing one and running it, which is the point of them. That leaves the tests
 * importing an untyped module, so the shape is declared here rather than by converting the
 * script to TypeScript and giving `npm run map` a compiler to depend on.
 */

export interface GlbFacts {
  /** File size on disk, the one honest fact a binary offers about itself. */
  bytes: number;
  /** Bounding size in metres, `[x, y, z]`, as Three will report it once loaded. */
  size: [number, number, number];
  triangles: number;
  /** Skinned meshes cannot go through `AssetLoader` — they load as characters (§1). */
  skinned: boolean;
  /** Clip names as the exporter wrote them; `clipKey` turns them into the game's. */
  clips: string[];
}

/** The facts, or null when the buffer is not glTF binary. */
export function glbFacts(buffer: Buffer): GlbFacts | null;
