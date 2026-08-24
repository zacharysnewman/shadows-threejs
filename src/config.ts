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
  /** Exposure under the filmic tone curve — the scene's overall brightness knob. */
  toneMappingExposure: 1.35,
} as const;

/** §2 — map pipeline limits. Guardrails for the loader/validator, not gameplay values. */
export const MAP_LIMITS = {
  /** Reject absurd dimensions early with a clear message rather than allocating them. */
  maxWidth: 512,
  maxHeight: 512,
  /** §2 — layer roles by index. */
  floorLayerIndex: 0,
  obstacleLayerIndex: 1,
  /**
   * How many rounds of "open a gate, see what that reaches" the map audit runs before it
   * gives up. Not a spec value — a level whose gates chain more than this deep is one
   * nobody would want to play, and the cap is what stops a cycle spinning.
   */
  maxGateCascade: 16,
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
  /** Walk speed in m/s (§3.1) — §5's reference speed. */
  walkSpeed: 3.0,
  /** Sprint speed in m/s, held rather than toggled (§3.1). */
  sprintSpeed: 4.5,
  /**
   * Ceiling on how fast the beam swings, in degrees per second (§3.1) — a reversal takes a
   * third of a second. A rate rather than a smoothing time constant because angular speed
   * is what the player actually perceives, so it is the thing worth tuning.
   *
   * Applies to the turn onto the movement direction when a sprint starts and to the turn
   * back onto the pointer when it ends. Ordinary aiming is direct.
   */
  aimTurnDegreesPerSecond: 540,
  /**
   * Movement intent below which a sprint does nothing. There is no sprinting in place, and
   * a barely-touched stick should not spend the aim lock (§3.1).
   */
  sprintMinimumIntent: 0.35,
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
  /** Deflection at which the touch movement stick starts sprinting (§3.1). */
  touchSprintDeflection: 0.95,
} as const;

/** §4.1 — the flashlight spotlight and its battery. */
export const FLASHLIGHT = {
  /**
   * Full cone angle in degrees (§4.1). Three.js `SpotLight.angle` is the *half* angle from
   * the axis, and §4.1's detection test is written against the half angle too, so this is
   * halved at both use sites rather than stored pre-halved and doubled back.
   */
  coneAngleDegrees: 45,
  penumbra: 0.3,
  /** Beam range in metres (§4.1). */
  range: 12,
  /** Height the beam is carried at, in metres. Chest height on a 1.8 m player (§3.1). */
  mountHeight: 1.6,
  /**
   * Beam brightness at full charge, in Three.js spotlight units at the decay below. A look
   * value: §4.1 fixes the cone's shape and the battery's arithmetic, not its candela.
   */
  baseIntensity: 55,
  /**
   * Falloff exponent. Well below 2 (physical) because the far half of a physically
   * falling-off beam is too dim to make decisions by, and the beam's reach is a mechanic.
   */
  decay: 1.0,
  /** Fraction of charge drained per second while on — 45 s from full (§4.1). */
  drainPerSecond: 1 / 45,
  /** Fraction recharged per second while off — half the drain rate (§4.1). */
  rechargePerSecond: 1 / 90,
  /** After a full drain, the charge needed before it can be switched on again (§4.1). */
  reEnableCharge: 0.15,
  /** Charge above which the beam is at full intensity (§4.1). */
  falloffCharge: 0.25,
  /** Intensity fraction at zero charge, interpolated up to full at `falloffCharge` (§4.1). */
  minIntensityFraction: 0.4,
} as const;

/** §4.2 — environmental lights, and §7's budget for how many of them cast shadows. */
export const ENVIRONMENT_LIGHT = {
  penumbra: 0.4,
  /**
   * Brightness at `intensity: 1.0`. Dimmer than the flashlight per metre lit: a lamp pool
   * is a safe zone to stand in, not a floodlight that makes the torch redundant.
   */
  baseIntensity: 30,
  decay: 1.2,

  /** §4.2's sabotage lifecycle — what a Shadow Monster standing under a lamp costs it. */
  sabotage: {
    /** Continuous dwell inside the pool before the lamp starts to struggle. */
    strainAfterSeconds: 2.0,
    /** How long it struggles before it goes out. */
    failAfterStrainSeconds: 1.5,
    /** Dark time before it comes back at full intensity, dwell reset. */
    recoverySeconds: 6.0,
    /** §4.2 — the strain's flicker ramp, over `failAfterStrainSeconds`. */
    severity: { from: 0.1, to: 0.95 },
  },
} as const;

