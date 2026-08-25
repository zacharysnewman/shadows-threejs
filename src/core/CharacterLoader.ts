/**
 * Animated characters (§1, §5.1) — the loading path a skinned mesh needs.
 *
 * **A character cannot be a prefab.** `AssetLoader` merges a model into one geometry with
 * every node transform baked in, which is exactly right for a wall and fatal for a skinned
 * one: the skeleton is the node hierarchy, and flattening it is deleting the thing the
 * animation drives. So characters load through here instead, keep their nodes, and keep
 * their clips.
 *
 * **Every instance needs its own skeleton.** Two spiders sharing one `SkinnedMesh` would
 * share one pose, so each is a `SkeletonUtils.clone` of the loaded scene — a separate node
 * tree and a separate skeleton, sharing the geometry and the materials underneath, which is
 * where the memory actually is. Loading is cached per name, so ten spiders is one fetch.
 *
 * The clips are handed over as they were authored and are *not* retimed here. §5.3 is
 * explicit that the strike time belongs to the simulation rather than to the animation, so
 * whoever plays the attack scales it to the strike; a loader that pre-baked that decision
 * would put a gameplay constant in an asset pipeline, which is the thing §5.3 says not to
 * do.
 */

import * as THREE from 'three';
import { CHARACTER_FIT } from '../config';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface Character {
  name: string;
  /** A fresh node tree with its own skeleton; geometry and materials are shared. */
  scene: THREE.Object3D;
  /** Clips as authored, keyed by the part of the name after the last `|`. */
  clips: Map<string, THREE.AnimationClip>;
  /**
   * Height in metres as the kit authored it, upright, measured rather than typed out.
   * Callers scale by `whatTheGameThinksItIs / authoredHeight` — a hand-copied number is
   * right until the art is swapped and then silently wrong (§1).
   */
  authoredHeight: number;
  /** True when nothing loaded and the caller should fall back to a placeholder body. */
  missing: boolean;
}

/**
 * Where to move a model so it stands on its own origin: grounded on `y = 0` and centred
 * horizontally on the point it occupies (§1).
 *
 * A kit's origin is wherever the artist left it, and the player's came out of a bundle whose
 * characters are laid out in a row — its model sits 1.5 m along x from the origin the game
 * places it at. Unmoved, the body stands a metre and a half from the player it represents:
 * the flashlight comes out of empty air, and the art walks through walls the collider
 * stopped at. Grounding without centring fixes the half of that anybody thinks to check.
 */
