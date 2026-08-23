# Top-Down Web Horror Game — Game Design & Technical Specification

## 1. Project Overview & Tech Stack Architecture

The goal of this project is to build a browser-based, top-down horror game utilizing a
2D-to-3D pipeline. Level layouts are designed in mobile/web-friendly 2D map editors and
exported as standard JSON files. A lightweight web engine then parses these JSON files to
generate a 3D environment with real-time lighting, shadows, and light-reactive enemy AI.

### Technical Stack Summary

- **Map Design Tools:** blurymind Tilemap Editor (PWA/Web) or NotTiled (Android/Web).
- **Build Tooling:** Vite (development server & asset bundling).
- **Language & Core Engine:** Modern JavaScript / TypeScript with Three.js (WebGL).
- **Camera Perspective:** Pitched top-down — perspective camera pitched at ≈70°–75° down,
  to ensure floor shadows from upright entities are visible.
- **Pathfinding:** 2D grid-based A\* algorithm (EasyStar.js or custom) layered with simple
  local avoidance.
- **3D Asset Pipeline:** Low-poly `.glb` / `.gltf` modular grid assets (2 m × 2 m grid unit
  standard).
- **Audio:** `THREE.PositionalAudio` for spatial 3D sound, crucial for tracking invisible
  threats.

## 2. Map Pipeline & JSON Data Schema

The game takes place on a single, continuous map. Level maps are created on a 2D tile
grid. Grid coordinates `(x, y)` map directly to 3D world space as
`(x · tileSize, 0, y · tileSize)`.

The maps checked into the repository are **prototypes, not the level**: one full-size
example that exercises the pipeline, and a small purpose-built map per phase. The level
itself is authored in the editor tooling during the content pass (§1). Nothing in a system's
design should be shaped by what the prototype maps happen to contain — they exist to build
systems against, and they will be replaced.

### Map Layers Structure

1. **Layer 0 — Terrain/Floor:** dirt, concrete, grass, pathing tiles.
2. **Layer 1 — Static Obstacles:** walls, fences, outer boundaries, buildings (have solid
   box colliders).
3. **Layer 2 — Entities & Interactive Objects:** player spawn point, enemy spawns, props,
   and interactables.

### Example JSON Specification Export (`map.json`)

```json
{
  "width": 50,
  "height": 50,
  "tileSize": 2.0,
  "layers": [
    {
      "name": "Floor",
      "data": [1, 1, 1, 1, 1, /* ... */ ]
    },
    {
      "name": "Walls",
      "data": [0, 2, 2, 0, 2, /* ... */ ]
    }
  ],
  "entities": [
    { "type": "PlayerSpawn", "x": 2, "y": 2, "properties": { "rotation": 0 } },
    { "type": "Flashlight", "x": 3, "y": 2, "properties": {} },
    { "type": "PowerSwitch", "x": 20, "y": 22, "properties": { "targetId": "Area2Lights", "mode": "toggle" } },
    { "type": "ExitGate", "x": 48, "y": 48, "properties": { "id": "MainExit", "locked": true, "requiredSwitches": 3 } },
    { "type": "SpiderEnemy", "x": 12, "y": 10, "properties": {} },
    { "type": "ShadowMonster", "x": 30, "y": 30, "properties": {} }
  ]
}
```

### Tileset & Collision Mapping

Tile IDs in each layer's `data` array are indices into a companion `tileset.json`, loaded
alongside the map. The map file carries no art or collision information itself.

```json
{
  "tiles": {
    "0": { "prefab": null,            "solid": false },
    "1": { "prefab": "floor_concrete", "solid": false },
    "2": { "prefab": "wall_brick",     "solid": true  },
    "3": { "prefab": "fence_chainlink", "solid": true  }
  }
}
```

- `data` arrays are row-major, length `width × height`; index `i` is tile
  `(i % width, ⌊i / width⌋)`. A `data` array of the wrong length is a load failure: the
  layout cannot be recovered from it and guessing at the intent would silently shift every
  tile after the error.
- `prefab` names a `.glb` in the asset bundle; `null` renders nothing.
- Tile id `0` always means "nothing here" — no prefab, not solid — whether or not the
  tileset declares it.
- A tile id a layer uses but the tileset does not define is logged and treated as `0`, for
  the same reason unknown entity types are skipped: an older build should still open a
  newer map, rendering what it understands.
- **Walkability derivation:** a tile is walkable for pathfinding when its Layer 0 tile is
  non-zero *and* its Layer 1 tile is not `solid`. Gates flip their tile's walkability at
  runtime (§6). The resulting boolean grid is the A\* input and is rebuilt on any
  walkability change.