/**
 * §5.2 — the flicker curve, shared by the flashlight's interference and by a lamp under
 * strain (§4.2). One formula, so a lamp about to fail and a beam about to blink read as
 * the same thing happening to two different lights.
 */
export const FLICKER = {
  /** `f` in `I(t) = I_base · (1 − severity · |sin(f·t)| · random(0.7, 1.3))`, in rad/s. */
  frequency: 18,
  /** The per-tick jitter multiplying the sine. */
  jitter: { min: 0.7, max: 1.3 },
} as const;

/**
 * §4 — the darkness the lighting mechanics act on.
 *
 * Not pure black: at zero ambient an unlit room is a blank screen rather than a dark one,
 * and the Shadow Monster (§5.2) is legible only against ground that has *some* light on it.
 * Low enough that nothing is identifiable without the flashlight, high enough that walls
 * read as silhouettes.
 */
export const AMBIENT = {
  skyColor: 0x2b3b54,
  groundColor: 0x10141c,
  /**
   * In Three's hemisphere-light units, which are not the spotlights' candela — this was
   * picked by looking at the scene, not by arithmetic.
   *
   * Bright enough to read a silhouette at mid-range, dim enough that identifying it, or
   * reading the floor for a route, still needs the beam (§4). That ceiling is what the
   * flashlight's value as a mechanic rests on: at roughly half again this value the tile
   * seams come up and the floor becomes readable without light; back near zero and both
   * enemies collapse into the same shape inside a cone.
   */
  intensity: 14,
} as const;

/**
 * §4 — the moon: one dim directional light that gives the gloom a direction. It casts no
 * shadow, deliberately: shadows exist only where a directed light does, which is what makes
 * the Shadow Monster (§5.2) visible inside a beam and absent outside one.
 */
export const MOON = {
  color: 0x9fb6d8,
  /** Dim enough to identify nothing by; it contributes shape, not visibility. */
  intensity: 0.55,
  /** Direction the light comes from, as a world offset. Steep, like a high moon. */
  direction: { x: -0.45, y: 1, z: -0.35 },
  /** How far from the player it is placed. Only its direction matters; it casts nothing. */
  distance: 40,
} as const;

/**
 * §4, §7 — the fog that makes *distance* the thing which hides the map, rather than
 * darkness. Exponential-squared, coloured to the sky so the world fades into the
 * background rather than towards a different colour.
 */
export const FOG = {
  color: 0x0a0f18,
  /**
   * Chosen against the camera's ground footprint (§3.2): visibility holds across the ~20 m
   * the player is acting in and is most of the way gone by the far edge, so the view ends
   * in gloom instead of at the edge of the geometry.
   */
  density: 0.035,
} as const;

/**
 * §4.3 — spatial audio. The distance model is the mechanic here: an unseen threat has to
 * be locatable by ear, which is a question of how loudness falls off with distance and of
 * nothing else.
 */
export const AUDIO = {
  /** Master gain. A mix level, not a spec value; the options UI (Phase 10) will own it. */
  masterVolume: 0.8,
  /**
   * Pooled positional sources for one-shots. Enemies hold their own long-lived emitters,
   * so this only has to cover footsteps, interactions and the like happening at once.
   */
  poolSize: 16,
  /** §4.3 — every source unless it names another profile. */
  defaultProfile: {
    model: 'linear',
    refDistance: 2,
    maxDistance: 25,
    rolloffFactor: 1.0,
  },
  /**
   * §4.3 — the Shadow Monster's footsteps carry further than anything else on the map,
   * because hearing is the only way to track it before it is close enough to read.
   */
  monsterFootstepProfile: {
    model: 'linear',
    refDistance: 4,
    maxDistance: 35,
    rolloffFactor: 1.0,
  },
} as const;

/**
 * §5 — enemies. The speeds are the spec's table; the rest are the values §5 needed and did
 * not have, now written into the spec beside them.
 */