export function standOn(box: THREE.Box3): THREE.Vector3 {
  return new THREE.Vector3(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
}

/**
 * Clip names arrive as `HumanArmature|Spider_Walk` — the exporter's rig name, a pipe, and
 * the clip. Neither half is worth carrying into gameplay code, and the rig name in
 * particular is a detail of whoever authored the kit.
 */
export function clipKey(name: string): string {
  const afterRig = name.slice(name.lastIndexOf('|') + 1);
  const afterKind = afterRig.slice(afterRig.indexOf('_') + 1);
  return afterKind.toLowerCase();
}

export class CharacterLoader {
  private readonly cache = new Map<string, Promise<LoadedCharacter | null>>();
  private readonly gltf = new GLTFLoader();
  private readonly missing = new Set<string>();

  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}characters/`) {}

  /** Character names that failed to load, for the debug overlay. */
  get missingCharacters(): readonly string[] {
    return [...this.missing];
  }

  /**
   * One instance, ready to add to a scene.
   *
   * Returns a `missing` character rather than throwing: an enemy with no art is still an
   * enemy that has to path, be lit and be collided with, and a run that fails to start
   * because a `.glb` moved is worse than one with a box in it (§1).
   */
  async load(name: string): Promise<Character> {
    const loaded = await this.loadSource(name);
    if (!loaded) {
      return {
        name,
        scene: new THREE.Group(),
        clips: new Map(),
        authoredHeight: 1,
        missing: true,
      };
    }

    return {
      name,
      scene: cloneSkinned(loaded.scene),
      authoredHeight: loaded.authoredHeight,
      // The `Map` is rebuilt per instance so a caller cannot mutate the cached one, but the
      // clips inside are shared: an `AnimationClip` is read-only data, and the per-instance
      // state lives in the mixer.
      clips: new Map(loaded.clips),
      missing: false,
    };
  }

  private loadSource(name: string): Promise<LoadedCharacter | null> {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const pending = this.fetch(name).catch((error: unknown) => {
      console.warn(`[characters] "${name}" failed to load; using a placeholder body`, error);
      this.missing.add(name);
      return null;
    });
    this.cache.set(name, pending);
    return pending;
  }

  private async fetch(name: string): Promise<LoadedCharacter | null> {
    const url = `${this.baseUrl}${name}.glb`;

    // The same HEAD probe the prefab loader uses, for the same reason: a dev server answers
    // an unknown path with `index.html` and a 200, so the content type is the real test.
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    const contentType = head?.headers.get('content-type') ?? '';
    if (!head || !head.ok || contentType.includes('text/html')) {
      this.missing.add(name);
      return null;
    }

    const gltf = await this.gltf.loadAsync(url);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of gltf.animations) clips.set(clipKey(clip.name), clip);

    // §1 — stand the model up if the kit authored it in another convention, and stand it
    // *on the ground* whatever its origin was.
    //
    // Three nested groups, because the two corrections do not commute and each has to be
    // scalable by whoever uses it:
    //
    //   root   — what the caller scales, and what `Character.scene` is
    //     stand — moves the model onto its own origin (`standOn`)
    //       orient — the kit's convention turned into this one
    //         gltf.scene
    //
    // The stand has to be the *parent* of the orient, or the rotation would turn the
    // translation with it. Both are in authored units, so scaling `root` scales them
    // together and the model still stands on the floor at any size.
    //
    // The rotation goes on a wrapper rather than on `gltf.scene` so the clips, which drive
    // the nodes underneath, are untouched: rotating an animated root is safe, rotating the
    // nodes an animation writes to is not.
    const fit = CHARACTER_FIT[name];
    const rotation = new THREE.Euler(
      THREE.MathUtils.degToRad(fit?.rotateX ?? 0),
      THREE.MathUtils.degToRad(fit?.rotateY ?? 0),
      0,
    );

    // Measured *before* the model is attached to anything, then transformed by the same
    // rotation the wrapper will apply.
    //
    // Order is the whole difficulty here. `setFromObject` reports world space, so measuring
    // after attaching either includes the rotation or does not depending on what the
    // matrices happen to hold — and both mistakes are silent. Measuring a parentless
    // `gltf.scene` is unambiguous: it is the model's own bounds, and one matrix takes it to
    // where the wrapper will put it.
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3()
      .setFromObject(gltf.scene)
      .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));

    const orient = new THREE.Group();
    orient.name = `${name}:orient`;
    orient.rotation.copy(rotation);
    orient.add(gltf.scene);

    const stand = new THREE.Group();
    stand.name = `${name}:stand`;
    stand.position.copy(standOn(box));
    stand.add(orient);

    const root = new THREE.Group();
    root.name = name;
    root.add(stand);

    const authoredHeight = Math.max(1e-6, box.max.y - box.min.y);

    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      // §5.1 — a spider is seen by sight *and* throws a shadow; §7 budgets for both.
      node.castShadow = true;
      node.receiveShadow = true;
      // Skinned meshes are culled against their bind-pose bounds, which an animation can
      // leave: a spider mid-lunge disappears at the edge of the frustum otherwise.
      node.frustumCulled = false;
    });

    return { scene: root, clips, authoredHeight };
  }

  dispose(): void {
    for (const pending of this.cache.values()) {
      void pending.then((loaded) => {
        loaded?.scene.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.geometry.dispose();
          for (const material of [node.material].flat()) material.dispose();
        });
      });
    }
    this.cache.clear();
  }
}

interface LoadedCharacter {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  authoredHeight: number;
}
