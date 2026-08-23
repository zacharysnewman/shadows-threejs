/**
 * The shared illumination query (§4.1).
 *
 * One service answers *is this entity lit, and by how much*, and **both AIs consume it**.
 * A spider deciding it was lit on different terms than the Shadow Monster would be a bug
 * nobody could see, only feel — so the cone test, the lamp test and the occlusion raycast
 * live here once, and Phases 7 and 8 ask rather than implement.
 *
 * Two costs, deliberately separated:
 *
 * - **Geometry** — range, cone angle, lamp radius — is re-tested on every query. It is a
 *   handful of arithmetic and it has to be current, because losing the light must be
 *   instant (§4.1): a monster that stayed frozen for an extra tenth of a second after the
 *   beam left it would be holdable with a beam that is no longer on it.
 * - **Occlusion** — the segment test against obstacles — is throttled to §4.1's interval
 *   and staggered across subjects, so the cost spreads instead of landing on one tick. The
 *   asymmetry that falls out is the right way round: walking out of the cone unlights an
 *   entity immediately, walking behind a wall takes up to one interval.
 */

import { FLASHLIGHT, ILLUMINATION } from '../config';
import type { ColliderIndex } from '../player/collision';
import type { BoxCollider } from '../map/types';
import { segmentBlocked } from '../nav/raycast';
import type { EnvironmentLights } from './EnvironmentLights';
import type { Flashlight } from './Flashlight';

export type LightSource = 'flashlight' | 'environment';

export interface LitSample {
  /** §4.1 — geometric: inside a light's reach, with a clear line to it. */
  lit: boolean;
  /** 0–1 strength of the strongest source at this point. Never decides `lit`. */
  amount: number;
  /** Which source is responsible, or `null` when nothing is. */
  source: LightSource | null;
  /** Seconds since this subject's line of sight was last confirmed (§4.1). */
  confirmedAgo: number;
}

const UNLIT: LitSample = { lit: false, amount: 0, source: null, confirmedAgo: 0 };

/**
 * Strength of a cone at a point, 0–1, ignoring occlusion and whether the light is on.
 * Zero outside the cone or beyond the range, so the same call answers both "is it inside"
 * and "how strongly" (§4.1).
 */
export function coneStrength(
  originX: number,
  originZ: number,
  aimX: number,
  aimZ: number,
  halfAngleRadians: number,
  range: number,
  targetX: number,
  targetZ: number,
): number {
  const dx = targetX - originX;
  const dz = targetZ - originZ;
  const distance = Math.hypot(dx, dz);
  if (distance > range) return 0;
  if (distance < 1e-6) return 1;

  const aimLength = Math.hypot(aimX, aimZ);
  if (aimLength < 1e-6) return 0;

  // cos of the angle between the beam axis and the direction to the target.
  const cosine = (dx * aimX + dz * aimZ) / (distance * aimLength);
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine)));
  if (angle > halfAngleRadians) return 0;

  // Falls off towards the rim and with distance. Neither decides `lit`; both are what the
  // reported amount is made of.
  const edge = 1 - (angle / halfAngleRadians) ** 2;
  const reach = 1 - distance / range;
  return Math.max(0, edge * reach);
}

/** Strength of a lamp's ground pool at a point, 0–1 (§4.2). */
export function poolStrength(
  lampX: number,
  lampZ: number,
  radius: number,
  intensity: number,
  targetX: number,
  targetZ: number,
): number {
  const distance = Math.hypot(targetX - lampX, targetZ - lampZ);
  if (distance > radius) return 0;
  return Math.max(0, intensity * (1 - distance / radius));
}

interface SubjectState {
  /**
   * Last confirmed occlusion result per source. `undefined` means there is no valid cache —
   * the subject has just entered this light's reach — and forces a confirmation now rather
   * than at the next interval, because §5.1 stuns "the instant the beam hits".
   */
  flashlightClear: boolean | undefined;
  environmentClear: Map<number, boolean>;
  sinceConfirm: number;
  /** Staggered so subjects do not all raycast on the same tick. */
  phase: number;
}

export class IlluminationService {
  private readonly subjects = new Map<string, SubjectState>();
  private readonly scratch: BoxCollider[] = [];
  private nextPhase = 0;
  private raycastsThisSecond = 0;
  private raycastsLastSecond = 0;
  private secondTimer = 0;

  constructor(
    private readonly flashlight: Flashlight,
    private readonly environment: EnvironmentLights,
    private readonly colliders: ColliderIndex,
  ) {}

