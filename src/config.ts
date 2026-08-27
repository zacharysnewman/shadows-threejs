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

/**
 * §2 — the band of trees outside every map's boundary.
 *
 * It is what lets §3.2 lock the camera to the player: a centred camera frames ground past
 * the edge whenever the player walks near one, and covering that ground is much cheaper
 * than moving the camera off the person the player is aiming with.
 */
/**
 * §2 — the trees the game builds rather than loads (`GeneratedPrefabs`).
 *
 * One shape at two sizes: §2's surround plants the short one in its thousands outside every
 * boundary, and the same geometry is offered to maps as the `tree_small` prefab. Shared
 * here because they are the same tree, and a wood that changed colour at the fence would
 * announce the fence.
 */
export const TREES = {
  /**
   * Trunk and canopy — the kit tree's palette, darkened.
   *
   * That tree is `#934625` and `#00e72a`, a near-neon green that works for a canopy the
   * camera rarely sees and would be a wall of it across a whole map. These are the same two
   * hues taken down, so the woods read as the same species at night.
   */
  trunkColour: 0x5c2f1c,
  canopyColour: 0x1c7328,
  /** The kit's roughness, so the moon catches these crowns as it catches everything else. */
  roughness: 0.27,
  /**
   * Height of the `tree_small` prefab, in metres (§2).
   *
   * Tall enough to be a tree the player walks between and short enough to be *seen* as one:
   * the camera eye is 13.31 m up, so a crown at this height is well inside the frame. That
   * is the whole difference from the kit's landmark tree, which is 26 m so that its canopy
   * clears the camera and never covers the floor a map's own wood is planted on (§2).
   */
  smallHeightMetres: 4.0,
  /**
   * Half-width of what a tree blocks, in metres — the trunk, not the crown (§2).
   *
   * The same call `PREFAB_FOOTPRINT` makes for the kit's tree: a crown is something you walk
   * under, and blocking the ground beneath it would fence off most of a forest.
   */
  trunkHalfWidth: 0.35,
} as const;

