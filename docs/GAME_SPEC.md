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
    { "type": "PowerSwitch", "x": 20, "y": 22, "properties": { "targetId": "Area2Lights" } },
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
  `(i % width, ⌊i / width⌋)`.
- `prefab` names a `.glb` in the asset bundle; `null` renders nothing.
- **Walkability derivation:** a tile is walkable for pathfinding when its Layer 0 tile is
  non-zero *and* its Layer 1 tile is not `solid`. Gates flip their tile's walkability at
  runtime (§6). The resulting boolean grid is the A\* input and is rebuilt on any
  walkability change.

### Entity Type Reference

Every `type` the loader accepts, with its `properties` contract. Unknown types are logged
and skipped rather than throwing, so a map can be opened by an older build.

| `type` | Properties | Notes |
| --- | --- | --- |
| `PlayerSpawn` | `rotation` (deg) | Exactly one required per map. |
| `Checkpoint` | `id` | Respawn anchor; see §6. |
| `Flashlight` | — | Pick-up. |
| `Note` | `noteId` | Key into `notes.json`; see §6. |
| `PowerSwitch` | `targetId` | Names a light group or gate. |
| `EnvironmentLight` | `groupId`, `radius`, `intensity` | Off until its group is powered. |
| `Gate` | `id`, `targetId`, `locked` | Rotates open when triggered. |
| `ExitGate` | `id`, `locked`, `requiredSwitches` | Win objective. |
| `SpiderEnemy` | — | Spawns at tile centre. |
| `ShadowMonster` | — | Spawns at tile centre. |

Multiple `EnvironmentLight` entities may share a `groupId`; a `PowerSwitch` toggles the
whole group at once. Entity `x`/`y` are grid coordinates and are converted to world space
by the mapping above, offset to the tile centre.

## 3. Player Controller, Camera & Interaction

### 3.1 Movement

- Top-down twin-stick control: keyboard `WASD` / arrows or left analog stick for movement,
  mouse position or right analog for aim (§4.1). The two are independent — the player can
  back away while keeping the beam on a threat.
- Walk speed 3.0 m/s, with acceleration/deceleration smoothed over 0.1 s to avoid snapping.
- The player is a 0.4 m radius capsule resolved against Layer 1 colliders by sliding along
  contact normals, so grazing a wall does not halt movement.
- There is no sprint, jump, or crouch. Distance from a threat is bought with light and
  route choice, not speed.

### 3.2 Camera Rig

- Perspective camera, 50° vertical FOV, pitched per §1, positioned 14 m above and behind
  the player along the pitch vector.
- Follows the player with critically damped smoothing (≈0.15 s time constant); no rotation
  — the map's north stays screen-up so learned routes stay legible in the dark.
- The rig clamps to map bounds so the camera never frames off-map void.

### 3.3 Interaction

- A single context action (`E` / gamepad `A` / on-screen tap target) acts on the nearest
  interactable within 1.5 m and within ±90° of the player's aim.
- When such a target exists, a prompt appears above it. Only one target is ever prompted —
  the nearest wins — so cluttered tiles cannot produce ambiguous input.
- Interaction is disabled while a UI modal (§6) or the death overlay (§5.3) is up.

## 4. Lighting, Visibility & Audio System

Lighting is the primary mechanics driver, paired tightly with spatial audio and battery
management.

### 4.1 Flashlight Mechanics & Battery

- **Type:** attached `THREE.SpotLight` bound to the player's position and directed towards
  the mouse cursor / right analog position on the X/Z plane.
- **Spotlight Properties:** angle ≈45°, penumbra 0.3, cast shadow enabled, range 12 m.
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

### 4.2 Environmental Lighting (Dynamic Sabotage)

- Turning on power switches activates environmental lights (e.g. overhead streetlamps or
  facility lights), addressed in groups by `groupId` (§2).
- **Properties:** each light is a `THREE.PointLight` at 4 m height with a default 6 m
  radius and per-entity `intensity` override. Only environmental lights within the camera
  frustum cast shadows, and at most two do so at once (§7).
- These lights act as temporary safe zones. The effect is per-enemy, not generic: a spider
  inside the radius is repelled and runs its flee lifecycle (§5.1); a Shadow Monster inside
  it is frozen (§5.2). Illumination from an environmental light counts as "lit" for both,
  identically to the flashlight beam.
- **Sabotage Mechanic:** the Shadow Monster can interact with environmental lights, turning
  them off or breaking them to remove safe zones, dynamically altering the safe paths
  through the map.
- **Sabotage semantics:** a sabotaged light is destroyed, not merely switched off — its
  group's `PowerSwitch` no longer restores it, and the safe zone is gone for the rest of
  the run. This makes lit territory a depleting resource and prevents the player from
  farming one lamp indefinitely. A 1.0 s wind-up plays before the light dies, giving the
  player a window to illuminate the monster and interrupt it.

### 4.3 Audio Core

- Implement `THREE.AudioListener` attached to the camera/player.
- All entities utilize `THREE.PositionalAudio` with a defined rolloff/reference distance so
  the player can audibly locate unseen threats. Default `linear` distance model,
  `refDistance` 2 m, `maxDistance` 25 m, `rolloffFactor` 1.0.