### Entity Type Reference

Every `type` the loader accepts, with its `properties` contract. Unknown types are logged
and skipped rather than throwing, so a map can be opened by an older build.

Properties are marked **required** or given a default. A required property that is missing
logs and skips that entity — it names something (a note's body, a switch's target) that
cannot be guessed. Everything else defaults, because tile editors export sparse property
objects and a map should not fail to load over an unwritten field.

| `type` | Properties | Notes |
| --- | --- | --- |
| `PlayerSpawn` | `rotation` (deg, default `0`) | Exactly one required per map. |
| `Flashlight` | — | Pick-up. |
| `Note` | `noteId` (required) | Key into `notes.json`; see §6. |
| `PowerSwitch` | `targetId` (required), `mode` (default `toggle`) | Names a light group or gate; `mode` is `toggle` or `latch` (§6). |
| `EnvironmentLight` | `groupId` (required), `radius` (default `6` m), `intensity` (default `1.0`) | Off until its group is powered. |
| `Gate` | `id`, `targetId` (both required), `locked` (default `true`) | Rotates open when triggered. |
| `ExitGate` | `id` (required), `locked` (default `true`), `requiredSwitches` (default `3`) | Win objective. |
| `SpiderEnemy` | — | Spawns at tile centre. |
| `ShadowMonster` | — | Spawns at tile centre. |

`mode` defaults to `toggle` rather than `latch` because `latch` is irreversible and feeds
the exit counter (§6): an unannotated switch defaulting to `latch` would silently create
objective progress the player cannot undo, while one defaulting to `toggle` is merely
reversible.

An entity whose `x`/`y` fall outside the map is logged and skipped on the same terms as an
unknown type. Missing or duplicated `PlayerSpawn` is the one entity-level load failure —
the run has nowhere to start, so there is nothing to degrade to.

Multiple `EnvironmentLight` entities may share a `groupId`; a `PowerSwitch` toggles the
whole group at once. Entity `x`/`y` are grid coordinates and are converted to world space
by the mapping above, offset to the tile centre.

Rotations are degrees clockwise from north, where north is `-Z` — screen-up under the
un-rotated camera (§3.2) — so `90` faces east. The convention has to be written down
somewhere: a spawn rotation is the player's facing before they have aimed at anything
(§3.1), and an editor exporting degrees says nothing about which way zero points.

## 3. Player Controller, Camera & Interaction

### 3.1 Movement

- Top-down twin-stick control: keyboard `WASD` / arrows or left analog stick for movement,
  mouse position or right analog for aim (§4.1). The two are independent — the player can
  back away while keeping the beam on a threat.
- Walk speed 3.0 m/s, with acceleration/deceleration smoothed over 0.1 s to avoid snapping.
- The player is a 0.4 m radius, 1.8 m tall capsule resolved by sliding along contact
  normals, so grazing a wall does not halt movement.
- What stops the capsule is everything the walkability grid calls unwalkable (§2), not
  only Layer 1 colliders: a tile with no floor blocks the player exactly as a wall does,
  and so does the map's outer edge whether or not the author walled it. A hole the player
  can walk out over is ground no enemy can follow them onto, and reads as standing on
  nothing.
- The player faces their spawn's `rotation` (§2) until the first aim input arrives, so a
  run does not open with the character facing an arbitrary direction.
- **Sprint** at 4.5 m/s while held, and **while sprinting the aim locks to the direction of
  travel**: the beam points where the player is going, and the pointer or aim stick is
  ignored until they let go.
- Aim turns at a **maximum of 540°/s** — a reversal takes a third of a second — both onto
  the movement direction when a sprint starts and back onto the pointer when it ends. A
  bounded turn rate rather than a smoothed one, because what the player perceives is the
  beam's angular speed, and it is the thing to tune. The turn back matters as much as the
  turn out: releasing sprint with the cursor behind you would otherwise whip the beam 180°
  in a single frame, which reads as a glitch rather than as looking back.
- Ordinary aiming is **direct**: outside a sprint and its recovery turn, the beam is at the
  cursor, with no lag between where the player points and where the light is. The rate
  limit exists for the transition, not for aiming.
- The lock is the whole cost of the sprint, and it is a steep one. Independent aim is what
  lets a player back away with the beam held on a threat (§3.1, first bullet); sprinting
  spends exactly that. A sprinting player cannot hold a spider deterred (§5.1) or a Shadow
  Monster frozen (§5.2) behind them — they have chosen to stop looking at whatever they are
  running from. Speed buys distance; it costs the only thing that controls what is chasing.