export const SURROUND = {
  /**
   * How tall a surround tree stands, in metres, and how much that varies.
   *
   * Short enough to be seen *whole* — the camera eye is 13.31 m up, so at this height the
   * crown is well inside the frame and what fills the edge of the screen is a canopy rather
   * than a row of trunks disappearing off the top. That is the difference from §2's
   * landmark tree, which is tall precisely so its canopy is never drawn.
   */
  treeHeightMetres: 3.5,
  /** Fraction either side of that height, so a stand of them is not one tree repeated. */
  heightVariation: 0.35,
  /**
   * Grid pitch before jitter, in metres — closer than a tile, so a tile of ground beyond
   * the boundary holds more than one tree.
   *
   * Density is the whole job out here: a forest edge is opaque, and gaps between crowns are
   * the void the surround exists to cover. It is affordable only because the tree is
   * *generated* rather than a kit prefab (see `Surround`) — at this spacing a 50-triangle
   * tree fills the band for a fraction of what one 3,104-triangle model would cost (§7).
   */
  spacingMetres: 0.5,
  /**
   * How far a tree may sit from its grid point, in metres. Enough to break the lattice —
   * a visible grid at the edge of the map advertises the boundary it exists to disguise.
   */
  jitterMetres: 0.25,
  /**
   * How deep the band holds that spacing, in metres — and past it, how much coarser the
   * lattice gets.
   *
   * The band is deep because §3.2's frustum reaches a long way sideways, but almost none of
   * that depth is ever *looked at*: a player is held off the boundary by whatever the map's
   * own edge is, and past the first few metres the fog and the absence of any light out
   * there (§4) leave a tree as a slightly different shade of dark. Spending the instances
   * evenly over the whole depth is what made a visible edge look thin. So the near rows —
   * the only ones anybody reads as trees — are packed, and the rest fall to a lattice
   * `farSpacingFactor` times coarser, which costs a sixteenth as much per square metre.
   */
  denseDepthMetres: 6,
  farSpacingFactor: 4,
  /**
   * Extra depth past what the camera can actually see, in metres.
   *
   * The band's depth is derived from §3.2's ground footprint rather than typed out, because
   * it *is* that number; this is only the slack for a jittered outer tree pulling inwards
   * and a row beyond the frustum's corner.
   */
  marginMetres: 2,
  /**
   * Aspect ratio the depth is computed for. The footprint's half-width grows with aspect,
   * so this is the widest screen the band is guaranteed to cover — 21:9, past which an
   * ultrawide sees a little further sideways than there are trees.
   */
  widestAspect: 21 / 9,
  /**
   * Albedo of the ground beyond the boundary — dark earth, lit by §4's night ambient
   * exactly as the map's own floor is.
   *
   * Deliberately *not* the fog's colour. Fog is what the scene fades into and is also the
   * background (§7), so ground painted fog-coloured is ground indistinguishable from the
   * void it was laid down to cover. It has to be lit like floor to read as floor, and then
   * the fog takes it into the distance on its own.
   */
  groundColour: 0x241f1a,
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
  /** `Landmark.rotation`, degrees clockwise from north (§2). */
  landmarkRotation: 0,
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
  /**
   * §3.1, §4 — the body the player sees themselves as, from `public/characters/`.
   *
   * Scaled to `height`, and turned to face the *aim* rather than the direction of travel:
   * §3.1's whole design is that the two are independent, and a character facing where it
   * walks would put the player's back to their own torch every time they retreat with the
   * beam held on something. `Player.render` already does this; the model inherits it.
   */
  character: 'player',
  /**
   * §4 — how far the player's own body is lifted off black so their silhouette stays
   * readable in the dark, as a fraction of each surface's own colour.
   *
   * A *fraction of the colour*, not a colour of its own. A flat grey added to every
   * material is the same grey whatever it is added to, and at §4's ambient it is most of
   * what the body is: a red shirt, bare arms and black shorts all come out the one pale
   * blue-grey, and the character reads as a ghost rather than as a person. Scaling their
   * own colours is the same thing a very dim light falling on them would do — which is
   * what the allowance is pretending to be — so the body keeps its colours and its own
   * internal contrast, which is most of what makes a shape read as a figure at all.
   *
   * It is still not a light: it illuminates nothing, lights no surface, and no
   * light-reactive enemy responds to it (§4).
   */
  readabilityLift: 0.09,
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
  /**
   * §3.1 — the on-screen action buttons, in CSS pixels: how wide each one is, the gap
   * between them in the stack, and how far the stack sits from the corner. 72 px is a
   * little over the 44 px minimum a thumb can hit reliably, which is the floor worth
   * respecting rather than the target.
   */
  touchButtonSize: 72,
  touchButtonGap: 16,
  touchButtonMargin: 24,
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
  /**
   * §4.1 — where the torch is held, relative to the player and their aim.
   *
   * Five numbers rather than a pose baked into the code, because "held" is a look and the
   * only way to settle a look is to move it while the game is running (§8.3, Phase 11).
   * Every one of them is an offset from the beam §4.1 derives, so all-zero-and-defaults is
   * the beam as the spec describes it and each knob is a departure somebody chose.
   */
  hold: {
    /** Height the beam is carried at, in metres. Chest height on a 1.8 m player (§3.1). */
    height: 1.6,
    /**
     * Metres along the aim direction the beam is emitted, clear of the player's own
     * capsule (§3.1's 0.4 m radius). A light inside the player's mesh is shadowed by it
     * and their shoulders throw a black wedge across their own pool.
     */
    forward: 0.55,
    /**
     * Metres to the right of the aim direction — the hand the torch is in. Zero is
     * centred, which is what §4.1's derivation assumes and what the pool is symmetric
     * about.
     */
    lateral: 0,
    /**
     * Degrees added to the declination §4.1 derives. Positive tilts the beam down, pulling
     * the pool in towards the player; negative flattens it out onto the walls. Zero is the
     * spec's beam, whose upper edge meets the ground exactly at `range`.
     */
    pitchTrimDegrees: 0,
    /**
     * Degrees the beam is turned off the aim direction, positive to the right. Zero is
     * aimed where the player is aiming, which is what §4.1 says and what the enemies'
     * cone test (§4.1's illumination query) assumes.
     */
    yawTrimDegrees: 0,
  },
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
  /**
   * Fraction of charge drained per second while on — 10 minutes of light from full (§4.1),
   * and there is no recharge, so this is the whole run's supply of light rather than a
   * cooldown. Switching the beam off is how the player saves it for later.
   */
  drainPerSecond: 1 / 600,
  /** Charge above which the beam is at full intensity (§4.1). */
  falloffCharge: 0.25,
  /** Intensity fraction at zero charge, interpolated up to full at `falloffCharge` (§4.1). */
  minIntensityFraction: 0.4,
} as const;