  /** Confirmations per second across all subjects — the §4.1 budget, measured. */
  get raycastsPerSecond(): number {
    return this.raycastsLastSecond;
  }

  get subjectCount(): number {
    return this.subjects.size;
  }

  /** Advances the throttle. On the simulation clock, like every other timer (§7). */
  tick(dt: number): void {
    for (const state of this.subjects.values()) state.sinceConfirm += dt;

    this.secondTimer += dt;
    if (this.secondTimer >= 1) {
      this.secondTimer -= 1;
      this.raycastsLastSecond = this.raycastsThisSecond;
      this.raycastsThisSecond = 0;
    }
  }

  /** Drop a subject's cached state — an enemy that died, or a run being torn down. */
  forget(key: string): void {
    this.subjects.delete(key);
  }

  reset(): void {
    this.subjects.clear();
  }

  /**
   * Is the entity at this point lit, and by how much (§4.1)? Safe to call every tick: the
   * geometry is recomputed and only the occlusion test is throttled.
   */
  sample(key: string, x: number, z: number): LitSample {
    const state = this.subjectFor(key);
    const interval = 1 / ILLUMINATION.raycastHz;
    const due = state.sinceConfirm >= interval;

    let best: LitSample = { ...UNLIT };

    // --- Flashlight ---------------------------------------------------------
    const beam = this.flashlight.battery.intensityFraction;
    if (beam > 0) {
      const light = this.flashlight.light;
      const origin = light.position;
      const target = this.flashlight.target.position;
      const strength = coneStrength(
        origin.x,
        origin.z,
        target.x - origin.x,
        target.z - origin.z,
        light.angle,
        FLASHLIGHT.range,
        x,
        z,
      );

      if (strength > 0) {
        // Entering the cone confirms immediately; staying in it re-confirms on the
        // interval. Only the *repeat* is throttled (§4.1, §5.1).
        if (due || state.flashlightClear === undefined) {
          state.flashlightClear = !segmentBlocked(
            this.colliders,
            origin.x,
            origin.z,
            x,
            z,
            this.scratch,
          );
          this.raycastsThisSecond += 1;
        }
        if (state.flashlightClear) {
          const amount = strength * beam;
          best = {
            lit: true,
            amount,
            source: 'flashlight',
            confirmedAgo: state.sinceConfirm,
          };
        }
      } else {
        // Outside the cone: unlit now, not at the next confirmation. The cache is dropped
        // rather than set false, so re-entering confirms immediately instead of waiting.
        state.flashlightClear = undefined;
      }
    }

    // --- Environmental lights (§4.2) ---------------------------------------
    for (const [index, lamp] of this.environment.lamps.entries()) {
      if (!lamp.light.visible) {
        state.environmentClear.delete(index);
        continue;
      }

      const strength = poolStrength(
        lamp.entity.wx,
        lamp.entity.wz,
        lamp.entity.radius,
        lamp.entity.intensity,
        x,
        z,
      );
      if (strength <= 0) {
        state.environmentClear.delete(index);
        continue;
      }

      let clear = state.environmentClear.get(index);
      if (due || clear === undefined) {
        clear = !segmentBlocked(
          this.colliders,
          lamp.entity.wx,
          lamp.entity.wz,
          x,
          z,
          this.scratch,
        );
        state.environmentClear.set(index, clear);
        this.raycastsThisSecond += 1;
      }
      if (!clear) continue;

      // Lit is lit; the amount is the strongest source, so a player standing in a lamp pool
      // with a beam on them reports whichever is doing more.
      if (!best.lit || strength > best.amount) {
        best = { lit: true, amount: strength, source: 'environment', confirmedAgo: state.sinceConfirm };
      }
    }

    if (due) state.sinceConfirm = 0;
    if (best.amount < ILLUMINATION.amountFloor && !best.lit) return { ...UNLIT };
    return best;
  }

  private subjectFor(key: string): SubjectState {
    let state = this.subjects.get(key);
    if (!state) {
      state = {
        flashlightClear: undefined,
        environmentClear: new Map(),
        // Each subject's first confirmation is due at a different point in the interval, so
        // a map full of enemies spreads its raycasts instead of spiking every tenth of a
        // second. Golden-ratio spacing rather than sequential, so any count spreads evenly.
        sinceConfirm: (1 / ILLUMINATION.raycastHz) * ((this.nextPhase * 0.6180339887) % 1),
        phase: this.nextPhase,
      };
      this.nextPhase += 1;
      this.subjects.set(key, state);
    }
    return state;
  }
}
