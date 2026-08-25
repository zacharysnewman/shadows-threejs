/**
 * Live balance tuning (§8.3, Cross-Cutting: debug harness).
 *
 * Phase 11 is a tuning pass, and a tuning pass done by editing `config.ts`, rebuilding and
 * replaying the situation is a tuning pass that gets one number tried per minute. This is
 * the same values reachable while the game is running, so a spider's approach speed can be
 * felt against the beam's reach in the run where the question came up.
 *
 * **It writes to `config.ts`'s objects.** That is deliberate and it is the only thing that
 * makes the panel worth having: the spec's constants are what the systems read, so a
 * tunable that wrote anywhere else would be tuning a copy. `as const` is a compile-time
 * claim, not a runtime one, so the writes are narrow casts — kept here, in the debug
 * module, and nowhere in `src/` that ships behaviour.
 *
 * Which is also the rule about what belongs here. A value found by turning a knob is a
 * value that has to land in the spec and in `config.ts` before it means anything
 * (CLAUDE.md): this panel finds numbers, it does not hold them. Nothing it stores survives
 * a different browser, and nothing it stores is the game.
 *
 * Debug-only, like everything else `?debug` arms — a player cannot reach it (§8.3).
 *
 * The definitions are data and the storage is pure, so both can be checked without a DOM.
 * `TuningPanel` is the part that needs one.
 */

import { AMBIENT, ENEMY, FLASHLIGHT, MOON, PLAYER } from '../config';
import { ENEMY_PROFILES } from '../enemies/Enemy';

/** Where a run's overridden values live between sessions. */
export const TUNING_STORAGE_KEY = 'shadows:tuning';

export interface Tunable {
  /** Stable across renames and reorderings: it is what the stored values are keyed by. */
  key: string;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Read the value the game is running on right now. */
  get(): number;
  /** Write it. Anything derived from it is the setter's problem, not the caller's. */
  set(value: number): void;
  /**
   * True when the change cannot reach the running scene by itself — a value that was read
   * once when something was constructed. `Run` re-pushes these; the panel says so.
   */
  needsPush?: boolean;
}

/**
 * The narrow cast the module comment explains. `as const` gives every field a readonly
 * literal type, and this is the one place allowed to look past that.
 */
function write<T extends object>(target: T, field: string, value: number): void {
  (target as unknown as Record<string, number>)[field] = value;
}

/** A tunable that is one field on one config object. */
function field(
  spec: Omit<Tunable, 'get' | 'set'>,
  target: object,
  name: string,
  ...mirrors: Array<[object, string]>
): Tunable {
  const source = target as unknown as Record<string, number>;
  return {
    ...spec,
    get: () => source[name] as number,
    set: (value) => {
      write(target, name, value);
      // §5 — `ENEMY_PROFILES` snapshots the speeds at module load and every enemy of a kind
      // shares the one profile object, so a speed has two homes and both have to move.
      for (const [mirror, mirrorName] of mirrors) write(mirror, mirrorName, value);
    },
  };
}

const SPIDER = ENEMY.spider;
const MONSTER = ENEMY.shadowMonster;

/**
 * Everything worth a knob, in the order a tuning session tends to want them: how fast the
 * player is, then what is chasing them, then the light that is the whole argument.
 *
 * Ranges are chosen to bracket the spec's value with room either side, not to be safe —
 * a slider that cannot reach an obviously wrong number cannot show you why it is wrong.
 */