- Sprinting requires moving. There is no sprint in place, and no stamina meter: the aim
  lock is the resource, not a bar.
- There is no jump or crouch.

### 3.2 Camera Rig

- Perspective camera, 50° vertical FOV, pitched per §1, positioned 14 m above and behind
  the player along the pitch vector.
- Follows the player with critically damped smoothing (≈0.15 s time constant); no rotation
  — the map's north stays screen-up so learned routes stay legible in the dark.
- The rig clamps to map bounds so the camera never frames off-map void. What is clamped is
  the frustum's ground footprint, not the camera position: under a pitched camera that
  footprint is a trapezoid, wider at its far edge than it is where the player stands.
- Framing the player outranks hiding void. The clamp never pushes the player within 2 m of
  the edge of the view, and on an axis where the map is too small to satisfy both rules the
  camera centres that axis rather than pinning the player to one side. Close to a boundary
  the far corners of the footprint will show void; that is the accepted cost, because a
  camera that hides the void by losing the player has failed at the more important half of
  its job.
- Static geometry between the camera and the player must not hide the player. At a 70°–75°
  pitch a full-height wall on the camera side of the player does exactly that, and once the
  map is dark (§4) the occluder does not even read as a wall — it is a black rectangle
  covering the player and their beam. Geometry inside a cylinder between the player and the
  camera is therefore faded out. Only the *visible surface* fades: the occluder still blocks
  light and still casts its shadow, so the fade cannot be used to see into a room the player
  could not otherwise see into. It is a way to see the player, not a way to see past walls.

### 3.3 Interaction

- A single context action (`E` / gamepad `A` / on-screen tap target) acts on the nearest
  interactable within 1.5 m and within ±90° of the player's aim.
- When such a target exists, a prompt appears above it. Only one target is ever prompted —
  the nearest wins — so cluttered tiles cannot produce ambiguous input.
- Interaction is disabled while a UI modal (§6) or the death overlay (§5.3) is up.

### 3.4 Health & Regeneration

- Health is a 0.0–1.0 pool, full at run start. It is a buffer against the spider only —
  the Shadow Monster ignores it entirely (§5.3).
- **Spider damage:** 0.34 per contact, so three hits from full kill. The pool is not
  segmented; a partially regenerated player can die in two.
- **No invulnerability window.** Damage is gated per attacker, not per player: each spider
  carries its own attack cooldown (§5.3), so it cannot re-hit on consecutive ticks, but
  nothing stops two spiders landing within the same second. A pack is proportionally more
  dangerous than one spider, and three converging can take a player from full health to
  dead in a single exchange.
- **Regeneration:** begins 6.0 s after the last damage taken and refills at 0.12/s —
  roughly 3 s to undo one hit, 8 s to recover from near-death. Taking damage resets the
  delay. Regeneration continues while moving; there is no resting or bandaging action, and
  nothing to collect.
- **Feedback:** no numeric bar or hearts. Damage state reads through a red vignette that
  tightens as health drops, an audible heartbeat that quickens below 0.34, and desaturation
  at the lowest band. The player should feel the state without reading a HUD element,
  and the effects fade as regeneration proceeds.

The intent is that spider encounters are survivable and recoverable — a mistake costs
tempo and forces a retreat rather than the run — while the Shadow Monster stays absolute.
Health never mitigates it, so no amount of regeneration makes standing near it viable.

## 4. Lighting, Visibility & Audio System

Lighting is the primary mechanics driver, paired tightly with spatial audio and battery
management.

**It is dark, not blacked out.** The map carries a dim ambient — enough that ground, walls
and anything standing on them read as silhouettes near and mid-range. What hides things is
*distance*: fog fades the scene out towards the edge of the camera's footprint (§3.2), so
the world ends in gloom rather than at a hard black line.

This is a mechanics decision, not an art one. If the only visible thing is whatever the beam
is pointed at, both enemies look the same — a shape inside a cone — and the Shadow Monster's
entire design (§5.2) is spent on a distinction the player never sees. With ambient gloom the
two read differently at range:

- **The spider is a shape you can see moving.** Fully visible in dark and light (§5.1), so
  at range it is a silhouette crossing the gloom.
