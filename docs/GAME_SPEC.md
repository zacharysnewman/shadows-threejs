# Top-Down Web Horror Game — Game Design & Technical Specification

## 1. Project Overview & Tech Stack Architecture

The goal of this project is to build a browser-based, top-down horror game utilizing a
2D-to-3D pipeline. Level layouts are designed in mobile/web-friendly 2D map editors and
exported as standard JSON files. A lightweight web engine then parses these JSON files to
generate a 3D environment with real-time lighting, shadows, and light-reactive enemy AI.

### Technical Stack Summary

- **Map Design Tools:** a tile editor built into this project and served from the same site (§9).
- **Build Tooling:** Vite (development server & asset bundling).
- **Language & Core Engine:** Modern JavaScript / TypeScript with Three.js (WebGL).
- **Camera Perspective:** Pitched top-down — perspective camera pitched at ≈70°–75° down,
  to ensure floor shadows from upright entities are visible.
- **Pathfinding:** 2D grid-based A\* algorithm (EasyStar.js or custom) layered with simple
  local avoidance.
- **3D Asset Pipeline:** Low-poly `.glb` / `.gltf` modular grid assets (2 m × 2 m grid unit
  standard).

  A kit authored by somebody else will not match that standard exactly, and editing the
  files to make it would mean re-editing them every time the kit updates. So prefabs are
  **normalised on load** instead, against one convention: a prefab sits *on* the ground and
  is lined up with its tile there — upright geometry starts at `y = 0` and floor geometry
  ends there, so a floor tile's walkable surface is the ground plane rather than something a
  few centimetres above it.

  **The fit is to the ground the model stands on, not to its silhouette.** Both axes of it,
  and both matter as soon as a model is not a box:

  - It is lined up on its **footing** — the half-metre slab at the height it meets the
    ground — rather than on the middle of its bounding box. A model wider up top than at the
    bottom is centred by its top otherwise: a tree centred on its bounding box is centred on
    its canopy, and a canopy that leans takes the trunk with it, off its tile and onto a
    neighbour's.
  - It is sat on the height it *makes contact* at, which is normally its lowest point but is
    not always. A stray vertex below the model's real base — a collapsed root tip, a pivot
    left behind — lifts the whole thing off the floor, and any scaling lifts it further.

  That is a placement rule and applies to every prefab. Three things it cannot infer are
  authored per prefab instead: which node to take, when a module is bundled inside a larger
  one (a door inside its wall); a height to scale to, when a module's own is wrong for this
  game (a 4 m wall where the level wants 3 m); and a contact height, where the model's own
  extreme is not the surface it meets the ground on — the tree above, and a dirt tile whose
  scattered stones stand proud of the ground the player walks on. All three are statements
  about the file, and none is something a loader should guess.

  **A prefab may be more than one material.** Most are one — a wall is brick and nothing
  else — but a model can be several things at once, and a tree is a brown trunk and green
  leaves. The loader keeps every distinct material and merges the geometry into a group per
  material, rather than picking one and rendering the whole model in it. A single-material
  prefab stays exactly one draw call, which is what §7's instancing budget is counted in;
  a two-material prefab costs two, and that is the price of the model being two things.
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

### Three ways a map says "put a thing here"

A tile is 2 m. Most of the world is that size or repeats at it, but a goal is 3 m wide, a
net is over ten, and neither faces the same way twice. Rather than teach tiles about size
and rotation, the format has three tiers, and only the middle one is about geometry bigger
than a tile:

- **A tile**, for anything that is one tile and repeats: floor, wall, fence, a crate. Solid
  tiles merge into the largest rectangles they can (§2, colliders), which is what keeps a
  twenty-tile wall run cheap. Tiles carry no rotation in the map data and will not get one —
  an authored angle per tile would break the merge, and everything that wants an angle wants
  size too.

  What a tile does get is a **facing derived from its neighbours**, for the modules that are
  a *length* of something. A wall, a fence and a gate are all modelled as a 2 m run across
  one axis with only enough depth to be solid; placed unturned, a north–south run of them is
  a row of disconnected rungs rather than a barrier. So a module whose footing is longer than
  it is deep is turned a quarter when its solid neighbours are north and south and not east
  and west. It is presentation and nothing more: the tile is solid across its whole square
  whichever way the model faces, so the collider merge, the walkability grid and the map
  format all see exactly what they saw before.
- **A `Landmark` entity**, for one model of any size at any angle. Entities already carry
  `rotation` and already sit at continuous world positions rather than on the grid, which
  is exactly what a 5.35-tile net at 40° needs and what a tile could never express. Its
  footprint comes from the prefab's own bounds, so the collision follows the art.
- **A stamp**, for an arrangement of the two: a soccer field is pitch tiles, two goals and
  a net. Stamps are an *authoring* idea and live in the editor (§9.4). They expand into
  ordinary tiles and entities when placed, and a map file has no trace of them.

That last split is load-bearing. A stamp that survived into the map format would be a
container, and every system that reads a map would have to learn about containers — the
walkability derivation, pathfinding, the reachability audit, the validator, the editor's
own undo. Expanding at author time costs the editor a feature and costs the game nothing.

### Landmarks

**A landmark is something you navigate by.** In a map where the beam reaches 12 m and fog
takes the rest (§4), one dark yard looks like the next, and a player who cannot tell where
they have already been is not exploring, they are lost. A landmark is a distinctive piece
of geometry placed so that catching it in the beam answers "where am I".

That is its whole job. Landmarks have no behaviour: nothing is triggered by reaching one,
they are not objectives, and they hold nothing. What they change is whether the map is
legible, which is a level-design property rather than a mechanic.

- **Big enough to be recognised from a beam's width.** A landmark that needs to be walked
  around to identify is not doing the job — the player is meant to sweep past it and know.
- **Distinct from each other.** Two landmarks of the same prefab in one region tell the
  player nothing they did not already know; the second one is decoration.

  Decoration is allowed, and a `Landmark` entity is how a map says "a model here" whether or
  not the model is doing this job. A stand of trees scattered across a yard is scenery: it
  blocks like anything else, it is worth placing, and no one of them answers "where am I".
  What the rules in this section govern is the claim that something is a *landmark* — which
  is a level-design property of how a model is placed, not a property of the entity type.
- **Placed off routes, not on them.** A landmark is a thing to *see*, and one standing in a
  corridor is a thing to walk around. Its footprint blocks the player like any other solid
  geometry (below), so this is a real cost and not a preference.
- **Not a substitute for a route.** The map still has to be navigable in the dark by its
  layout; landmarks make a legible map memorable, not an illegible map passable.

**Footprint.** A landmark occupies the ground its model occupies. The loader takes the
prefab's own bounding box — real metres, as authored — rotates it, and contributes it as a
collider like any solid tile; the walkability grid follows from that, so enemies path
around a landmark exactly as they path around a wall. Deriving from the mesh rather than
from an authored number means a swapped model moves its own collision, which matters
because the alternative is a number that is right until the art changes and silently wrong
afterwards.

Some models lie, and the spec allows saying so: a basketball hoop's backboard overhangs
ground a player can walk under, and a footprint taken from its bounds would block a square
of empty yard. A prefab may declare an override footprint, in the same place the other two
things prefab normalisation cannot infer already live (§1). The override is the exception
and needs a reason; the derived box is the default.