/**
 * §4.1 — the torch as a thing in the hand, rather than a light with no source.
 *
 * A body the player's arms reach for (§3.1) and the beam comes out of. It is not what
 * places the light: §4.1 decides where the beam is emitted, and the torch is drawn from
 * the hand that got closest to that point out to it, so the two always meet however short
 * the reach turns out to be.
 */
export const TORCH = {
  /** Barrel radius in metres — §4.1's "a few centimetres across". */
  radius: 0.035,
  /** Shortest the barrel is ever drawn, when the hand reaches the beam's origin outright. */
  minLength: 0.12,
  /** Radius of the lens at the far end, which is where the beam starts. */
  lensRadius: 0.05,
} as const;

/**
 * §4 — the beam you can see in the air, for the lights that cast shadows (§7).
 *
 * Presentation only: nothing here reaches §4.1's illumination query, so a thicker haze
 * cannot make a corner readable or a monster deterred. What it decides is how much of a
 * beam is visible between the torch and the pool it makes.
 */
export const LIGHT_SHAFT = {
  /**
   * Raymarch steps through the flashlight's cone, and through a lamp's.
   *
   * The lamp's is lower because its cone is the wider of the two by a long way — 4 m up
   * over a 6 m pool (§4.2) — so it covers far more of the screen for far less of the
   * picture, and §7 spends the frame on the beam that is the mechanic.
   */
  flashlightSteps: 24,
  environmentSteps: 14,
  /**
   * Haze added per metre of lit beam. The whole look, in one number each.
   *
   * The lamp's is the thinner: a shaft under every working light would turn a powered room
   * into fog, and §4's dark is the point. A lamp gets enough to show the cone it pools
   * with, and the torch gets enough to be a beam.
   */
  flashlightDensity: 0.05,
  environmentDensity: 0.018,
  /**
   * Seconds a lamp's shaft takes to arrive or leave as it gains or loses one of §7's two
   * shadow slots. The slots change hands as the camera moves, and a shaft that appeared
   * the instant a lamp won one would pop on across the room.
   */
  handoverSeconds: 0.4,
  /**
   * Height the march stops at, in metres. The floor receives shadows but never casts them
   * (§7), so the shadow map cannot tell the march the ground is there — and most of the
   * flashlight's cone is below it (§4.1).
   */
  floorHeight: 0.02,
  /**
   * Extra shadow-map bias for a sample in mid-air, on top of the light's own. A sample is
   * not on the surface the light's bias was tuned against, and acne in the haze reads as
   * the beam fizzing rather than as a depth artefact.
   */
  shadowBias: -0.0015,
  /** Radial segments of the proxy cone the shaft is rasterised through. */
  proxySegments: 24,
  /** How far the proxy is grown past the true cone, so its edge is never the shaft's. */
  proxyMargin: 1.02,
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

  /**
   * §4.2 — the lamp you can see, as opposed to the light it throws.
   *
   * §4.2 calls these streetlamps and facility lights, and until this they were a pool of
   * light coming out of nothing: an unpowered one was not dim, it was *absent*, so a level
   * with lamps and no switch wired to them looked like a level with no lamps in it. A post
   * and a head make the fixture a thing on the map — visibly there and visibly off, which
   * is what tells the player there is power to find (§6.3).
   *
   * Placeholder proportions in the same spirit as §6's prop bodies: crude, legible under a
   * beam, and replaced by the art pass.
   */
  fixture: {
    /** Post radius in metres — thin enough not to be a landmark in its own right. */
    postRadius: 0.08,
    /** The head's radius and depth in metres, hung at the mount height. */
    headRadius: 0.34,
    headDepth: 0.22,
    /** Unlit and lit head colours; the post never changes. */
    postColour: 0x2c2f36,
    headColour: 0x4a4a44,
    litColour: 0xfff2d8,
    /** Emissive strength of a lit head. It is the source, so it reads as the brightest thing. */
    litEmissive: 1.6,
  },

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
  /**
   * §5.2 — the floor the curve is clamped to, as a fraction of base intensity. Not zero:
   * at full severity the formula goes negative on a high jitter draw, and a beam clamped
   * to zero is switched *off* for a tick or two, which reads as the torch dying rather
   * than as the torch struggling. The struggle is the tell; killing the light throws it
   * away and hands the player a fright with no information in it.
   *
   * It bounds the lamps too (§4.2), and a straining lamp wants the same treatment: dim to
   * nearly nothing and hold, rather than strobe to black. A lamp that has actually failed
   * is set dark outright, which is a different event and still available.
   */
  floor: 0.15,
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
   * flashlight's value as a mechanic rests on, and it is a ceiling on the *pair*: this and
   * `MOON.intensity` together are what light the map with the beam off, so they are tuned
   * and moved together. On the `example` map this puts unlit ground at ~8.6/255 mean
   * luminance against the ~2.9 the fog alone gives; roughly four times this and the tile
   * seams come up and the floor becomes readable without light, while back near zero both
   * enemies collapse into the same shape inside a cone.
   */
  intensity: 1.4,
} as const;