- **The Shadow Monster is nothing at all.** The ambient reveals ordinary things; it reveals
  the monster not one bit. Its body is never drawn (§5.2) and the gloom casts no shadows, so
  outside a light it has no presence of any kind — not a silhouette, not a shadow, nothing.
  **It is visible only where a directed light falls on it**, as the hard shadow that light
  throws, and it is nothing again the moment the light leaves.

  That asymmetry only works because the map *is* lit enough to see ordinary things by. Where
  nothing is visible outside the beam, an invisible monster is distinguishable from nothing —
  everything is equally unseen. Against a gloom in which a spider is a shape crossing open
  ground, a creature that never appears there at all is a different kind of thing. Its other
  tells stay the ones §5 gives it: footsteps that carry further than anything else on the map
  (§4.3), and the lamp it makes flicker from across the level (§4.2).

**A moon for shape.** One dim directional light, steeply angled, gives the gloom a direction
so an unlit yard reads as a place rather than as a flat grey wash. It casts no shadow.

**Shadows exist only where a directed light does.** The flashlight casts and the
environmental lamps cast; the ambient and the moon do not. A shadow on the ground is
therefore information in itself — something is being lit — and it is what the Shadow Monster
is built on (§5.2).

The ambient stays *under* the flashlight, and that ceiling is what keeps the beam a
mechanic: a silhouette in the gloom cannot be identified, the floor cannot be read for a
route, and a note, a switch or a pick-up cannot be found without light on it. The beam is
for knowing what something is; the ambient is only for knowing that something is there.

**The player's own silhouette stays readable.** The character is legible in the dark as a
dim shape. This is a rendering allowance, not a light source — it illuminates nothing, lights
no surface, and no light-reactive enemy responds to it. A player who cannot see which of the
shapes on screen is theirs is not playing a dark game, they are playing a broken one.

### 4.1 Flashlight Mechanics & Battery

- **Type:** attached `THREE.SpotLight` bound to the player's position and directed along the
  player's aim on the X/Z plane — the mouse cursor or right analog position, except while
  sprinting, when aim is the direction of travel (§3.1).
- **Spotlight Properties:** angle ≈45° (the full cone), penumbra 0.3, cast shadow enabled,
  range 12 m along the ground.
- **Mounting:** carried at chest height and emitted just clear of the player's capsule — a
  light inside the player's own mesh is shadowed by it, and the player's shoulders throw a
  black wedge across their own beam. The axis is declined so the cone's *upper* edge meets
  the ground at the beam's range, which puts the near edge of the lit pool about a metre in
  front of the player. A beam pointed flat along the aim vector spends its upper half on
  walls and leaves the floor dark around the player, which under the pitched camera (§3.2)
  reads as a hole rather than as a torch.
- **Toggle:** `F` / gamepad `X` / the on-screen action button. A toggle is refused outright,
  with no state change, while the battery is flat or the lockout below is holding.
- **Battery Drain & Recharge (mechanic):**
  - The flashlight has a finite charge capacity, expressed as a 0.0–1.0 charge fraction.
  - When turned ON, the battery drains steadily: 1/45 per second, i.e. 45 s of continuous
    light from full.
  - When turned OFF, the battery auto-recharges over time at 1/90 per second — half the
    drain rate, so sustained use costs twice what it returns. This forces the player into
    terrifying moments of vulnerability in the dark.
  - At 0.0 the light cuts out and cannot be switched back on until charge reaches 0.15,
    preventing a strobe exploit against the Shadow Monster's freeze (§5.2).
  - Beam intensity is full above 0.25 charge and falls off linearly to 40% at 0.0, so the
    player feels the reserve draining before it fails.
- **Optimized FOV Detection:**
  - Checks if an enemy target position `P_e` lies within distance `d ≤ range` and within
    angle `θ ≤ spotlightAngle / 2`.
  - Raycasts to confirm line-of-sight are only performed at a fixed interval
    (e.g. every 100 ms / 10 Hz).

#### The illumination query

One service answers *is this entity lit, and by how much*, and **both AIs consume it;
neither has its own**. A spider that decided it was lit on different terms than the Shadow
Monster would be a bug nobody could see, only feel.

- **Lit is geometric, not photometric.** An entity is lit when it is inside a light's reach
  with a clear line to it: within the beam's range *and* half-angle for the flashlight
  (above), or within a lamp's ground radius for an environmental light (§4.2). §5.1 says
  the spider stuns "the instant the beam hits" it, so a dim beam still counts — brightness
  never decides, only geometry. A beam that is off and a lamp that is unpowered light
  nothing.
- **The amount** is reported beside it: 0–1, the strongest single source's strength at that
  point, falling off with distance and towards the edge of a cone, scaled by the beam's
  battery falloff (§4.1) or the lamp's authored intensity (§4.2). Nothing in §5 keys off it
  yet — it is there for tuning, for the HUD, and so that a later behaviour that *should*
  care about strength has something honest to ask.