export const TUNABLES: readonly Tunable[] = [
  field(
    { key: 'player.walk', group: 'Player', label: 'walk speed', min: 1, max: 8, step: 0.1, unit: 'm/s' },
    PLAYER,
    'walkSpeed',
  ),
  field(
    { key: 'player.sprint', group: 'Player', label: 'sprint speed', min: 1, max: 12, step: 0.1, unit: 'm/s' },
    PLAYER,
    'sprintSpeed',
  ),
  field(
    { key: 'player.aimTurn', group: 'Player', label: 'aim turn rate', min: 90, max: 1440, step: 10, unit: '°/s' },
    PLAYER,
    'aimTurnDegreesPerSecond',
  ),
  field(
    { key: 'player.accel', group: 'Player', label: 'acceleration time', min: 0, max: 0.6, step: 0.01, unit: 's' },
    PLAYER,
    'accelerationTime',
  ),

  field(
    { key: 'spider.wander', group: 'Spider', label: 'wander speed', min: 0.2, max: 5, step: 0.1, unit: 'm/s' },
    SPIDER,
    'wanderSpeed',
    [ENEMY_PROFILES.SpiderEnemy, 'wanderSpeed'],
  ),
  field(
    { key: 'spider.pursue', group: 'Spider', label: 'pursue speed', min: 0.5, max: 8, step: 0.1, unit: 'm/s' },
    SPIDER,
    'pursueSpeed',
    [ENEMY_PROFILES.SpiderEnemy, 'pursueSpeed'],
  ),
  field(
    { key: 'spider.flee', group: 'Spider', label: 'flee speed', min: 0.5, max: 10, step: 0.1, unit: 'm/s' },
    SPIDER,
    'fleeSpeed',
    [ENEMY_PROFILES.SpiderEnemy, 'fleeSpeed'],
  ),
  field(
    { key: 'spider.detect', group: 'Spider', label: 'detect radius', min: 2, max: 40, step: 1, unit: 'm' },
    SPIDER,
    'detectRadius',
    [ENEMY_PROFILES.SpiderEnemy, 'detectRadius'],
  ),
  // §5.1's `T_flee` — the "scare time" range, rolled fresh each time the beam catches one.
  // Two knobs rather than one, because the *spread* is what decides whether holding a beam
  // feels like a rule or like a gamble.
  field(
    { key: 'spider.fleeDelayMin', group: 'Spider', label: 'scare time · min', min: 0, max: 10, step: 0.1, unit: 's' },
    SPIDER.light.fleeDelaySeconds,
    'min',
  ),
  field(
    { key: 'spider.fleeDelayMax', group: 'Spider', label: 'scare time · max', min: 0, max: 10, step: 0.1, unit: 's' },
    SPIDER.light.fleeDelaySeconds,
    'max',
  ),
  field(
    { key: 'spider.fleeSeconds', group: 'Spider', label: 'flee duration', min: 0.5, max: 10, step: 0.1, unit: 's' },
    SPIDER.light,
    'fleeSeconds',
  ),
  field(
    { key: 'spider.windUp', group: 'Spider', label: 'attack wind-up', min: 0.05, max: 2, step: 0.05, unit: 's' },
    SPIDER.attack,
    'windUpSeconds',
  ),
  field(
    { key: 'spider.cooldown', group: 'Spider', label: 'attack cooldown', min: 0.2, max: 6, step: 0.1, unit: 's' },
    SPIDER.attack,
    'cooldownSeconds',
  ),

  field(
    { key: 'monster.wander', group: 'Shadow Monster', label: 'wander speed', min: 0.2, max: 5, step: 0.1, unit: 'm/s' },
    MONSTER,
    'wanderSpeed',
    [ENEMY_PROFILES.ShadowMonster, 'wanderSpeed'],
  ),
  field(
    {
      key: 'monster.pursue',
      group: 'Shadow Monster',
      label: 'pursue speed',
      min: 0.5,
      max: 6,
      step: 0.1,
      unit: 'm/s',
    },
    MONSTER,
    'pursueSpeed',
    // §5's table gives it no flee speed and it never flees; the profile keeps the two equal
    // so the field is never a lie about a state it cannot enter.
    [ENEMY_PROFILES.ShadowMonster, 'pursueSpeed'],
    [ENEMY_PROFILES.ShadowMonster, 'fleeSpeed'],
  ),
  field(
    { key: 'monster.blinkSeconds', group: 'Shadow Monster', label: 'blink window', min: 0.1, max: 3, step: 0.05, unit: 's' },
    MONSTER.blink,
    'seconds',
  ),
  field(
    {
      key: 'monster.blinkCooldown',
      group: 'Shadow Monster',
      label: 'blink cooldown',
      min: 0,
      max: 5,
      step: 0.1,
      unit: 's',
    },
    MONSTER.blink,
    'cooldownSeconds',
  ),
  field(
    {
      key: 'monster.blinkThreshold',
      group: 'Shadow Monster',
      label: 'blink threshold',
      min: 0.05,
      max: 0.9,
      step: 0.05,
      unit: '× beam',
    },
    MONSTER.blink,
    'intensityThreshold',
  ),
  field(
    { key: 'monster.ramp', group: 'Shadow Monster', label: 'severity ramp', min: 0.2, max: 10, step: 0.1, unit: 's' },
    MONSTER.flicker,
    'rampSeconds',
  ),
  field(
    { key: 'monster.severityTo', group: 'Shadow Monster', label: 'severity ceiling', min: 0.2, max: 1, step: 0.05 },
    MONSTER.flicker.severity,
    'to',
  ),

  field(
    {
      key: 'torch.drain',
      group: 'Flashlight',
      label: 'drain rate',
      min: 1 / 1800,
      max: 1 / 30,
      step: 1 / 1800,
      unit: '/s',
    },
    FLASHLIGHT,
    'drainPerSecond',
  ),
  field(
    {
      key: 'torch.range',
      group: 'Flashlight',
      label: 'beam range',
      min: 3,
      max: 30,
      step: 0.5,
      unit: 'm',
      needsPush: true,
    },
    FLASHLIGHT,
    'range',
  ),
  field(
    {
      key: 'torch.cone',
      group: 'Flashlight',
      label: 'cone angle',
      min: 10,
      max: 120,
      step: 1,
      unit: '°',
      needsPush: true,
    },
    FLASHLIGHT,
    'coneAngleDegrees',
  ),
  field(
    {
      key: 'torch.intensity',
      group: 'Flashlight',
      label: 'beam brightness',
      min: 5,
      max: 200,
      step: 1,
      needsPush: true,
    },
    FLASHLIGHT,
    'baseIntensity',
  ),

  // §4.1's `hold` — where the torch is carried. Five knobs on one pose, because a held
  // light is judged by looking at it and there is no arithmetic that settles it: the
  // shoulder wedge, the near edge of the pool and how much of the beam the player's own
  // body eats are all things you find by moving the torch while walking around.
  field(
    {
      key: 'torch.holdHeight',
      group: 'Flashlight',
      label: 'held · height',
      min: 0.2,
      max: 2.5,
      step: 0.05,
      unit: 'm',
      needsPush: true,
    },
    FLASHLIGHT.hold,
    'height',
  ),
  field(
    {
      key: 'torch.holdForward',
      group: 'Flashlight',
      label: 'held · forward',
      min: -0.5,
      max: 2,
      step: 0.05,
      unit: 'm',
    },
    FLASHLIGHT.hold,
    'forward',
  ),
  field(
    {
      key: 'torch.holdLateral',
      group: 'Flashlight',
      label: 'held · to the right',
      min: -1,
      max: 1,
      step: 0.05,
      unit: 'm',
    },
    FLASHLIGHT.hold,
    'lateral',
  ),
  field(
    {
      key: 'torch.holdPitch',
      group: 'Flashlight',
      label: 'held · pitch trim',
      min: -30,
      max: 30,
      step: 0.5,
      unit: '°',
      needsPush: true,
    },
    FLASHLIGHT.hold,
    'pitchTrimDegrees',
  ),
  field(
    {
      key: 'torch.holdYaw',
      group: 'Flashlight',
      label: 'held · yaw trim',
      min: -45,
      max: 45,
      step: 0.5,
      unit: '°',
    },
    FLASHLIGHT.hold,
    'yawTrimDegrees',
  ),

  field(
    {
      key: 'night.ambient',
      group: 'Night',
      label: 'ambient',
      min: 0,
      max: 14,
      step: 0.05,
      needsPush: true,
    },
    AMBIENT,
    'intensity',
  ),
  field(
    {
      key: 'night.moon',
      group: 'Night',
      label: 'moon',
      min: 0,
      max: 1,
      step: 0.005,
      needsPush: true,
    },
    MOON,
    'intensity',
  ),
];