/**
 * §4 — the moon: one dim directional light that gives the gloom a direction. It casts no
 * shadow, deliberately: shadows exist only where a directed light does, which is what makes
 * the Shadow Monster (§5.2) visible inside a beam and absent outside one.
 */
export const MOON = {
  color: 0x9fb6d8,
  /**
   * Dim enough to identify nothing by; it contributes shape, not visibility. Kept at a
   * fixed fraction of `AMBIENT.intensity`, and moved with it — see the note there. The
   * moon is the larger half of what the floor is lit by, and left where the ambient is
   * not it holds the tile seams readable however far the ambient falls.
   */
  intensity: 0.055,
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
/**
 * §8.1 — the menu music. Not part of `AUDIO`: none of that applies to it, because it has no
 * position, no distance model and no place in a run (see `src/audio/Music.ts`).
 */
export const MUSIC = {
  /** The track, under `public/audio/music/`. */
  file: 'falling-through-glass.mp3',
  /** Well under the game's own sounds: this plays where nothing has to be heard over it. */
  volume: 0.45,
  /** §8.1 — it arrives rather than starts, so the first gesture is not also a cue. */
  fadeInSeconds: 1.5,
  /** Shorter: a run beginning should not have the menu still audible under it. */
  fadeOutSeconds: 0.8,
} as const;

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

  /**
   * §5 — light as terrain. What an enemy *outside* a light does about it, as distinct from
   * what light does to one standing in it (§5.1, §5.2).
   */
  lightAvoidance: {
    /**
     * What a lit tile costs the Shadow Monster, against 1 for a dark one (§5).
     *
     * It is a detour budget in disguise: at 4, the monster will walk up to about four tiles
     * of darkness to avoid one tile of light, and takes the lit route the moment the dark
     * one is longer than that. High enough that it visibly prefers the dark, low enough
     * that a lamp between it and the player is an inconvenience rather than a wall — §5.2's
     * whole threat is that it never stops.
     *
     * A first value, like §5's radii, and one the tuning pass should expect to move.
     */
    monsterLitCost: 4,
  },

  spider: {
    /** Cat-sized (§5.1) — half a metre across, and a third of a metre tall. */
    radius: 0.25,
    height: 0.35,
    /** §5.1 — the animated body, from `public/characters/`. */
    character: 'spider',
    /**
     * Ground speed the walk clip was authored at, in m/s. §5.1 drives the cycle's playback
     * rate from actual speed, and this is the rate that means "×1" — measured by watching
     * the legs against the ground, which is the only way to measure it.
     */
    walkClipSpeed: 2.4,
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
    /**
     * §5.2 — the size the spiders used to be, which is the whole of the silhouette's
     * design: what the player finds in the beam is a spider twice the size of the ones
     * that scuttle, standing still.
     */
    height: 0.7,
    /**
     * §5.2 — the body that is never drawn.
     *
     * It still needs to be a *shape*: the shadow is the creature, and a shadow is only
     * frightening if its outline is. A capsule casts a capsule, and every pixel of this
     * thing the player will ever see is its outline on the floor.
     *
     * It wears the spider's mesh, at the size §5.1's spiders were before they shrank. A
     * silhouette the player already knows how to read is worth more than an unfamiliar
     * one: they have spent the run learning what a spider's shadow looks like, and this is
     * that shape, too big, and not moving.
     *
     * What it does not get is animation. §5.2 is absolute that it is never both moving and
     * visible, so a walk cycle would be frames nobody can see and a standing temptation to
     * show them — and now that its mesh is one that *has* clips, that is enforced where the
     * rig is built rather than by the art happening to have none. See `EnemyManager`.
     */
    character: 'spider',
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
      /**
       * How long the beam stays down, in seconds — the length of a human blink. The beam
       * holds at `FLICKER.floor` for the whole of it and the monster is free the whole
       * time, so this is also how much ground a blink is worth: at its 1.8 m/s pursuit
       * speed, a little under a metre.
       */
      seconds: 0.5,
      /**
       * Dead time after a blink *ends* before another can trigger. Measured from the end
       * rather than the start, or a cooldown no longer than the blink itself would let
       * them run back to back and the beam would never come up between them.
       */
      cooldownSeconds: 0.5,
    },
    /** §5.2 — ground covered between footsteps. Slower than the player's 0.95 m (§4.3). */
    strideMetres: 1.6,
  },
} as const;