- **Occlusion is shared with movement.** Light is blocked by the same obstacles that block
  walking (§3.1), and by nothing else: a hole in the floor does not cast a shadow. The test
  is a segment against those obstacles on the X/Z plane, which is an approximation — it
  ignores height, so a beam that would pass over a low crate is treated as stopping at it.
  It errs towards *shadowed*, which matches the shadow the player can see on the ground.
- **The confirming raycast is throttled to the interval above and staggered across
  entities**, so the cost is spread rather than landing on one tick. What is throttled is
  the *repeat*: an entity entering a light's reach is confirmed on that same tick, because
  §5.1 stuns "the instant the beam hits" and a tenth of a second is not an instant. Leaving
  the cone is instant too — the geometry is re-tested every tick, and losing the light has
  to be immediate or §5.2's freeze could be held with a beam no longer on the monster.
  What can lag by up to one interval is the middle case: an entity that stays inside the
  cone while a wall comes between them.

### 4.2 Environmental Lighting (Dynamic Sabotage)

- Turning on power switches activates environmental lights (e.g. overhead streetlamps or
  facility lights), addressed in groups by `groupId` (§2).
- **Properties:** each light is a downward-facing `THREE.SpotLight` mounted at 4 m,
  throwing a cone that pools to a default 6 m ground radius, with a per-entity `intensity`
  override. Only environmental lights within the camera frustum cast shadows, and at most
  two do so at once (§7).
- These lights act as temporary safe zones. The effect is per-enemy, not generic: a spider
  inside the cone is repelled and runs its flee lifecycle (§5.1); a Shadow Monster inside
  it is frozen (§5.2). Illumination from an environmental light counts as "lit" for both,
  identically to the flashlight beam.
- **Sabotage Mechanic:** the Shadow Monster's presence degrades a light it is standing
  under. This is not a deliberate action it takes and not a permanent one — the lamp
  struggles while the monster is in its cone, fails, and recovers.

#### Sabotage Lifecycle

A light tracks the monster's continuous dwell time inside its cone. Leaving the cone
resets the dwell to zero.

1. **Strain (dwell ≥ 2.0 s):** the lamp begins to flicker, its intensity fluttering with
   the same character as the flashlight interference (§5.2) and audibly buzzing.
2. **Failure (after 1.5 s of flicker):** the lamp goes out. Its safe zone is gone and the
   Shadow Monster's freeze (§5.2) releases the instant the cone dies.
3. **Recovery (6.0 s later):** the lamp relights at full intensity, with the dwell timer
   reset. If the monster is still standing under it, the cycle begins again from strain.

The light is never destroyed and its `PowerSwitch` state is untouched — a powered group
stays powered, and an outage is a rolling hazard rather than lost progress. The design
consequence is a moving map of safe ground: routes the player relied on go dark for a few
seconds at a time and come back, and camping under one lamp forever fails on its own.

**The flicker is a tell.** The Shadow Monster is invisible (§5.2), so a lamp starting to
strain across the map is the clearest information the player ever gets about where it is —
readable at any distance, and worth reading before the pool goes dark.

### 4.3 Audio Core

- Implement `THREE.AudioListener`, carried by the **player**, not the camera. Every distance
  below is measured from where the player is standing, and the camera sits 14 m above and
  behind them (§3.2) — hanging the listener off it would add that 14 m to every source and
  quietly halve the map's audible radius.
- The listener is never rotated, like the camera (§3.2), so world `+x` is screen-right and
  what the player hears on their left is on the left of their screen. North and south of
  the player pan alike; that is a real limit of stereo on a top-down map, and it is why
  distance has to carry the rest of the information.
- All entities utilize `THREE.PositionalAudio` with a defined rolloff/reference distance so
  the player can audibly locate unseen threats. Default `linear` distance model,
  `refDistance` 2 m, `maxDistance` 25 m, `rolloffFactor` 1.0.
- The Shadow Monster's footsteps use `refDistance` 4 m and `maxDistance` 35 m — audible
  further out than anything else on the map, because hearing is the only way to track it
  before it is close enough to cast a readable shadow.
- The player's own footsteps sound on a cadence driven by ground actually covered, not by a
  timer: a player held against a wall makes no noise however hard they walk into it. They
  are quieter and higher than the Shadow Monster's (§5.2) and always centred on the
  listener, so they can never be mistaken for something approaching.
- Browser autoplay policy requires a user gesture before audio starts; the title screen's
  first input resumes the `AudioContext`.
