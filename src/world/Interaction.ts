/**
 * Choosing what the context action acts on (§3.3).
 *
 * Pure arithmetic over positions, so the rule — inside 1.5 m, inside ±90° of aim, nearest
 * wins — can be exercised without a scene, a camera or an input device. §3.3 is explicit
 * that exactly one target is ever prompted; ambiguity here would show up as a player
 * pressing `E` next to two things and getting the wrong one.
 */

import { INTERACTION } from '../config';
import type {
  ExitGateEntity,
  FlashlightEntity,
  GateEntity,
  MapEntity,
  NoteEntity,
  PowerSwitchEntity,
} from '../map/types';

/** The entity types the context action can act on (§6). */
export type Interactable =
  | FlashlightEntity
  | NoteEntity
  | PowerSwitchEntity
  | GateEntity
  | ExitGateEntity;

const INTERACTABLE_TYPES = new Set(['Flashlight', 'Note', 'PowerSwitch', 'Gate', 'ExitGate']);

export function isInteractable(entity: MapEntity): entity is Interactable {
  return INTERACTABLE_TYPES.has(entity.type);
}

export interface TargetQuery {
  playerX: number;
  playerZ: number;
  /** Unit aim direction on the X/Z plane (§3.1). */
  aimX: number;
  aimZ: number;
}

/**
 * The one thing the context action would act on, or null.
 *
 * Nearest is by distance from the player rather than by angle from the aim axis (§3.3):
 * the cone decides what is eligible, and the player's sense of which thing they are
 * standing next to is a distance sense.
 */
export function findTarget<T extends { wx: number; wz: number }>(
  candidates: readonly T[],
  query: TargetQuery,
): T | null {
  const cosLimit = Math.cos((INTERACTION.aimHalfAngleDegrees * Math.PI) / 180);
  const aimLength = Math.hypot(query.aimX, query.aimZ);

  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const dx = candidate.wx - query.playerX;
    const dz = candidate.wz - query.playerZ;
    const distance = Math.hypot(dx, dz);
    if (distance > INTERACTION.range || distance >= bestDistance) continue;

    // Standing exactly on it has no direction to test, and refusing it would make a target
    // unreachable by walking closer — the one movement the player has.
    if (distance > 1e-4 && aimLength > 1e-6) {
      const cosine = (dx * query.aimX + dz * query.aimZ) / (distance * aimLength);
      // Inclusive of the boundary: §3.3 says *within* ±90°, and at exactly 90° the cosine
      // and the limit are both zero to within a rounding error that would otherwise decide
      // it — a target square beside the player is the commonest case there is.
      if (cosine < cosLimit - 1e-9) continue;
    }

    best = candidate;
    bestDistance = distance;
  }

  return best;
}