/**
 * §1, §8.2 — where the prefab art came from. One entry per kit, in the order the credits
 * list them.
 *
 * A provenance record before it is a compliance one. The question that gets asked later is
 * "can we ship this, and where do we get the next version", and the answer has to live
 * somewhere that is not somebody's memory — which is exactly the case a kit with *no*
 * stated licence makes: `licence: null` is a fact about the kit, not a gap in this file,
 * and the credits screen says so rather than implying permission nobody gave.
 */
export interface PrefabKit {
  kit: string;
  author: string;
  url: string;
  /** The licence as the author states it, or null where the source states none. */
  licence: string | null;
  licenceUrl: string | null;
  /** Where the exact files can be re-fetched, pinned if the source allows pinning. */
  source: string;
  /** Whether crediting is required. Unknown counts as required — see `licence: null`. */
  attributionRequired: boolean;
  /** Which prefabs came from this kit, by name. */
  prefabs: readonly string[];
}

export const PREFAB_KITS: readonly PrefabKit[] = [
  {
    kit: 'KayKit — Dungeon Remastered 1.0',
    author: 'Kay Lousberg',
    url: 'https://kaylousberg.com',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source:
      'KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0@b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07',
    /** CC0 requires none. Offered here for anyone who wants to credit it anyway. */
    attributionRequired: false,
    prefabs: [
      'fence_chainlink',
      'floor_concrete',
      'floor_dirt',
      'gate_wood',
      'prop_crate',
      'wall_brick',
    ],
  },
  {
    kit: 'Playground Props Collection',
    author: 'Stanisko',
    url: 'https://stanisko.itch.io/playground-props-collection-low-poly-game-ready',
    /**
     * The pack ships no licence file and the download states no terms, so there is nothing
     * to record here but that. Treated as attribution-required and named on the credits
     * screen, which is the conservative reading and the only one available: an unstated
     * licence is not a permissive one, it is an unanswered question.
     *
     * §8.2 — outstanding before release. The terms have to be confirmed with the author,
     * and until they are, this is the entry that says nobody has.
     */
    licence: null,
    licenceUrl: null,
    source: 'https://stanisko.itch.io/playground-props-collection-low-poly-game-ready',
    attributionRequired: true,
    prefabs: ['prop_goal', 'prop_hoop', 'prop_net', 'prop_slide', 'prop_swing'],
  },
  {
    kit: '3D Low Poly Tree',
    author: 'yurikokuun',
    url: 'https://yurikokuun.itch.io/3d-low-poly-tree',
    /**
     * The author requires credit, which is why `attributionRequired` is true and why the
     * credits screen names them (§8.2). Unlike CC0, this one is a condition rather than a
     * courtesy: shipping without the line is shipping in breach.
     */
    licence: 'Free, attribution required',
    licenceUrl: null,
    source: 'https://yurikokuun.itch.io/3d-low-poly-tree',
    attributionRequired: true,
    prefabs: ['prop_tree'],
  },
  {
    kit: 'Animated Easy Enemies',
    author: 'Quaternius',
    url: 'https://quaternius.itch.io/animated-easy-enemies',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://quaternius.itch.io/animated-easy-enemies',
    /** CC0 requires none. Offered here for anyone who wants to credit it anyway. */
    attributionRequired: false,
    /**
     * Both enemies' body. A character rather than a prefab — it is skinned (see §1) — and
     * one mesh at two sizes: §5.1's spiders, and §5.2's Shade at twice their size.
     */
    prefabs: ['spider'],
  },
  {
    kit: 'Fitness Characters',
    author: 'iPoly3D',
    url: 'https://poly.pizza/bundle/Fitness-Characters-7PwJehPdnZ',
    /** Public domain, so the credit is a courtesy — offered anyway (§8.2). */
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://poly.pizza/bundle/Fitness-Characters-7PwJehPdnZ',
    attributionRequired: false,
    /** §3.1's player body. Static: the kit ships no rig, so there is no locomotion cycle. */
    prefabs: ['player'],
  },
];

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
/**
 * §2 — the ground a landmark blocks, where its own bounds are the wrong answer.
 *
 * A landmark's footprint is derived from its mesh, which is right almost always and is the
 * only version that survives the art changing. The exception is a model whose bounds are
 * not what a player walks into: a basketball hoop is a pole with a backboard three metres
 * up, and its bounding box would fence off a square of empty yard under the board.
 *
 * Half-extents in metres, before rotation. An entry here needs a reason of that kind —
 * "the mesh overhangs ground you can walk under" — and not a preference about difficulty.
 */