- A paused simulation (§6) silences positional sources: a world that is not advancing must
  not still be walking towards the player. The listener and the context stay alive, so
  unpausing resumes rather than restarts.

## 5. Enemy Design & AI Specification

Both enemies rely on a base A\* pathfinding logic that updates their target paths
periodically (e.g. every 500 ms). The Shadow Monster ignores other entity colliders.

Movement speeds, all in m/s, tuned against the player's 3.0 m/s (§3.1):

| State | Spider | Shadow Monster |
| --- | --- | --- |
| Wander / idle | 1.2 | 1.4 |
| Pursuing player | 2.4 | 1.8 |
| Fleeing | 3.6 (1.5× pursue) | — |

Neither enemy outruns the player. A walking player is faster than a pursuing spider and
half again as fast as the Shadow Monster; only a *fleeing* spider (3.6) beats a walk, and
nothing beats a sprint (§3.1). That is deliberate: an enemy that catches a player in a
straight line would make the map a reflex test. They threaten by never stopping, by taking
routes the player cannot, and by the corners and dead ends they force — and by what running
costs. A sprinting player has their light pointed the way they are going (§3.1), which means
whatever they are running from is unlit, unfrozen and undeterred behind them.

**Bodies.** The spider is a 0.5 m radius circle on the X/Z plane, the Shadow Monster 0.55 m,
resolved against the same obstacles as the player (§3.1). Neither is stopped by the other:
spiders steer around each other with the local avoidance above, and the Shadow Monster
ignores other entity colliders entirely — it walks through its own kind and through the
spiders, which is part of taking routes the player cannot.

**Acquiring the player.** Pursuit is decided by proximity, not by sight:

| | Acquires within | Gives up beyond |
| --- | --- | --- |
| Spider | 16 m | 26 m |
| Shadow Monster | always | never |

The two radii differ so that a player at the edge of a spider's range cannot make it
flicker between hunting and wandering. Sight is not part of acquiring — an enemy that had
to see the player first could never begin a chase around a corner, and on a map of
buildings that is most of what a chase is. What line of sight decides is only *how* an
enemy comes: with a clear line it walks straight at the player, and without one it paths
(§1) and repaths on the interval above. The Shadow Monster always knows where the player
is; that is the whole of its threat, and it is why it is the slower of the two.

**Wandering.** With no one to chase, an enemy picks a walkable point within about 8 tiles,
walks to it, and pauses 0.6–2.4 s before choosing another. An enemy that cannot find a
route — to a wander target or to the player — wanders rather than standing still or
pressing into the wall between them.

The radii and the wander numbers are first values, not tuned ones: they are exactly the
kind of thing the tuning pass (§1, content) is expected to move once the game is playable.

### 5.1 Enemy 1: Giant Spider (Dog-Sized)

- **Visual Representation:** dog-sized arachnid mesh + cast shadow. Fully visible in dark
  and light. Emits chittering/scuttling spatial audio.
- **Animation:** a locomotion cycle and an attack. The locomotion cycle's playback rate is
  driven by the spider's actual speed, so a wandering spider (1.2 m/s), a pursuing one
  (2.4 m/s) and a fleeing one (3.6 m/s) all place their legs on the ground instead of
  skating. The attack animation is authored *to* the strike time in §5.3 — see there.
- **Base Behavior:** wanders, or uses A\* pathfinding to approach the player.
- **Light Reaction Lifecycle:**
  1. **Instant Stun:** the instant the flashlight beam hits the spider's bounding box, its
     velocity drops to `0`.
  2. **Deterrence Timer:** a timer `T_flee` randomized between 1.0 s and 4.0 s begins.
  3. **Flee Mode:** if illuminated for `T_flee`, the spider enters `Flee` state. It
     calculates a vector directly away from the player, raycasts to find the furthest
     walkable point on that vector, and sets that as its new target for 3 s, moving at
     1.5× speed.
  4. **Interruption:** if light is removed before `T_flee` expires, it resumes approaching
     after a 0.2 s delay.
- **On contact:** the spider damages rather than kills, and recoils afterwards; see §5.3.
  It is a war of attrition the player can lose slowly, not a single mistake.

### 5.2 Enemy 2: Shadow Monster