- The Shadow Monster's footsteps use `refDistance` 4 m and `maxDistance` 35 m — audible
  further out than anything else on the map, because hearing is the only way to track it
  before it is close enough to cast a readable shadow.
- Browser autoplay policy requires a user gesture before audio starts; the title screen's
  first input resumes the `AudioContext`.

## 5. Enemy Design & AI Specification

Both enemies rely on a base A\* pathfinding logic that updates their target paths
periodically (e.g. every 500 ms). The Shadow Monster ignores other entity colliders.

Movement speeds, all in m/s, tuned against the player's 3.0 m/s (§3.1):

| State | Spider | Shadow Monster |
| --- | --- | --- |
| Wander / idle | 1.2 | 1.4 |
| Pursuing player | 2.4 | 1.8 |
| Fleeing | 3.6 (1.5× pursue) | — |

Neither enemy outruns the player at a sprint they do not have: the spider is faster only
while fleeing, and the Shadow Monster is always slower, so it threatens by never stopping
and by taking routes the player cannot.

### 5.1 Enemy 1: Giant Spider (Dog-Sized)

- **Visual Representation:** dog-sized arachnid mesh + cast shadow. Fully visible in dark
  and light. Emits chittering/scuttling spatial audio.
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

### 5.2 Enemy 2: Shadow Monster

- **Visual Representation:**
  - **Material:** the mesh uses a custom material that is nearly invisible (e.g. a faint
    visual distortion) but casts a stark, hard shadow onto the floor (`castShadow = true`).
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
  3. **Environmental Sabotage:** if the Shadow Monster enters the radius of an active
     environmental light, it disables the light source.

### 5.3 The Death State (Fail Condition)

- A simple X/Z distance check is run between the player and any hostile entity.
- If `distance(player, enemy) < 1.0m` (radius overlap):
  - Input is disabled.
  - A full-screen jump-scare UI element (CSS/HTML overlay) triggers, holding for 1.5 s.
  - Scene reloads to the last checkpoint or level start (§6).
- The check runs against the player's 0.4 m capsule; the 1.0 m threshold means contact is
  lethal slightly before the meshes visibly touch, which reads as being grabbed.

## 6. Items & Interactivity Specification

1. **Flashlight Prop:** item pick-up on grid. Equips the player's primary light source.
2. **Note Props:** pick-up or readable triggers. Display UI modal overlay containing
   lore/clues. Body text lives in a separate `notes.json` keyed by `noteId`, not in the
   map file, so writing and level design stay independent. Opening a note pauses
   simulation; the world does not advance while the player is reading.
3. **Power Switches / Buttons:** interactive objects used to restore power to sections or
   open access points. A switch toggles every entity sharing its `targetId` — a light
   group, a gate, or the exit's power routing. Switches latch on and cannot be switched
   back off; progress through the map is monotonic, and the only thing that removes a
   safe zone is sabotage (§4.2).
4. **Fences & Gates:** solid obstacle prefabs. Gates transition from `solid = true` to
   `solid = false` and rotate 90° when triggered.
5. **The Exit Gate:** the final objective. Unpowered initially. Requires the player to
   navigate the map, find specific buttons/switches to route power to it, and survive the
   escape. It unlocks once `requiredSwitches` distinct switches targeting it have latched;
   a HUD counter shows how many remain so the objective never becomes a hunt for an
   unmarked last switch.
6. **Checkpoints:** invisible respawn anchors placed on the grid. Passing within 1.5 m
   activates one and records the player's position along with world state — which switches
   have latched, which lights have been sabotaged, which notes have been read. Death (§5.3)
   restores that snapshot, not a fresh map: sabotage survives death, so a bad run leaves
   the map permanently darker and there is no value in dying deliberately to reset it.
   Enemies respawn at their map-defined positions.

### Victory Condition

Reaching the unlocked exit gate ends the run: input is disabled, a victory overlay
displays elapsed time, notes found, and lights lost to sabotage, and the player may
restart from the level start. Escaping with most of the map's lights destroyed is a worse
score than escaping with them intact, which rewards interrupting sabotage (§4.2) rather
than only running.

## 7. Rendering & Performance Targets

Shadows are the core mechanic rather than an effect, so the shadow budget is a design
constraint and not a polish-phase concern.

- Target 60 fps on mid-range desktop hardware, 30 fps floor on recent mobile. The game is
  playable on touch, but the design target is desktop with mouse aim.
- Exactly one shadow-casting `SpotLight` (the flashlight) plus at most two shadow-casting
  environmental lights at a time, chosen each frame by proximity to the camera. Remaining
  environmental lights illuminate without casting.
- Shadow map 2048×2048 for the flashlight, 1024×1024 for environmental lights; PCF soft
  shadows; shadow camera near/far tightened to the light's range to keep depth precision.
- Static Layer 0/1 geometry is merged or instanced per prefab at load time — a 50×50 map is
  2,500 floor tiles and must not be 2,500 draw calls.
- Simulation runs on a fixed 60 Hz timestep decoupled from rendering, so AI timers (§4.1,
  §5) behave identically regardless of frame rate.
- Budget for the whole level to be resident at once: the map is a single continuous space
  (§2) with no streaming and no loading screens after the initial load.
