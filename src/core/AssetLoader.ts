/**
 * Prefab asset loader (§1, §2).
 *
 * **Where the art comes from.** The `.glb` files in `public/prefabs/` are KayKit's
 * *Dungeon Remastered 1.0* by Kay Lousberg (https://kaylousberg.com), released **CC0 1.0** —
 * public domain, no attribution required. The credit is here anyway, because six months from
 * now the question "where did these come from and are we allowed to ship them" needs an
 * answer that does not depend on anyone remembering.
 *
 * Pulled from the author's own repository at a pinned commit:
 * `KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0` @ `b0ca9bd9`. The licence text ships
 * beside the files as `public/prefabs/LICENSE-kaykit.txt`, and
 * `public/prefabs/README.md` maps our prefab names onto the kit's filenames.
 *
 * Phase 1 has no art bundle yet, so this is the stub the plan calls for: it *tries* to
 * load `assets/prefabs/<name>.glb` and falls back to a procedural placeholder box whose
 * footprint and height are derived from the prefab's name prefix. Swapping in real assets
 * later is a matter of dropping `.glb` files into place — no caller changes, because
 * everything downstream consumes the same `Prefab` record either way.
 *
 * Prefabs are reduced to a single geometry + material pair because the map builder
 * instances them (§7: a 50×50 map must not be 2,500 draw calls). A `.glb` with multiple
 * meshes is merged into one geometry at load time.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PREFAB_FIT, PREFAB_FOOTING } from '../config';

export interface Prefab {
  name: string;
  geometry: THREE.BufferGeometry;
  /**
   * One material, or one per geometry group where the model is several things at once — a
   * tree's trunk and its leaves. `THREE.Mesh` and `THREE.InstancedMesh` both take either.
   */
  material: THREE.Material | THREE.Material[];
  /** Height in metres, used for collider extents and for sitting the mesh on the floor. */
  height: number;
  /**
   * §2 — the module's ground footprint, in metres, once it is fitted: how much of the
   * tile it actually stands on. `x > z` is a length of something that runs, which is what
   * the map builder turns to follow its neighbours.
   */
  footprint: { x: number; z: number };
  /** True when no `.glb` was found and a placeholder stands in. */
  placeholder: boolean;
}

/**
 * Placeholder dimensions by name prefix. These exist so a map is legible before any art
 * lands; real prefabs override them with their own bounds.
 */
const PLACEHOLDER_KINDS: ReadonlyArray<{
  prefix: string;
  height: number;
  /** Footprint as a fraction of one tile. */
  footprint: number;
  color: number;
  /** Floor-type prefabs sit *below* y = 0 so upright geometry starts at the ground plane. */
  sunken: boolean;
}> = [
  { prefix: 'floor_', height: 0.1, footprint: 1.0, color: 0x3a3f44, sunken: true },
  { prefix: 'wall_', height: 3.0, footprint: 1.0, color: 0x6b6f76, sunken: false },
  { prefix: 'fence_', height: 1.6, footprint: 0.12, color: 0x8a8f96, sunken: false },
  { prefix: 'gate_', height: 1.6, footprint: 0.16, color: 0xb08a4a, sunken: false },
  { prefix: 'prop_', height: 1.0, footprint: 0.6, color: 0x7a6a55, sunken: false },
];

const DEFAULT_KIND = { height: 1.0, footprint: 0.8, color: 0x9b59b6, sunken: false };

function kindFor(name: string) {
  return PLACEHOLDER_KINDS.find((k) => name.startsWith(k.prefix)) ?? DEFAULT_KIND;
}

/** §1 — what `PREFAB_FIT` says about one file, as far as the fit itself is concerned. */
export interface PrefabFit {
  fitHeight?: number;
  /**
   * The height in the file's own units at which the model meets the ground — for a floor,
   * the surface walked on. Given only where the model's own extreme is not it; see
   * `PREFAB_FIT` for the two that need it and why.
   */
  contact?: number;
}

