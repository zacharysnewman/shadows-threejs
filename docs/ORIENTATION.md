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
| `src/core/` | `SimClock`, `Viewport` (renderer/scene/camera), `Input`, `AssetLoader` (prefabs, merged), `CharacterLoader` (skinned, cloned per instance), `OccluderFade`, `Rng`, URL options |
| `src/map/` | `validate` (fatal vs warning), `MapLoader`, `MapGeometry` (instanced), `colliders` (greedy merge), `WalkabilityGrid`, `EntityRegistry`, `Landmarks`, `audit` (is the level finishable) |
| `src/player/` | `Player` (tick is pure arithmetic; render is the only scene-graph part), `collision`, `CameraRig`, `Health`, `autoRig` (rig derived from a mesh), `ArmIk` |
| `src/lighting/` | `Flashlight` + `Battery`, `EnvironmentLights`, `Ambient` (night rig), `Illumination`, `flicker`, `LightShaft`, `TorchBody`, `LampVoices` |
| `src/enemies/` | `Enemy` (shared state machine, speeds, A\*, avoidance), `Spider`, `ShadowMonster`, `EnemyManager` (spawning + the one contact test), `Gait`, `CharacterRig` |
| `src/nav/` | `AStar` (8-connected, no corner-squeezing, then string-pulled), `raycast` (segment vs boxes on X/Z) |
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
- **`TuningPanel` writes a group heading whenever the group changes as it walks `TUNABLES`,**
  so entries for one group must stay contiguous or the panel prints the heading twice.

## Traps already paid for

Each of these looked like bad art or bad luck rather than a bug.

- **A `SkinnedMesh`'s bind matrix is its *world* matrix.** Three renders a skinned vertex as
  `boneWorldNow · boneInverseAtBind · bindMatrix · v`, so an identity there renders the model
  in raw authored coordinates — for a Z-up kit, flat on its back, metres away.
- **A model's own axes are not the game's.** Measure the up axis as the longest extent;
  assuming Y-up is right for most kits and silently wrong for one. A loader wraps a model in
  orientation and grounding nodes, so a vertex's coordinates, its mesh's and the character
  root's are three different frames — measure, place and bind in one.
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

Tests are the floor; anything about how the game *looks* is measured here. Chromium and
Playwright are installed but the browser Playwright expects may not be — launch with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` and
`args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']`. Do not run
`playwright install`.

The recipe that works:

```js
await page.goto('http://localhost:5173/shadows-threejs/?debug&map=phase3-test');
await page.click('.shell-play');                       // §8.1 — the only door into a run
await page.waitForFunction(() => window.shadows?.player);
await page.keyboard.press('KeyH');                     // hide the readout, it covers a third
                                                       // of the screen
```

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

**The rig camera clamps to keep the player framed** (§3.2), so the far end of a 12 m beam is
usually at or past the edge of the view. If a measurement needs geometry both near and far,
put it left-to-right across the screen rather than up-screen — the frame is much wider than
it is deep — or shorten the beam through the tuner.

Driving the tuner's sliders is the shipped path for anything marked `needsPush`: find the
`input[type=range]` whose **`parentElement`** text contains the label (not `closest('div')` —
that matches the whole panel), set `value` and dispatch an `input` event.

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
