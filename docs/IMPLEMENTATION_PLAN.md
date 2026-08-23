# Implementation Plan

Build order for `GAME_SPEC.md`. This document is the sequence and the exit criteria only —
every mechanic, constant, and data shape lives in the spec, referenced here by section.
Where the two disagree, the spec wins; if a phase turns up something the spec does not
answer, fix the spec rather than deciding it here.

## Ordering Principle

The dependency spine is **map → player → light → detection → enemies → objectives**. Two
constraints drive it:

- Both enemies are defined entirely by their reaction to light (§5), so nothing about
  either can be validated until the flashlight and a shared "is this entity lit" query
  exist. That query is built once, as its own phase, before either AI.
- Environmental lights (§4.2) are needed by the Shadow Monster's sabotage behaviour *and*
  by the power-routing objective. They are stood up early with a debug toggle, and wired to
  switches later, so the AI phase does not block on the objective phase.

Phases 1–6 are strictly sequential. Phases 7 and 8 are independent of each other and can be
parallelised. Phase 9 depends on 6 but not on the enemies.

## Progress

Where a phase is done, its section carries a **Status** note saying what landed, what was
deliberately left to a later phase, and what it forced back into the spec. A phase is only
"done" when its exit criteria are demonstrable — the notes say how, so the claim can be
re-checked rather than taken on trust.

| Phase | Status |
| --- | --- |
| 0 — Scaffold | **Done** |
| 1 — Map Pipeline | **Done** |
| 2 — Player Controller & Camera | **Done** |
| 3 — Lighting Core & Flashlight | **Done** |
| 4 — Audio Core | **Done** |
| 5 — Navigation & Enemy Base | **Done** |
| 6 — Illumination Detection Service | **Done** |
| 7 — Spider AI | Not started |
| 8 — Shadow Monster | Not started |
| 9 — Interactables, Power & Objectives | Not started |
| 10 — Run Lifecycle | Not started |
| 11 — Content & Tuning | Not started |

## Phase 0 — Scaffold

Vite + TypeScript project, Three.js render loop with the fixed-timestep simulation clock
(§7), resize handling, and a debug overlay (frame time, sim tick, entity count). Stub asset
loader for `.glb` prefabs.

**Exit:** an empty lit scene renders at target frame rate; the sim clock is independently
steppable and pauseable, since every later phase's timers depend on it.

**Status: done.** `src/core/` — `SimClock` (fixed 60 Hz, pauseable, steppable, time-scaled,
with a render interpolation `alpha`), `Viewport` (renderer, pitched camera, resize, shadow
settings from §7) and the placeholder `AssetLoader`; `src/debug/DebugOverlay` carries the
readout every later phase hangs rows off. Covered by `tests/simclock.test.ts`.

## Phase 1 — Map Pipeline

Loader and validator for `map.json` and `tileset.json` (§2): layer decoding, prefab
instancing with the merge/instancing budget from §7, box collider generation from Layer 1,
and derivation of the walkability grid. Entity records are parsed into a typed registry but
not yet spawned beyond placeholder markers.

**Exit:** the example map renders as navigable 3D geometry; the walkability grid is
queryable and visualisable as a debug overlay; an unknown entity type logs and skips
without throwing.

**Status: done.** `src/map/` — validator, prefab instancing, greedy collider merge,
walkability grid with runtime overrides, typed entity registry. `maps/phase1-test` is the
deliberately broken map that exercises every skip-and-warn path, asserted in
`tests/example-maps.test.ts`. Prefabs are still placeholder boxes: no `.glb` art exists
yet, and the loader falls back by name prefix.

## Phase 2 — Player Controller & Camera

Movement, capsule collision against Phase 1 colliders, and the camera rig (§3.1–3.2),
plus the health pool with its regeneration delay and curve (§3.4), driven by a debug
damage key until real enemies exist. Input abstraction covering keyboard+mouse,
gamepad, and touch from the start — retrofitting a second input path onto a mouse-only aim
implementation is the expensive version of this.

