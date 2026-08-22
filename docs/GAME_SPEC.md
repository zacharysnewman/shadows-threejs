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

## 3. Lighting, Visibility & Audio System

Lighting is the primary mechanics driver, paired tightly with spatial audio and battery
management.

### 3.1 Flashlight Mechanics & Battery

- **Type:** attached `THREE.SpotLight` bound to the player's position and directed towards
  the mouse cursor / right analog position on the X/Z plane.
- **Spotlight Properties:** angle ≈45°, penumbra 0.3, cast shadow enabled, range 12 m.
- **Battery Drain & Recharge (mechanic):**
  - The flashlight has a finite charge capacity.
  - When turned ON, the battery drains steadily.
  - When turned OFF, the battery auto-recharges over time. This forces the player into
    terrifying moments of vulnerability in the dark.
- **Optimized FOV Detection:**
  - Checks if an enemy target position `P_e` lies within distance `d ≤ range` and within
    angle `θ ≤ spotlightAngle / 2`.
  - Raycasts to confirm line-of-sight are only performed at a fixed interval
    (e.g. every 100 ms / 10 Hz).

### 3.2 Environmental Lighting (Dynamic Sabotage)

- Turning on power switches activates environmental lights (e.g. overhead streetlamps or
  facility lights).
- These lights act as temporary safe zones, freezing or repelling enemies within their
  radius.
- **Sabotage Mechanic:** the Shadow Monster can interact with environmental lights, turning
  them off or breaking them to remove safe zones, dynamically altering the safe paths
  through the map.

### 3.3 Audio Core

- Implement `THREE.AudioListener` attached to the camera/player.
- All entities utilize `THREE.PositionalAudio` with a defined rolloff/reference distance so
  the player can audibly locate unseen threats.

## 4. Enemy Design & AI Specification

Both enemies rely on a base A\* pathfinding logic that updates their target paths
periodically (e.g. every 500 ms). The Shadow Monster ignores other entity colliders.

### 4.1 Enemy 1: Giant Spider (Dog-Sized)

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

### 4.2 Enemy 2: Shadow Monster

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
       rapid, lurching step toward the player.
  3. **Environmental Sabotage:** if the Shadow Monster enters the radius of an active
     environmental light, it disables the light source.

### 4.3 The Death State (Fail Condition)

- A simple X/Z distance check is run between the player and any hostile entity.
- If `distance(player, enemy) < 1.0m` (radius overlap):
  - Input is disabled.
  - A full-screen jump-scare UI element (CSS/HTML overlay) triggers.
  - Scene reloads to the last checkpoint or level start.

## 5. Items & Interactivity Specification

1. **Flashlight Prop:** item pick-up on grid. Equips the player's primary light source.
2. **Note Props:** pick-up or readable triggers. Display UI modal overlay containing
   lore/clues.
3. **Power Switches / Buttons:** interactive objects used to restore power to sections or
   open access points.
4. **Fences & Gates:** solid obstacle prefabs. Gates transition from `solid = true` to
   `solid = false` and rotate 90° when triggered.
5. **The Exit Gate:** the final objective. Unpowered initially. Requires the player to
   navigate the map, find specific buttons/switches to route power to it, and survive the
   escape.
