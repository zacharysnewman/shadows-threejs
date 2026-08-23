/**
 * Prefab asset loader (§1, §2).
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

export interface Prefab {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Height in metres, used for collider extents and for sitting the mesh on the floor. */
  height: number;
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

  private fromScene(name: string, scene: THREE.Object3D, tileSize: number): Prefab {
    const geometries: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;

    scene.updateMatrixWorld(true);
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      geometries.push(geometry);
      if (!material) {
        material = Array.isArray(node.material) ? node.material[0] ?? null : node.material;
      }
    });

    if (geometries.length === 0 || !material) {
      this.missing.add(name);
      return this.makePlaceholder(name, tileSize);
    }

    const merged =
      geometries.length === 1
        ? (geometries[0] as THREE.BufferGeometry)
        : (BufferGeometryUtils.mergeGeometries(geometries, false) ?? geometries[0]!);
    merged.computeBoundingBox();
    const height = merged.boundingBox ? merged.boundingBox.max.y - merged.boundingBox.min.y : 1;

    return { name, geometry: merged, material, height, placeholder: false };
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

    return { name, geometry, material, height: kind.height, placeholder: true };
  }

  dispose(): void {
    for (const pending of this.cache.values()) {
      void pending.then((prefab) => {
        prefab.geometry.dispose();
        prefab.material.dispose();
      });
    }
    this.cache.clear();
  }
}
