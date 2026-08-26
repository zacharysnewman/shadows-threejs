/**
 * Placeholder bodies for the things the player interacts with (§6).
 *
 * Until the art pass (Phase 11) a `Note` and a `PowerSwitch` are entities with a position
 * and nothing to see. That is fine for every phase before this one, and not fine for this
 * one: §6's objective chain is *finding* things, and a chain the player cannot see is not
 * completable in any sense worth testing.
 *
 * So: one crude shape per type, distinguishable at a glance under a torch beam — the
 * flashlight a small bright cylinder on the ground, a note a pale card on a post, a switch a
 * box on a post that changes colour once it is thrown. They cast and receive like everything
 * else, so they read the same way the map does.
 *
 * **The posts are not decoration.** A card at chest height with nothing under it is a card
 * floating in mid-air, and every note and switch in this game looked like that: §9.2 has the
 * *editor* mount them against a solid neighbour, which is a placement rule and not a thing
 * the renderer can rely on — a map may put one anywhere, and now that a level's interior can
 * be open forest (§2) there is frequently no neighbour to mount against at all. So each one
 * carries its own stand and needs nothing from the map.
 *
 * Presentation only. Nothing here decides anything; `Objectives` owns the state and this
 * reads it back.
 */

import * as THREE from 'three';
import type { Interactable } from './Interaction';
import type { Objectives } from './Objectives';

const COLOURS = {
  /** The stand under a note or a switch — dark, so the thing on top of it is what reads. */
  post: 0x3a3128,
  flashlight: 0xf2e2b0,
  note: 0xd8d2c0,
  switchOff: 0x6a4f3a,
  switchOn: 0x63d18a,
  gate: 0x4a4a52,
  exitLocked: 0x8a3b3b,
  exitOpen: 0x63d18a,
} as const;

interface Prop {
  entity: Interactable;
  object: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  /** Anchor for the interaction prompt, in world space (§3.3). */
  anchorY: number;
}

export class Props {
  readonly root = new THREE.Group();
  private readonly props: Prop[] = [];
  /** Pick-ups already taken; kept so the mesh can be removed and never re-added. */
  private readonly taken = new Set<string>();

  constructor(interactables: readonly Interactable[]) {
    this.root.name = 'Props';
    for (const entity of interactables) {
      const prop = build(entity);
      if (!prop) continue;
      prop.object.position.set(entity.wx, 0, entity.wz);
      this.root.add(prop.object);
      this.props.push(prop);
    }
  }

  get count(): number {
    return this.props.length;
  }

  /** Everything still on the map — a taken pick-up is no longer a target (§6.1). */
  get present(): Interactable[] {
    return this.props.filter((prop) => !this.taken.has(prop.entity.key)).map((p) => p.entity);
  }

  /** Where a prompt should float for this entity (§3.3: "above it"). */
  anchorFor(entity: Interactable): number {
    return this.props.find((prop) => prop.entity === entity)?.anchorY ?? 1;
  }

  /** Take a pick-up off the map. */
  collect(entity: Interactable): void {
    if (this.taken.has(entity.key)) return;
    this.taken.add(entity.key);
    const prop = this.props.find((p) => p.entity === entity);
    prop?.object.removeFromParent();
  }

  /** Re-colour the switches and the exit from the run's state. Per rendered frame. */
  refresh(objectives: Objectives): void {
    for (const prop of this.props) {
      const entity = prop.entity;
      if (entity.type === 'PowerSwitch') {
        const on =
          entity.mode === 'latch'
            ? objectives.isLatched(entity.key)
            : objectives.isGroupPowered(entity.targetId);
        prop.material.color.setHex(on ? COLOURS.switchOn : COLOURS.switchOff);
        prop.material.emissive.setHex(on ? COLOURS.switchOn : 0x000000);
        prop.material.emissiveIntensity = on ? 0.35 : 0;
      } else if (entity.type === 'ExitGate') {
        const unlocked = objectives.exitProgress().unlocked;
        prop.material.color.setHex(unlocked ? COLOURS.exitOpen : COLOURS.exitLocked);
        prop.material.emissive.setHex(unlocked ? COLOURS.exitOpen : COLOURS.exitLocked);
        prop.material.emissiveIntensity = unlocked ? 0.4 : 0.12;
      }
    }
  }

  dispose(): void {
    for (const prop of this.props) {
      prop.object.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
      prop.material.dispose();
    }
    this.props.length = 0;
    this.root.removeFromParent();
  }
}

function build(entity: Interactable): Prop | null {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
  let geometry: THREE.BufferGeometry;
  let y: number;

  switch (entity.type) {
    case 'Flashlight':
      material.color.setHex(COLOURS.flashlight);
      material.emissive.setHex(COLOURS.flashlight);
      // Faintly lit, because a torch lying in the dark is the one thing the player has no
      // torch to find with (§6.1).
      material.emissiveIntensity = 0.5;
      geometry = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10);
      y = 0.25;
      break;

    case 'Note':
      material.color.setHex(COLOURS.note);
      material.emissive.setHex(COLOURS.note);
      material.emissiveIntensity = 0.12;
      geometry = new THREE.BoxGeometry(0.45, 0.5, 0.04);
      y = 0.9;
      break;

    case 'PowerSwitch':
      material.color.setHex(COLOURS.switchOff);
      geometry = new THREE.BoxGeometry(0.5, 0.7, 0.28);
      y = 1.0;
      break;

    case 'ExitGate':
      material.color.setHex(COLOURS.exitLocked);
      material.emissive.setHex(COLOURS.exitLocked);
      material.emissiveIntensity = 0.12;
      geometry = new THREE.BoxGeometry(0.4, 1.6, 0.4);
      y = 0.8;
      break;

    // A `Gate` is a tile, and the tile is the thing that swings (§6.4). Drawing a second
    // body for it would be a prop standing where the gate no longer is.
    case 'Gate':
      return null;

    default:
      return null;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = y;

  const object = new THREE.Group();
  object.name = `Prop:${entity.key}`;
  object.add(mesh);
  if (entity.type === 'Note') object.rotation.y = Math.PI / 8;

  // Anything held at chest height needs something holding it up. The flashlight is a
  // pick-up lying on the floor and the exit's marker already reaches the ground, so those
  // two are the exceptions rather than the rule.
  if (entity.type === 'Note' || entity.type === 'PowerSwitch') {
    const bottom = y - boxHeight(geometry) / 2;
    object.add(post(bottom));
  }

  return { entity, object, material, anchorY: y + 0.5 };
}

/** How tall a box geometry is, so a prop's stand can reach exactly its underside. */
function boxHeight(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  return box ? box.max.y - box.min.y : 0;
}

/** A stand from the floor to `top`, so what sits on it is not floating in the dark. */
function post(top: number): THREE.Mesh {
  const height = Math.max(0.05, top);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, height, 6),
    new THREE.MeshStandardMaterial({ color: COLOURS.post, roughness: 0.9, metalness: 0 }),
  );
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
