/**
 * Single source of constants, mirroring `docs/GAME_SPEC.md`.
 *
 * The spec is authoritative: every value here cites the section it comes from, and tuning
 * (Phase 11) should be an edit here plus an amendment to the spec, never a literal buried
 * in a system. Nothing in `src/` should hard-code a number that belongs in this file.
 */

/** §7 — simulation runs on a fixed timestep decoupled from rendering. */
export const SIM = {
  /** Fixed simulation rate in Hz. */
  tickRate: 60,
  /** Seconds per simulation tick. */
  get tickSeconds(): number {
    return 1 / SIM.tickRate;
  },
  /**
   * Ceiling on how much real time a single frame may feed the accumulator. Prevents the
   * spiral of death when a tab is backgrounded and returns with a multi-second delta.
   */
  maxFrameSeconds: 0.25,
} as const;

/** §1, §2 — grid-to-world mapping. `tileSize` is per-map; this is the expected default. */
export const GRID = {
  defaultTileSize: 2.0,
} as const;

/** §1, §3.2 — pitched top-down camera rig. */
export const CAMERA = {
  /** Vertical FOV in degrees (§3.2). */
  fov: 50,
  /** Downward pitch in degrees; §1 specifies 70°–75°. */
  pitchDegrees: 72,
  /** Distance from the player along the pitch vector, in metres (§3.2). */
  distance: 14,
  /** Critically damped follow time constant, in seconds (§3.2). */
  smoothingTime: 0.15,
  near: 0.1,
  far: 200,
} as const;

/** §7 — shadow budget. Shadows are a mechanic, so these are design constraints. */
export const RENDER = {
  /** Shadow map resolution for the flashlight (§7). */
  flashlightShadowMapSize: 2048,
  /** Shadow map resolution for environmental lights (§7). */
  environmentShadowMapSize: 1024,
  /** At most this many environmental lights cast shadows at once (§7). */
  maxShadowCastingEnvironmentLights: 2,
  /** Clamp for `devicePixelRatio`; mobile is a 30 fps floor (§7). */
  maxPixelRatio: 2,
} as const;

/** §2 — map pipeline limits. Guardrails for the loader/validator, not gameplay values. */
export const MAP_LIMITS = {
  /** Reject absurd dimensions early with a clear message rather than allocating them. */
  maxWidth: 512,
  maxHeight: 512,
  /** §2 — layer roles by index. */
  floorLayerIndex: 0,
  obstacleLayerIndex: 1,
} as const;

/**
 * §2 — defaults applied when an authored entity omits an optional property. Editors
 * export sparse `properties` objects, so the loader fills the gaps rather than rejecting
 * the map.
 */
export const ENTITY_DEFAULTS = {
  /** `PlayerSpawn.rotation`, degrees. */
  playerSpawnRotation: 0,
  /**
   * `PowerSwitch.mode`. `toggle` is the reversible mode; defaulting to `latch` would
   * silently make an unannotated switch irreversible objective progress (§6).
   */
  switchMode: 'toggle',
  /** `EnvironmentLight.radius`, metres — the default ground pool from §4.2. */
  environmentLightRadius: 6,
  /** `EnvironmentLight.intensity` — full brightness unless the map overrides it (§4.2). */
  environmentLightIntensity: 1,
  /** `EnvironmentLight` mount height, metres (§4.2). */
  environmentLightHeight: 4,
  /** `Gate.locked` / `ExitGate.locked`. */
  gateLocked: true,
  /** `ExitGate.requiredSwitches` (§6). */
  exitRequiredSwitches: 3,
} as const;