/** §1 — the ground-plane extent of a prefab's footing, in the geometry's own space. */
export interface Footing {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The prefab's footing: the x/z extent of the slab `PREFAB_FOOTING.bandMetres` deep at the
 * height the model meets the ground (§1).
 *
 * Exported because it is the whole of the difference between a tree standing on its tile
 * and a tree standing a tile away from it, and because §2's tile orientation is read off
 * the same numbers — a module longer in x than in z is a length of wall, and knows which
 * way it runs.
 */
export function footingOf(geometry: THREE.BufferGeometry, contactY: number): Footing {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const silhouette: Footing = {
    minX: box?.min.x ?? 0,
    maxX: box?.max.x ?? 0,
    minZ: box?.min.z ?? 0,
    maxZ: box?.max.z ?? 0,
  };

  const position = geometry.getAttribute('position');
  if (!position) return silhouette;

  const footing: Footing = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < position.count; i += 1) {
    if (Math.abs(position.getY(i) - contactY) > PREFAB_FOOTING.bandMetres) continue;
    const x = position.getX(i);
    const z = position.getZ(i);
    if (x < footing.minX) footing.minX = x;
    if (x > footing.maxX) footing.maxX = x;
    if (z < footing.minZ) footing.minZ = z;
    if (z > footing.maxZ) footing.maxZ = z;
  }
  // Nothing within the band would mean a model with no geometry near the ground it stands
  // on, which is not a shape any prefab has; the silhouette is the honest answer rather
  // than an origin picked out of the air.
  return footing.minX > footing.maxX ? silhouette : footing;
}

/**
 * Fit a loaded prefab to this project's conventions (§1), in place. Returns its height.
 *
 * A kit authored by somebody else sits wherever its author left it: this one has walls
 * running from x = 0 rather than centred, and floor slabs whose top surface is 5 cm above
 * the ground plane. Neither is wrong of the kit — both are wrong *here*, where the map
 * builder places one module per tile centre and everything else assumes the floor is y = 0.
 *
 * Normalising on load rather than editing the files keeps the kit swappable: a newer
 * version drops in without redoing the edits, and a different kit needs no edits at all.
 *
 * **The fit is to the ground the model stands on, not to its silhouette.** Both axes of it:
 * it is sat on its contact height and lined up on the footing at that height
 * (`footingCentre`). A bounding box is the wrong thing to fit by whenever the model is
 * wider up top than at the bottom — a tree centred on its box is centred on its canopy,
 * and the trunk ends up on somebody else's tile.
 *
 * `fitHeight` scales **height only**. On a modular grid the footprint is the part that
 * cannot move: a 2 m wall scaled uniformly to three-quarters is a 1.5 m wall, and a run of
 * them has a half-metre gap between every tile. Height is the axis with slack in it, which
 * is why the fit is expressed as one number and why it is opt-in per prefab (§1) rather
 * than something applied by default.
 */
export function normalisePrefab(
  geometry: THREE.BufferGeometry,
  name: string,
  fit: PrefabFit = {},
): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return 1;

  let scale = 1;
  if (fit.fitHeight && fit.fitHeight > 0) {
    const current = box.max.y - box.min.y;
    if (current > 1e-6) {
      scale = fit.fitHeight / current;
      geometry.scale(1, scale, 1);
      geometry.computeBoundingBox();
    }
  }

  const fitted = geometry.boundingBox ?? box;
  const height = fitted.max.y - fitted.min.y;
  // Floors end at the ground plane and everything else starts there, which is the same
  // contract the placeholder boxes are built to (`sunken` above). `contact` overrides the
  // extreme where the extreme is a stray — it is authored in the file's own units, so it
  // scales with the model.
  const sunken = kindFor(name).sunken;
  const contactY =
    fit.contact !== undefined ? fit.contact * scale : sunken ? fitted.max.y : fitted.min.y;
  const footing = footingOf(geometry, contactY);

  geometry.translate(
    -(footing.minX + footing.maxX) / 2,
    -contactY,
    -(footing.minZ + footing.maxZ) / 2,
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return height;
}

export class AssetLoader {
  private readonly cache = new Map<string, Promise<Prefab>>();
  private readonly gltf = new GLTFLoader();
  private readonly missing = new Set<string>();

