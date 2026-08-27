# Orientation

Notes for picking this project up cold, so the same things do not have to be re-derived from
the source every time.

**This is not a second spec.** `docs/GAME_SPEC.md` says what the game does and every number
it does it with; when the two disagree, the spec is right and this file is stale. What lives
here is the shape of the code, the orderings that are load-bearing, and the things that were
silently wrong once and cost hours. No design values — a number copied here goes out of date
the moment the original moves, and the copy gets believed.

`docs/project-map.jsonl` is the file-level index; this is the layer above it.

## A frame, in order

One loop drives everything and `main.ts` owns it (§7). `Run.frame(realDelta)` runs, in this
order, and the order is not incidental:

1. `input.update()` — sampled once, so three ticks in one frame see one snapshot.
2. `outcome.tick(realDelta)` — clamped real time; the jump-scare's hold cannot run on a
   paused clock.
3. `clock.advance(realDelta)` — the fixed 60 Hz simulation, only while the run is playing.
4. `player.render(alpha, delta)` → `enemies.render` → voices, paths.
5. `flashlight.update(...)` — from the *interpolated* player position.
6. `flashlight.carry(player.reachFor(...))` — the arms are solved against the beam after it
   has been placed, never before.
7. `night.follow`, `audio.update`, `occluders.update` — all from the interpolated position.
8. camera (rig, or free camera when enabled), `environment.update(camera, delta)`, props, HUD.
9. `viewport.render()`, then `frameStats.sample()` — after, so the counters are this frame's.

**Sim clock or render delta** decides where a thing goes. Anything with a timer ticks on
`clock.onTick` (battery, AI, sabotage, gates). Anything presentational runs on the render
delta and follows the interpolated position (camera smoothing, walk cycle, beam placement,
occluder fade, shaft fades). Putting a timer on the render delta makes it frame-rate
dependent; putting a visual on the tick reintroduces the 60 Hz staircase.

## Who owns what