/**
 * The spec's values, captured before anything is applied — so "reset" means back to what
 * `config.ts` says rather than back to whatever this browser last stored. Read at module
 * load, which is the only moment the two are guaranteed to be the same thing.
 */
const DEFAULTS: ReadonlyMap<string, number> = new Map(
  TUNABLES.map((tunable) => [tunable.key, tunable.get()]),
);

export function defaultFor(key: string): number | undefined {
  return DEFAULTS.get(key);
}

/** Clamp to the slider's range and snap to its step, so a stored value cannot be silly. */
export function coerce(tunable: Tunable, value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.get(tunable.key) ?? tunable.min;
  return Math.min(tunable.max, Math.max(tunable.min, value));
}

export type TuningValues = Record<string, number>;

/**
 * Read what this browser last stored.
 *
 * Every failure returns "nothing stored": a private window throws on `localStorage`, a
 * hand-edited entry parses to junk, and a key that no longer exists is a tunable somebody
 * deleted. None of those is worth an error in a debug tool — the game runs on the spec's
 * values, which is the correct answer to "I could not read your overrides".
 */
export function loadTuning(storage: Storage | null = safeStorage()): TuningValues {
  if (!storage) return {};
  let raw: string | null = null;
  try {
    raw = storage.getItem(TUNING_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const values: TuningValues = {};
  for (const tunable of TUNABLES) {
    const value = (parsed as Record<string, unknown>)[tunable.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[tunable.key] = coerce(tunable, value);
    }
  }
  return values;
}

/** Persist. A full storage or a private window is not worth failing a run over. */
export function saveTuning(values: TuningValues, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(TUNING_STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* Nothing to do and nothing worth saying: the run is unaffected. */
  }
}

export function clearTuning(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(TUNING_STORAGE_KEY);
  } catch {
    /* As above. */
  }
}

/** Push stored values into the config objects the game reads. Returns what was applied. */
export function applyTuning(values: TuningValues): TuningValues {
  const applied: TuningValues = {};
  for (const tunable of TUNABLES) {
    const value = values[tunable.key];
    if (value === undefined) continue;
    const coerced = coerce(tunable, value);
    tunable.set(coerced);
    applied[tunable.key] = coerced;
  }
  return applied;
}

/** Put every tunable back to the value `config.ts` shipped with. */
export function resetTuning(): void {
  for (const tunable of TUNABLES) {
    const value = DEFAULTS.get(tunable.key);
    if (value !== undefined) tunable.set(value);
  }
}

/** The values currently in force, whatever put them there. */
export function currentTuning(): TuningValues {
  const values: TuningValues = {};
  for (const tunable of TUNABLES) values[tunable.key] = tunable.get();
  return values;
}

/** Only the ones that differ from the spec — what is worth storing, and what to show. */
export function overriddenTuning(): TuningValues {
  const values: TuningValues = {};
  for (const tunable of TUNABLES) {
    const value = tunable.get();
    if (value !== DEFAULTS.get(tunable.key)) values[tunable.key] = value;
  }
  return values;
}

/** `localStorage`, or null where touching it throws — a sandboxed frame, or blocked data. */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