/**
 * §1, §5.1 — the orientation a character model was authored in, where it is not this
 * game's.
 *
 * The counterpart to `PREFAB_FIT`, and it exists for the same reason: a kit authored by
 * somebody else will not match, and editing their file means re-editing it every time the
 * kit updates. glTF is Y-up by convention and most exporters honour it, but a model
 * converted out of a Z-up tool can arrive lying on its back — which is not a bug in the
 * model, just a fact about where it came from.
 *
 * Degrees, applied in X then Y, before anything else touches the model. An entry here is a
 * statement about the *file*, never about how the game wants a character to stand: rotating
 * a character to face somewhere is `Player.render`'s job and changes with the aim.
 */
/**
 * §3.1 — the rig derived for player art that ships without one (`autoRig`).
 *
 * Fractions of the model's own height rather than metres, so the same numbers suit a
 * character of any size. Every one of them is a guess a real rig would not have to make;
 * they are here, and not buried in the code, because the day the art arrives with its own
 * skeleton this whole block goes.
 */
export const PLAYER_RIG = {
  /** Where the hip sits, up from the feet. A little under half a standing figure. */
  hipFraction: 0.48,
  /** Height of the blend band across the hip: wider bends, narrower shears. */
  blendFraction: 0.12,
  /** How far each leg bone sits from centre, as a fraction of the model's width. */
  legSpreadFraction: 0.12,
  /** One stride, in seconds, at `walkClipSpeed`. */
  strideSeconds: 0.9,
  /** Peak leg swing from vertical. Small: the camera is 14 m up and looking down (§3.2). */
  legSwingDegrees: 22,
  /** How far the hips rise over each supporting foot, as a fraction of height. */
  bobFraction: 0.012,
  /**
   * Ground speed the stride above is authored at, in m/s — the player's own walk (§3.1), so
   * walking is ×1 and sprinting reads as hurrying rather than as a different animation.
   */
  walkClipSpeed: 3.0,

  /**
   * §3.1 — the arms, which the same bounding box has to find before they can hold anything.
   *
   * A standing figure's arms are the outermost thing above its hips, so lateral distance is
   * what separates them from the torso. `armInsetFraction` is that distance as a fraction of
   * the model's half-width: beyond it and above the waist is an arm, and the band either
   * side of the line is shared so the shoulder bends rather than tearing.
   */
  armInsetFraction: 0.33,
  armInsetBandFraction: 0.12,
  /** Where the elbow sits along the arm, from shoulder to hand. */
  elbowFraction: 0.5,
  /** Blend band between two arm bones, as a fraction of the arm's length. */
  armBlendFraction: 0.3,
  /**
   * How much of an arm's run is averaged into each end when the shoulder and the hand are
   * measured from the mesh. A single extreme vertex is a fingertip or a shoulder pad, and
   * either one puts the joint centimetres out on an arm half a metre long.
   */
  armEndFraction: 0.15,
  /**
   * How far the arms hang from straight down when they are holding nothing, in degrees
   * outward from the body. The kit is authored with its arms out level, which from §3.2's
   * camera is the most visible pose there is and reads as a scarecrow rather than a person.
   */
  armRestDegrees: 14,
  /**
   * Which way the elbow is pushed, as a mix of straight down and straight out: 1 is
   * directly below the arm, 0 is directly out from the body. Two bones and a target leave
   * the elbow free anywhere on a circle around the line between them, and nothing in the
   * lengths decides where — this is what puts it under the arm rather than up by the ear.
   */
  elbowDrop: 0.8,
} as const;

