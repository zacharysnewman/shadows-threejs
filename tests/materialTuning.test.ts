/**
 * §2's surfaces under §8.3's tuner: the ground, and the kit's own models.
 *
 * Both are values that were consumed once — the ground was rasterised into a texture at
 * load, a model's albedo was written onto a material as it was loaded — so both need a push
 * to reach a running game, and a push is exactly the kind of thing that is silently wrong.
 * The two failures worth pinning are a push that *compounds* (drag a tint and the world
 * goes on darkening after you stop) and a push that fires when nothing moved (a quarter of
 * a second of texture arithmetic every time somebody nudges the player's walk speed).
 *
 * No GPU here: a `DataTexture` is an array and a material is an object, so everything that
 * decides what the ground and the models end up *being* is checkable without one. What is
 * not checkable is how any of it reads, which is a browser's job.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GROUND, MODELS } from '../src/config';
import {
  disposeGroundMaterials,
  groundMaterial,
  rebuildGroundMaterial,
} from '../src/core/GroundTextures';
import { applyModelLook, refreshModelLook } from '../src/core/ModelMaterials';
import { TUNABLES, resetTuning } from '../src/debug/Tuning';

const tunable = (key: string) => {
  const found = TUNABLES.find((entry) => entry.key === key);
  if (!found) throw new Error(`no tunable "${key}"`);
  return found;
};

// Every test in here moves live config, and the ground caches what it was built from.
afterEach(() => {
  resetTuning();
  disposeGroundMaterials();
});

/** The bytes of a texture, copied — the arrays themselves are re-filled in place. */
function bytes(map: THREE.Texture | null): Uint8Array {
  const data = (map?.image as { data?: Uint8Array } | undefined)?.data;
  if (!data) throw new Error('texture has no pixels');
  return data.slice();
}

describe('the ground under the tuner (§2, §8.3)', () => {
  it('re-generates into the material every floor tile is already drawn with', () => {
    // The floor is one instanced mesh and the surround is one plane, both pointing at this
    // (§7). A rebuild that returned a *new* material would leave both drawing the old one,
    // which is the failure this in-place refill exists to avoid.
    const material = groundMaterial();
    const before = bytes(material.map);
    const version = material.map!.version;

    tunable('ground.dirtLight').set(0x00ff00);
    rebuildGroundMaterial();

    expect(groundMaterial()).toBe(material);
    expect(bytes(material.map)).not.toEqual(before);
    // `needsUpdate` is write-only; the version it bumps is what the renderer re-uploads on.
    expect(material.map!.version).toBeGreaterThan(version);
  });

  it('leaves the relief alone when only a colour moved', () => {
    // The normal map is built from the height field and the height field knows nothing
    // about colour, so a colour change that moved it would mean the two had got tangled.
    const material = groundMaterial();
    const normals = bytes(material.normalMap);

    tunable('ground.dirtDamp').set(0x101010);
    rebuildGroundMaterial();

    expect(bytes(material.normalMap)).toEqual(normals);
  });

  it('re-cuts the relief when the relief moves', () => {
    const material = groundMaterial();
    const normals = bytes(material.normalMap);

    tunable('ground.normalStrength').set(GROUND.normalStrength * 2);
    rebuildGroundMaterial();

    expect(bytes(material.normalMap)).not.toEqual(normals);
    expect(material.normalScale.x).toBe(GROUND.normalScale);
  });

  it('does nothing at all when no ground value moved', () => {
    // The tuner calls back on *every* change, so this is what stops a nudge to a walk speed
    // costing a full re-rasterisation. Scribbling on the pixels is how a rebuild that did
    // happen is told from one that did not: a real one would wipe the scribble out.
    const material = groundMaterial();
    const data = (material.map?.image as { data: Uint8Array }).data;
    data[0] = data[0] === 0 ? 255 : 0;
    const scribbled = data[0];

    tunable('player.walk').set(5.5);
    rebuildGroundMaterial();

    expect(data[0]).toBe(scribbled);
  });
});