**A landmark can be taller than the camera, and the tallest ones should be.** The camera
eye sits `distance × sin(pitch)` above the ground — 13.3 m at §3.2's values — and is
pitched down, so nothing above that plane is ever in frame. A tree scaled so its canopy
starts above it gives the player a trunk rising out of the top of the world and no leaves
at all: you are under a canopy you can never see, which is what being under a tree at night
is like from below, and it costs nothing to draw. Scaling for this is a vertical scale only
(§1's `fitHeight`), so the canopy climbs without the trunk thickening.

**Height is not footprint.** A landmark's collider is its ground area, whatever its height.
A 4 m hoop and a 1 m bench block the same way, and both fade when they come between the
camera and the player (§3.2's occluder rule) — which a tall landmark will exercise harder
than anything else on the map, since it is the tallest geometry the game places.

### Beyond the boundary

**Every map is surrounded by trees it is not made of.** The playable area ends at the map
rectangle; the *world* does not, and a band of small trees fills the ground outside it in
every direction.

This exists so the camera can be locked to the player (§3.2). A camera that always centres
the player will frame ground beyond the boundary whenever they walk near one, and the
alternative to filling that ground is sliding the camera off the player — which changes
what a cursor position means exactly where a cornered player can least afford it. Scenery
outside the map is the cheaper answer by a long way: it costs one instanced draw and buys
back the camera rule the whole of aiming rests on.

- **Ground first, trees second.** There is ground out there, and it is what actually covers
  the void; the trees stand on it for depth and to stop the eye. Foliage alone would have to
  be *opaque* to hide anything, which is a great many instances of a detailed model for a
  part of the world nobody can reach (§7). It is lit by §4's night ambient exactly as the
  map's own floor is — painting it the fog's colour would make it the colour of the void it
  is covering, since §7 colours the fog to the sky and draws the background in it too.
- **Small trees, not the ones inside.** A map's own wood is planted from the tall landmark
  tree, whose canopy clears the camera entirely and is never drawn (*Woods inside the map*)
  — right where the floor underneath has to stay visible, and useless where covering ground
  is the whole job. The surround's trees are a few metres tall, so the crown is well inside
  the frame and what the player sees past the boundary is canopy rather than a row of trunks
  standing in void.
- **Packed at the front, thinned behind.** Several trees per tile of ground for the first
  few metres, crowns overlapping deep enough to be opaque; a lattice several times coarser
  behind that. A forest edge is solid, and anything sparser reads as a few trees standing in
  a field, which says "the map stops here" as loudly as the void did — but only the first
  few metres are ever *read* that way. The map's own edge holds the player well off the
  boundary, and past that the fog and the absence of any light out there (§4) leave a tree
  as a slightly different shade of dark. Spread evenly over the whole depth, the same number
  of trees leaves the one strip anybody looks at looking thin.
- **The tree is generated, not a kit prefab.** Density is what the boundary needs and detail
  is what it does not: nobody can reach this ground, and at a few metres tall under §4's
  night ambient it is a silhouette. A tree built from a trunk and two faceted crowns is
  around fifty triangles against a kit tree's three thousand, which is the difference
  between a band of thousands and a band nobody can afford (§7). It also scales *uniformly*,
  where a prefab's `fitHeight` scales height alone — so a short surround tree is a small
  tree rather than a full-width canopy squashed flat.

  It is also available to a map as the `tree_small` prefab, for a wood that wants a crown
  the player can see rather than one above the camera.
- **Scenery and nothing else.** They are outside the map, so they are outside walkability,
  outside the collider set, outside the audit, and outside every light's reach. They cast
  no shadows: a shadow on the ground means a light is on something (§4), and nothing out
  there is ever lit.
- **As deep as the camera can frame, and no deeper.** The band extends past the boundary by
  the reach of §3.2's ground footprint, because that is exactly the ground a player standing
  on the edge tile can see; the margin on top of it is slack for a jittered outer tree
  pulling inwards, not a guess at anything. Making it deeper builds trees no camera can
  frame; making it shallower puts the void back. The *density* is what falls off with depth,
  not the depth itself.
- **Scattered, not planted in rows.** Positions are jittered off a grid, from the run's
  seed (Cross-Cutting: determinism), so a replay grows the same forest. A visible lattice
  at the edge of every map would read as the boundary it is meant to disguise.
- **A tree's spin comes from where it stands.** Every tree is turned about its own axis by
  a hash of its position, not by the next number out of the run's seed. A tree is a thing in
  a place, and its facing is a property of the place: it does not change because the band was
  walked in a different order, or because something earlier in the run drew one more random
  number. The same rule holds for a wood planted inside the map, where the rotation is
  written into the map file (*Woods inside the map*).

The surround is generated rather than authored. It is not in the map file, the editor does
not place it, and a map that says nothing about it still gets one — it is a property of
*being a map*, not a decision a level makes.

### Woods inside the map

A level's ground cover is trees, and what they have to do is the opposite of what the
surround's do: cover nothing. §3.2 looks down at 72° from 14 m, and the floor is where the
player, the enemies and every shadow are. **A crown below that camera roofs the ground
behind it**, and a wood the player cannot see through is a wood they cannot be chased
through.

So a wood is planted from the *tall* landmark tree — 26 m, canopy well above the eye and
never drawn (*Landmarks*). What is left in frame is trunks: a constant vertical presence
that breaks every sightline and casts every shadow, standing on ground that stays completely
readable. A tree short enough to see whole is the one shape that cannot do this job.

Spacing is what makes it a wood rather than a wall. Close enough that no sightline runs the
width of the map; open enough to walk and be chased through. **One clear tile between trunks
is the limit**, because a trunk fills most of its tile and trees on touching tiles are a wall
— a wood that walls itself off strands ground, which the audit reports (§2).

Each tree carries its own `rotation`, hashed from its tile so the same map always grows the
same wood — the same rule as the surround's spin, for the same reason.

What a wood replaces is worth stating: it is the cover, the sight-line breaks and the
shadow-casters that interior walls used to be. A level made of rooms is not more interesting
than a level made of trees; it is only more obviously authored.

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
| `Note` | `noteId` (required), `facing` (deg, default `0`) | Key into `notes.json`; see §6. Mounts on a solid neighbour (§9.2). |
| `PowerSwitch` | `targetId` (required), `mode` (default `toggle`), `facing` (deg, default `0`) | Names a light group or gate; `mode` is `toggle` or `latch` (§6). Mounts on a solid neighbour (§9.2). |
| `EnvironmentLight` | `groupId` (required), `radius` (default `6` m), `intensity` (default `1.0`) | Off until its group is powered. |
| `Gate` | `id`, `targetId` (both required), `locked` (default `true`) | Rotates open when triggered. |
| `ExitGate` | `id` (required), `locked` (default `true`), `requiredSwitches` (default `3`) | Win objective. |
| `Landmark` | `prefab` (required), `rotation` (deg, default `0`) | Decoration you navigate by; any size, any angle. Footprint from the prefab's bounds. See Landmarks above. |
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

A `Landmark` naming a `prefab` that does not exist is logged and skipped rather than
standing a placeholder box in the yard. This is the one place a missing prefab is *not*
worth a placeholder: everywhere else a placeholder keeps a map legible while the art lands,
but a landmark whose whole purpose is to be recognisable is worse as an anonymous grey box
than as nothing at all — it would be a distinctive thing that is not distinctive, which is
the one failure the feature cannot survive.

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
  It is the number every speed in §5 and every distance in §4 is tuned against, so it moves
  with them or not at all.
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

**The player's body walks.** The legs swing and the body rises and falls in time with the
ground actually covered: standing still the gait stops, and the sprint is the same gait
hurried rather than a second animation. The same rule §5.1 states for the spider, and what
makes a sprint look like one without asking the art for a second clip.

Art that ships without a skeleton gets one derived from its mesh — a hip, a leg either side,
and an arm either side — with vertices shared through a band at the waist and another at the
shoulder so the joins bend rather than shear. It is an approximation, and the thing that
makes it good enough is §3.2's camera: from 14 m up a limb is a few pixels and only the
cadence reads. A model too flat or too empty to be a standing figure is left unrigged and
static, and one with nothing beyond the shoulder line is given no arms rather than two made
up, because a bad rig is worse than none. An authored skeleton, when the art has one, is used
instead and this is dead code.

**The arms carry the torch, in both hands.** They reach for the point §4.1 emits the beam
from, solved for rather than posed: the hips rise and fall twice a stride, and an arm at a
fixed rotation would swing the hand through several centimetres a step while the light it is
supposed to be holding sat perfectly still. Two hands rather than one because it costs
nothing and settles a question the mesh cannot answer — a bounding box knows which side of
centre a vertex is on but not which side is the model's right, so a one-handed carry would be
picking a hand by guess. With no torch in hand (§6.1) the arms simply hang.

An arm that cannot reach straightens along the line to the target and stops there; it never
stretches. The kit's arms are about half a metre on a 1.8 m body and §4.1's mount is far
enough forward that this is the ordinary case rather than the edge case, which is why §4.1
draws the torch from the hand out to the beam rather than parenting it to either.

- Hips at **48%** of the model's height, blended over a band **12%** of it; feet **12%** of
  the model's width either side of centre.
- An arm is whatever sits above the hips and more than **33%** of the model's half-width off
  its centreline, blended over a band **12%** of the half-width — a standing figure's arms
  are the outermost thing above its waist, and that is the only thing in a bounding box that
  separates a sleeve from a ribcage. The shoulder and the hand are the centroids of the
  innermost and outermost **15%** of that run, rather than single vertices: one vertex is a
  fingertip or a shoulder pad, and either puts the joint centimetres out on an arm this
  short. The elbow is halfway between them, blended over **30%** of the arm's length, and it
  is pushed **80%** towards straight down and **20%** straight out from the body — a target
  and two bone lengths leave it free anywhere on a circle, and nothing but this decides
  which part of that circle it sits on.
- Arms that are holding nothing hang **14°** out from vertical.
- One stride is **0.9 s**, the legs swinging **±22°** and the body lifting **1.2%** of its
  height twice per stride — once over each foot.
- The clip is authored at the walk speed, so it plays at ground speed ÷ **3.0 m/s** and
  stops when the player does.
- Every value here is a fraction of the model's own size rather than a length, so the same
  numbers suit a character of any height.

**A character stands on the point it occupies.** Nothing in a model file says where the feet
are, so a loaded character is grounded on the floor and centred horizontally on its own
bounds. Kits are authored around whatever origin their artist left — the player's comes out
of a bundle laid along an axis, one and a half metres from its own origin — and a body
standing beside the collider that represents it walks through walls the player stopped at
and holds its flashlight out of empty air.

**On touch**, the same two independent controls are floating sticks: the left half of the
screen moves, the right half aims, and each anchors wherever the thumb lands rather than at
a fixed spot on the glass — the only arrangement that survives different hand sizes and both
orientations. Sprint is the movement stick pushed to its rim, so it costs no second thumb.

Every action the player *taps* — the context action (§3.3) and the flashlight (§4.1) — has
an on-screen button, stacked in the bottom-right corner. This is not optional chrome: an
action bound only to a key and a gamepad button does not exist on a phone, and the game is
meant to be playable there (§7). Held actions are the exception, and sprint is the only one:
they belong on the stick the thumb is already on.

### 3.2 Camera Rig

- Perspective camera, 50° vertical FOV, pitched per §1, positioned 14 m above and behind
  the player along the pitch vector.
- Follows the player with critically damped smoothing (≈0.15 s time constant); no rotation
  — the map's north stays screen-up so learned routes stay legible in the dark.
- **The rig is locked to the player.** It looks at where they are and nothing pulls it off
  them — not a map edge, not a corner. The player therefore sits at the same point on the
  screen everywhere on the map, which is the whole reason: with mouse aim, the vector from
  the player to the cursor *is* the vector from the player to their aim, and a camera that
  slides off-centre near a boundary silently changes what a given cursor position means, in
  exactly the places a player is most likely to be cornered.
- **Nothing frames off-map void, because there is none to frame.** The map is surrounded
  beyond its boundary by scenery the player cannot reach (§2), sized against the frustum's
  ground footprint — which under a pitched camera is a trapezoid, wider at its far edge than
  it is where the player stands. Answering the void outside the map rather than by moving
  the camera is what lets the camera do only the half of the job it was ever good at.
- Static geometry between the camera and the player must not hide the player. At a 70°–75°
  pitch a full-height wall on the camera side of the player does exactly that, and once the
  map is dark (§4) the occluder does not even read as a wall — it is a black rectangle
  covering the player and their beam. Geometry inside a cylinder between the player and the
  camera is therefore faded out. Only the *visible surface* fades: the occluder still blocks
  light and still casts its shadow, so the fade cannot be used to see into a room the player
  could not otherwise see into. It is a way to see the player, not a way to see past walls.

### 3.3 Interaction

- A single context action (`E` / gamepad `A` / on-screen tap target) acts on the nearest
  interactable within 1.5 m and within ±90° of the player's aim. Nearest is measured from
  the player, not from the aim axis: a target dead ahead and one just inside the cone are
  chosen between by distance, because the player's sense of which thing they are standing
  next to is a distance sense.
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
- **Feedback:** no numeric bar or hearts. Damage state reads through a red vignette whose
  strength is `1 − health`, so it is absent at full and total at zero; an audible heartbeat
  below 0.34, running from 1.0 Hz at the threshold to 2.2 Hz at zero; and desaturation
  below 0.17, where the image falls to 40% of its colour. The player should feel the state
  without reading a HUD element, and because all three are functions of the current value
  rather than of a damage event, they fade on their own as regeneration proceeds.

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

**The ambient and the moon are one setting.** They are the whole of what lights the map with
the beam off, and how dark the night is means the pair of them, not either one. So they are
tuned together and changed together, at a fixed ratio. The moon is the larger half of what
the ground is actually lit by: dropping the ambient alone leaves the floor tiles readable at
*zero* ambient, which is the ceiling above (§4) quietly broken while the number that names it
says otherwise.

**Shadows exist only where a directed light does.** The flashlight casts and the
environmental lamps cast; the ambient and the moon do not. A shadow on the ground is
therefore information in itself — something is being lit — and it is what the Shadow Monster
is built on (§5.2).

**A beam is visible in the air, and only where it is casting.** The haze inside a cone is
drawn, so a torch is a beam reaching a pool rather than a pool that appears a metre away
from the hand holding it. It is the strongest thing tying the light to the player, and under
§3.2's camera — which sees the cone side-on, from above and behind — it is most of what
makes the beam read as a beam.

It is presentation and nothing else. The illumination query (§4.1) never sees it, no
light-reactive enemy responds to it, and no amount of it makes a dark corner readable: it
adds a little glow to the air along a beam that was already there.

Two rules keep it honest, and both are the same rule §4 states about shadows:

- **The visible beam is cut by exactly what cuts the shadows.** An obstacle standing in the
  cone takes the haze behind it as well as the light on the floor, so the airborne beam
  ends at the wall it is pointed at rather than glowing on the far side. This applies to the
  Shadow Monster too, and gains it a tell rather than costing it one: a monster in the beam
  is a wedge of missing haze in the air as well as a shadow on the floor, which is the same
  shadow, seen twice. It is still nothing at all outside a light (§5.2).
- **Only a shadow-casting light has one.** Cutting the haze needs the depth the light
  already drew for its shadows, and a light with no shadow map has nothing to cut it with —
  an uncut cone is a beam that shines through walls. So the visible beam is spent on exactly
  the lights §7 gives shadows to: the flashlight always, and whichever two lamps hold §7's
  environmental slots. A lamp's arrives and leaves over a fraction of a second as those
  slots change hands, so walking across a room does not flash cones on and off across it.

The beam dims with the light it belongs to: the battery's falloff (§4.1), §5.2's
interference, a lamp's flicker (§4.2). A light emitting nothing has no haze in it either,
which is the same rule §4.1's query is written on.

How thick the air is: **0.05** per metre of lit beam for the flashlight, **0.018** for a
lamp, and a lamp's fades in and out over **0.4 s** as §7's slots change hands. The lamp's is
the thinner of the two and by more than the numbers suggest, because a lamp is four metres
straight up over a six-metre pool and the camera looks almost straight down its cone: what
would be a shaft seen side-on is a wash seen end-on, and a wash over every working light
turns a powered room into fog. §4's dark is the point, and the torch is what the game is
played by.

The ambient stays *under* the flashlight, and that ceiling is what keeps the beam a
mechanic: a silhouette in the gloom cannot be identified, the floor cannot be read for a
route, and a note, a switch or a pick-up cannot be found without light on it. The beam is
for knowing what something is; the ambient is only for knowing that something is there.

**The player's own silhouette stays readable.** The character is legible in the dark as a
dim shape. This is a rendering allowance, not a light source — it illuminates nothing, lights
no surface, and no light-reactive enemy responds to it. It applies to whatever body the
player has, art or placeholder: a kit's own colours go to black under §4's ambient like
anything else, so the allowance is a property of *being the player*, not of a particular
mesh.

**And it is a fraction of the body's own colours, not a colour of its own.** A flat lift is
the same shade wherever it lands, and at §4's ambient it is most of what an unlit body is:
a red shirt, bare arms and black shorts all come out the one pale grey, and the player reads
as a ghost rather than as a person. Lifting each surface by a fraction of *its own* colour is
what a very dim light falling on them would do — which is what the allowance is pretending to
be — so the body keeps its colours and its internal contrast, and internal contrast is most
of what makes a shape read as a figure at all. The lift is **9%** of each surface's colour.

**The player's body faces their aim, never their movement.** §3.1 makes the two
independent, and that independence is the game's signature move — backing away with the beam
held on a spider. A body that turned to face where it was walking would show the player
their own back at exactly that moment, and would quietly undo the mechanic §3.1 spends the
sprint's aim lock to protect. So the body strafes and backpedals, and the one time it moves
the way it faces is a sprint, which is what makes a sprint look different. A player who cannot see which of the
shapes on screen is theirs is not playing a dark game, they are playing a broken one.

### 4.1 Flashlight Mechanics & Battery

- **Type:** attached `THREE.SpotLight` bound to the player's position and directed along the
  player's aim on the X/Z plane — the mouse cursor or right analog position, except while
  sprinting, when aim is the direction of travel (§3.1).
- **Spotlight Properties:** angle ≈45° (the full cone), penumbra 0.3, cast shadow enabled,
  range 12 m along the ground.
- **Mounting:** carried at chest height (1.6 m) and emitted 0.55 m along the aim, just clear
  of the player's capsule — a light inside the player's own mesh is shadowed by it, and the
  player's shoulders throw a black wedge across their own beam. The axis is declined so the
  cone's *upper* edge meets the ground at the beam's range, which puts the near edge of the
  lit pool about a metre in front of the player. A beam pointed flat along the aim vector
  spends its upper half on walls and leaves the floor dark around the player, which under
  the pitched camera (§3.2) reads as a hole rather than as a torch.

  **Where the torch is held is five values, and all five are tunable (§8.3):** the height it
  is carried at, how far forward of the player it is emitted, how far to the player's right
  (0 m — centred, which is what the derivation above assumes), a **pitch trim** in degrees
  added to the derived declination, and a **yaw trim** in degrees turning the beam off the
  aim direction. Both trims are 0° by default, so the defaults are exactly the beam
  described above and every departure from it is one somebody chose. Where the torch is held
  and where it points are separate: the yaw trim turns the beam and leaves the origin alone.

  A held light is judged by looking at it — how much of the beam the player's own body eats,
  where the near edge of the pool falls, whether a torch carried off-centre reads as being
  held or as being broken — and there is no arithmetic that settles any of it. Hence knobs
  rather than a pose fixed in code.
- **The torch is a thing in the hand**, not a light with no source: a barrel a few
  centimetres across, never drawn shorter than **12 cm**, with a lens at the far end that the
  beam comes out of. The lens is as bright as the beam it is throwing, so a battery running
  down dims the thing the player is holding as well as the pool on the floor. It casts no
  shadow: a torch that shadowed its own cone would put a black core down the middle of the
  beam and a bite out of the pool, which is a rendering artefact rather than anything anybody
  has seen a torch do.

  **The hand goes to the light; the light never goes to the hand.** Where the beam is
  emitted is settled by the five values above, and by nothing about the body. The arms reach
  for that point (§3.1) and the barrel is drawn from wherever the hand got to out to it — so
  a body whose arms are too short for the reach still holds a torch that meets its own beam,
  no part of the mechanic depends on the proportions of a particular kit, and moving any of
  those five knobs takes the hand with it. Solving it the other way round would hang the beam
  off the walk cycle's bob, which is the mounting rule broken by an animation.
- **Toggle:** `F` / gamepad `X` / the on-screen action button. A toggle is refused outright,
  with no state change, once the battery is flat.
- **Battery Drain (mechanic):**
  - The flashlight has a finite charge capacity, expressed as a 0.0–1.0 charge fraction.
  - When turned ON, the battery drains steadily: 1/600 per second, i.e. **10 minutes of
    continuous light from full**.
  - **It does not recharge.** That charge is the run's entire supply of light, and time
    spent in the dark buys nothing back — it only avoids spending more.
  - At 0.0 the light cuts out and stays out for the rest of the run.
  - Beam intensity is full above 0.25 charge and falls off linearly to 40% at 0.0, so the
    last two and a half minutes are a beam visibly going out rather than one that is fine
    until it is gone.

  A recharging battery makes darkness a wait: stand still, get the light back, carry on. A
  finite one makes it a decision — is this corridor worth part of the ending? — and that
  decision is what §4's dark is for. It also settles the strobe exploit against the Shadow
  Monster's freeze (§5.2) without a lockout rule: blinking the beam to hold the monster
  costs exactly the light it produces, so it buys nothing that holding the beam would not.
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
  never decides, only geometry.
- **A light emitting nothing lights nothing.** Geometry decides *where* the light reaches;
  whether it is on at all is a separate question and it is asked first. A torch that is off,
  a battery that is flat, a lamp that is unpowered or has failed (§4.2), and a beam that is
  out for a blink (§5.2) all light nothing, however well aimed.

  This is what keeps every rule written in terms of light agreeing with what the player can
  see. Reading the *charge* instead would have a spider deterred by a beam that is out and
  the Shadow Monster frozen by darkness, and §5.2's hard rule turns on it exactly: the
  window the monster walks in is a window nothing is lighting it, so there is no shadow to
  give it away and none to suppress.
- **Being in the beam is a different question, and only §5.2 asks it.** The Shadow Monster
  is the one thing that can put the torch out, so "is there light on me" during its own
  blink answers with the darkness it caused. It asks instead whether the player still has
  the torch switched on and still has it pointed here, which is what decides when the blink
  ends.
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
- **There is a lamp to see, not only a pool to stand in.** A post up to the mount height and
  a shade at the top of it, whose head lights with the lamp and guts with it while it
  strains. Neither piece casts a shadow: the light is a point at the top of its own post, so
  a post that cast would put a black bar through the middle of the pool it exists to throw.

  This is what makes an unpowered lamp *visible but off* rather than absent. A lamp with no
  `PowerSwitch` naming its group never lights — that is the mechanic and not a fault, since
  routing power is the thing the player does (§6.3) — but a level whose lamps were invisible
  until powered is a level that looks like it has no lamps in it, and an author placing them
  has nothing to tell them what is missing. The map audit reports it (`group-no-switch`) and
  the editor shows that report while the level is being built (§9).
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
   the same character as the flashlight interference (§5.2) and audibly buzzing. It uses
   that formula unchanged, with `flickerSeverity` ramping 0.1 → 0.95 across the 1.5 s of
   strain, so the lamp is visibly worse the closer it is to going out and the player can
   read how long they have left under it.
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

Neither enemy outruns the player. A walking player is faster than a pursuing spider, and the
Shadow Monster pursues at three fifths of a walk; only a *fleeing* spider (3.6) beats a walk, and
nothing beats a sprint (§3.1). That is deliberate: an enemy that catches a player in a
straight line would make the map a reflex test. They threaten by never stopping, by taking
routes the player cannot, and by the corners and dead ends they force — and by what running
costs. A sprinting player has their light pointed the way they are going (§3.1), which means
whatever they are running from is unlit, unfrozen and undeterred behind them.

**Bodies.** The spider is a 0.25 m radius circle on the X/Z plane, the Shadow Monster
0.55 m, resolved against the same obstacles as the player (§3.1). Neither is stopped by the other:
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

**Light is terrain.** Both enemies route around lit ground, not merely react to it once
they are standing in it. Lit is lit by §4.1's query — the flashlight's cone and any powered
environmental lamp, and *only* while they are actually emitting. An unpowered lamp, a lamp
that has failed (§4.2), a torch switched off or run flat: none of them are terrain, because
none of them are light.

The two enemies pay for it differently, and the difference is the design rather than an
inconsistency to tidy up:

- **A spider will not enter light.** Lit ground is not walkable to it: a route that crosses
  a pool is not a route, and a straight line at the player that crosses one is not a clear
  line. The rule binds a spider that is *not currently lit*. One standing in light is
  stunned or fleeing, and §5.1 owns it completely — the block would otherwise trap a spider
  that a lamp came on over, since it could not cross its own pool to leave.
- **The Shadow Monster only finds it expensive.** A lit tile costs it several times what a
  dark one does, so it takes the dark way round when there is one and walks straight
  through when the detour is long or there is no detour at all. It is never stopped by
  light; §5.2's threat is that it never stops.

**What the asymmetry buys, and why it must not be flattened.** A player standing under a
working lamp cannot be reached by spiders at all. That is intended, and it is not safety:
it is an invitation to the one thing that does not care. The monster walks into the pool,
which freezes it (§5.2 step 1) and starts it degrading the lamp by standing there (§5.2
step 3, §4.2) — so the lamp's flicker becomes the tell that the trade is being collected.
When the lamp fails the spiders come back and the monster is standing next to the player,
unfrozen. Giving both enemies the same rule removes the counter and makes a powered lamp a
place to wait out the game.

**A spider that cannot reach the player flees.** If the player is inside a light, they are
not merely far away, they are unreachable — and a spider circling the edge of a pool it
will not enter reads as a broken pathfinder. So an unlit spider whose target is lit
abandons the hunt on §5.1's terms, taking a flee leg like any other.

The radii and the wander numbers are first values, not tuned ones: they are exactly the
kind of thing the tuning pass (§1, content) is expected to move once the game is playable.

### 5.1 Enemy 1: Giant Spider (Cat-Sized)

- **Visual Representation:** cat-sized arachnid mesh + cast shadow — half a metre across and
  a third of a metre tall, low enough to the ground that it reads as scuttling rather than
  striding. Fully visible in dark and light. Emits chittering/scuttling spatial audio, and stops while it is held still —
  the sound says where a spider is *moving*, so a stunned or recoiling one gives nothing
  away, and a deterred one going quiet in the dark is not the same as a gone one.
- **Animation:** a locomotion cycle and an attack. The locomotion cycle's playback rate is
  driven by the spider's actual speed, so a wandering spider (1.2 m/s), a pursuing one
  (2.4 m/s) and a fleeing one (3.6 m/s) all place their legs on the ground instead of
  skating. The attack animation is authored *to* the strike time in §5.3 — see there.
- **Base Behavior:** wanders, or uses A\* pathfinding to approach the player.
- **Light Reaction Lifecycle:**
  1. **Instant Stun:** the instant the flashlight beam hits the spider's bounding box, its
     velocity drops to `0`. It stops the spider *moving* and nothing else: one already
     within §5.3's contact range still attacks, lit or not.
  2. **Deterrence Timer:** a timer `T_flee` randomized between 1.0 s and 4.0 s begins.
  3. **Flee Mode:** if illuminated for `T_flee`, the spider enters `Flee` state. It
     calculates a vector directly away from the player, raycasts along that vector for the
     furthest walkable point within 18 m, and sets that as its new target for 3 s, moving
     at 1.5× speed. The furthest *dark* point, where the vector offers one: fleeing is what
     ends the illumination, and a leg that stops inside the same pool has not deterred
     anything. It may cross lit ground to get there — a spider already in light is exempt
     from §5's rule against entering it, which is what lets it out of a pool at all. A spider with nowhere to run — the away vector blocked before the
     first step — cowers where it is for the 3 s instead. Light does not re-stun a fleeing
     spider: freezing it again would let a held beam pin it where it started, and the flee
     it just earned would never happen.
  4. **Interruption:** if light is removed before `T_flee` expires, it resumes approaching
     after a 0.2 s delay, and the next beam to catch it rolls a fresh `T_flee`. The timer
     measures *continuous* illumination, so sweeping a beam on and off a spider never
     deters it — holding the beam is what costs it the ground, and the battery is what
     that costs the player (§4.1).
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
  - **It is never both moving and visible. This is a hard rule, not a consequence.** It is
    invisible unless a light is on it, and a light on it freezes it, so for almost all of a
    run the rule keeps itself: every frame in which the player can see anything of it is a
    frame in which it is standing still.

    The blink is the one case where the rule has to be designed for, and it is designed for
    by **putting the beam out**. For that window the torch emits nothing at all, so there is
    no light to cast by and nothing on the floor to see — not a faint shadow, not a
    silhouette sliding across the ground, nothing, exactly as everywhere the light is not.
    The shape goes out, and comes back somewhere else half a second later.

    That is a rule enforced by the lighting rather than against it. The alternative — hold
    the beam at 15% and switch the monster's shadow off underneath it — keeps the rule and
    breaks the world: the creature is standing in light and casting nothing, which is a
    special case that has to be remembered every time anything else about it changes. **The
    monster always casts.** Whenever a light is on it, its shadow is on the floor.

    Anything that would put a moving image of this creature on screen is wrong, however
    faint, and no amount of it is a glimpse worth having: a second way to see the monster
    is a second way that is easier than the one hard way the whole design is built on.
  - **Animation: none.** One pose covers it, because no frame of it in motion is ever
    drawn.
  - **It still needs a *model*.** "Never drawn" is not "never modelled": the shadow is the
    creature, and a shadow is only frightening if its outline is. A capsule casts a capsule.
    So the monster gets real art for precisely the reason it needs no animation — every
    pixel of it the player will ever see is a silhouette on the floor, and the silhouette is
    the entire visual design. The mesh is loaded with colour and depth writes off and shadow
    casting on, exactly as the placeholder was.

    **The model is §5.1's spider, at twice the size the spiders are.** The silhouette a
    player can read fastest is one they have already been taught, and this run teaches it:
    they have spent it learning what a spider's shadow looks like on the floor. What the
    beam finds is that shape, too large, and — unlike every other spider they have met —
    perfectly still. A shape they half-recognise is worse than an unfamiliar one, because
    they know what it would be doing if it were the other thing.

    It follows that the two sizes are load-bearing rather than incidental. If the spiders
    were this size the shadow would be ambiguous, and the run's one hard way of seeing this
    creature would resolve to "probably a spider".
  - **Audio:** heavy, slow, spatial footsteps — one every 1.6 m of ground covered, which
    at its pursuit speed is a step a little under every second. Slower than the player's
    own stride and carrying much further (§4.3), so the two are never confusable and a
    step heard in the dark is information about where the monster is, not about where the
    player just was.
- **Light Reaction Lifecycle:**
  1. **Movement Freeze:** when illuminated (by flashlight or environment light), the Shadow
     Monster cannot move. It can still kill: contact is fatal at any health (§5.3) and a
     frozen monster is no safer to touch than a walking one. The freeze buys the player
     ground, never immunity.
  2. **Light Interference / Flickering:**
     - Sustained flashlight focus causes the beam intensity `I` to fluctuate:

       ```
       I(t) = I_base · (1.0 - flickerSeverity · |sin(f · t)| · random(0.7, 1.3))
       ```

     - `f` is 18 rad/s, so the beam dips a little under six times a second — fast enough
       to read as a light struggling rather than as one being switched, and slow enough
       that a dip lasts several simulation ticks and can therefore be acted on.
     - `random(0.7, 1.3)` is re-rolled every simulation tick (§7). Re-rolling makes the
       depth of each dip uneven, which is what stops the blink below from arriving on a
       predictable beat — the player can see that a blink is *becoming likely* and never
       when it will land.
     - `flickerSeverity` ramps from 0.1 to 0.95 over 3 seconds of continuous focus. Focus
       is continuous in the same sense as §5.1's deterrence timer: the instant the monster
       leaves the cone the beam is clean again and the ramp restarts from 0.1.
     - **The flicker never reaches zero.** The formula above goes negative at high severity
       on a high jitter draw, so it is clamped to a floor of 15% of `I_base`. A beam
       oscillating down to nothing is not a beam struggling, it is a torch switched off, and
       the player reads it as their equipment failing rather than as something reaching into
       their light. The struggle is the information; blacking out throws it away. The same
       floor bounds a lamp under strain (§4.2) — a lamp that has actually *failed* is dark,
       and that is a different event.

       The floor is the flicker's, not the blink's. A blink is not a deep dip, it is the
       light going out, and it goes all the way out.
     - **The "Blink":** during extreme flickers — intensity below 35% of `I_base` for 3
       consecutive ticks — the beam **goes out, and stays out for 0.5 s**, about
       the length of a human blink. For the whole of that window the Shadow Monster's freeze
       lifts and it simply *walks*, at its ordinary 1.8 m/s pursuit speed, along a route the
       grid allows. Roughly 0.9 m of ground, and it can be heard covering it: the blink is a
       walk, so it has footsteps (§4.3). Another blink cannot begin until 0.5 s after this
       one **ends**, so the beam is reliable for at least that long in between.

       It is a walk and not a teleport on purpose. A jump-cut is something the player is
       told about after the fact — the shape was there, now it is here. Half a second of
       near-dark with heavy footsteps in it is something they are *inside*, and the dread is
       in the window rather than in the discovery afterwards.

       The monster casts no shadow for the length of the blink. The beam is still on it and
       still bright enough to cast by, so this is enforced rather than incidental — see the
       hard rule above. The walk is something the player *hears*; it is never something they
       watch.

       Those numbers interlock: the threshold is only reachable once `flickerSeverity`
       passes 0.5, which is about 1.4 s into the ramp. So the first stretch of holding the
       beam on the monster is safe, and the beam becoming unreliable is the warning that
       the monster is about to close. Holding light on it is how you find out where it is,
       and it is also how you let it approach.
     - **Only the flashlight's interference blinks it.** An environmental light's flicker
       (§4.2) does not, and a monster lit by an environmental light cannot blink at all,
       whatever the beam is doing. §4.2 pins it under a lamp until the lamp fails, and a
       blink that could carry it out of the pool would take that away.
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

**Light does not save a player who is already within reach.** §5.1's stun is immediate and
literal and it stays that way — a lit spider does not *advance* — but at contact range it
has nowhere left to advance to, and the beam no longer stops it striking. A lunge already
committed lands whether or not the spider is lit, and a stunned spider standing inside 1.0 m
still starts one.

The same is true of the Shadow Monster, whose freeze is otherwise absolute (§5.2): a player
who walks into a frozen one dies. Light stops it moving; it was never armour.

So the beam is a tool for controlling ground, not a shield. What answers a lunge is
distance: the wind-up is 0.35 s and §3.1 walks a metre in it, which is the whole of the
telegraph's purpose. A player who backs off survives; a player who stands still with the
torch on does not, however bright it is. The deterrence timer (§5.1) is unaffected and runs
as it always did — the light still turns spiders around, it just does not do it fast enough
to matter at arm's length.

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
  two enemies use different jump-scare presentations, so the player reads what killed them:
  the spider's is red and convulsive, the Shadow Monster's is a black screen with a shape
  arriving out of it. What has to hold, whatever the art becomes, is that the two are not
  confusable at a glance — the player has to know which mistake they made, because the two
  mistakes have nothing in common.
- The hold is real time, not simulation time: the world has already stopped.
- The run ends. There is no respawn and no checkpointing: the jump-scare resolves to a
  game-over screen, and the only continuation is a new game from the level start with all
  switch, note, and pick-up progress cleared.

Which enemy killed the player is not tracked separately: §5.3 gives the spider a *damage*
and the monster a *kill*, so the deduction that empties the pool and the outright kill are
already two different events, and the jump-scare reads them apart from that alone.

The check runs against the player's 0.4 m capsule; the 1.0 m threshold means contact
lands slightly before the meshes visibly touch, which reads as being grabbed.

## 6. Items & Interactivity Specification

1. **Flashlight Prop:** item pick-up on grid. Equips the player's primary light source.
   Until it is picked up the torch cannot be switched on at all, so the opening of a run is
   played in whatever light the map already has. A map with no `Flashlight` entity starts
   the player holding one — a map built to exercise one mechanic should not have to author
   a pick-up to be playable.
2. **Note Props:** pick-up or readable triggers. Display UI modal overlay containing
   lore/clues. Body text lives in a separate `notes.json` keyed by `noteId`, not in the
   map file, so writing and level design stay independent. A `noteId` with no entry is
   shown as a placeholder rather than failing the load, on the same terms as a missing
   prefab or sound (§2). Opening a note pauses simulation; the world does not advance while
   the player is reading, and it closes on the interact action or `Escape`. The note stays
   where it is once read — it is a thing on the map, not a collectable — and the count of
   distinct notes read is what the victory screen reports (below).
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
   `solid = false` and rotate 90° when triggered. The swing takes 0.6 s, and **walkability
   and the collider flip when it completes**, not when it starts: a gate that can be walked
   through while it still looks shut reads as broken, and 0.6 s is short enough that
   waiting for it never feels like being held up.

   The rotation is about the gate's hinge — the edge it shares with a solid neighbour,
   taken in west, east, north, south order — so it swings clear of the opening instead of
   turning in place. The map format has no hinge field and a gate filling a doorway always
   has one; a gate with no solid neighbour at all rotates about its own centre, which is
   the degenerate case and looks like nothing much.
5. **The Exit Gate:** the final objective. Unpowered initially. Requires the player to
   navigate the map, find specific buttons/switches to route power to it, and survive the
   escape. It unlocks once `requiredSwitches` distinct `latch` switches targeting it have
   fired;
   a HUD counter shows how many remain so the objective never becomes a hunt for an
   unmarked last switch.

   Unlocking is not an action the player takes at the gate: the last switch routes the
   power, and the gate opens where it stands, wherever the player is. Distinct is by
   switch, not by press — a `latch` that has already fired contributes nothing further,
   which is what `latch` being one-way is for.

   **The exit is a gate, and stands on a gate tile.** Like any other gate it is solid until
   it swings (item 4), so the ground it occupies cannot be walked on before the power
   routes — which is also what makes "standing where it stood" a sound way to end the run.
   A map that places the entity on open floor has authored an exit that is not a gate at
   all: it is walkable from the first second, and the run is won by walking onto it. The
   escape therefore checks that the exit is *unlocked* as well as that the player is on it.
   Both, deliberately: the tile is the design and the check is what stops a level's
   authoring mistake being handed to the player as a victory.
### Run Structure

A run is a single life over the whole map (§2), with no checkpoints, no saves, and no
mid-run persistence. World state — latched switches, toggled light groups, notes read,
pick-ups held — lives only for the duration of the run and is discarded on death (§5.3) or
victory.

### Victory Condition

Reaching the unlocked exit gate ends the run: input is disabled, a victory overlay
displays elapsed time and notes found, and the player may start a new run.

*Reaching* it means standing on its tile. A locked exit is a solid tile and cannot be stood
on at all, so no separate check for "is it open" is needed — the gate having swung is what
makes the tile reachable (§6.4).

Elapsed time is simulation time, so the seconds a player spent reading a note (§6.2) are not
counted against them; a game that punished reading would be a game that told the player not
to read.

Both end screens — game-over and victory — are dismissed by the interact action or a click,
and dismissing them starts the new run.

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
- One visible beam (§4) per shadow-casting light and no more — the flashlight's plus the two
  environmental slots, so three draw calls at most. Each is a cone of the light's own shape,
  raymarched per pixel against that light's shadow map: **24** steps for the flashlight and
  **14** for a lamp, whose cone is far wider and covers far more of the screen for far less
  of the picture. Bounded three ways — it starts where the ray enters the cone, stops at the
  light's range, and stops at the floor, which receives shadows but does not cast them and so
  cannot stop it itself. Samples are dithered in screen space; a march this short bands into
  visible shells otherwise, and the dither is a rendering detail with no bearing on a
  replayed run (Cross-Cutting: determinism).
- Filmic tone mapping. The scene is a handful of small, close lights against near-black
  (§4) — exactly the range that clips. Without a tone curve the middle of a light pool goes
  flat white and takes the detail with it, including the shadows the game is played by.
- Exponential fog, coloured to the sky, tuned so the far edge of the camera's ground
  footprint (§3.2) is most of the way faded out. It is what makes distance rather than
  darkness the thing that hides the map (§4), and it applies to lit geometry too: a lamp
  pool on the far side of the view is a glow, not a readable place.
- Static Layer 0/1 geometry is merged or instanced per prefab at load time — a 50×50 map is
  2,500 floor tiles and must not be 2,500 draw calls. **Landmarks are instanced by the same
  rule**, and for the same reason: they are entities rather than tiles, which made one mesh
  each look reasonable while a map had nine of them, and a map whose interior is a wood (§2)
  has hundreds.
- Simulation runs on a fixed 60 Hz timestep decoupled from rendering, so AI timers (§4.1,
  §5) behave identically regardless of frame rate. A long frame is clamped rather than
  caught up on, so a backgrounded tab does not come back to a spiral of catch-up ticks.
- **One loop drives the game, and the shell owns it.** The clock is advanced from exactly
  one place, with the real time since the last advance. Two drivers on one clock is not a
  performance problem but a correctness one: the world runs at a multiple of real time,
  every speed in §3.1 and §5 is silently scaled by however many drivers there are, and the
  clamp above — which exists to bound one long frame — becomes the size of the multiple.
- Budget for the whole level to be resident at once: the map is a single continuous space
  (§2) with no streaming and no loading screens after the initial load.
- **The shaders a lit lamp needs are compiled before the run starts, not when a switch is
  thrown.** A renderer keys a shader on how many lights are visible and how many of them
  cast shadows, so a lamp coming on is a new shader for every material on screen at once,
  compiled inside the frame that switched it. That frame is the one where the player has
  just done the thing the level is about (§6), and it is the only stall in an otherwise
  steady game — the flashlight never causes it, because it is in the scene from the first
  frame and is paid for during load like everything else.

  So every lighting state a run can reach is posed and compiled while the level loads: each
  number of lamps a `PowerSwitch` could light at once (§6), each number of shadow slots that
  could be filled at that count, with the torch lit and dark. The cost is a fraction of a
  second added to a load, against a visible hitch at the worst possible moment. A body that
  arrives after the run is built (§5.1) brings materials the pass could not have seen, so it
  is run again when they land rather than left to the switch.

## 8. Shell: Title, Credits & Debug Mode

Everything outside a run. §6 defines what a run *is* and how it ends; this is what surrounds
it — the screen it starts from, the credits it resolves to, and the developer affordances
that must not be part of what a player sees.

### 8.1 The Screens

Four, and no more. A horror game's menu should get out of the way.

1. **Title.** The game's name, `Play`, and `Credits`. Nothing animated behind it that costs
   a frame budget the run needs.
2. **Run.** §6's single life. The HUD (§6) and the damage feedback (§3.4) are the only
   things on screen.
3. **Ending.** §5.3's game-over or §6's victory overlay, both offering another run.
4. **Credits.** Reachable from the title and from the victory screen, and it returns to the
   title.

**The title screen is where the audio context is armed** (§4.3). Browsers refuse to start an
`AudioContext` without a user gesture, and pressing `Play` is the first gesture there is —
which is why a run must not begin without passing through the title, however tempting a
`?skip` would be. Loading a specific map for testing is a debug affordance (§8.3), not a
route into the game.

### 8.2 Credits

The credits screen names, in this order:

- **Game design:** Zack Newman.
- **Art:** each kit and its author (§1), linked to where it came from. Every kit is named,
  including the ones whose licence asks for nothing: a project that credits only what it is
  forced to has misunderstood why the licence is free.
- **Code:** the libraries and build tools the game is built on, and who wrote them.

**Attributions, not licence terms.** The screen says who made what. It does not print
licence names, and it does not editorialise about which credits were required and which
were courtesy — a reader wants to know whose work they are looking at, and a page that
sorts its thanks by legal obligation makes the smaller point loudly. The terms themselves
are a developer's concern and live where a developer looks: `PREFAB_KITS` in `config.ts`
records each kit's licence, the vendored kits ship their own licence files, and the `assets`
row of the debug readout (§8.3) names the terms of everything loaded.

The list is generated from the same constants the game loads its assets by, not typed out
separately — a credits screen maintained by hand is a credits screen that stops being true
the first time a dependency changes.

### 8.3 Debug Mode

**Off by default.** The debug readout, the free camera, the overlays and the debug keys are
developer tools, and a player who reaches for `WASD` and finds a wall of diagnostics is
playing a different game than the one this specifies.

- Enabled by `?debug` on the URL, which also unlocks `?map=` and `?seed=`.
- Without it: no readout, no debug keys, and the map is the level.
- With it: everything the Cross-Cutting debug harness describes, exactly as now, plus a
  link to the editor (§9) on the title screen.
- **A flag whose value says off is off.** `?debug=0`, `=false`, `=off` and `=no` turn it
  off; naming it with no value, or any other value, turns it on. Writing `=0` is the
  obvious way to disable a flag, and one that quietly meant the opposite would read as a
  harness there is no way out of.
- **`?overlay=0` starts the readout hidden**, with the rest of the harness armed. Testing a
  map means `?debug`, because that is what unlocks `?map=` — so without this, wanting a
  custom map and not wanting a wall of diagnostics over it is not a thing the URL can say.
- **The readout is dismissible by touch.** `H` toggles it, and a key is not a control on a
  phone (§3.1): under debug it carries a tap target to dismiss it and leaves one behind to
  bring it back. The same rule as the on-screen action buttons, for the same reason.
- **The editor is not behind it.** `?edit` opens on its own, because authoring a level is
  not debugging a run — the person doing it wants a tool, not a diagnostic readout over
  their level. What debug mode decides is whether a *player* is offered the door.

The distinction is not a build flag. `window.shadows` is already stripped from production
builds; this is about what a *development* build shows by default, so that running the game
and testing the game are different acts rather than the same one.

**The balance tuner.** Debug mode carries a panel of sliders over the values §11's tuning
pass has to settle — the speeds, the reaction times, the beam and the night, and the look
values §4 gives the dark: how thick the air inside a beam is, inside a lamp's cone, and how
far the player's own body is lifted off black — writing them into the running game as they
move, and remembering them in the browser between sessions.
It is hidden until asked for even under `?debug`, because two panels at once is most of the
screen; the readout is the one worth leaving up.

It exists because tuning by editing a constant, rebuilding and replaying the situation gets
one number tried per minute, and most of these values are only answerable by feel: whether a
spider's approach is faster than the beam can sweep is not a question arithmetic settles.

Two rules make it safe to have:

- **A player never touches it.** Nothing constructs it without `?debug`, so a browser that
  has stored overrides still runs a player's game on the spec's numbers. This is the same
  rule as `?map=` and `?seed=`, for the same reason, and it is what allows the panel to
  write to the constants the game actually reads rather than to a copy of them.
- **It finds numbers; it does not hold them.** A value discovered by turning a knob is not
  a decision until it lands in this spec and in `src/config.ts`. What the browser stores is
  a working note between sessions, and a run measured against stored overrides is a run
  measured against nothing anybody agreed to — so the panel marks every value that is off
  the spec, and can hand back the list of them.

## 9. Level Editor

The level is authored in a tile editor built into this project and served from the same
site (§1), rather than in a third-party tool. Three reasons, in order of weight:

1. **It writes `map.json` directly.** No export format to convert, no schema to keep in
   sync with §2, and no class of bug where the editor's idea of the map and the game's
   disagree.
2. **It can run the audit while you author.** The loader answers "does this parse"; the
   audit answers "can this level be finished" — a gate whose only switch is behind itself,
   an exit needing more `latch` switches than the map has. Finding those while placing them
   rather than after a playthrough is most of what the tool is for.
3. **It runs where the level is being designed.** A browser tool works on a phone, which a
   desktop editor does not.

### 9.1 Editing Model

- **Two tile layers** (§2): floor and obstacles, edited one at a time, with the other shown
  faded for reference.
- **Paint, erase, and rectangle.** The rectangle tool is how buildings are made: a building
  is a filled or outlined block of wall tiles, not a distinct kind of thing. That keeps one
  prefab to one tile, which is what §7's instancing and §2's collider merge are built on.
- **Entities are placed on tiles**, one selected at a time, with a properties sheet for the
  fields §2's entity table requires. An entity whose required property is unset is drawn as
  an error, not silently written.
- **A property is edited as what it is.** One of a fixed set of values — a switch's `mode`,
  a gate's `locked` — is a row of buttons, not a text box somebody has to know the word for.
  A property naming something else on the map — a switch's `targetId`, a lamp's `groupId` —
  offers the names the level already contains, so a switch is wired to a lamp by picking its
  group rather than by spelling it the same way twice.

  This is not a convenience. §6.5 needs `latch` switches and the audit says so in as many
  words, but while `mode` was a bare text field the only way to make one was to already know
  the word — an editor that asked for something it gave no way to supply.
- **The audit is read as sentences, not as a tally.** The status line carries the first
  finding in full and a `Checks` panel carries the rest. A count of warnings is a number an
  author learns to ignore, and "3 warning(s)" is what somebody reads while placing lamps
  that will never come on, with the sentence that would have told them so — `light group
  "Yard" has no switch and can never be powered` — sitting unread behind it.
- **Undo and redo** over every edit. A tile editor without undo is a tile editor that is
  used carefully instead of quickly.
- **The palette is the standard tileset.** The editor writes tile ids, and ids mean nothing
  without the `tileset.json` a map is loaded beside (§2). So the ids the palette offers —
  `0` pit, `1` concrete, `2` wall, `3` fence, `4` dirt, `5` gate, `6` crate — are defined by
  every `tileset.json` in the project, whether or not that map uses them. A level moved
  between directories keeps its tiles; one played through §9.3 gets the same walls it was
  drawn with.

### 9.2 Facing

`Note` and `PowerSwitch` mount on a solid neighbour rather than standing in the open, and
carry a `facing` in degrees clockwise from north (§2's convention). The editor defaults it
to a solid neighbour and lets it be turned.

**A note must face the camera to be readable.** The camera is pitched down with no yaw and
sits on the `+Z` side of the player (§3.2), so only south-facing surfaces are ever seen. A
note mounted on the north face of a wall is behind that wall from every angle the game can
be viewed from. So a note's solid neighbour must be to its **north, east or west** — never
south — and the editor refuses the fourth case rather than letting a level be authored with
unreadable notes in it.

A switch has no such constraint: it needs to be reachable (§3.3), not legible.

### 9.3 Getting a Level Out

- **Copy to clipboard.** The whole `map.json` as text, in one action. On a phone this is the
  reliable path — no file system, no download permissions — and it pastes into a commit.
- **Play it now.** The editor hands the level straight to the game without a round trip
  through the repository, so a change can be tested in the seconds after it is made. This
  is a debug affordance (§8.3) and is not a route a player can reach.
- **Autosave.** Work in progress survives the browser being closed. It is not a save
  system: the exported file is the level, and the autosave is a draft.

### 9.4 Stamps

A stamp is an arrangement of tiles and entities placed in one action — a soccer field is a
rectangle of pitch tiles, a goal at each end, a net. It is a way of drawing, not a kind of
thing a level contains.

**A stamp expands on placement and leaves nothing behind.** What lands in the map is the
tiles and the entities, exactly as if they had been drawn one at a time: no grouping, no
reference back to the stamp, nothing in `map.json` that says a field was ever placed. Undo
takes the whole placement back as one step, because it was one action — but the moment it
is placed, a stamp's contents are ordinary map content and are edited as such. Move one
goal and it is a field with a goal moved, not a broken instance of anything.

This is what keeps §2 flat. A stamp that survived into the file would be a container, and
the walkability derivation, the pathfinder, the reachability audit, the validator and undo
itself would each need to understand it. Expanding at author time means none of them do.

**A stamp is a piece, not a brush.** The library is a catalogue of distinct set-pieces — the
soccer field, the playground, the loading bay — and a level places roughly one of each. They
are the parts a level is assembled from, which is why they are worth keeping and naming, and
why one is authored carefully rather than stamped in rows.

That is also what makes expanding on placement cost nothing. The obvious objection to it —
there is no way to change every field in a level at once, because after placement there are
no fields — assumes a level with many fields in it. There is one. Whatever "editing every
instance" would have bought is a saving of one edit.

- **A stamp is data** — a footprint, its tiles per layer, and its entities with their
  offsets and properties. A handful ship with the project; the rest are made in the editor
  (below). Either way what a stamp *is* is the same thing.
- **Rotation in quarter turns.** The tile grid is square and the entities inside carry their
  own angles (§2), so a stamp rotates by rotating both. Free-angle rotation would mean
  tiles at an angle, which the grid cannot express.
- **Every angle an entity carries rotates**, not only `rotation`: a note's `facing` (§9.2)
  is which wall it is mounted on, and the wall turned with the stamp. A quarter turn can
  leave a note facing north, where the camera cannot read it — the editor says so on
  placement rather than silently laying down an unreadable note.
- **Placement is previewed and clamped.** The footprint is shown before the click, and a
  stamp that would fall outside the map is refused rather than clipped: half a soccer field
  is not a thing anybody meant to place.
- **Overwriting is allowed and visible.** A stamp writes over what is under it — that is
  what makes it useful for laying ground — and the preview shows what it will cover.

#### Making one

**A stamp is captured from the map, not drawn on a second canvas.** The author draws the
arrangement in the level with the tools they already have, drags a rectangle round it, and
names it. What is captured is that rectangle: both layers' tiles and every entity inside,
measured from its top-left corner.

The map is the right surface to author on because a stamp is made of nothing else — §9.4's
whole point is that it expands into ordinary tiles and entities. A separate stamp editor
would be a second canvas, a second set of tools and a second undo stack, to draw the same
things in the same way. It would also break the loop that makes this worth having: place a
stamp, adjust what landed, capture the result as a better one.

Capture takes **every cell in the rectangle**, including empty ones. A stamp made from a
yard with no walls in it clears the walls where it lands, which is what "writes over what is
under it" has to mean for the ground-laying case to work at all. The stamps that ship with
the project write single layers, and that is a thing a definition can express and a capture
cannot: a captured stamp is the whole rectangle, deliberately.

**The library persists in the browser, and exports as JSON.** Captured stamps are kept
alongside the autosaved draft (§9.3) and survive the browser closing. The whole library
copies to the clipboard as JSON in one action and is pasted back the same way. Same rules as
the level export: no file system, no download permission, nothing that does not work on a
phone.

**A piece worth keeping goes in the project.** `public/stamps.json` holds the level's
pieces, in exactly the format the export produces, and the editor loads it as part of the
library. Committing a stamp there is what makes it permanent: present on every device, in
every browser, surviving cleared site data, and visible in a diff when it changes. Browser
storage is where a stamp lives while it is being worked out; the file is where it lives once
it is a piece of the level.

Three sources, layered, and the precedence between them is the whole of the rule:

- **The defaults** — the handful defined in source, so a fresh clone has something to place
  and a failed load still leaves a working palette.
- **The project's** — `public/stamps.json`, loaded at startup. The level's pieces.
- **The captured** — this browser's.

**A later layer replaces an earlier one of the same name rather than sitting beside it.** One
name is one stamp: the palette never shows two things called the same thing, and no operation
has to guess which was meant. Only the top layer is deletable, and only the top layer is
exported — the project's pieces are in the repository already, and exporting them would mean
importing them back as duplicates of themselves.

#### Changing one

A piece is authored over time, and the first cut of it is rarely the one that ships. Every
stamp can therefore be renamed, re-cut from the map, and thrown away:

- **Rename** changes what it is called. The name it was captured under is its identity and
  does not move, so that a piece keeps pointing at the same thing while it is being worked on.
- **Replace from selection** re-cuts it from a rectangle, in place. The alternative — delete
  and capture again — gives a second piece under a second name, and the level is then holding
  the old one.
- **Delete** removes it.

**A committed piece is edited by taking a copy of it.** The project's stamps and the defaults
cannot be changed from the editor — the file would put them straight back — so editing one
copies it into this browser first, *under the same name*. That copy covers the original in the
palette, is edited like anything else, and exports under the name it came from, so it lands
back in `stamps.json` over the entry it replaces rather than beside it. Delete the copy and the
committed piece is back.

That is what makes the round trip work in both directions. Without it, fixing a committed
piece would produce a second piece under a second name, which somebody would have to rename by
hand on the way into the file — and forget to, once.

The file loads asynchronously and the editor does not wait for it. A level designer who opens
the editor gets the tools immediately and the project's pieces a moment later, which is the
right way round: a missing or malformed `stamps.json` costs the pieces in it and never the
editor.

The exported form is compact rather than pretty. Tiles are run-length encoded per layer over
the footprint's row-major index, because a captured yard is a few hundred cells that are
almost all the same and a person is meant to be able to paste the result into a message.
Encoding is lossless in both directions — a stamp that touches one layer stays that way.