| Directory | Owns |
| --- | --- |
| `src/core/` | `SimClock`, `Viewport` (renderer/scene/camera), `Input`, `AssetLoader` (prefabs, merged), `GeneratedPrefabs` (art built rather than loaded — §2's small tree), `CharacterLoader` (skinned, cloned per instance), `OccluderFade`, `Rng`, URL options |
| `src/map/` | `validate` (fatal vs warning), `MapLoader`, `MapGeometry` (instanced), `colliders` (greedy merge), `WalkabilityGrid`, `EntityRegistry`, `Landmarks` (instanced per prefab — §7), `Surround` (§2's ground and trees *outside* the map — scenery only), `audit` (is the level finishable) |
| `src/player/` | `Player` (tick is pure arithmetic; render is the only scene-graph part), `collision` (the only thing holding the player on the map now), `CameraRig` (locked to the player; `groundFootprint` is what sizes §2's surround), `Health`, `autoRig` (rig derived from a mesh), `ArmIk` |
| `src/lighting/` | `Flashlight` + `Battery`, `EnvironmentLights`, `Ambient` (night rig), `Illumination` (`sample` per entity, `litAt` per point), `LitTiles` (per-tile, memoised per path search), `flicker`, `LightShaft`, `TorchBody`, `LampVoices` |
| `src/enemies/` | `Enemy` (shared state machine, speeds, A\*, avoidance), `Spider`, `ShadowMonster`, `EnemyManager` (spawning + the one contact test), `Gait`, `CharacterRig` |
| `src/nav/` | `AStar` (8-connected, no corner-squeezing, then string-pulled; optional per-tile enter cost and a separate grid to straighten against), `raycast` (segment vs boxes on X/Z), `LitGrid` (§5's light-as-terrain views — pure, knows nothing about lights) |
| `src/world/` | `Objectives` (the run's whole state), `Gates`, `Interaction`, `Notes`, `Props`, `RunOutcome` |
| `src/audio/` | `AudioCore` (listener on the *player*, pooled sources), `SoundBank` (ZzFX-synthesised placeholders), `profiles`, `Footsteps` |
| `src/ui/`, `src/editor/`, `src/debug/` | HUD and run overlays; the level editor (§9); the readout, overlays, tuner and frame stats |

Ownership rules worth knowing before editing:

- **`Illumination` is the only place that answers "is this lit".** Both AIs consume it. An
  enemy computing its own answer is the bug class the service exists to prevent.
- **`EnemyManager` owns the contact test**; what contact *means* is each enemy's.
- **`Objectives` owns run state** and has no serialisation — there is no save, by design.
- **Nothing in `src/` hard-codes a spec number.** `src/config.ts` mirrors them, each citing
  its section.

## Invariants that break silently

- **One driver on the clock.** A system that registers its own `requestAnimationFrame` while
  `main.ts` is already driving makes the world run at a multiple of real time.
  `tests/run.test.ts` fails if a run drives itself.
- **Skin weights sum to 1.** Anything else scales the vertex and reads as the character
  deflating, not as a rig bug.
- **At rest, skinning moves no vertex.** `tests/autoRig.test.ts` asserts it under the
  loader's wrapper nodes, which is the only nesting where a wrong answer differs from a
  right one.
- **The spec, the config, the tests and `project-map.jsonl` move together.** A behaviour
  change touching only one of them is incomplete; the map has a test that enforces its half.
- **String-pulling can undo a route's whole reason for existing.** `findPath` straightens
  its result by dropping every waypoint the previous one can see, so a path that went the
  long way round something the *cost* disliked — §5's lit ground — is straightened back
  through it unless the smoothing is judged against a grid where that ground is blocked
  (`PathOptions.smoothGrid`). The route is correct and the enemy walks through the light
  anyway, which looks like the cost not working.
- **`TuningPanel` writes a group heading whenever the group changes as it walks `TUNABLES`,**
  so entries for one group must stay contiguous or the panel prints the heading twice.

## Traps already paid for

Each of these looked like bad art or bad luck rather than a bug.

- **A media element is the device's media unless it is put on the graph.** An
  `HTMLAudioElement` left to itself takes a phone's lock-screen transport controls, shows in
  the notification shade, and stops whatever the player was already listening to — correct
  for a music app, wrong for a game. Routing it through `createMediaElementSource` makes it
  one more node in the graph the rest of the sound comes out of. The music streams through
  an element rather than a decoded buffer only because a four-minute track is ~110 MB of PCM;
  the element is a compromise, and putting it on the graph is what pays for it.
- **ZzFX's `filter` is a high-pass when positive.** Reaching for a positive number to take
  the top off a sound removes its *bottom* instead — ZzFX builds one biquad from
  `sign(filter)`, and `b0 = (1 + sign · cos)/2` is the high-pass form. Negative is the
  low-pass, and the corner is twice the number either way. It reads as the sound simply
  being thin, so it is diagnosed by measuring the low-band share rather than by listening.
- **A source stopped on the render loop is restarted by the render loop.** `SpiderVoices`
  and `LampVoices` re-`play()` their emitters whenever the thing they speak for is doing
  something, and they update outside the simulation guard. Silencing the world on death
  stopped them for exactly one frame. It was invisible for as long as death suspended the
  whole `AudioContext` — the sources were playing into a suspended context — and only became
  audible once the context had to stay alive so the jump-scare could have a sound. Anything
  that silences the world has to stop the updates too, not just the sources.

- **A tree short enough to see whole is a tree that roofs the floor.** The instinct from
  §3.2's 72° pitch is that a 26 m trunk is a dark bar rather than a shape, so a wood should
  be planted from something you can see the top of. It is the wrong way round: a crown below
  the camera hides the ground behind it, and the ground is where the player, the enemies and
  every shadow are. The tall tree's canopy is *above* the eye and never drawn, which is
  exactly why a wood is made of them — and why §2's surround, whose job is to cover ground
  rather than stand on it, uses the short one instead.
- **A light coming on compiles shaders, in the frame it comes on.** Three keys a program on
  how many lights are visible and how many cast, so switching a lamp is a new key for every
  material on screen at once. It looked like a physics or audio hitch at the moment a
  `PowerSwitch` fired, and it never happened twice. `EnvironmentLights.precompile` poses
  every reachable lighting state at load and compiles against it (§7); `renderer.info.programs.length`
  before and after a toggle is how to check it — it must not move. It is synchronous on
  purpose, so no frame can be drawn with the lights posed.
- **A character's materials are shared between every instance of it.** `CharacterLoader`
  clones the node tree per instance and shares geometry *and materials* underneath, which is
  where the memory saving is. So a flag set on one instance's material is set for all of
  them — and since §5.2's monster wears §5.1's spider, hiding the monster's body (colour and
  depth writes off) turned every spider in the run into a shadow. The symptom points nowhere
  near the cause. `Enemy.attachCharacter` clones the monster's materials first; anything else
  that needs to differ per instance has to do the same.
- **Ground painted the fog's colour is invisible.** §7 colours the fog to the sky *and* uses
  it as the scene background, so a surface tinted to `FOG.color` is exactly the colour of the
  void behind it. §2's surround ground reads as ground because it is a lit material taking
  §4's ambient like the map's own floor, not because it was given the right hex.
- **An `ExitGate` on a floor tile is a free win.** The run ends by standing where the exit
  stood, and what stops that happening early is the tile being *solid* until the power routes
  (§6.5). This project's own example map had the entity on plain floor for several phases:
  walking onto it won the run with nothing routed. `Objectives.escapedAt` now checks the
  state as well, so the next authoring slip costs a locked exit instead.
- **A `SkinnedMesh`'s bind matrix is its *world* matrix.** Three renders a skinned vertex as
  `boneWorldNow · boneInverseAtBind · bindMatrix · v`, so an identity there renders the model
  in raw authored coordinates — for a Z-up kit, flat on its back, metres away.
- **A model's own axes are not the game's.** Measure the up axis as the longest extent;
  assuming Y-up is right for most kits and silently wrong for one. A loader wraps a model in
  orientation and grounding nodes, so a vertex's coordinates, its mesh's and the character
  root's are three different frames — measure, place and bind in one.
- **A skinned mesh is not where its vertices say it is.** glTF *ignores* the transform of
  the node a skinned mesh hangs off; the joints carry it. `jointWorld · inverseBind` is the
  identity only when the rest pose is the bind pose — on this kit's spider it is the
  armature's 100× Z-up correction, so skinning a vertex and *then* placing it with the
  node's matrix applies that correction twice and reports a 594 m spider on its side. Three
  measures the bind-posed vertices, which is why `scripts/glb-facts.mjs` says 1.931 m where
  the raw accessors say 1.949 m.
- **Nothing in a `.glb` says where the feet are.** Characters are grounded *and* centred
  horizontally on load; without it a body stands beside the collider that represents it.
- **A flat emissive is the same shade wherever it lands.** Applied per material it swamps a
  kit's own colours at §4's ambient and every surface comes out one pale grey. The
  readability allowance is a fraction of each surface's own colour for that reason.
- **`rAF` hands its callback a timestamp, not a delta.** Feeding it to something measured in
  seconds, with a clamp, turns every frame into a full `maxFrameSeconds` of simulation.
- **Three packs spotlight shadow depth into RGBA** (`RGBADepthPacking`); `shadow.matrix`
  carries world space straight to that map's clip space. Sampling it by hand means
  `unpackRGBAToDepth`, divide by `w`, add the bias, and answer *unlit* outside the frustum.
- **The floor receives shadows but never casts them** (§7), so a shadow map cannot tell
  anything that the ground is there. The shaft's march clamps to `y ≥ 0` separately.
- **A test that hard-codes a distance that is really a speed times a time** fails on the next
  tuning pass for a reason unrelated to what it checks. Derive it from the constant.

## Driving the game in a browser

Tests are the floor; anything about how the game *looks* is measured here.

**Chromium is installed; the `playwright` package is not.** It is deliberately not a
dependency of this project — nothing the game ships uses it — so install it somewhere
outside the tree and drive the dev server from there. The browser it would otherwise
download is already on disk and must not be fetched again:

```bash
npm install playwright        # in a scratch directory, not this repo
```

```js
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
```

Do not run `playwright install`.

The recipe that works:

```js
await page.goto('http://localhost:5173/shadows-threejs/?debug&map=phase3-test&overlay=0');
await page.click('.shell-play');                       // §8.1 — the only door into a run
await page.waitForFunction(() => window.shadows?.player);
```

`&overlay=0` starts the readout hidden — it covers a third of the screen otherwise, and
`?map=` is debug-only so there is no arming one without the other. `H` still toggles it, and
under `?debug` it also carries a `×` to dismiss and a `dbg` handle to bring it back, which
is the path that exists on a phone.

**Every in-page path carries the base**, in dev exactly as in production (`vite.config.ts`
sets it so a base-path mistake surfaces locally). A dynamic `import('/src/…')` or
`import('/node_modules/…')` from inside `page.evaluate` 404s; `/shadows-threejs/src/…` and
`/shadows-threejs/node_modules/…` resolve. Vite compiles the TypeScript on the way through,
so the game's own modules can be imported and driven directly — which is usually better than
reimplementing what they do:

```js
const { CharacterLoader } = await import('/shadows-threejs/src/core/CharacterLoader.ts');
```

Import `three` from `/shadows-threejs/node_modules/three/build/three.module.js` when a
measurement needs it, and expect a "Multiple instances of Three.js" warning if the page has
already loaded its own — harmless for measuring, and a reason not to compare object
identities across the two.

Then, from `window.shadows` (dev builds only, republished on every restart):

- `flashlight.held = true` — skip the §6.1 pick-up on maps that author one.
- `player.moveTo(x, z)` — teleport without smoothing.
- `player.aimTowards(x, z)` plus `input.aimSource = 'stick'` — aim exactly, without the
  pointer overwriting it on the next frame.
- `clock.timeScale = 0` — hold the world still while rendering carries on. Better than the
  `Y` key, which removes the enemies rather than stopping them.
- `environment.toggleAll()` — power every lamp group.
- `rig.viewport.camera` / `rig.viewport.renderer.info.render` — projection and draw counts.
  `viewport` itself is *not* on the handle; reach it through `rig`.
- **`freeCamera` is not on the handle either.** Press `V` and drive it with the wheel and
  `WASD`, or work within the rig camera.

The handle carries: `clock, input, loaded, player, rig, flashlight, environment, audio,
testEmitter, occluders, enemies, objectives, props, gates, hud, notes, voices, monsterSteps,
lampVoices, rng, illumination, night, audit, frameStats`.

**`music` and `restart` are the shell's, not the run's**, and are on the handle from the
moment the page loads rather than from the first run — which is the point of them, since the
music plays on the title screen and a handle that only existed inside a run could not reach
it. A run's own entries are merged over these when one is built.

`shadows.music` is also the only way to see what the menu's music is doing: `new Audio()`
makes a *detached* element, so it is not in the DOM and `document.querySelector('audio')`
finds nothing. `music.silent` is the one worth knowing — the graph playing nothing, which is
what an older iOS Safari does with `createMediaElementSource` and which looks exactly like a
track that failed to load.

**The rig camera is locked to the player** (§3.2) — it centres them everywhere, including
hard into a corner, so a screen position means the same thing wherever the player is
standing. It used to clamp to the map's bounds and no longer does; §2's surround covers the
ground outside instead.

The frame is much wider than it is deep, and the far end of a 12 m beam is usually at or
past the top of it. If a measurement needs geometry both near and far, put it left-to-right
across the screen rather than up-screen, or shorten the beam through the tuner.

Driving the tuner's sliders is the shipped path for anything marked `needsPush`: find the
`input[type=range]` whose **`parentElement`** text contains the label (not `closest('div')` —
that matches the whole panel), set `value` and dispatch an `input` event.

**Anything about *light* has to be measured on real frames.** The beam is placed on the
render side (see *A frame, in order*), so driving the simulation with `clock.advance()` in a
loop advances the AI, the timers and the battery while leaving the torch pointing wherever
the last rendered frame left it. Every light query then answers about a beam that is not
where the player is aiming, and the run looks broken in a way that is entirely the harness's
fault. Step the clock for arithmetic; let `requestAnimationFrame` run for anything lit.

**To put something *in* the beam, move it onto the beam — not the beam onto it.** The aim is
rebuilt from input every frame, so a value written from a `rAF` callback can be overwritten
before `flashlight.update` reads it. Read the axis instead and place your subject on it:

```js
const o = shadows.flashlight.light.position;
const t = shadows.flashlight.target.position;
const len = Math.hypot(t.x - o.x, t.z - o.z);
const spot = { x: player.position.x + ((t.x - o.x) / len) * 0.9, z: /* … */ };
```

**A model's size, triangles and clip names are in `docs/project-map.jsonl` already** —
`npm run map` re-derives them from the files, so a question like "how tall is the spider as
authored" is a `grep`, not a browser session. What still needs the browser is anything about
the model *in the scene*: how it reads at its game scale, what its shadow looks like, where
the beam catches it.

**To judge geometry the game keeps dark, light it in the harness rather than in the game.**
`viewport.renderer.toneMappingExposure = 6` and `viewport.scene.fog = null` turn §2's
surround from a black mass into a countable stand of trees, which is the difference between
"looks thin" and "there is a gap here". Nothing about that view is a gameplay view — go back
to a normal frame before judging how anything *reads*.

**How far past the boundary the camera actually reaches is a raycast, not a guess.** Unproject
the screen corners onto the ground plane (`y = 0`) and subtract the rig target: at 16:9 the
far corners sit about 13.7 m to the side and 8.1 m ahead, and a map's own edge keeps the
player several metres inside that. That gap is why §2's band is dense at the front and thin
behind.

Screenshot differencing is how the look values were settled: capture with a value at 0 and at
its default, difference per pixel, and report the max as well as the mean — a leak is local.
`pngjs` reads the captures; there is no PIL here.

## Which map exercises what

| Map | Use it for |
| --- | --- |
| `example` | 50×50, full pipeline, 5 lamps, 3 spiders, a monster, the whole objective chain. The only one with interior wall runs long enough to test occlusion against |
| `phase2-test` | Movement and collision, nothing else in the way |
| `phase3-test` | Lighting: 7 lamps, 3 switches, no enemies |
| `phase5-test`, `phase7-test` | Navigation and the spider |
| `phase8-test` | The Shadow Monster, ×2 |
| `poi-test` | Landmarks |
| `phase1-test` | Small, but has one of everything including a `TeleportPad` |

None of them is the level (see CLAUDE.md, *Maps*).

## Debug keys

`?debug` arms all of it. `WASD`/`E`/`F`/`Shift` are player keys; the rest are the harness:
`V` free camera, `O` occluder fade, `Z` audio test emitter, `N` enemy paths, `X` block the
hovered tile, `Y` disable enemies, `I` draw the monster's body (§5.2 says never), `B` drain
the battery to 5%, `L` power every light group, `J` heal, `G` walkability, `C` colliders,
`M` entity markers, `P` pause, `.` step one tick, `[` `]` time scale, `R` restart, `T` the
tuning panel, `H` hide the readout.

None of them exists on a phone, where the only debug chrome is the readout's own two tap
targets (`×` and `dbg`). `?overlay=0` starts it hidden; `?debug=0` turns the harness off
outright, and takes `?map=` down with it.

## The suite

Every test is pure — no GPU, no DOM beyond jsdom where a panel needs one — because systems
here are deliberately built so their arithmetic can be exercised without Three.js. That is
what makes the suite worth having and also what bounds it: it can assert that a beam's cone
angle is what §4.1 says, and it cannot assert that the beam looks like a beam. Everything in
the second category is measured in a browser instead (above), and the numbers go in the PR
and in the phase's Status note.

Where a thing cannot be tested at its own level, test the invariant it rests on. A shader
cannot be run here, but the wiring that feeds it can: `tests/lighting.test.ts` asserts that
the shaft receives the light's live shadow map, matrix and bias, because losing that is how
the beam would silently start shining through walls.