describe("the kit's own models under the tuner (§2, §8.3)", () => {
  const authored = () =>
    new THREE.MeshStandardMaterial({ color: 0x804020, roughness: 0.8, metalness: 0.1 });

  it('draws the kit as it was authored while nothing is tuned', () => {
    // Every default is an identity, so a run nobody has tuned is a run drawing the art.
    const material = authored();
    const before = material.color.clone();
    applyModelLook(material);

    expect(material.color.getHex()).toBe(before.getHex());
    expect(material.emissive.getHex()).toBe(0x000000);
    expect(material.roughness).toBe(0.8);
    expect(material.metalness).toBe(0.1);
  });

  it('derives from the authored colour every time, so a drag cannot compound', () => {
    // The failure this prevents: each change reading the *last* result and multiplying it
    // again, so the world keeps darkening after the slider has stopped and only a reload
    // puts it back.
    const material = authored();
    applyModelLook(material);

    tunable('models.tint').set(0x808080);
    applyModelLook(material);
    const once = material.color.clone();
    applyModelLook(material);
    applyModelLook(material);

    expect(material.color.getHex()).toBe(once.getHex());
    expect(once.r).toBeLessThan(new THREE.Color(0x804020).r);
  });

  it('lifts each surface by a fraction of its own colour, never a flat grey', () => {
    // §3.1's rule, applied to the kit: a flat emissive is the same shade wherever it lands,
    // and at §4's ambient that is most of what an unlit surface is.
    const warm = authored();
    const cold = new THREE.MeshStandardMaterial({ color: 0x204080 });
    applyModelLook(warm);
    applyModelLook(cold);

    tunable('models.lift').set(0.2);
    applyModelLook(warm);
    applyModelLook(cold);

    expect(warm.emissive.r).toBeGreaterThan(warm.emissive.b);
    expect(cold.emissive.b).toBeGreaterThan(cold.emissive.r);
    expect(warm.emissive.r).toBeCloseTo(warm.color.r * MODELS.readabilityLift, 6);
  });

  it('keeps whatever the art already glowed with', () => {
    // Some kit modules are lit in their own right. A lift is added to that, not written
    // over it, so a lift of zero leaves a glowing model glowing.
    const lamp = new THREE.MeshStandardMaterial({ color: 0x404040, emissive: 0x332200 });
    applyModelLook(lamp);
    expect(lamp.emissive.getHex()).toBe(0x332200);

    tunable('models.lift').set(0.1);
    applyModelLook(lamp);
    expect(lamp.emissive.r).toBeGreaterThan(new THREE.Color(0x332200).r);
  });

  it('reaches a material that was cloned to be one instance’s own', () => {
    // `Enemy.attachCharacter` clones a shared material so the Shadow Monster can hide its
    // body without hiding every spider's (the trap `CharacterLoader` documents). A push
    // that only knew about the materials the loader built would miss the clone — which is
    // why the authored record rides on the material and the push walks the scene.
    const shared = authored();
    applyModelLook(shared);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), shared.clone());
    const scene = new THREE.Scene().add(mesh);

    tunable('models.tint').set(0x000000);
    refreshModelLook(scene);

    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x000000);
    // And the one it was cloned from is untouched by a walk that never reached it.
    expect(shared.color.getHex()).not.toBe(0x000000);
  });

  it('leaves materials nothing surfaced alone', () => {
    // The generated ground and the props §6 colours from run state are in the same scene
    // and are owned elsewhere; a push that took every material it found would fight them.
    const prop = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const scene = new THREE.Scene().add(new THREE.Mesh(new THREE.BoxGeometry(), prop));

    tunable('models.tint').set(0xff0000);
    refreshModelLook(scene);

    expect(prop.color.getHex()).toBe(0x00ff00);
  });
});