export const CHARACTER_FIT: Readonly<
  Record<string, { rotateX?: number; rotateY?: number }>
> = {
  // Empty, and worth staying that way. Every kit so far turned out to be honest Y-up glTF
  // once loaded — including one whose raw vertex data reads Z-up, because the node above it
  // carries the conversion. Reading a `.glb`'s accessors and concluding the model is on its
  // side is a mistake this table exists to be the *fix* for, not the evidence of: measure a
  // loaded model, never a parsed one.
};

export const PREFAB_FOOTPRINT: Readonly<Record<string, { hx: number; hz: number }>> = {
  /** Pole and base only; the backboard and rim are overhead (§2). */
  prop_hoop: { hx: 0.3, hz: 0.3 },
  /**
   * The trunk, measured below 3 m — 1.83 m across, and the same in both axes. The canopy is
   * 11.84 m wide and starts nearly 15 m up (§2): a footprint from the mesh would fence off
   * six tiles of ground you are meant to walk under, which is the whole point of the tree.
   */
  prop_tree: { hx: 0.92, hz: 0.92 },
};

/**
 * §1 — how deep a prefab's *footing* is: the slab at its base that meets the ground.
 *
 * A prefab is lined up with its tile on this slab rather than on its whole silhouette,
 * because the part that touches the ground is the part that has to be where the tile is.
 * A tree centred on its bounding box is centred on its canopy, and a canopy that leans
 * takes the trunk with it — 1.2 m off, on a 2 m tile.
 *
 * Half a metre: deep enough to catch a base wider than the shaft above it (a lamp's plinth,
 * a tree's root flare), shallow enough that nothing overhead is in it. It changes only the
 * two prefabs that lean; every other one in the kit centres identically either way.
 */
export const PREFAB_FOOTING = {
  bandMetres: 0.5,
} as const;

export const PREFAB_FIT: Readonly<
  Record<string, { node?: string; fitHeight?: number; contact?: number }>
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
  /**
   * §2 — tall enough that its canopy is above the camera and never drawn.
   *
   * The camera eye sits `CAMERA.distance × sin(CAMERA.pitchDegrees)` above the ground —
   * 14 × sin 72° = 13.31 m — and is pitched down, so nothing above that plane is in frame
   * at all. In the model the leaves begin at 56.2% of its height, so 26 m puts the
   * underside of the canopy at 14.6 m: a metre and a bit clear, with the trunk carrying on
   * up past the camera and out of the top of the world.
   *
   * `fitHeight` scales the Y axis only (see `normalisePrefab`), so the canopy gets taller
   * without getting wider and the trunk keeps its 1.83 m girth — which is what
   * `PREFAB_FOOTPRINT` blocks. What the player gets is a trunk rising out of sight and a
   * dark gap in the sky where the leaves are, which is what being under a tree at night
   * looks like from below.
   *
   * `contact` because the model's lowest point is not what it stands on: four vertices sit
   * 0.14 m below the trunk, all four at the same x/z — one degenerate point with no
   * footprint at all, where a root tip was collapsed. Grounded on it the whole tree is
   * lifted 0.26 m off the floor once `fitHeight` has scaled that gap up with everything
   * else. 0.045 is the ring the trunk actually meets the ground on, 1.44 m across.
   */
  prop_tree: { fitHeight: 26, contact: 0.045 },
  /**
   * §1 — the dirt tile's *surface*, not its highest pebble.
   *
   * A floor is sunk until its contact plane is y = 0, and this one is strewn with stones
   * standing up to 0.086 m proud of it. Sinking the tile by those puts the ground the
   * player walks on 8.6 cm below the ground plane: everything standing on dirt floats by
   * that much, and a dirt tile beside a concrete one is a step. The stones stand above
   * the floor here, which is what stones do.
   */
  floor_dirt: { contact: 0 },
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
  /** §8.1 — the menu's music. `MUSIC.file` is the same track; this is who made it. */
  music: { name: 'Falling Through Glass', author: 'Zack Newman' },
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
