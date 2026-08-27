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

import { AMBIENT, ENEMY, FLASHLIGHT, GROUND, LIGHT_SHAFT, MODELS, MOON, PLAYER, TREES } from '../config';
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
  /**
   * What the value *is*, which is the only thing the panel needs to know to draw it: a
   * number gets a slider, a colour gets a swatch.
   *
   * A colour is still a number — `0xrrggbb`, exactly as `config.ts` writes it — so
   * everything that stores, restores, compares and copies a tunable is unchanged by this.
   * A hex on a slider is the alternative and it is unusable: the three channels are
   * interleaved into one axis, so the value either side of a green is a red.
   */
  kind?: 'number' | 'colour';
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

/**
 * A colour on one config object. Sliders bracket a number; a colour's range is the whole of
 * `0x000000`–`0xffffff` and the panel gives it a swatch instead.
 */
function colour(
  spec: Omit<Tunable, 'get' | 'set' | 'min' | 'max' | 'step' | 'kind'>,
  target: object,
  name: string,
): Tunable {
  return field({ ...spec, min: 0, max: 0xffffff, step: 1, kind: 'colour' }, target, name);
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
    {
      key: 'player.readable',
      group: 'Player',
      label: 'unlit readability',
      min: 0,
      max: 0.5,
      step: 0.005,
      needsPush: true,
    },
    PLAYER,
    'readabilityLift',
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
      key: 'torch.haze',
      group: 'Flashlight',
      label: 'beam haze',
      min: 0,
      max: 0.25,
      step: 0.002,
      unit: '/m',
      needsPush: true,
    },
    LIGHT_SHAFT,
    'flashlightDensity',
  ),

  field(
    {
      key: 'night.lampHaze',
      group: 'Night',
      label: 'lamp haze',
      min: 0,
      max: 0.12,
      step: 0.001,
      unit: '/m',
      needsPush: true,
    },
    LIGHT_SHAFT,
    'environmentDensity',
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

  // §2's ground is rasterised from these at load, so every one of them is a texture that
  // has to be built again — which is what `needsPush` means here and why the rebuild waits
  // for the slider to settle (`requestGroundRebuild`).
  colour({ key: 'ground.dirtDark', group: 'Ground', label: 'earth · damp', needsPush: true }, GROUND, 'dirtDark'),
  colour({ key: 'ground.dirtLight', group: 'Ground', label: 'earth · dry', needsPush: true }, GROUND, 'dirtLight'),
  colour({ key: 'ground.dirtDamp', group: 'Ground', label: 'earth · hollows', needsPush: true }, GROUND, 'dirtDamp'),
  field(
    { key: 'ground.dirtRoughness', group: 'Ground', label: 'earth roughness', min: 0, max: 1, step: 0.01, needsPush: true },
    GROUND,
    'dirtRoughness',
  ),
  colour({ key: 'ground.pebbleDark', group: 'Ground', label: 'stone · dark', needsPush: true }, GROUND, 'pebbleDark'),
  colour({ key: 'ground.pebblePale', group: 'Ground', label: 'stone · pale', needsPush: true }, GROUND, 'pebblePale'),
  field(
    { key: 'ground.pebbleRoughness', group: 'Ground', label: 'stone roughness', min: 0, max: 1, step: 0.01, needsPush: true },
    GROUND,
    'pebbleRoughness',
  ),
  field(
    { key: 'ground.pebbleOpacity', group: 'Ground', label: 'stone colour depth', min: 0, max: 1, step: 0.01, needsPush: true },
    GROUND,
    'pebbleOpacity',
  ),
  field(
    { key: 'ground.pebbleCoverage', group: 'Ground', label: 'stone coverage', min: 0, max: 1, step: 0.01, needsPush: true },
    GROUND,
    'pebbleCoverage',
  ),
  // The relief values, which are the ones §2 says decide whether a beam raking the floor
  // reads as light falling on ground at all.
  field(
    { key: 'ground.dirtRelief', group: 'Ground', label: 'relief depth', min: 0, max: 0.08, step: 0.002, unit: 'm', needsPush: true },
    GROUND,
    'dirtRelief',
  ),
  field(
    { key: 'ground.grainRelief', group: 'Ground', label: 'grain share', min: 0, max: 1, step: 0.01, needsPush: true },
    GROUND,
    'grainRelief',
  ),
  field(
    { key: 'ground.normalStrength', group: 'Ground', label: 'normal strength', min: 0, max: 8, step: 0.1, needsPush: true },
    GROUND,
    'normalStrength',
  ),
  field(
    { key: 'ground.normalScale', group: 'Ground', label: 'normal scale', min: 0, max: 3, step: 0.05, needsPush: true },
    GROUND,
    'normalScale',
  ),

  // §2's generated tree: the surround's thousands and any map that places `tree_small`.
  colour({ key: 'trees.trunk', group: 'Trees', label: 'trunk', needsPush: true }, TREES, 'trunkColour'),
  colour({ key: 'trees.canopy', group: 'Trees', label: 'canopy', needsPush: true }, TREES, 'canopyColour'),
  field(
    { key: 'trees.roughness', group: 'Trees', label: 'roughness', min: 0, max: 1, step: 0.01, needsPush: true },
    TREES,
    'roughness',
  ),

  // §2's kit art, over the top of what it was authored with. Every default is an identity,
  // so a session that does not touch these is a session drawing the kit as it came.
  colour({ key: 'models.tint', group: 'Models', label: 'albedo tint', needsPush: true }, MODELS, 'albedoTint'),
  field(
    { key: 'models.lift', group: 'Models', label: 'readability lift', min: 0, max: 0.5, step: 0.005, needsPush: true },
    MODELS,
    'readabilityLift',
  ),
  field(
    { key: 'models.roughness', group: 'Models', label: 'roughness ×', min: 0, max: 2, step: 0.05, needsPush: true },
    MODELS,
    'roughnessScale',
  ),
  field(
    { key: 'models.metalness', group: 'Models', label: 'metalness ×', min: 0, max: 2, step: 0.05, needsPush: true },
    MODELS,
    'metalnessScale',
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
  const clamped = Math.min(tunable.max, Math.max(tunable.min, value));
  // A colour is a packed `0xrrggbb` and a fractional one is not a colour: a stored 0.5
  // would be read back as a hex the swatch cannot show and the game would run on a value
  // nothing displays.
  return tunable.kind === 'colour' ? Math.round(clamped) : clamped;
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