export const ENEMY = {
  /** §5 — how often a pursuing enemy recomputes its path. */
  repathSeconds: 0.5,
  /** §5.3 — contact threshold, measured centre to centre against the player's capsule. */
  contactDistance: 1.0,
  /** Velocity smoothing, as for the player (§3.1) — enemies should not snap to speed. */
  accelerationTime: 0.18,
  /**
   * How hard enemies push out of each other (§1, §5: "simple local avoidance"). Steering,
   * not physics: it nudges the direction of travel, and the collider resolution behind it
   * is what actually stops anything overlapping.
   */
  avoidanceStrength: 1.6,
  /** Wander leg length, in tiles, and the pause between legs (§5). */
  wanderRadiusTiles: 8,
  wanderPauseSeconds: { min: 0.6, max: 2.4 },
  /** Distance from a waypoint at which it counts as reached, in metres. */
  waypointRadius: 0.45,

  spider: {
    /** Dog-sized (§5.1). */
    radius: 0.5,
    height: 0.7,
    wanderSpeed: 1.2,
    pursueSpeed: 2.4,
    fleeSpeed: 3.6,
    /** §5 — acquires the player inside this range, whether or not it can see them. */
    detectRadius: 16,
    /**
     * §5 — gives up beyond this. Wider than `detectRadius` so acquisition cannot flicker,
     * and wide enough that ducking behind a building does not end a chase: the straight-line
     * distance stays inside it while the route around goes much further.
     */
    loseRadius: 26,

    /** §5.1's light reaction lifecycle. */
    light: {
      /** `T_flee`, rolled afresh each time the beam catches an unlit spider. */
      fleeDelaySeconds: { min: 1.0, max: 4.0 },
      /** Delay before a spider that lost the light resumes approaching. */
      resumeDelaySeconds: 0.2,
      /** How long a flee leg lasts, whether or not it reaches its target. */
      fleeSeconds: 3.0,
      /** Furthest along the away vector a flee target is looked for. */
      fleeSearchDistance: 18,
      /**
       * Resolution of that search, in metres. Not a spec value — it is how finely the
       * away vector is sampled against the grid, and it only has to be smaller than a
       * tile so a target can never be placed across a wall the search stepped over.
       */
      fleeSearchStep: 0.5,
    },

    /** §5.3's attack: a wind-up, a strike that re-checks range, and what follows. */
    attack: {
      /** Telegraph before the strike. The player's window, and a metre of walking (§3.1). */
      windUpSeconds: 0.35,
      /** From the strike, hit or miss, before this spider can attack again. */
      cooldownSeconds: 1.5,
      /** Hold after a hit lands, before pursuit resumes. */
      hitHoldSeconds: 1.0,
      /** Hold after a lunge misses. Shorter than a hit's, but dodging still costs it tempo. */
      missHoldSeconds: 0.5,
      /** How far a landed hit shoves the player away from the spider. */
      playerKnockback: 1.0,
      /** How far the spider throws itself back from the player after landing one. */
      recoilDistance: 1.5,
    },
  },

  shadowMonster: {
    radius: 0.55,
    height: 2.2,
    wanderSpeed: 1.4,
    pursueSpeed: 1.8,
    /** §5 — it always knows. The threat is that it never stops, not that it hunts well. */
    detectRadius: Number.POSITIVE_INFINITY,
    loseRadius: Number.POSITIVE_INFINITY,

    /** §5.2's light interference: the ramp, and the blink it eventually allows. */
    flicker: {
      /** `flickerSeverity` at the start and end of the ramp. */
      severity: { from: 0.1, to: 0.95 },
      /** Seconds of continuous focus the ramp takes. */
      rampSeconds: 3.0,
    },
    blink: {
      /** Fraction of `I_base` the beam must drop below to count as an extreme flicker. */
      intensityThreshold: 0.35,
      /** Consecutive ticks below it before the freeze breaks (§7 — ticks, not frames). */
      consecutiveTicks: 3,
      /** How far the lurch carries it, at most. */
      distance: 2.0,
      /** How long the lurch takes. Short enough to read as a jump-cut, not a walk. */
      seconds: 0.15,
      /** Dead time after a blink before another can trigger. */
      cooldownSeconds: 0.5,
      /**
       * Resolution of the walkability march along the step, in metres. Not a spec value —
       * as with §5.1's flee search, it only has to be finer than a tile so the step can
       * never be placed across a wall it stepped over.
       */
      searchStep: 0.25,
    },
    /** §5.2 — ground covered between footsteps. Slower than the player's 0.95 m (§4.3). */
    strideMetres: 1.6,
  },
} as const;

/**
 * §1 — where the prefab art came from.
 *
 * CC0 asks for nothing, so this is not a compliance record; it is a provenance one. The
 * question that gets asked later is "can we ship this, and where do we get the next
 * version", and the answer has to live somewhere that is not somebody's memory.
 */