  /**
   * Prefabs live outside Vite's bundled-asset directory and are addressed from `BASE_URL`,
   * so the site works when served from a subpath (GitHub Pages project sites).
   */
  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}prefabs/`) {}

  /** Prefab names that fell back to a placeholder, for the debug overlay. */
  get missingPrefabs(): readonly string[] {
    return [...this.missing];
  }

  load(name: string, tileSize: number): Promise<Prefab> {
    const key = `${name}@${tileSize}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const pending = this.loadUncached(name, tileSize).catch((error: unknown) => {
      console.warn(`[assets] prefab "${name}" failed to load; using placeholder`, error);
      this.missing.add(name);
      return this.makePlaceholder(name, tileSize);
    });

    this.cache.set(key, pending);
    return pending;
  }

  private async loadUncached(name: string, tileSize: number): Promise<Prefab> {
    const url = `${this.baseUrl}${name}.glb`;

    // A HEAD probe keeps a missing asset out of GLTFLoader's error path, which is noisy
    // and, for an HTML 404 body, throws a parse error rather than a network error. Dev
    // servers answer an unknown path with `index.html` and a 200, so the content type is
    // the real test, not the status.
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    const contentType = head?.headers.get('content-type') ?? '';
    if (!head || !head.ok || contentType.includes('text/html')) {
      this.missing.add(name);
      return this.makePlaceholder(name, tileSize);
    }

    const gltf = await this.gltf.loadAsync(url);
    return this.fromScene(name, gltf.scene, tileSize);
  }

  /**
   * Flatten a loaded scene into one geometry and the material(s) that go with it.
   *
   * **A prefab may have more than one material.** Most of the kit is one — a wall is brick
   * and nothing else — and taking the first one was right until a model arrived that is two
   * things at once: a tree is a brown trunk and green leaves, and keeping only the first
   * rendered the whole tree brown. So the geometries are merged into *groups*, one per
   * distinct material, and the prefab carries the material array those groups index.
   *
   * Single-material prefabs keep the old path exactly — one geometry, no groups, one
   * material — because that is the common case and because §7 counts draw calls: a grouped
   * geometry costs one draw call per group, and a wall has no reason to pay for two.
   */
  private fromScene(name: string, scene: THREE.Object3D, tileSize: number): Prefab {
    const fit = PREFAB_FIT[name] ?? {};
    /** Distinct materials in first-seen order; the index is the group's material index. */
    const materials: THREE.Material[] = [];
    /** Geometries per material index, so the merge can build groups in that order. */
    const byMaterial = new Map<number, THREE.BufferGeometry[]>();

    scene.updateMatrixWorld(true);

    // §1 — a module bundled inside a larger one: take the named node and discard the rest,
    // or the gate's tile gets the wall the gate was modelled inside.
    const root = fit.node ? scene.getObjectByName(fit.node) : scene;
    if (!root) {
      console.warn(`[assets] prefab "${name}": no node "${fit.node}"; using the whole scene`);
    }
    (root ?? scene).traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const nodeMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!nodeMaterial) return;

      let index = materials.indexOf(nodeMaterial);
      if (index === -1) {
        index = materials.length;
        materials.push(nodeMaterial);
      }

      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      const bucket = byMaterial.get(index);
      if (bucket) bucket.push(geometry);
      else byMaterial.set(index, [geometry]);
    });

    if (materials.length === 0) {
      this.missing.add(name);
      return this.makePlaceholder(name, tileSize);
    }

    // In material order, so group `i` indexes `materials[i]`.
    const ordered = materials.map((_, index) => byMaterial.get(index) ?? []);
    const flattened = ordered.flat();
    if (flattened.length === 0) {
      this.missing.add(name);
      return this.makePlaceholder(name, tileSize);
    }

    let merged: THREE.BufferGeometry;
    if (materials.length === 1) {
      merged =
        flattened.length === 1
          ? (flattened[0] as THREE.BufferGeometry)
          : (BufferGeometryUtils.mergeGeometries(flattened, false) ?? flattened[0]!);
    } else {
      // One merged geometry per material first, so the grouped merge produces exactly one
      // group per material rather than one per source mesh.
      const perMaterial = ordered.map(
        (group) =>
          (group.length === 1
            ? group[0]
            : BufferGeometryUtils.mergeGeometries(group, false)) as THREE.BufferGeometry,
      );
      merged = BufferGeometryUtils.mergeGeometries(perMaterial, true) ?? perMaterial[0]!;
    }

    const height = normalisePrefab(merged, name, fit);
    // Fitted, the contact height is y = 0 by construction, so this is the footing measured
    // where the module actually meets its tile (§2).
    const footing = footingOf(merged, 0);
    return {
      name,
      geometry: merged,
      material: materials.length === 1 ? materials[0]! : materials,
      height,
      footprint: { x: footing.maxX - footing.minX, z: footing.maxZ - footing.minZ },
      placeholder: false,
    };
  }

  private makePlaceholder(name: string, tileSize: number): Prefab {
    const kind = kindFor(name);
    const footprint = tileSize * kind.footprint;
    const geometry = new THREE.BoxGeometry(footprint, kind.height, footprint);
    // Translate so the prefab's origin is its floor contact point: everything the map
    // builder places sits on y = 0 without per-prefab offsets.
    geometry.translate(0, kind.sunken ? -kind.height / 2 : kind.height / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: kind.color,
      roughness: 0.9,
      metalness: 0.0,
    });

    return {
      name,
      geometry,
      material,
      height: kind.height,
      // A placeholder is square, so it never reads as a run that wants turning (§2).
      footprint: { x: footprint, z: footprint },
      placeholder: true,
    };
  }

  dispose(): void {
    for (const pending of this.cache.values()) {
      void pending.then((prefab) => {
        prefab.geometry.dispose();
        for (const material of [prefab.material].flat()) material.dispose();
      });
    }
    this.cache.clear();
  }
}
