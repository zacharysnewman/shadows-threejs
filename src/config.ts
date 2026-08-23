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
  /**
   * Metres of ground the bounds clamp must leave between the player and the edge of the
   * view (§3.2). Where hiding off-map void would cost more than this, the void wins.
   */
  playerMargin: 2.0,
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

/** §3.1 — player capsule and movement. */
export const PLAYER = {
  /** Walk speed in m/s. There is no sprint (§3.1). */
  walkSpeed: 3.0,
  /**
   * Time constant for the acceleration/deceleration smoothing, in seconds (§3.1). Velocity
   * approaches the input's target exponentially rather than snapping.
   */
  accelerationTime: 0.1,
  /** Capsule radius in metres (§3.1); the collision query is this circle on the X/Z plane. */
  radius: 0.4,
  /** Capsule height in metres (§3.1). Visual and, later, the flashlight mount height. */
  height: 1.8,
} as const;

/** §3.4 — the health pool. A buffer against the spider only; the monster ignores it. */
export const HEALTH = {
  /** The pool is a 0.0–1.0 fraction; there is no numeric HUD (§3.4). */
  max: 1.0,
  /** Damage per spider contact — three hits from full kill (§3.4, §5.3). */
  spiderDamage: 0.34,
  /** Seconds after the last damage before regeneration starts; damage resets it (§3.4). */
  regenDelay: 6.0,
  /** Regeneration rate per second once the delay has elapsed (§3.4). */
  regenRate: 0.12,
  /** Below this, the heartbeat quickens (§3.4). Phase 10 renders it; the value lives here. */
  lowThreshold: 0.34,
} as const;

/**
 * Input feel. Unlike everything above, the spec does not fix these — §3.1 requires
 * keyboard, gamepad and touch but not their dead zones — so they are tuning values that
 * belong here rather than literals inside the input layer.
 */
export const INPUT = {
  /** Radial dead zone for both analog sticks, as a fraction of full deflection. */
  stickDeadzone: 0.22,
  /** Aim stick deflection below which the stick is not treated as aiming at all. */
  aimDeadzone: 0.35,
  /** Radius in CSS pixels at which a touch drag counts as full stick deflection. */
  touchStickRadius: 56,
} as const;