- **Visual Representation:**
  - **Material: the body is never drawn.** Not faint, not a distortion, not a shimmer —
    the mesh contributes nothing to the image at all. It exists in the scene solely to cast
    a stark, hard shadow onto the floor (`castShadow = true`), and it casts under the
    flashlight and the environmental lamps and under nothing else, because the ambient and
    the moon throw no shadows (§4).
    
    So **the shadow is the creature**. Sweeping a beam across apparently empty ground and
    finding a shadow lying in it is the only way to see the thing, and the moment the light
    leaves it there is nothing there again. A faint visible body would be strictly worse: it
    would give the player a second, easier way to find the monster, and the whole design is
    that there is only the one hard way.
  - **Animation: none.** A single pose is enough, because the monster is never both moving
    and visible. It is invisible unless a light is on it, and a light on it freezes it
    (below) — so every frame in which the player can see anything of it is a frame in which
    it is standing still. The blink step is the one exception and wants no animation either:
    §5.2 calls for a jump-cut rather than a walk, so the pose simply arrives somewhere else.
    Nothing subtle would read anyway; what the player sees is a silhouette on the floor.
  - **Audio:** heavy, slow, spatial footsteps.
- **Light Reaction Lifecycle:**
  1. **Movement Freeze:** when illuminated (by flashlight or environment light), the Shadow
     Monster cannot move.
  2. **Light Interference / Flickering:**
     - Sustained flashlight focus causes the beam intensity `I` to fluctuate:

       ```
       I(t) = I_base · (1.0 - flickerSeverity · |sin(f · t)| · random(0.7, 1.3))
       ```

     - `flickerSeverity` ramps from 0.1 to 0.95 over 3 seconds of continuous focus.
     - **The "Blink" Movement:** during extreme flickers (when light intensity drops below
       threshold for a few frames), the Shadow Monster breaks its freeze state and takes a
       rapid, lurching step toward the player. Threshold: intensity below 35% of
       `I_base` for 3 consecutive frames. The step covers up to 2.0 m toward the player
       over 0.15 s, stopping short at the first solid tile, and cannot retrigger for
       0.5 s. The step is instant enough to read as a jump-cut rather than a walk.
  3. **Environmental Sabotage:** if the Shadow Monster enters the cone of an active
     environmental light, it disables the light source — by standing in it rather than by
     acting on it. Note that the cone also freezes the monster, so the frozen monster
     degrading the lamp above it is the same event: it is pinned until the lamp fails, and
     the lamp's flicker is what tells the player where it is pinned. See the sabotage
     lifecycle in §4.2 for timings.

### 5.3 Contact, Damage & The Death State (Fail Condition)

- A simple X/Z distance check is run between the player and any hostile entity.
- If `distance(player, enemy) < 1.0m` (radius overlap), the outcome depends on which
  enemy made contact:

**Spider contact — an attack, not a touch.** Closing to 1.0 m does not deal damage; it
starts an attack, and the damage lands partway through it:

1. **Wind-up (0.35 s).** The spider commits: it stops advancing and plays its attack
   animation. This is a telegraph, and it is the player's window — 0.35 s is a metre of
   walking (§3.1), so a player who reacts to the lunge gets out of reach of it.
2. **Strike (at 0.35 s).** The 1.0 m check is taken *again*, at this instant.
   - **In reach:** deducts 0.34 health (§3.4). The player is knocked back 1.0 m from the
     spider, and the spider recoils 1.5 m, holds for 1.0 s, then resumes pursuit (§5.1).
   - **Out of reach:** the lunge misses. No damage, no knockback, and the spider holds for
     0.5 s before it can do anything else. Missing has to cost it tempo, or dodging buys
     the player nothing.
3. **Cooldown (1.5 s from the strike),** whether it hit or missed. Tracked on the spider,
   not on the player, so other spiders are unaffected and can land their own hits in the
   same second.

