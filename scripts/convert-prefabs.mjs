/**
 * Converts a kit's source models into the `.glb` prefabs the game loads (§1).
 *
 *     node scripts/convert-prefabs.mjs <source-dir> [--dry]
 *
 * The loader takes glTF binary and nothing else, and not every kit ships it — the
 * playground props in `PREFAB_KITS` arrive as FBX. This is that conversion, checked in
 * rather than done once on somebody's machine, because the interesting part is not the
 * command: it is the *mapping*, from a kit's file names to the prefab names the tilesets
 * and the maps refer to. That mapping is the thing which has to survive re-fetching the
 * kit a year from now, and a shell command in a commit message does not survive anything.
 *
 * Two rules the conversion has to hold, both learned the hard way:
 *
 * - **Never `--khr-materials-unlit`.** It is the obvious flag for a flat-shaded low-poly
 *   kit and it is catastrophic here: an unlit material ignores every light in the scene,
 *   and this entire game is what the flashlight does to things (§4). A prop that is
 *   equally bright inside the beam and outside it is a prop that has opted out of the
 *   game. `--pbr-metallic-roughness` gives `MeshStandardMaterial`, which is what
 *   `AssetLoader` expects and what §7's shadow budget is spent on.
 * - **Scale is the kit's business, not ours.** FBX carries a 100× node scale here, and
 *   `AssetLoader.fromScene` bakes `matrixWorld` into the geometry, so the metres that come
 *   out are the metres the author modelled. Nothing is rescaled on the way through: a prop
 *   that is the wrong size is a prop to fix in `PREFAB_FIT`, where the fitting rules
 *   already live and are already tested.
 *
 * The converter is a dev dependency this repository does not otherwise need, so it is not
 * in `package.json`: install it when converting.
 *
 *     npm i --no-save fbx2gltf
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const OUT_DIR = fileURLToPath(new URL('../public/prefabs/', import.meta.url));
const CHARACTER_DIR = fileURLToPath(new URL('../public/characters/', import.meta.url));

/**
 * Source file name → prefab name, per kit.
 *
 * The prefab name is what a tileset entry or a `Landmark` entity says (§2), so it follows
 * the repository's convention — a category prefix and lower snake case — rather than the
 * kit's own capitalisation. Renaming a kit's file is not an option; renaming on the way in
 * is, and this is where that decision is written down.
 */
const KITS = {
  /** Stanisko — Playground Props Collection. See `PREFAB_KITS` for the provenance. */
  playground: {
    'Goal.fbx': 'prop_goal',
    'Hoop.fbx': 'prop_hoop',
    'Net.fbx': 'prop_net',
    'Slide.fbx': 'prop_slide',
    'Swing.fbx': 'prop_swing',
  },
  /** yurikokuun — 3D Low Poly Tree. Ships as a single bare `.fbx`, hence the one entry. */
  tree: {
    'Tree.fbx': 'prop_tree',
  },
};

/**
 * Animated characters, which go somewhere else and are converted the same way.
 *
 * They cannot be prefabs: a prefab is merged into one geometry with its transforms baked
 * in (§1), and doing that to a skinned mesh destroys the skinning. So they live in
 * `public/characters/` and are loaded by their own path, keeping their skeleton and their
 * clips. The conversion is identical — the same flags, for the same reasons.
 */
const CHARACTER_KITS = {
  /** Quaternius — Animated Easy Enemies (CC0). `FBX/Spider.fbx` from the pack. */
  enemies: {
    'Spider.fbx': 'spider',
  },
};

const FLAGS = ['--binary', '--pbr-metallic-roughness'];

async function main() {
  const [sourceDir, ...rest] = process.argv.slice(2);
  const dry = rest.includes('--dry');

  if (!sourceDir) {
    console.error('usage: node scripts/convert-prefabs.mjs <source-dir> [--dry]');
    console.error('       the directory holding a kit\'s unpacked source models');
    process.exitCode = 1;
    return;
  }

  const source = resolve(sourceDir);
  // Which kit this is, decided by what is actually on disk rather than by a flag: a
  // mistyped kit name would otherwise convert nothing and report success.
  const entries = [
    ...Object.entries(KITS).flatMap(([kit, mapping]) =>
      Object.entries(mapping)
        .filter(([file]) => existsSync(join(source, file)))
        .map(([file, prefab]) => ({ kit, file, prefab, dir: OUT_DIR })),
    ),
    ...Object.entries(CHARACTER_KITS).flatMap(([kit, mapping]) =>
      Object.entries(mapping)
        .filter(([file]) => existsSync(join(source, file)))
        .map(([file, prefab]) => ({ kit, file, prefab, dir: CHARACTER_DIR })),
    ),
  ];

  if (entries.length === 0) {
    console.error(`no known kit files in ${source}`);
    const known = [...Object.values(KITS), ...Object.values(CHARACTER_KITS)]
      .flatMap((mapping) => Object.keys(mapping))
      .join(', ');
    console.error(`known files: ${known}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(CHARACTER_DIR, { recursive: true });
  const convert = dry ? null : require('fbx2gltf');

  for (const { kit, file, prefab, dir } of entries) {
    const from = join(source, file);
    const to = join(dir, `${prefab}.glb`);
    if (dry) {
      console.log(`[${kit}] ${basename(from)} → ${prefab}.glb (dry)`);
      continue;
    }
    await convert(from, to, FLAGS);
    console.log(`[${kit}] ${basename(from)} → ${prefab}.glb`);
  }

  console.log(
    `\n${entries.length} prefab(s) written to public/prefabs/.\n` +
      'Every prefab there must be claimed by a kit in `PREFAB_KITS` — tests/prefabs.test.ts ' +
      'fails naming any that is not.',
  );
}

await main();