**Exit:** the player traverses the example map, slides along walls without catching, the
camera tracks smoothly and clamps at map bounds, and debug damage produces the correct
regeneration delay and refill curve.

**Status: done.**

*Landed.* `src/core/Input.ts` — one snapshot of movement, aim and actions fed by keyboard
and mouse, gamepad, and touch (floating twin sticks plus an on-screen action button), all
three wired from the start rather than retrofitted. `src/player/` — `collision.ts`
(tile-bucketed broad phase and circle-versus-box resolution along contact normals),
`Player.ts` (movement smoothing, aim, render interpolation off the sim clock's `alpha`),
`Health.ts` (§3.4's pool, delay and refill) and `CameraRig.ts` (frustum ground footprint,
bounds clamp, critically damped follow). `maps/phase2-test` is the purpose-built map for
this phase: pillar staircase, doorways, a fence run, a pit, a dead-end alcove, and walkable
floor against all four edges so every camera clamp is reachable. Debug harness gained `V`
(free camera, now off by default), `K` (one spider's damage) and `J` (heal), plus player,
aim, health and camera readouts. Tests: `collision`, `player`, `health`, `camera`, `input`,
and phase2-test fixture assertions — 104 in total.

*Left to later phases.* Interaction (§3.3) waits for Phase 9, which owns the things there
are to interact with; the input layer already carries the `interact` action so nothing has
to be re-plumbed. Health reaching zero logs and stops there — death resolution, the
jump-scare and the damage feedback effects are Phase 10.

*Sent back to the spec.* Four gaps this phase turned up, all now written into
`GAME_SPEC.md` rather than decided in code: the capsule's height (§3.1); that a hole in
Layer 0 stops the player rather than only stopping pathfinding, and that the map edge does
too (§3.1); the rotation convention — degrees clockwise from north, `-Z` — that a spawn
facing is expressed in (§2); and what the camera clamp does when its two rules conflict,
which near a boundary they always do (§3.2). The last is the one worth reading: keeping the
player in frame beats hiding off-map void, so the clamp gives way rather than parking the
player at the screen edge.

*Revised later.* §3.1 originally ruled out a sprint outright. It now has one, at 4.5 m/s,
which locks the aim to the direction of travel while held — the speed is paid for with the
twin-stick independence that lets a player back away with the beam on a threat. §5's speed
table note was rewritten with it, since it had been resting on the player *not* having a
sprint. The turn was first written as a smoothing time constant and is now a bounded
**540°/s**, because angular speed is what a player perceives and therefore what should be
specified; the same rate turns the beam *back* onto the cursor when the sprint ends, since
releasing with the cursor behind you would otherwise whip it through 180° in one frame.

*Known, unsolved.* At a 70°–75° pitch, a full-height wall standing between the camera and
the player hides the player — visible on the example map today with placeholder 3 m walls.
Recorded in §3.2 as a requirement on the art pass rather than papered over here.

## Phase 3 — Lighting Core & Flashlight

The flashlight spotlight bound to aim, the battery charge/drain/recharge cycle with its
intensity falloff and re-enable lockout (§4.1), environmental light entities with a debug
toggle, and the shadow budget and quality settings (§7).

**Exit:** the beam casts hard floor shadows from a test prop; a full drain-to-empty cycle
behaves per spec including the lockout; frame rate holds with the shadow budget saturated.

**Status: done.**

*Landed.* `src/lighting/` — `Battery.ts` (drain, recharge, the intensity falloff and the
lockout, all on the sim clock), `Flashlight.ts` (the one shadow-casting spotlight §7
budgets for, bound to the player's aim), `EnvironmentLights.ts` (a lamp per entity, shaped
to its authored ground pool, powered by group, with §7's two shadow slots re-chosen each
frame by proximity and frustum) and `Ambient.ts` (the night baseline that replaced the
flat placeholder lighting). Filmic tone mapping in the viewport. `maps/phase3-test` is the
map for this phase: a prop field to throw shadows from, seven lamps in three groups —
more than the two shadow slots, so the budget has to choose — and a corridor no lamp
reaches. Debug harness gained `F` (torch), `B` (drain to 5%), `L` (power every group) and
`O` (occluder fade), plus torch and lamp readouts.

*Verified.* The beam's hard shadows and the lamp pools were checked in a browser, not only
in tests. The full battery cycle was driven end to end there too: 5% → drains out → cuts
off and latches → `F` refused → recharges past 15% → relights at partial beam.

*Not verified.* "Frame rate holds with the shadow budget saturated" could not be measured:
this environment renders through a software rasteriser at 7–15 fps regardless of what is on
screen. The budget itself is enforced and tested — never more than two environmental
shadow casters, chosen by proximity within the frustum — but the frame-rate half of the
exit criterion needs a real GPU and is outstanding.

*Sent back to the spec.* The ambient floor the dark sits on and the player's own legibility
in it (§4); the beam's mounting, its derived declination, and the input that toggles it
(§4.1); filmic tone mapping as a render requirement rather than a preference (§7).

*Revised after Phase 5 — the moon.* §4 now calls for a dim, shadow-casting directional
light. Without it the Shadow Monster in the gloom is not merely invisible but absent: no
body, no shadow, nothing until it steps into a beam. Under the moon it is a shadow sliding
across open ground with nothing above it, which is the creature's whole idea. Its shadow
camera follows the player rather than covering the map (§7), since a directional shadow map
spread over 100 m has nothing left for the one shadow the player is meant to read. **A note
for Phase 8:** whatever near-invisible material the monster gets has to keep `castShadow`
working — the shadow is now the thing it is seen by.

*Revised after Phase 5 — the ambient.* The ambient this phase chose was near-black, and that
turned out to be a design mistake rather than a tuning one: with only the beam visible, a spider and the
Shadow Monster are the same shape inside a cone, and §5.2's entire design goes unseen. §4 now
calls for a dim ambient plus fog — dark, not blacked out, with distance rather than darkness
doing the hiding. The values live in `AMBIENT` and `FOG`.

*Solved rather than deferred.* Phase 2 recorded camera-side occluders as a problem for the
art pass. Turning the lights out promoted it: an unlit occluder is not a wall the player
can see over, it is a black rectangle covering the player and their beam, and on the
example map the player spawns behind one. Static geometry inside a cylinder between the
player and the camera is now dithered away in the fragment shader — visible surface only,
so an occluder still blocks light and still casts its shadow, and the fade cannot be used
to see into a room. §3.2 records the rule and its limit.

*Left to later phases.* Nothing consumes the beam as a query yet: "is this entity lit" is
Phase 6, built once for both AIs, and the cheap cone test plus throttled raycast in §4.1
belong to it. Phase 8 drives `Flashlight.intensityScale` for the flicker (§5.2) — the hook
exists and is tested, the curve does not. The flashlight is held from the start; the
pick-up that grants it is Phase 9, as is wiring `PowerSwitch` to the light groups the
debug key currently powers wholesale.

## Phase 4 — Audio Core

Listener, positional source pooling, distance models (§4.3), and the autoplay-gesture gate.

**Exit:** a moving off-screen test emitter is locatable by ear alone.

**Status: done.**

*Landed.* `src/audio/` — `AudioCore.ts` (the listener, a fixed pool of positional sources,
long-lived emitters for entities, and the autoplay-gesture gate), `profiles.ts` (§4.3's two
distance models, plus the arithmetic the debug readout uses to say what the player *should*
be hearing), `SoundBank.ts` (fetch a real file, fall back to seeded procedural synthesis —
the same arrangement as the placeholder prefabs) and `Footsteps.ts` (a step per stride of
ground actually covered). `Z` orbits a test emitter off-screen; the readout reports its
distance, its side, and its expected gain.

*Verified.* The exit criterion is about ears, which no test runner has, so the live audio
graph was tapped in a browser instead — a channel splitter and two analysers on the
listener's own output, measuring what actually comes out:

| Source | Measured |
| --- | --- |
| 8 m east | bias **+0.59** (right) |
| 8 m west | bias **−0.60** (left) |
| 8 m north | bias **−0.00** — centred, exactly the limit §4.3 now records |
| 3 → 8 → 16 → 24 m | level 1.00 → 0.77 → 0.40 → 0.042, against 1.00 → 0.77 → 0.41 → 0.045 predicted by the linear model |
| 28 m and 33 m | default profile silent; monster profile still audible, 8× the default's level at 24 m |

The gesture gate was watched going `suspended` → `running` on the first key, pausing was
watched taking it back to `suspended` and unpausing returning it, and walking for three
seconds at 3 m/s produced nine footsteps against a 0.95 m stride. Those measurements go
through the development-only debug handle (Cross-Cutting), so they run against the dev
server; a production bundle has no handle to reach.

*Sent back to the spec.* The listener rides the player rather than the camera, and why
(§4.3) — with the consequence that north and south of the player pan alike, so distance
carries the rest. The player's own footsteps: driven by ground covered, centred, and
distinct from the monster's. And what a paused simulation does to sound, which §6 implied
and §4.3 did not say: positional sources go silent, the context stays alive, unpausing
resumes rather than restarts. That last one is implemented here rather than deferred,
since writing a rule into the spec and leaving the code disagreeing with it is worse than
either alone.

*Left to later phases.* Nothing on the map makes a sound of its own yet — the emitters an
enemy holds are Phase 5's to create, and `footstep_heavy` and `chitter` are sitting in the
bank waiting for them. Real audio files replace the synthesised placeholders in Phase 11,
changing nothing above `SoundBank`.

## Phase 5 — Navigation & Enemy Base

A\* over the Phase 1 grid with the repath interval and local avoidance (§5), a base enemy
entity with the shared state machine skeleton and movement speeds, spawning from map
entities, and the shared contact check (§5.3) emitting a contact event that each AI
resolves its own way in Phases 7 and 8. No light reactions yet.

**Exit:** a placeholder enemy pursues the player around obstacles, repaths when the player
breaks line of sight, and the grid rebuild on a walkability change is picked up mid-path.

**Status: done.**

*Landed.* `src/nav/AStar.ts` — eight-connected A\* on a binary heap, refusing the diagonal
between two wall corners, with a line-of-sight test that both pulls paths straight and tells
an enemy whether it can walk at the player instead of pathing to them. `src/enemies/` —
the shared `Enemy` (state machine, §5's speeds, repath interval, local avoidance, collision
against the same colliders the player uses) and `EnemyManager` (spawning from map entities,
and the shared contact check). `src/core/rng.ts` gives the per-run seed the cross-cutting
notes asked for, with a named sub-stream per system so one system's draws cannot re-roll
another's; `?seed=` replays a run. `maps/phase5-test` is the map for this phase, `N` draws
enemy paths coloured by state, `X` flips the hovered tile's walkability the way a gate
would, and `Y` switches the enemies off.

*Verified.* Driven in a browser on `phase5-test`, through the debug handle:

| Criterion | What was watched |
| --- | --- |
| Pursues around obstacles | Spiders acquired the player beside a 16 m block, the player ducked round it, and the nearest spider came round to their side — x 42 → 21.6, arriving 10.9 m away. |
| Repaths when line of sight breaks | With the block between them, pursuing spiders held `pursue` and carried a three-waypoint route instead of a straight line; on regaining sight the route emptied again. |
| Grid rebuild picked up mid-path | Shutting the tile a spider was walking to — a gate closing in its face — changed its route from `19,16 10,16 9,11` to `20,17 18,17 10,16 9,11` within 0.7 s, without waiting for the repath timer. |

The contact check also fired at 0.97 m and 0.99 m, against §5.3's 1.0 m threshold, logging
that resolution belongs to Phases 7 and 8.

*Sent back to the spec.* §5 said what enemies do and never said when they start: acquisition
radii (16 m for the spider, 26 m to give up, always for the Shadow Monster) and the reasoning
for deciding it by proximity rather than by sight — an enemy that has to see you first can
never begin a chase around a corner. Also the collision radii the bodies needed, the wander
rule, and what an enemy does when no route exists. The first radii were narrower; widening
them came out of watching a chase die the moment the player stepped behind a building.

*A spec-fidelity bug the tests caught.* §5.1's "velocity drops to `0`" is literal. The first
implementation let a frozen enemy's velocity decay through the usual smoothing, which
carried a pursuing spider 0.41 m further into the player after the beam had already caught
it. `frozen` and `recoil` now zero the velocity outright.

*Left to later phases.* No light reactions: the states are declared and their movement rules
implemented, but nothing enters `flee` or `frozen` until Phases 7 and 8, which also own what
a contact *means*. Enemies make no sound yet — `chitter` and `footstep_heavy` are in the
bank and the emitters they need exist (§4.3).

## Phase 6 — Illumination Detection Service

The single shared query answering *is entity E lit, and by how much* — the cheap
distance/angle test, the throttled confirming raycast, and environmental light coverage
(§4.1, §4.2). Both AIs consume this; neither implements its own.

**Exit:** a debug readout reports lit/unlit per entity correctly through walls, at beam
edges, and inside environmental light radii, at the specified raycast budget.

**Status: done.**

*Landed.* `src/lighting/Illumination.ts` — one service answering *is this entity lit, and by
how much*, with the cone test, the lamp-pool test and the throttled confirming raycast in
one place. `src/nav/raycast.ts` holds the segment-versus-obstacle test it uses, and
`ColliderIndex` gained a box query to feed it. The readout reports lit/unlit per entity with
its source and strength, and the measured raycast rate beside the budget.

*Verified.* Driven in a browser on `phase5-test`, through the debug handle:

| Case | Reported |
| --- | --- |
| Beam on the entity | `lit, 0.55, flashlight` |
| Beam turned away | `unlit` — on the next tick, not the next confirmation |
| 20° off the beam axis (inside the 22.5° half-angle) | `lit, 0.02` — right at the rim |
| 25° off the axis (outside it) | `unlit` |
| Behind the central block, beam aimed at it | `unlit` |
| Under an unpowered lamp | `unlit` |
| Same lamp powered | `lit, 1.00, environment` |
| Budget | `5/s across 4 subjects · budget 10/s each` |

The measured rate sits under the budget rather than at it, because an entity outside every
cone and pool costs no raycast at all: the geometry rules it out first, and only a candidate
is ever confirmed.

*Sent back to the spec.* §4.1 described the cheap test and the throttle and never said what
the query *answers*, which the plan had asked for as "and by how much". §4.1 now carries the
illumination query: lit is geometric — inside the reach with a clear line, so a dim beam
still counts, because §5.1 stuns "the instant the beam hits" and brightness never decides;
the amount is reported beside it for tuning and for a later behaviour that should care;
occlusion is shared with movement, including the admission that the test ignores height and
so errs towards shadowed; and the throttle applies to the *repeat* confirmation only.

*The rule that turned on a contradiction.* A flat 10 Hz throttle would delay a spider's stun
by up to a tenth of a second, and §5.1 says "the instant". Entering a light's reach now
confirms on that same tick, and leaving is instant because the geometry is re-tested every
tick; only an entity that stays inside a cone while a wall comes between them can lag, and
by at most one interval.

*Left to later phases.* Nothing consumes the answer yet. Phase 7 turns it into the spider's
stun and deterrence timer, and Phase 8 into the monster's freeze — which is the point of
building it once here: two AIs asking the same question cannot disagree about it.

## Phase 7 — Spider AI

The four-step light reaction lifecycle (§5.1) on top of Phases 5 and 6: stun, randomised
deterrence timer, flee target selection, and interruption. Also its contact resolution —
damage, mutual knockback, and the post-hit recoil hold (§5.3).

**Exit:** every branch of the lifecycle is reachable and observable in a test map; the flee
raycast never targets an unwalkable point; three contacts from full health kill; one
spider cannot land hits faster than its own cooldown, and two spiders converging both
register inside the same second.

## Phase 8 — Shadow Monster

Near-invisible shadow-casting material, freeze-on-lit, the flicker curve and its severity
ramp, blink stepping, its fatal contact resolution (§5.3), and the environmental light
sabotage lifecycle (§5.2, §4.2).

**Exit:** the monster is trackable by shadow and footsteps alone; sustained focus produces
the flicker ramp and blink; a lamp the monster stands under runs the full
strain/failure/recovery cycle and releases the freeze exactly when it fails; leaving the
cone mid-strain resets it.

## Phase 9 — Interactables, Power & Objectives

Pick-ups, note modals with simulation pause, both switch modes wired to light groups and
gates, gate open transitions with their walkability flip, the exit gate unlock counter, and
the HUD (§6). Depends on Phase 6 only for the interaction prompt's aim test.

**Exit:** a full objective chain — find flashlight, read a note, fire the required latch
switches, open the exit — is completable on the example map with enemies disabled; a
`toggle` switch cuts and restores its light group without touching exit progress.

## Phase 10 — Run Lifecycle

Death resolution from the Phase 5 contact events, the per-enemy jump-scare overlays, the
damage feedback effects — vignette, heartbeat, desaturation (§3.4) — the game-over and
victory screens, and run teardown and restart from a clean map (§5.3, §6). No checkpointing or save system — a run
is one life, so this phase is about tearing the world down and rebuilding it cleanly, not
about snapshotting it.

**Exit:** death and victory both return to a fresh run with no state carried over —
including no leaked timers, audio sources, or lights from the previous run; the objective
chain from Phase 9 is completable end to end with enemies live.

## Phase 11 — Content & Tuning

The real map built in the editor tooling (§1), art and audio passes, and a tuning pass over
the timing constants — deterrence timers, flicker ramp, battery rates, enemy speeds. These
are the numbers most likely to move once the game is playable; expect to amend the spec
here rather than treating the current values as final.

**Exit:** a complete playable run, target frame rates met on both hardware tiers (§7).

## Cross-Cutting

- **Debug harness, from Phase 1 on.** Walkability overlay, entity state labels, lit/unlit
  readout, free camera, and a time-scale control. Most of this spec's behaviour is a state
  machine reacting to light — without visualisation, tuning it is guesswork.
- **A debug handle on `window`, in development builds only.** The overlay is for reading;
  the handle is for reaching — the systems behind every row, addressable from a console or
  an automated check. Some exit criteria cannot be met any other way: Phase 4's is about
  what a player hears, and the only honest way to check it is to tap the live audio graph
  and measure what comes out. It is compiled out of production builds, so verification that
  uses it runs against the dev server rather than a preview of the bundle.
- **Test maps per phase**, small and purpose-built, checked in beside the example map. The
  real map (Phase 11) is the worst possible place to first exercise a flee raycast.
- **Determinism.** Every timer runs on the fixed sim clock (§7); seed the randomised values
  (§5.1, §5.2) from a per-run seed so a bug can be reproduced. With one life per run
  (§6), a bug that only surfaces deep into a run is otherwise expensive to reach — pair
  the seed with a debug warp so late-run state can be re-entered directly.
- **The spec is the source of truth for constants.** Load them from one typed config module
  mirroring the spec's values rather than scattering literals, so Phase 11's tuning is an
  edit in two places, not thirty.