**Light cancels an attack outright.** A spider lit during its wind-up stops where it is
(§5.1's stun is immediate and literal); the strike never happens and no cooldown starts.
Cancelling a lunge with the beam is one of the few things the flashlight does *directly* to
a spider rather than through the deterrence timer, and the battery is what it costs.

**The strike time belongs to the simulation, not to the animation.** Damage resolves at
0.35 s into the attack whatever the art does; an attack animation whose contact frame lands
somewhere else is the thing that gets re-timed. Tying the damage to an animation event
instead would make a gameplay constant editable in an art file, and would change how much
health a mistake costs whenever the animation is re-exported.

Without the recoil and the cooldown, a spider that reached the player would deal its whole
pool in consecutive ticks; with them, being caught by one spider is survivable and being
caught by three is not. The run continues; if the deduction takes health to 0.0, it resolves
as death below.

The wind-up and miss-recovery durations above are first values, expected to move in the
tuning pass (§1, content): they set how reactive a spider feels, and that is not knowable
until it is played.

**Shadow Monster contact — fatal.** Kills outright at any health, on contact, with no
wind-up and no animation. There is no chip damage, no partial hit, and no survivable brush —
reaching the player is the whole of its threat, and giving it a telegraph would hand the
player a reaction where the design gives them none.

**On death:**

- Input is disabled.
- A full-screen jump-scare UI element (CSS/HTML overlay) triggers, holding for 1.5 s. The
  two enemies use different jump-scare presentations, so the player reads what killed them.
- The run ends. There is no respawn and no checkpointing: the jump-scare resolves to a
  game-over screen, and the only continuation is a new game from the level start with all
  switch, note, and pick-up progress cleared.

The check runs against the player's 0.4 m capsule; the 1.0 m threshold means contact
lands slightly before the meshes visibly touch, which reads as being grabbed.

## 6. Items & Interactivity Specification

1. **Flashlight Prop:** item pick-up on grid. Equips the player's primary light source.
2. **Note Props:** pick-up or readable triggers. Display UI modal overlay containing
   lore/clues. Body text lives in a separate `notes.json` keyed by `noteId`, not in the
   map file, so writing and level design stay independent. Opening a note pauses
   simulation; the world does not advance while the player is reading.
3. **Power Switches / Buttons:** interactive objects that act on every entity sharing
   their `targetId`. Two modes:
   - **`latch`** — one-way. Turns its target on and cannot be turned back off. Used for
     gates and for the exit's power routing, so objective progress is monotonic and the
     exit's counter never moves backwards.
   - **`toggle`** — two-way. Used for light groups, so the player can deliberately kill a
     lit area as well as restore it. Cutting a lamp forfeits its safe zone but removes the
     pool of light the player is standing in — worth it when being seen matters more than
     being safe.
   Safe zones otherwise go dark only through the temporary outages in §4.2.
4. **Fences & Gates:** solid obstacle prefabs. Gates transition from `solid = true` to
   `solid = false` and rotate 90° when triggered.
5. **The Exit Gate:** the final objective. Unpowered initially. Requires the player to
   navigate the map, find specific buttons/switches to route power to it, and survive the
   escape. It unlocks once `requiredSwitches` distinct `latch` switches targeting it have
   fired;
   a HUD counter shows how many remain so the objective never becomes a hunt for an
   unmarked last switch.
### Run Structure

A run is a single life over the whole map (§2), with no checkpoints, no saves, and no
mid-run persistence. World state — latched switches, toggled light groups, notes read,
pick-ups held — lives only for the duration of the run and is discarded on death (§5.3) or
victory.

### Victory Condition

Reaching the unlocked exit gate ends the run: input is disabled, a victory overlay
displays elapsed time and notes found, and the player may start a new run.

## 7. Rendering & Performance Targets

Shadows are the core mechanic rather than an effect, so the shadow budget is a design
constraint and not a polish-phase concern.

- Target 60 fps on mid-range desktop hardware, 30 fps floor on recent mobile. The game is
  playable on touch, but the design target is desktop with mouse aim.
- Exactly one shadow-casting `SpotLight` (the flashlight) plus at most two shadow-casting
  environmental lights at a time, chosen each frame by proximity to the camera. Remaining
  environmental lights illuminate without casting. The ambient and the moon (§4) cast
  nothing — a design rule first and a saving second, since a shadow on the ground has to
  mean a light is on something.
- Shadow map 2048×2048 for the flashlight, 1024×1024 for environmental lights; PCF soft
  shadows; shadow camera near/far tightened to the light's range to keep depth precision.
- Filmic tone mapping. The scene is a handful of small, close lights against near-black
  (§4) — exactly the range that clips. Without a tone curve the middle of a light pool goes
  flat white and takes the detail with it, including the shadows the game is played by.
- Exponential fog, coloured to the sky, tuned so the far edge of the camera's ground
  footprint (§3.2) is most of the way faded out. It is what makes distance rather than
  darkness the thing that hides the map (§4), and it applies to lit geometry too: a lamp
  pool on the far side of the view is a glow, not a readable place.
- Static Layer 0/1 geometry is merged or instanced per prefab at load time — a 50×50 map is
  2,500 floor tiles and must not be 2,500 draw calls.
- Simulation runs on a fixed 60 Hz timestep decoupled from rendering, so AI timers (§4.1,
  §5) behave identically regardless of frame rate.
- Budget for the whole level to be resident at once: the map is a single continuous space
  (§2) with no streaming and no loading screens after the initial load.
