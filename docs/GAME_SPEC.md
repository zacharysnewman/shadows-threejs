# Top-Down Web Horror Game — Game Design & Technical Specification

> **Note on placeholders:** the source text for this spec lost several inline numeric
> values and formulas in transit (they appeared as replacement characters). Those spots
> are marked `TBD` below, with the surrounding context preserved so the intended value
> can be filled in. Nothing has been invented in their place.

## 1. Project Overview & Tech Stack Architecture

The goal of this project is to build a browser-based, top-down horror game utilizing a
2D-to-3D pipeline. Level layouts are designed in mobile/web-friendly 2D map editors and
exported as standard JSON files. A lightweight web engine then parses these JSON files to
generate a 3D environment with real-time lighting, shadows, and light-reactive enemy AI.

### Technical Stack Summary

- **Map Design Tools:** blurymind Tilemap Editor (PWA/Web) or NotTiled (Android/Web).
- **Build Tooling:** Vite (development server & asset bundling).
- **Language & Core Engine:** Modern JavaScript / TypeScript with Three.js (WebGL).
- **Camera Perspective:** Pitched top-down — perspective camera pitched at `TBD`–`TBD`
  degrees down, to ensure floor shadows from upright entities are visible.
- **Pathfinding:** 2D grid-based A\* algorithm (EasyStar.js or custom) layered with simple
  local avoidance.
- **3D Asset Pipeline:** Low-poly `.glb` / `.gltf` modular grid assets (`TBD` grid unit
  standard).
- **Audio:** `THREE.PositionalAudio` for spatial 3D sound, crucial for tracking invisible
  threats.

## 2. Map Pipeline & JSON Data Schema

The game takes place on a single, continuous map. Level maps are created on a 2D tile
grid. Grid coordinates `(x, y)` map directly to 3D world space as `(x, 0, y)`.

### Map Layers Structure

1. **Layer 0 — Terrain/Floor:** dirt, concrete, grass, pathing tiles.
2. **Layer 1 — Static Obstacles:** walls, fences, outer boundaries, buildings (have solid
   box colliders).
3. **Layer 2 — Entities & Interactive Objects:** player spawn point, enemy spawns, props,
   and interactables.

### Example JSON Specification Export (`map.json`)

*The concrete export sample was not included in the source spec — to be supplied from the
chosen editor's actual export. It must express the three layers above plus an entity list
carrying type, grid position, and per-type properties.*

## 3. Lighting, Visibility & Audio System

Lighting is the primary mechanics driver, paired tightly with spatial audio and battery
management.

### 3.1 Flashlight Mechanics & Battery

- **Type:** attached `THREE.SpotLight` bound to the player's position and directed towards
  the mouse cursor / right analog position on the `XZ` plane.
- **Spotlight Properties:** angle `TBD`, penumbra `TBD`, cast shadow enabled, range `TBD`.
- **Battery Drain & Recharge (mechanic):**
  - The flashlight has a finite charge capacity.
  - When turned ON, the battery drains steadily.
  - When turned OFF, the battery auto-recharges over time. This forces the player into
    terrifying moments of vulnerability in the dark.
- **Optimized FOV Detection:**
  - Checks if an enemy target position lies within distance `TBD` and within angle `TBD`.
  - Raycasts to confirm line-of-sight are only performed at a fixed interval
    (e.g. every `TBD`).

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
periodically (e.g. every `TBD`). The Shadow Monster ignores other entity colliders.

### 4.1 Enemy 1: Giant Spider (Dog-Sized)

- **Visual Representation:** dog-sized arachnid mesh + cast shadow. Fully visible in dark
  and light. Emits chittering/scuttling spatial audio.
- **Base Behavior:** wanders, or uses A\* pathfinding to approach the player.
- **Light Reaction Lifecycle:**
  1. **Instant Stun:** the instant the flashlight beam hits the spider's bounding box, its
     velocity drops to `0`.
  2. **Deterrence Timer:** a timer `t` randomized between `TBD` and `TBD` begins.
  3. **Flee Mode:** if illuminated for `t`, the spider enters `Flee` state. It calculates a
     vector directly away from the player, raycasts to find the furthest walkable point on
     that vector, and sets that as its new target for `TBD`, moving at `TBD` speed.
  4. **Interruption:** if light is removed before `t` expires, it resumes approaching after
     a `TBD` delay.

### 4.2 Enemy 2: Shadow Monster

- **Visual Representation:**
  - **Material:** the mesh uses a custom material that is nearly invisible (e.g. a faint
    visual distortion) but casts a stark, hard shadow onto the floor (`castShadow = true`).
  - **Audio:** heavy, slow, spatial footsteps.
- **Light Reaction Lifecycle:**
  1. **Movement Freeze:** when illuminated (by flashlight or environment light), the Shadow
     Monster cannot move.
  2. **Light Interference / Flickering:**
     - Sustained flashlight focus causes the beam intensity to fluctuate (formula `TBD`).
     - `flickerSeverity` ramps from `TBD` to `TBD` over `TBD` seconds of continuous focus.
     - **The "Blink" Movement:** during extreme flickers (when light intensity drops below
       threshold for a few frames), the Shadow Monster breaks its freeze state and takes a
       rapid, lurching step toward the player.
  3. **Environmental Sabotage:** if the Shadow Monster enters the radius of an active
     environmental light, it disables the light source.

### 4.3 The Death State (Fail Condition)

- A simple distance check is run between the player and any hostile entity.
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
   `solid = false` and rotate `TBD` degrees when triggered.
5. **The Exit Gate:** the final objective. Unpowered initially. Requires the player to
   navigate the map, find specific buttons/switches to route power to it, and survive the
   escape.