export const PREFAB_SOURCE = {
  kit: 'KayKit — Dungeon Remastered 1.0',
  author: 'Kay Lousberg',
  url: 'https://kaylousberg.com',
  licence: 'CC0 1.0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  /** The author's own repository, pinned, so the exact files can be re-fetched. */
  repo: 'KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
  commit: 'b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07',
  /** CC0 requires none. Offered here for anyone who wants to credit it anyway. */
  attributionRequired: false,
} as const;

/**
 * §1 — the two things prefab normalisation cannot infer.
 *
 * Everything else is a placement rule the loader applies to every prefab: centred on its
 * tile in X and Z, and sitting on the ground plane. These are the per-prefab facts, and
 * they are here rather than baked into the `.glb` files because editing a third-party kit
 * means re-editing it on every update.
 *
 * The values below fit the kit `PREFAB_SOURCE` names. A prefab with no entry is used
 * exactly as authored, which is the common case and what a kit built to the 2 m standard
 * needs.
 */
export const PREFAB_FIT: Readonly<
  Record<string, { node?: string; fitHeight?: number }>
> = {
  /**
   * The kit has no standalone gate: the door is a child of a 4 m doorway wall, and taking
   * the whole file would put a second wall on the gate's tile. `node` takes the door and
   * discards its parent.
   */
  gate_wood: { node: 'wall_doorway_door', fitHeight: 2.2 },
  /**
   * A 4 m wall. Scaled to 3 m, which is what the placeholder established and what the
   * camera's pitch (§3.2) and the occluder fade were tuned against.
   */
  wall_brick: { fitHeight: 3.0 },
  /** A 1.1 m barrier where the level wants something at chest height to break sight over. */
  fence_chainlink: { fitHeight: 1.6 },
};

/**
 * §5.3, §6 — the run's ending, and the state the player reads it through.
 */
export const RUN = {
  /** §5.3 — how long the jump-scare holds before the game-over screen. Real time. */
  jumpScareSeconds: 1.5,
  /** §3.4 — the heartbeat's rate at `HEALTH.lowThreshold` and at zero. */
  heartbeatHz: { atThreshold: 1.0, atZero: 2.2 },
  /** §3.4 — health below which the image desaturates, and the fraction it falls to. */
  desaturateBelow: 0.17,
  desaturateTo: 0.4,
} as const;

/**
 * §3.3, §6 — interaction and the objectives it drives.
 */
export const INTERACTION = {
  /** §3.3 — how close the player must be to act on something, in metres. */
  range: 1.5,
  /** §3.3 — half the arc around the aim direction a target must fall inside. */
  aimHalfAngleDegrees: 90,
  /** §6 — how long a gate takes to swing, and after which its walkability flips. */
  gateSwingSeconds: 0.6,
  /**
   * Height above a target the interaction prompt is anchored at, in metres. Presentation,
   * not a spec value: it only has to clear the placeholder props.
   */
  promptHeight: 1.2,
} as const;

/**
 * §4.1 — the shared illumination query. Both AIs ask this and neither implements its own,
 * so its budget is the budget for light detection on the whole map.
 */
export const ILLUMINATION = {
  /** §4.1 — line-of-sight confirmations per second, per entity. */
  raycastHz: 10,
  /**
   * Amount below which a source contributes nothing worth reporting. Not what decides
   * *lit* — §4.1 makes that geometric — only a floor on the number reported beside it.
   */
  amountFloor: 0.01,
} as const;

/**
 * §8.2 — everything the credits screen names that is not the art (`PREFAB_SOURCE` above).
 *
 * Beside the values the game loads by, for the reason §8.2 gives: a credits screen typed
 * out separately is one that stops being true the first time a dependency changes.
 * `tests/credits.test.ts` fails when `package.json` names a package this does not — which
 * is what actually keeps it honest, since nothing else would notice.
 */
export const CREDITS = {
  /** Matches `index.html`'s `<title>`; the title screen renders this one. */
  title: 'Shadows',
  designer: 'Zack Newman',
  /** Shipped in the bundle. */
  libraries: [
    { package: 'three', name: 'three.js', author: 'mrdoob and contributors', licence: 'MIT', role: 'rendering, scene graph, glTF loading' },
    { package: 'zzfx', name: 'ZzFX', author: 'Frank Force', licence: 'MIT', role: 'procedural sound (§4.3)' },
  ],
  /** Built with rather than shipped with, and credited on the same grounds. */
  tools: [
    { package: 'vite', name: 'Vite', licence: 'MIT' },
    { package: 'typescript', name: 'TypeScript', licence: 'Apache-2.0' },
    { package: 'vitest', name: 'Vitest', licence: 'MIT' },
  ],
} as const;
