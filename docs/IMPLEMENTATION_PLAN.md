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
| 7 — Spider AI | **Done** |
| 8 — Shadow Monster | **Done** |
| 9 — Interactables, Power & Objectives | **Done** |
| 10 — Run Lifecycle | **Done** |
| 11 — Content & Tuning | **In progress** — tooling landed, content outstanding |
| 12 — Level Editor | **Done** |
| 13 — Shell: Title, Credits & Debug Mode | **Done** |

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
and mouse, gamepad, and touch (floating twin sticks plus on-screen action buttons), all
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

The flashlight spotlight bound to aim, the battery's drain and intensity falloff (§4.1),
environmental light entities with a debug toggle, and the shadow budget and quality
settings (§7).

**Exit:** the beam casts hard floor shadows from a test prop; a full drain-to-empty cycle
behaves per spec; frame rate holds with the shadow budget saturated.

**Status: done.**

*Landed.* `src/lighting/` — `Battery.ts` (the drain and the intensity falloff, on the sim
clock), `Flashlight.ts` (the one shadow-casting spotlight §7
budgets for, bound to the player's aim), `EnvironmentLights.ts` (a lamp per entity, shaped
to its authored ground pool, powered by group, with §7's two shadow slots re-chosen each
frame by proximity and frustum) and `Ambient.ts` (the night baseline that replaced the
flat placeholder lighting). Filmic tone mapping in the viewport. `maps/phase3-test` is the
map for this phase: a prop field to throw shadows from, seven lamps in three groups —
more than the two shadow slots, so the budget has to choose — and a corridor no lamp
reaches. Debug harness gained `F` (torch), `B` (drain to 5%), `L` (power every group) and
`O` (occluder fade), plus torch and lamp readouts.

*Verified.* The beam's hard shadows and the lamp pools were checked in a browser, not only
in tests. The battery was driven end to end there too, via `B`: 5% → the beam dims as the
falloff takes hold → cuts out at 0% → `F` refused, and still refused after waiting.

*Not verified.* "Frame rate holds with the shadow budget saturated" could not be measured:
this environment renders through a software rasteriser at 7–15 fps regardless of what is on
screen. The budget itself is enforced and tested — never more than two environmental
shadow casters, chosen by proximity within the frustum — but the frame-rate half of the
exit criterion needs a real GPU and is outstanding.

*Sent back to the spec.* The ambient floor the dark sits on and the player's own legibility
in it (§4); the beam's mounting, its derived declination, and the input that toggles it
(§4.1); filmic tone mapping as a render requirement rather than a preference (§7).

*Revised after Phase 5 — the night rig.* §4 now carries a dim ambient, fog, and a moon that
gives the gloom a direction without casting. Shadows exist only where a directed light does,
so a shadow on the ground means something is being lit — which is what the Shadow Monster is
built on (§5.2).

*Revised after Phase 5 — the ambient.* The ambient this phase chose was near-black, and that
turned out to be a design mistake rather than a tuning one: with only the beam visible, a spider and the
Shadow Monster are the same shape inside a cone, and §5.2's entire design goes unseen. §4 now
calls for a dim ambient plus fog — dark, not blacked out, with distance rather than darkness
doing the hiding. The values live in `AMBIENT` and `FOG`.

*Revised after Phase 12 — the battery.* The recharge is gone. §4.1 now gives the run a
single finite supply of light: 10 minutes from full, draining only while the beam is on and
never coming back. A recharging battery made darkness a wait rather than a decision, and it
was the only reason the re-enable lockout existed — with nothing to recover, strobing the
beam against §5.2's freeze costs exactly the light it makes, so the lockout went with it.
`Battery.ts` lost `lockedOut`, and `FLASHLIGHT` lost `rechargePerSecond` and
`reEnableCharge`.

*Revised after Phase 12 — the ambient, again.* The values Phase 5 chose were tuned against
the placeholder boxes, and the real prefab kit that landed afterwards is far brighter: the
same numbers lit the whole map, and §4's ceiling — the floor cannot be read for a route
without the beam — was quietly false. `AMBIENT.intensity` and `MOON.intensity` came down to
a tenth, together. §4 now says outright that they are one setting: the moon is the larger
half of what the ground is lit by, and dropping the ambient alone leaves the tile seams
readable at zero ambient.

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
bank waiting for them. Real audio files replace the synthesised placeholders as they arrive.

*The player's step is a recording now, and it did reach above `SoundBank`.* This phase
expected a real file to be a drop-in — same name, same call, better sound. Four of them
are not: §4.3 now asks for a variant per footfall and no two consecutive steps alike, which
is a name per variant in the bank, a picker on the run's seed (`FootstepVariants`), and a
choice at the call site. The swap is transparent for any sound that stays *one* sound;
a set of variants is a behaviour change, and belongs in the spec rather than in an asset
folder. The cut the four recordings needed, and why, is in `public/audio/README.md`.

*Verified.* Walked on `phase2-test` with a tap on `AudioCore.playAt`:

| | Measured |
| --- | --- |
| Steps fired over one walk | 154, every one played |
| Consecutive repeats | **0** |
| Spread over the four | 41 / 43 / 39 / 31 |
| Stride between steps | median **0.950 m**, against §4.3's 0.95 |
| Loaded from disk | all four; `bank.placeholders` lists only the seven still synthesised |
| Decoded | mono, 0.078–0.118 s, peak 0.499–0.501 |

Level and placement were rendered through an `OfflineAudioContext` carrying the game's own
buffers, `AUDIO_PROFILES.default` and the real master gain — not measured off the live
graph, for the reason in `ORIENTATION.md`:

| | Peak | Bias |
| --- | --- | --- |
| The four variants, at the player | 0.306 – 0.334 (**1.09×** spread) | 0.000, centred |
| `footstep_heavy`, same distance | 0.857 | 0.000 |
| A step 8 m east / 8 m west | 0.160 | **+0.607** / **−0.607** |

The last row is the cross-check on the method: Phase 4 measured +0.59/−0.60 off the live
graph at that distance, so the offline render agrees with the device path where the device
path can be measured. Every variant is comfortably under the monster's step, which is what
§4.3 asks for and what the player's steps cannot get from distance — they play at zero.

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
deterrence timer, flee target selection, and interruption. Also its attack: the wind-up, the
strike that re-checks range, the miss, and the knockback, recoil hold and cooldown that
follow (§5.3). The strike time is the simulation's, so the attack animation is authored to
it rather than the other way round.

**Exit:** every branch of the lifecycle is reachable and observable in a test map; the flee
raycast never targets an unwalkable point; three contacts from full health kill; a lunge
dodged during the wind-up deals nothing and still costs the spider tempo; a spider lit
during its wind-up never strikes; one spider cannot land hits faster than its own cooldown,
and two spiders converging both register inside the same second.

**Status: done.**

*Landed.* `src/enemies/Spider.ts` — §5.1's four steps and §5.3's attack, on top of the
shared enemy. `Enemy.think` became a `protected decide`, so a subclass wraps the shared
behaviour rather than the shared class growing a switch on kind; `EnemyContext` gained the
illumination query and a two-method view of the player, both narrow enough that a test can
supply them without a scene. `EnemyManager` builds `Spider`s for `SpiderEnemy` entities and
hands its one contact check to whichever enemy tripped it. `Player` gained `damage` and
`knockBack`. `attack` joined the state machine, alongside `frozen` and `recoil`, as a state
in which velocity is zero. `src/enemies/SpiderVoices.ts` gives each spider §5.1's chitter.

`maps/phase7-test` is the map for this phase, and every feature of it is one branch: a
26 m walled lane to flee up, a spider with a wall four metres behind it, a dead-end pocket,
open yard for the attack, and a lamp so deterrence can be watched happening to a spider
nobody is aiming at. The `spider` readout row carries the lifecycle, which `state` alone
does not show — stunned and about-to-flee are both `frozen`.

*Verified.* 20 unit tests in `tests/spider.test.ts` over the lifecycle and the attack, plus
`tests/player.test.ts` for the knockback. The rest was driven in a browser on
`phase7-test`, through the debug handle, at seed `phase7` (`scripts/` has no runner for
this; the script is reproduced in the PR):

| Case | Measured |
| --- | --- |
| Beam held on a pursuing spider | froze on the tick it landed; broke at 3.17 s (T_flee 1.0–4.0) |
| The flee leg | 3.02 s (spec 3.0) at up to 3.60 m/s (flee 3.6, pursue 2.4), 10.3 m directly north |
| Where it ended | walkable tile, then back to `pursue` |
| Spider with a wall two rows north, nine seconds of beam | closest row reached 10; the wall is row 9, open again at row 8 — never crossed |
| Spider cornered in the pocket | `flee (cornered)`, 3.02 s, moved 0.00 m |
| Contact | wind-up 0.37 s (0.35 plus the tick contact was reported on), health 1.00 → 0.66 |
| Separation right after the strike | 3.40 m — 0.90 m gap + 1.0 m player knockback + 1.5 m recoil |
| Standing still and taking it | 3 hits in 5.6 s → dead; mean gap 1.88 s against a 1.85 s floor |
| Backing off during the wind-up | 0.00 damage, 0.52 s hold after the miss (spec 0.5), cooldown started |
| Beam on during the wind-up | 0.00 damage, cooldown 0.00 s — a cancelled lunge starts none |
| Spider standing in a powered lamp pool, torch off, player 34 m away | froze, then fled after 1.43 s |
| Raycast budget with four spiders | 8–9/s against 10/s each |

*Sent back to the spec.* §5.1 step 3 said "the furthest walkable point on that vector" and
gave no distance: it is 18 m now, in the spec and in `config`. Two questions the step did
not answer are answered there too — a spider whose away vector is blocked before the first
step cowers for the 3 s rather than picking a different direction, and light does not
re-stun a fleeing spider, because a held beam would otherwise pin it a metre from where the
deterrence started and the flee it just earned would never happen. Step 4 now says the timer
is *continuous* and re-rolls, so flicking a beam on and off deters nothing. §5.1's chitter
now says it stops while the spider is held still: a stunned spider that kept chittering
would be the one cue that gives away a spider holding in the dark.

*Left to later phases.* The attack animation (§5.1) — the strike time is the simulation's
and is already fixed at 0.35 s, so the animation is authored to it in Phase 11 rather than
the other way round. Death (§5.3): health reaching 0.0 does nothing yet beyond reading
`0.00 · DEAD` in the readout, because the jump-scare and the run's end are Phase 10's. The
Shadow Monster's half of the contact check is still unresolved and still logs, which is why
`phase7-test` has no monster on it.

## Phase 8 — Shadow Monster

The never-drawn shadow-casting body (§5.2), freeze-on-lit, the flicker curve and its severity
ramp, the blink, its fatal contact resolution (§5.3), and the environmental light sabotage
lifecycle (§5.2, §4.2).

**Exit:** the monster is trackable by shadow and footsteps alone; sustained focus produces
the flicker ramp and blink; a lamp the monster stands under runs the full
strain/failure/recovery cycle and releases the freeze exactly when it fails; leaving the
cone mid-strain resets it.

**Status: done.**

*Landed.* `src/enemies/ShadowMonster.ts` — the freeze, the severity ramp, the blink and the
fatal contact, on the same `decide` hook the spider uses. `src/lighting/flicker.ts` holds
§5.2's curve as three pure functions, and **both** the beam and a straining lamp go through
it, because §4.2 asks for "the same character" and the reason is a gameplay one: a lamp
straining across the map and a beam starting to blink are the player learning the same fact.
`EnvironmentLights` gained §4.2's lifecycle, with *powered* and *working* kept as two
separate facts so a failure never touches the switch. `blink` joined the state machine. `MonsterFootsteps` and `LampVoices` are the two tells
that work with nothing on screen; `Player.kill` is the contact.

`maps/phase8-test` is the map, and its load-bearing feature is a **pit**: light crosses a
floor gap (§4.1 occludes on obstacles, and a hole is not one) and walking does not, which
makes it the only place a monster can be lit with something impassable between it and the
player — so it is the only reliable way to watch the blink stop short instead of lurching
into it. Two spiders share the map for the comparison the whole design rests on.

*Revised afterwards — the blink is a walk in the dark, not a jump-cut.* Three faults, and
the first was doing real damage: the curve clamped to zero, so at high severity the beam
*switched off* for a tick or two at a time — 17 blackouts in six seconds of focus, `visible`
going false — which reads as the player's torch failing rather than as something reaching
into their light. It is clamped to `FLICKER.floor` (15%) now, beam and lamps alike.

The blink itself was a 2 m displacement over 0.15 s, marched against the grid, silent
because a jump-cut is not eight strides. §5.2 now gives it 0.5 s — the length of a human
blink — with the beam held at the floor for the whole window and the freeze simply lifted:
the monster *walks*, at its ordinary 1.8 m/s, along a route the grid allows, with its
footsteps audible. About 0.64 m per blink once the acceleration ramp is paid, and the dead
time is measured from the end of the window rather than the start (measured from the start,
a cooldown no longer than the blink would let them run back to back).

That made `blink` an ordinary hunting state rather than a pinned one, which is where the
third fault came from: `pinned`, `speedForState` and the acquisition branch all knew, and
`steer` did not — so the first version was unfrozen, pathing, and standing perfectly still.
`hunting()` names the pair now, so the sites that have to agree are one edit.

The fourth was mine and the tests caught it: sweeping the torch away *inside* a blink left
the beam dimmed and the severity ramp open, because the window ran to completion regardless.
A 0.15 s window hid that; a 0.5 s one would not have. A blink now ends on the tick the beam
leaves.

Sent back to the spec: the flicker's floor and why it is not zero, and the blink as a window
rather than a step.

*Revised again — the blink is the light going out, and the rule is physical.* The blink held
the beam at the flicker's 15% floor, which is plenty of light to cast a shadow by. §5.2's
hard rule — never both moving and visible — was therefore enforced *against* the renderer,
by switching the monster's shadow off underneath a beam that was still lit. That keeps the
rule and breaks the world: a creature standing in light and casting nothing is a special case
that has to be remembered every time anything else about it changes.

A blink now puts the beam out. The torch emits nothing for the window, so there is nothing to
cast by and nothing to suppress, and the monster **always casts** — whenever a light is on
it, its shadow is on the floor. The floor stays where it was for the flicker, which is a
different thing: an oscillation down to nothing reads as the torch dying, and the struggle is
the information.

*The bug that made possible.* `IlluminationService` read the battery's charge and not what
the torch was *emitting*, so it had no idea the beam was flickering at all — which is why
`advanceBlink` had to carry the line "whatever the illumination service still calls lit". A
light emitting nothing now lights nothing, and every rule written in terms of light agrees
with what the player can see. It also closed a hole: a lamp reaching the monster mid-blink
was invisible to the sampler, because the flashlight won the source with a beam that was out,
so the monster could have walked under a lamp — lit, moving, and casting.

That leaves one question the sampler could not answer, and `LitSample.inBeam` answers it. The
monster is the one thing that can put the torch out, so asking "is there light on me" during
its own blink returns the darkness it caused and ends the window a tick after it opened. It
asks instead whether the player still has the torch on and pointed here.

*A consequence worth stating.* An honest sampler means a blink is genuinely dark for
*everyone*, and §5.1's spider grace (`resumeDelaySeconds`, 0.2 s) is shorter than the 0.5 s
window — so a spider held at bay breaks free partway through every blink and its deterrence
timer restarts. Measured in a browser with one spider 4 m down the beam: **57% of samples
fleeing with no monster in the beam, 8% with one blinking it, and 31% in `pursue`** — a
Shadow Monster in your light now makes spiders substantially harder to deter. That is what
the light going out means, and it is a balance change §11 should look at rather than a bug;
raising the grace above the blink's length would undo it without making the lighting dishonest
again.

*Verified in a browser* on `phase5-test`, monster held in the beam for six seconds:

| Case | Measured |
| --- | --- |
| Beam fraction during a blink | `0`, and no other value across 61 samples |
| `light.visible` during a blink | `false` |
| `light.intensity` during a blink | `0` |
| Beam fraction outside a blink | never below `0.15` — the flicker keeps its floor |
| Shadow casting, any state | never switched off, in any of 120 samples |

*Verified.* 290 unit tests (up from 256): 21 in `tests/monster.test.ts` for the curve, the
freeze, the ramp and the blink, 8 more in `tests/lighting.test.ts` for the sabotage
lifecycle, 5 for the map. The rest was driven in a browser on `phase8-test` at seed
`phase8`:

| Case | Measured |
| --- | --- |
| Beam lands on it | `frozen` on that tick, severity 0.10 |
| Severity ramp under continuous focus | 0.5 s → 0.25, 1.5 s → 0.53, 3.0 s → 0.86, 5.0 s → 0.95 |
| First blink | 2.32 s — unreachable before ~1.4 s, as the threshold arithmetic requires |
| Six seconds of held beam | 5 blinks, 10.0 m closed; it never walks, so every metre of that is a lurch |
| Beam floor during a deep dip | 0% — an extreme flicker is the light cutting out, not dimming |
| Blink at the pit's edge | 15 blinks, 0 ticks on an unwalkable tile, furthest z = 19.45 against a pit edge at 20.00 and a 0.55 m radius |
| Lamp strain | 1.98 s (spec 2.0) |
| Lamp failure | 3.48 s (spec 3.5) |
| Freeze release | 3.50 s — the tick the lamp died, not one later |
| Recovery | relit at 9.48 s (3.48 + 6.0), straining again at 11.50 s with the monster still under it |
| Control lamp in the other group | `steady`, 100% — never so much as flickered |
| Group power through a failure | still on: an outage is a rolling hazard, not lost progress |
| Leaving mid-strain | one tick out of the pool → `steady`, dwell 0.00 s; 1.9 s back under it is still `steady`, so the count restarted rather than resumed |
| Footsteps | 8 heavy steps in 6 s of walking (1.6 m stride at 1.8 m/s ≈ 1 per 0.89 s) |
| Footsteps while frozen in the beam at 6 m | 0 in 1.2 s — light takes the sound away too |

The headline read was checked by eye, three frames of the same standing pair 5 m from the
player. Beam on: the spider is a lit body and beside it a dark column is carved out of the
pool, running north from where the monster's feet meet the floor. Beam off: the spider is
still a readable shape in the ambient and where the monster stands there is nothing at all —
not a silhouette, not a shimmer. Debug bodies revealed: the shadow's base is where the
monster is. That asymmetry is the entire creature, and it only exists because §4's ambient
is high enough for an ordinary thing to be a shape in it.

One thing the stills cost an hour to get: a beam held on the monster ramps and it blinks out
of frame in under two seconds, so each frame has to be staged fresh. That is the mechanic
working, and worth knowing before anyone tries to screenshot it again.

*Sent back to the spec.* §5.2's flicker formula had a free variable and two unstated
cadences. `f` is 18 rad/s now — just under six dips a second, fast enough to read as a light
struggling and slow enough that a dip lasts several ticks and can be acted on. `random(0.7,
1.3)` is re-rolled every simulation tick, which is what makes successive dips uneven and
stops the blink arriving on a beat. Focus is *continuous*, on §5.1's precedent: losing the
monster from the cone restarts the ramp at 0.1. §5.2 also now spells out that only the
flashlight's interference blinks it and that a monster lit by an environmental light cannot
blink at all — §4.2 pins it under a lamp until the lamp fails, and a blink that carried it
out of the pool would take that away. §4.2 says the lamp's own strain uses the same curve
with severity ramping 0.1 → 0.95 across its 1.5 s. §5.2's footsteps got a stride: 1.6 m,
slower than the player's 0.95 m so the two are never confusable.

*Left to later phases.* Death itself: contact takes the pool to 0.0 and the readout says
`DEAD`, and that is all — input is still live, there is no jump-scare and no game-over, all
of which are Phase 10's (§5.3). The `PowerSwitch` entities on the map still do nothing;
§4.2's groups are driven by the debug key until Phase 9 wires them. No animation work — one
pose, which covered the monster completely until the blink became a walk. §5.2 now asks for
a walk cycle for that window alone, and it is outstanding.

## Phase 9 — Interactables, Power & Objectives

Pick-ups, note modals with simulation pause, both switch modes wired to light groups and
gates, gate open transitions with their walkability flip, the exit gate unlock counter, and
the HUD (§6). Depends on Phase 6 only for the interaction prompt's aim test.

**Exit:** a full objective chain — find flashlight, read a note, fire the required latch
switches, open the exit — is completable on the example map with enemies disabled; a
`toggle` switch cuts and restores its light group without touching exit progress.

**Status: done.**

*Landed.* `src/world/` — `Interaction.ts` is §3.3's target rule as one pure function;
`Objectives.ts` is the run's whole world state (latched switches, powered groups, notes
read, the torch in hand) and resolves an interaction into changes, reporting what happened
rather than drawing anything; `Gates.ts` swings a gate and flips the three things that are
normally static — the instanced tile, the walkability grid and the collider index;
`Notes.ts` loads `notes.json`; `Props.ts` gives the interactables placeholder bodies.
`src/ui/Hud.ts` is the prompt, the note modal and the exit counter, and nothing else — §3.4
is explicit that health is *not* a HUD element.

Two things had to stop being immutable for a gate to open: `ColliderIndex` gained
`removeAt`, and `MapGeometry` now indexes the obstacle layer's instances so one tile can be
re-placed. Both are narrow on purpose — a gate is the only thing in the map that moves.

The example map already authored the whole chain (a torch, two notes, three `latch`
switches on `MainExit`, one on `CompoundGate`, two `toggle` switches on light groups, a
gate and an exit needing three). Phase 9 is the phase that makes it work, so it needed no
new map.

*Verified.* 313 unit tests (up from 290): 23 in `tests/objectives.test.ts` over the
targeting rule, both switch modes, the exit counter and the gate swing. The chain itself was
driven in a browser on the example map with the enemies disabled, at seed `phase9`, pressing
`E` from where a player would stand:

| Step | Observed |
| --- | --- |
| Stood by the torch | prompt `Take the flashlight`, `held=false` |
| Took it | `held=true`, prop gone from the map, prompt gone, and the torch will now switch on |
| Stood by a note | prompt `Read` |
| Read it | modal `Torn shift log`, sim paused, notes 1/2 |
| While reading | the world advanced **0 ticks in 0.8 s**, and the prompt was hidden (§3.3, §6.2) |
| `Escape` | closed, unpaused |
| `toggle` on `YardLights` | 0/5 lamps lit → 3/5 → 0/5 → 3/5 across three presses |
| …and the exit | `0/3` throughout: cutting a light group costs no objective progress |
| `latch` on `CompoundGate` | not walkable on the tick it fired; flipped after **0.600 s** of gate ticks (spec 0.6) |
| Three `latch` switches on `MainExit` | counter `1/3` → `2/3` → `EXIT OPEN`, exit tile walkable, gate swung |
| Re-pressing a fired `latch` | prompt `Already routed`, exit still `3/3` |

*The bug the screenshots caught.* The note modal was drawn permanently, holding the last
note's text over the game. `.hud-modal` sets `display: grid`, and a class selector outbids
the user agent's `[hidden] { display: none }` — so `hidden = true` did nothing. It is a
one-line `.hud [hidden] { display: none !important }` now, and the reason it is worth a note
is that every state probe said the modal was closed: `hud.openNote` was null, the element's
`hidden` was true, and the thing was still on screen. Only a picture showed it.

*Sent back to the spec.* §6.1 did not say what a map with no `Flashlight` entity does; the
player starts holding one, so a map built to exercise one mechanic need not author a pick-up
to be playable. §6.2 did not say what closes a note (the interact action or `Escape`) or what
a `noteId` with no entry does (a placeholder, on the same terms as a missing prefab). §6.4
gave a gate no swing duration and nothing to rotate about: 0.6 s, about the hinge it shares
with a solid neighbour taken in west/east/north/south order, and **walkability and the
collider flip when the swing completes** — a gate that can be walked through while it still
looks shut reads as broken. §6.5 now says unlocking is not something the player does at the
gate: the last switch routes the power and it opens where it stands. §3.3 now says nearest
is measured from the player rather than from the aim axis.

*Left to later phases.* Reaching the open exit does nothing yet — §6's victory condition
(input disabled, an overlay with elapsed time and notes found) is Phase 10's, as is the death
side of §5.3. The props are placeholder shapes; the art pass is Phase 11. Gamepad and
on-screen tap targets for the context action are bound in `Input` but only `E` has been
driven here.

## Phase 10 — Run Lifecycle

Death resolution from the Phase 5 contact events, the per-enemy jump-scare overlays, the
damage feedback effects — vignette, heartbeat, desaturation (§3.4) — the game-over and
victory screens, and run teardown and restart from a clean map (§5.3, §6). No checkpointing or save system — a run
is one life, so this phase is about tearing the world down and rebuilding it cleanly, not
about snapshotting it.

**Exit:** death and victory both return to a fresh run with no state carried over —
including no leaked timers, audio sources, or lights from the previous run; the objective
chain from Phase 9 is completable end to end with enemies live.

**Status: done.**

*Landed.* The phase is mostly a refactor, because "no state carried over" is a question
about structure and not about features. `src/Run.ts` now owns everything that belongs to one
life — the clock, the map, the lights, the enemies, the objectives, the readout rows, the
debug keys — and `src/main.ts` is the shell that outlives it: the renderer, the input
devices, the decoded sound bank, the HUD and the note library. A run cannot dispose itself,
so ending one asks the shell, and the shell disposes the old before building the new.

`src/world/RunOutcome.ts` is the ending as arithmetic: four states, input and simulation
switched off on the same call that starts the jump-scare, and a run that cannot end twice.
`src/ui/RunOverlays.ts` is §3.4's damage feedback and §5.3's two jump-scares and end
screens. `Player` now records which of §5.3's two contact resolutions emptied the pool,
which is all the jump-scare needs to know.

Five things had no teardown and now do: `SimClock` (listeners), `DebugOverlay` (rows, which
close over the run that added them), `AudioTestEmitter` (a held source), `Hud` (an open note
would otherwise survive into the next life), and `MapLoader` (its geometry group).

*Verified.* 323 unit tests (up from 313), ten of them over the outcome ordering and the
§3.4 curves. The exit criterion itself is a census of the live scene across three runs,
taken in a browser on the example map with the enemies live:

| Run | Scene |
| --- | --- |
| 1 (fresh) | 139 objects, 8 lights, 43 meshes |
| 2 (after a death and a restart) | 139 objects, 8 lights, 43 meshes |
| 3 (after a second death) | 139 objects, 8 lights, 43 meshes |

Δ0 on every count. Getting there found two real leaks — a `SpotLight` is constructed with a
default target object, and the flashlight was adding that to the scene before replacing it,
so one empty `Object3D` accumulated per life; and `MapLoader.dispose` emptied the static
geometry group without taking it out of the scene.

Alongside it:

| Case | Measured |
| --- | --- |
| Death | `input=false`, `simulating=false` on the same call, cause `ShadowMonster`, the monster's jump-scare on screen |
| The world after death | **0 simulation ticks in 0.7 s** |
| The jump-scare's hold | 6 × 0.25 s clamped frames → `over` (spec 1.5 s), driven through the live `RunOutcome` |
| Game over | `You were caught`, and `E` starts the next run |
| A restart's state | torch back on the floor, notes 0, exit 0/3, health 1.00, clock reset |
| A pinned seed | identical across runs, so a death is replayable |
| The second death | spider this time, and the spider's jump-scare — the two are distinguishable |
| Victory | `Out · 0:01.3 · 1 of 2 notes found` |
| Vignette | `1 − health` exactly: 0.34, 0.68, 0.87 at healths 0.66, 0.32, 0.13 |
| Desaturation | fires at 0.13, not at 0.32 — the band is below 0.17, which two spider hits do not reach |
| Heartbeat at health 0.30 | 0.88 s between beats against a computed 0.876 s |

*What could not be measured this way.* Wall-clock sampling of the jump-scare through
Playwright is too coarse at this frame rate — the whole 1.5 s falls between two samples — so
the hold is measured by driving the live `RunOutcome` a clamped frame at a time instead.
Screenshots time out while the jump-scare's keyframes are on screen, so the two
presentations are evidenced by their DOM state (`run-scare is-spider` / `is-monster`) rather
than by a picture. Frame rate remains unmeasurable here, as in every phase.

*Sent back to the spec.* §3.4 said the vignette "tightens", the heartbeat "quickens below
0.34" and the image desaturates "at the lowest band", and gave no numbers for any of it:
the vignette's strength is `1 − health`, the heartbeat runs 1.0 → 2.2 Hz between the
threshold and zero, and the image falls to 40% colour below 0.17. All three are functions of
the current value rather than of a damage event, which is *why* they fade on their own as
regeneration proceeds — that is now written down rather than implied. §5.3 now says the
jump-scare's hold is real time because the world has already stopped, and that which enemy
killed the player needs no separate tracking: the spider's contact is a *damage* and the
monster's is a *kill*, so the two are already distinct events. §6 now says reaching the exit
means standing on its tile — a locked exit is a solid tile and cannot be stood on, so the
gate having swung is the whole of the "is it open" test — that elapsed time is simulation
time, so reading a note costs the player nothing, and that both end screens are dismissed by
the interact action or a click.

*Left to later phases.* The jump-scares are CSS shapes, not art, and the end screens are
plain cards; Phase 11 owns how any of it looks. There is no title screen and no options, so
the audio context is still armed by the first input of any kind rather than by a title
screen's (§4.3). The real level is Phase 11's too — everything above was driven on the
example map, which is scaffolding.

## Phase 11 — Content & Tuning

The real map built in the editor tooling (§1), art and audio passes, and a tuning pass over
the timing constants — deterrence timers, attack wind-up, flicker ramp, battery rates, enemy
speeds. The art pass owes the spider a speed-driven locomotion cycle and an attack whose
contact frame lands on §5.3's strike time, and the Shadow Monster a single pose. These
are the numbers most likely to move once the game is playable; expect to amend the spec
here rather than treating the current values as final.

**Exit:** a complete playable run, target frame rates met on both hardware tiers (§7).

**Status: partly done — everything that is not authoring.**

This phase is three content passes and a tuning pass, and none of the four can be done by
anyone who is not looking at the game: the level is designed, the art and audio are made,
and the timings are tuned by playing. What *can* be built ahead of them is the tooling each
pass needs, and that is what landed. **The phase is not done and its exit criteria are not
met.**

*Landed.*

`src/map/audit.ts` — the question the loader does not ask. Parsing tells you the file is
valid; this tells you the level can be *finished*. A gate whose only switch is behind
itself, an exit needing three latches on a map with two, a switch buried in a wall nobody
can stand next to, a note whose text was never written: none of these break anything, and a
player finds them by walking the level twice and concluding the game is broken.

Reachability is computed the way a player earns it, not with a flood fill over the finished
map: flood from the spawn, open any gate whose switch is inside what has been reached, flood
again, repeat to a fixed point. A single pass over the closed map understates the level and
a pass with every gate open overstates it; the fixed point is the only one of the three that
answers the question. It runs at load — so opening `?map=<yours>` reports on what you just
exported — and over every checked-in map in the tests.

`src/debug/FrameStats.ts` — §7's targets are the one exit criterion in the plan that cannot
be checked where the game is built. The instrument can be. Percentiles rather than an
average, because a run that averages 60 fps and drops one frame in fifty is not a run that
hit the target; plus draw calls and triangles, because §7's instancing rule is stated as a
number and is therefore checkable.

`src/enemies/Gait.ts` — the half of the art pass that is not art. §5.1 owes the spider a
speed-driven locomotion cycle and §5.3 owes an attack whose contact frame lands on the
strike; both are numbers a clip is driven by, and both exist now. The cycle advances with
*ground covered* rather than with time, so a wandering spider and a fleeing one both put
their legs where they touch. The attack's progress runs 0 → 1 across the wind-up and the
contact frame is placed where it reaches 1 — so re-exporting the art cannot move when damage
lands, which is what §5.3 asks for. The placeholder spider grew eight legs to make the cycle
visible; the Shadow Monster deliberately has none (§5.2 — one pose).

*Verified.* 350 unit tests (up from 323): 17 over the audit, 10 over the gait. In a browser:

| Case | Measured |
| --- | --- |
| Audit of the example map | 0 findings, 2068 tiles reachable, 0 stranded |
| Audit of every checked-in map | nothing blocking |
| A gate whose only switch is behind it | `gate-locked-out`, blocking, and the ground behind it reported stranded |
| A cascade (gate B's switch behind gate A) | opens, because the fixed point runs again after A |
| A diagonal-only gap | reported stranded: a player cannot squeeze through a corner |
| §7's instancing rule | 2500 tiles → 5 instanced meshes, **6 draw calls** |
| Frame instrument | p50 450 ms here, 67 stalls discarded — the number is meaningless on a software rasteriser, which is the point of building the instrument rather than reporting a figure |
| Spider walking at 2.4 m/s | bob range 0.068 m, leg swing range 0.994 rad against a 0.5 rad amplitude |
| Spider caught by a beam | swing settles from 0.994 rad to 0.001 over two seconds — eased, not snapped |

*The placeholder audio is a library's now.* `SoundBank` synthesises through ZzFX's
`buildSamples` (MIT, zero dependencies) — a parameter set per sound instead of hand-rolled
oscillators and filters. Only the pure half of the library is used: ZzFX's own `play` builds
a mono `AudioContext` of its own, and §4.3 needs every sound to come out of a
`THREE.PositionalAudio` or an unseen thing cannot be located by ear. Every parameter set
pins ZzFX's `randomness` to 0, because each sound is built once into a buffer and replayed
from it — the jitter would vary nothing between plays and only make the buffer differ
between runs, which Cross-Cutting forbids. Loops are composed from shots placed in a
fixed-length buffer rather than synthesised, because a one-shot with a decay tail clicks
when `THREE.Audio` repeats it.

*A test that was measuring the wrong thing.* "The monster's step is lower than the player's"
was checked by zero crossings per second of buffer — which counts a longer sound's silence
against it, and reported the low sound as the high one the moment the two durations
diverged. It now measures crossings per second of *sounding* signal, and a second test
measures what §4.3 actually claims: the share of a sound's energy below 150 Hz, which is
what survives distance. That one failed at first and was right to — the heavy step's noise
was swamping its fundamental, putting 4% of its energy in the low end where it now puts 14%.

*A third-party kit does not fit a project's conventions, and should not be edited to.*
`AssetLoader` normalises prefabs on load instead: centred on the tile in X and Z, and sitting
on the ground plane — upright geometry starting at `y = 0`, floor geometry ending there. That
was a real gap rather than a nicety. The placeholder path had always grounded its boxes
carefully; the `.glb` path took the merged geometry raw, so any real asset would have landed
misplaced. This kit would have put every wall a metre east of its tile and the player five
centimetres underground.

Two things normalisation cannot infer are authored per prefab in `PREFAB_FIT`: which node to
take, because the kit's gate is modelled as a child of a 4 m doorway wall, and a height to
scale to, because its walls are 4 m where this game wants 3. `fitHeight` scales **height
only** — the first version scaled uniformly, which would have shrunk a 2 m wall to 1.5 m and
left a half-metre gap between every tile on a wall run.

*Sent back to the spec.* §1 asserted that assets are 2 m modular and said nothing about what
happens when a kit is not. It now carries the normalisation rule and the two per-prefab
exceptions, because "the assets are on-grid" turned out to be a thing the loader has to
*make* true rather than something it can assume.

*The fit is to the ground a model stands on, not to its silhouette.* Centring on the middle
of the bounding box is right for a box and wrong for anything wider up top: measured off the
files, the tree's canopy pulled its trunk **1.22 m** off its tile — more than half of a 2 m
tile, and the collider stayed where the tile was. The hoop's backboard did the same for
0.86 m. Prefabs are now lined up on their **footing**, the half-metre slab at the height they
meet the ground (`PREFAB_FOOTING`), which moves those two and leaves every other prefab in
the kit bit-identical.

The other axis of the same mistake is grounding on the model's lowest vertex. The tree's is
four vertices collapsed onto **one point** 0.14 m under the trunk — a root tip with no
footprint at all — and `fitHeight` scales that gap up with everything else, so the tree hung
**0.26 m** in the air. `floor_dirt` is the same shape of error the other way up: its flat top
is `y = 0` in the file and its scattered stones stand 0.086 m proud of it, so sinking the
tile by its highest stone put the ground the player walks on 8.6 cm *under* the ground plane
— everything standing on dirt floated by that much, and a dirt tile beside a concrete one was
a step. `PREFAB_FIT.contact` states the height each of those two actually meets the ground at.

*The tiles that are a length of something now know which way they run.* A wall, a fence and a
gate are all modelled as a 2 m run across x with only enough depth to be solid. Placed
unturned, a north–south run of them is a row of disconnected rungs with a metre of daylight
between each — which is what every vertical fence and every vertical wall in the game looked
like. `MapGeometry` reads a facing off the solid neighbours: a module whose footing is longer
than it is deep turns a quarter where the run goes north–south. It is presentation only, and
deliberately so — the tile is solid across its whole square whichever way the model faces, so
the collider merge, the walkability grid and the map format see exactly what they saw before,
which is what lets §2 keep its rule that tiles carry no rotation *in the data*.

*Where the torch is held is now five knobs rather than a pose in the code.* `FLASHLIGHT.hold`
— height, forward, lateral, a pitch trim on the derived declination and a yaw trim off the
aim — all five on the §8.3 panel, all five defaulting to exactly the beam §4.1 derives, so
the spec's beam is where the sliders start rather than somewhere they happen to reach. The
forward offset was a literal in `Flashlight` (`PLAYER.radius + 0.15`), which is the kind of
number CLAUDE.md says belongs in the config; it does now. Where the torch is held and where
it points stay separate: the yaw trim turns the beam and leaves the origin alone.

*A lamp you can see.* §4.2's environmental lights were a pool of light coming out of nothing,
so an unpowered one was not dim, it was *absent* — a level with lamps and no switch wired to
them looked like a level with no lamps in it. There is a post and a shade now, and the head
lights with the lamp and gutters with it through §4.2's strain, which keeps the flicker
readable as the tell §4.2 says it is. Neither piece casts: the light is a point at the top of
its own post, so a post that cast would put a black bar through the pool it exists to throw.

*A rig derived from a mesh, and two ways to bind it wrong.* The player's kit is a posed
model with no skeleton and no clips: unrigged it slides across the ground like furniture,
which reads worse than the capsule it replaced. `src/player/autoRig.ts` derives three bones
from the bounding box and generates a stride, driven by ground covered exactly as §5.1 drives
the spider's. It is meant to be replaced by an authored skeleton and says so.

Both ways it went wrong were silent, and neither looked like a binding bug — they looked like
bad art. Three renders a skinned vertex as `boneWorldNow · boneInverseAtBind · bindMatrix · v`,
re-deriving the mesh's own inverse from `matrixWorld` every frame, so the bind matrix is the
only thing carrying geometry into the space the bones were measured in. An identity there
rendered a Z-up kit flat on its back, several metres from the player. The second was the
measurement: a loader wraps a model in orientation and grounding nodes, so a vertex's own
coordinates, its mesh's and the character root's are three different frames. The rig now
measures, places and binds in one — the node the meshes hang from — and
`tests/autoRig.test.ts` asserts the invariant the whole thing rests on: at rest, skinning
moves no vertex at all. That test only fails under the loader's nesting, which is why it
builds it.

*A body standing beside the player it represents.* Nothing in a `.glb` says where the feet
are. `CharacterLoader` grounded a model on `y = 0` and left it wherever its origin put it
horizontally — and the player's kit comes out of a bundle whose characters are laid along an
axis, 1.5 m from theirs. Measured in the browser: the body's centre at `(5.59, 3.67)` for a
player standing at `(5, 5)`. It now centres horizontally as well as grounding, which is
`standOn` in `CharacterLoader` and four tests over the arithmetic; the spider and the monster
were already centred and did not move.

*Verified in a browser*, since none of this is assertable from a test runner:

| Case | Measured |
| --- | --- |
| The rig, on the loaded player | 3 bones, 7 skinned meshes, 0 plain — every mesh converted |
| Standing | leg angle 0.00°, the clip paused rather than playing in place |
| Walking at 0.67 m/s | leg angles across ten samples: 13.2, 3.2, −21.2, 6.6, 9.7, −18.0, 1.7, 16.3, −11.4, −6.5 |
| Sprinting at 4.5 m/s | still swinging, at the rate the ground goes by |
| Placement | hips at `(5.008, 0.864, 5.003)` for a player at `(5, 0, 5)` — 48% of 1.8 m up, on the spot |
| Body against the player marker | the character's feet land on the projected player position, screenshot `walk.png` |
| Spider and Shadow Monster | centres `(18.81, 31.57)` and `(46.35, 3.35)` against positions `(18.83, 31.52)` and `(46.35, 3.35)`; both grounded at `y = 0`, heights 0.71 m and 2.20 m |
| Every fitted prefab's footing, `poi-test` | all nine centred on `(0, 0)` — the tree's 1.44 m trunk was `(−0.25, −1.22)` off its tile before, the hoop's pole `(0, −0.86)` |
| The tree, grounded | trunk ring at `y = 0.000` exactly; the root point 0.26 m below the floor, where a root belongs |
| `floor_dirt` against `floor_concrete` | both surfaces at `y = 0`; the dirt's stones stand to `+0.086` instead of the tile sinking by them |
| A north–south fence run | one continuous barrier, screenshot `after-fence.png`; a comb of disconnected rungs before it |
| A north–south wall run | one continuous wall, screenshot `after-wall.png` |
| Torch held at `height 0.6, lateral 0.7, yaw 25°` | origin `(20.30, 0.60, 27.55)` for a player at `(21, 27)` and a beam aimed 25° right of the aim — matches the arithmetic to 3 dp, and the pool moves off-centre on screen |
| A lamp with no switch | visibly a lamppost, visibly unlit, screenshot `lamp-off.png`; nothing at all before it |
| The same lamp powered | head lit, pool thrown, the player's shadow across it, screenshot `lamp-lit.png` |

*One mesh, two sizes.* The Shade wore a Ghoul from a different kit; it wears §5.1's spider
now, scaled to the size the spiders were before they halved. §5.2 has always said the
silhouette *is* the creature, and the strongest silhouette available is one the run has
already taught the player to read: they know what a spider's shadow looks like on the floor,
so what the beam finds is that shape, too big, and — alone among the spiders they have met —
not moving. The two sizes are load-bearing rather than decorative, and §5.2 now says so: if
the spiders were this size the shadow would resolve to "probably a spider", and the one hard
way of seeing this creature would stop being hard.

That put a rule in code that the art used to enforce by accident. The Ghoul had no clips, so
"the monster is never animated" cost nothing; the spider mesh has five, and an idle breath
under a held beam is a *moving shadow of a frozen monster* — §5.2's hard rule broken in the
one moment the player is looking straight at it. `EnemyManager` hands the monster's rig an
empty clip map, so the pose it holds is a property of the object rather than a discipline
about how it is driven, and `tests/monster.test.ts` fails if that is undone.

The Ghoul kit left `PREFAB_KITS` with the file, so the credits screen (§8.2) stopped naming
an author whose work is no longer shipped — it is generated from that list, so nothing else
had to change. `tests/prefabs.test.ts` already required claimed art and shipped art to match
exactly, which is what made deleting the `.glb` and forgetting the credit impossible.

*Verified in a browser*, since none of it is assertable from a test runner:

| Case | Measured |
| --- | --- |
| Spider, in scene | collider radius 0.25 m, configured height 0.35 m, rendered span 1.27 × 0.35 × 1.15 m |
| Shade, in scene | collider radius 0.55 m, configured height 0.70 m, rendered span 2.48 × 0.70 × 2.67 m — 1.96× the spider, and close to the 2.34 m the Ghoul spanned |
| Shade in the beam | an unmistakable spider silhouette on the floor with nothing visible casting it, screenshot `shade-in-beam.png` |
| The body behind it (`I`) | the mesh grounded and centred on its collider at its authored rest pose, screenshot `shade-body.png` |
| Both, one beam | the Shade reads as twice the live spider at a glance, screenshot `two-sizes-bodies.png` |
| Shade's rig | 0 clips, nothing playing, after a rendered frame |
| Spider's rig, same mesh | 5 clips, `walk` playing |

*The interior stopped being architecture.* The example map's three brick buildings and its
freestanding cover blocks are gone; the fence is the only wall on the level, and inside it is
a wood of two hundred trees. What the buildings were for — routes to path around, corners to
lose a spider behind, geometry for the beam to throw shadows off — a forest does without
announcing itself as level design.

What settled the tree is in §2 and the orientation notes now, because the intuition is
backwards. **A crown roofs the ground.** The first attempt planted short trees, on the
reasoning that a 26 m trunk at 72° is a dark bar rather than a shape — and 3.7 m canopies
four metres apart buried the floor, which is where the player, the enemies and every shadow
are. The kit's landmark tree works precisely because its canopy is *above* the eye and never
drawn: what is left in frame is trunks, breaking every sightline and throwing every shadow
over ground that stays completely readable. One clear tile between trunks keeps the wood
walkable and the audit clean.

`GeneratedPrefabs` came out of that first attempt and stayed, because §2's surround needs
exactly the tree the interior did not: `tree_small`, built rather than fetched, is what the
band outside the boundary is planted from. The loader builds a prefab where it would
otherwise fetch a `.glb`, and everything downstream — maps, landmarks, colliders,
walkability — treats it as any other prefab.

*Landmarks are instanced now (§7).* One mesh each was fine at nine landmarks and wrong at two
hundred: the map went to 97 draw calls before this and 18 after, with the triangles down from
581k to 467k at the same time. §7's rule about 2,500 floor tiles was always the same rule;
landmarks being entities rather than tiles is what hid that.

*And the notes and switches stopped floating.* They had been cards and boxes hanging at chest
height with nothing under them for every phase since §6 — the class comment even described "a
box on a post" that was never built. §9.2 has the *editor* mount them against a solid
neighbour, which is a placement rule the renderer cannot lean on, and a level whose interior
is open wood has no neighbour to mount against at all. Each carries its own stand now.

*Shadow-only spiders, and why.* Dressing §5.2's monster in §5.1's spider (below) made every
spider in the run invisible — models gone, shadows left. `CharacterLoader` shares materials
between instances deliberately, so the monster turning colour and depth writes off on *its*
body turned them off on the material the spiders draw with. Nothing about the symptom points
at the monster. `Enemy.attachCharacter` gives the monster materials of its own before hiding
it, the sharing that makes ten spiders one upload is untouched, and
`tests/monster.test.ts` fails on the shared material if the isolation is removed.

*A forest edge, not a scatter.* The surround's trees were the kit's tree scaled down, which
brought two problems: `fitHeight` scales Y alone, so a short one is a full-width canopy
squashed flat, and at 3,104 triangles a *dense* band is millions of triangles for scenery
nobody can reach. The surround builds its own tree now — a trunk and two faceted crowns
merged with vertex colours, about fifty triangles, one material, one draw — in the kit's own
palette taken down from its near-neon `#00e72a`, which reads as a few big canopies and would
be a wall of neon at this density. Authored at unit height so an instance's scale is its size
in metres, and scaled uniformly: short means small.

That buys the density the boundary actually needs — and *where* it needs it, which took a
second pass to get right. Spread evenly, the band puts most of its trees in rows nobody can
see: the frustum reaches ~13.7 m sideways at 16:9 (measured by unprojecting the screen
corners onto the ground), a map's own edge holds the player several metres inside that, and
past the first few metres the fog and the absence of any light out there leave a tree as a
slightly different shade of dark. So the near rows are packed to 0.5 m and everything behind
`SURROUND.denseDepthMetres` drops to a lattice four times coarser — **12,233 trees** in one
draw, 612k triangles, with the visible strip four times denser than the evenly-spread band
that preceded it at the same cost.

*The camera stopped letting go of the player, and the world grew an outside.* §3.2 clamped
the rig to the map's bounds so the view never framed off-map void, and the spec was candid
that the two rules fought: near an edge a pitched frustum's far corners overhang the
boundary long before the player does, so the clamp slid the player off-centre exactly where
aiming matters most. With mouse aim that is not a cosmetic problem — the vector from the
player to the cursor *is* their aim, and a camera that drifts changes what a cursor position
means in the corners a player is most likely to be cornered in.

The clamp is gone and the rig is locked to the player. What answers the void is §2's
surround: ground and a scatter of small trees outside every map, in every direction, deep
enough to cover what a player standing on the edge tile can see — derived from
`groundFootprint` rather than typed out, so it cannot drift out of step with §3.2's pitch
and distance. It is scenery only: outside walkability, outside the colliders, outside the
audit, casting nothing, because nothing out there is ever lit.

Two things about it were wrong first and are worth keeping written down. The trees alone
left gaps, and the obvious fix — more trees — is 3,104 triangles each for ground nobody can
walk on; a ground plane covers it in two, and the band went from 250 instances to 156 with a
better result. And that plane, painted `FOG.color` on the reasoning that the fog is what
everything fades into, was *invisible*: §7 draws the background in the same colour, so
fog-coloured ground is the exact colour of the void. It is a lit material now, taking §4's
ambient like the map's own floor.

*The example map is a level again rather than a test rig.* The fence is the level's edge
instead of an interior compound, the gate is set into that perimeter, and the exit is on the
ground the gate opens onto. Trees are scattered through the interior. The old brick wall
around the whole map is gone — the map's own edge holds the player now (`clampInside`), and
what is past it is forest.

*A win the player never earned.* Standing on the exit's tile ends the run, and what stops
that happening early is the exit being a *gate*: solid until the power routes and it swings
(§6.4). The entity had been sitting on a plain floor tile since the map was written, so the
exit was walkable from the first second and the run could be won by strolling onto it with
`0/3` routed. Found by teleporting a test player near the exit and watching the victory
screen appear. The tile is authored correctly now, and `Objectives.escapedAt` checks the
exit is unlocked as well — the tile is the design, the check is what stops the next
authoring slip being handed to a player as a victory. §6.5 says both.

*Verified in a browser* (`?debug&map=example&seed=7`):

| Case | Measured |
| --- | --- |
| Player hard into the map's corner | camera target `(1.50, 1.50)` against a player at `(1.50, 1.50)` — dead centre, where the clamp used to pull it away |
| The ground beyond the boundary | covered: forest floor and canopy, no void, from the corner and from all four edges |
| Surround cost | 12,233 instances in one draw, 612k triangles; **1.40M triangles** and 23 draw calls for the whole scene, 200 landmark trees included |
| Audit of the reworked map | **0 findings** |
| The objective chain | `0/3` routed → exit locked and standing on it does nothing; three latches → `3/3`, unlocked, and the exit ends the run |
| Gate and exit | gate at tile `(25, 46)` in the fence, exit at `(25, 48)` beyond it, on a gate tile flanked by fence stubs |

*Light became terrain.* §5 had both enemies react to light standing in it and ignore it
completely when choosing where to walk, so a spider would path through a lamp's pool to
reach the player and be stunned by the light it had just chosen to enter. They route around
it now, and the two do it differently on purpose: lit tiles leave a spider's grid entirely,
while the Shade merely pays `ENEMY.lightAvoidance.monsterLitCost` to enter one. §5.2's
threat is that it never stops, and a monster a lamp could wall off is a monster the player
can hide from.

The asymmetry is the design and §5 now says so, because it would otherwise read as an
inconsistency to tidy up. A player standing under a working lamp cannot be reached by
spiders at all — and that is an invitation rather than safety, because the one thing that
does not care walks into the pool, freezes there (§5.2 step 1) and starts degrading the
lamp by standing in it (§5.2 step 3). The lamp's flicker is the tell that the trade is being
collected; when it fails the spiders come back and the monster is standing next to the
player. Give both enemies the same rule and that counter disappears.

Three things had to be true for any of it to work, and each was silently false at first:

- **A line that crosses light is not a clear line.** `updatePursuitPath` skips pathing
  entirely when the player is visible, so in open ground the route was a straight line that
  answered to nothing and the whole feature did nothing.
- **The string-pulling has to be judged against the dark.** Smoothing drops every waypoint
  the previous one can see, so a route the monster took the long way round a pool was
  straightened back through it — `PathOptions.smoothGrid` is what refuses that shortcut.
- **`null` from a search is not an empty path.** Empty means *already on the player's tile*;
  conflating the two made an enemy that had caught the player give up on it.

*And light stopped being armour.* §5.3 said light cancelled a lunge outright — a spider lit
during its wind-up never struck. It does now: §5.1's stun stops a spider *advancing*, and
one already inside 1.0 m has nowhere left to advance to. A stunned spider at contact range
starts attacks too, and §5.2's freeze never protected anyone who touched the monster. What
answers a lunge is the 0.35 s telegraph and a metre of walking (§3.1); the torch is a tool
for controlling ground. Two tests that asserted the old rule were rewritten rather than
deleted, because the new rule has something to say about each case they covered.

*Verified in a browser* (`?debug&map=example&seed=99`), since none of it is assertable from
a test runner:

| Case | Measured |
| --- | --- |
| Player standing in a 6 m lamp pool, spider 11 m off | spider lit on **0 of 900** ticks, closest approach 11.02 m, state `flee` throughout, no damage taken |
| The same, with the Shade left in | lamp on → both frozen in the pool → **lamp fails at t≈4.5 s** → spiders resume and reach the player: §4.2's sabotage is the counter to camping, unscripted |
| Spider held on the beam's centreline at 0.9 m | lit on **420 of 420** frames, seen both `frozen` and `attack`, **3 hits**, player 1.00 → 0.00 |
| Player walking into a lamp-frozen Shade | dead on the tick of contact |
| Cost of ten seconds of simulation | **29.7 ms** for the whole sim including every repath — the per-search memo keeps §5's tile queries off the frame |

*The one stall in the game was a shader compile.* Turning the lamps on for the first time
hitched for a fraction of a second, and never again on any later toggle — the flashlight
never did it at all. Three keys a shader program on how many lights are *visible* and how
many of them cast shadows, so a lamp coming on is a new key for every material on screen at
once, compiled inside the frame that switched it; the torch escapes because it is in the
scene from the first frame and is compiled during load with everything else. Measured with
`renderer.info.programs.length`: six new programs per lighting state, 6 → 12 → 18 → 24 as
the groups were switched in turn.

`EnvironmentLights.precompile` now poses every lighting state a run can reach and compiles
against it while the level loads — each number of lamps a `PowerSwitch` could light at once,
each number of shadow slots that could be filled at that count (a slot goes only to a lamp
on screen, so it is not fixed by the lit count), with the torch lit and dark. It is
synchronous on purpose: a posed light is a lit lamp, and yielding between poses would show
the player a map flashing on and off. It runs again when the character bodies land, because
those arrive after the run is built and bring materials the first pass could not have seen.

The verification is the whole point and it is one number: **216 programs after load, and
216 after every combination of both groups on and off with the torch lit and dark**. 326 ms
added to the load on this software rasteriser, against a hitch at the moment the player does
the thing the level is about. §7 says the rule; `tests/lighting.test.ts` covers which states
get posed and that every light is put back exactly as it was found.

*The frame rate is still outstanding*, on a software rasteriser as always (§7).

*The beam you can see, and the hand holding it.* A `SpotLight` lights the surfaces it
reaches and nothing in between, so a torch in a dark room was a pool on the floor with no
visible connection to the player. `src/lighting/LightShaft.ts` draws the haze inside the
cone: a proxy cone rasterised front faces only, raymarched per fragment, each sample tested
against the light's own shadow map. Sampling the shadow map rather than fading a cone mesh
is the whole design — an unshadowed shaft passes through the wall the light stops at and
glows on the far side, which contradicts §4's rule that a shadow on the ground means a light
is on something. It is also what ties the feature to §7's budget: no shadow map, no shaft,
so the flashlight always has one and exactly the two lamps holding §7's environmental slots
do, fading in over 0.4 s as the slots change hands.

Three bounds do real work and each is load-bearing. The march *starts* at the rasterised
fragment, because a cone is convex and a ray that enters one crosses a front face on the way
in — so the entry point is free and no ray-cone intersection is solved in the shader. It
stops at the light's range, and it stops at the floor: §7 has the floor receive shadows and
not cast them, so the shadow map cannot tell the march the ground is there, and most of the
flashlight's cone is *below* it once §4.1's declination is applied. Without the floor clamp
the beam glows through the ground it is lighting.

`src/player/ArmIk.ts` and the arms `autoRig` now derives are the other half. §4.1 decides
where the beam is emitted and the hand goes there, never the reverse: solving it the other
way round would hang the light off the walk cycle's bob and quietly break the mounting rule
that keeps the player out of their own shadow. It is also what makes §4.1's five `hold`
knobs behave — moving the torch up, forward or off to the hand's side takes the arms with
it, because they are solved against wherever the beam ended up rather than posed to a
position somebody wrote down. The arms are found the one way a bounding box
can find them — a standing figure's arms are the outermost thing above its waist — and the
shoulder and hand come from centroids of the innermost and outermost slices of that run
rather than from single vertices, which on an arm half a metre long is the difference
between a joint and a fingertip. Both hands carry, which also settles a question the mesh
cannot answer: a bounding box knows which side of centre a vertex is on, not which side is
the model's right.

The kit's reach is short and the solver says so rather than hiding it — an unreachable
target gives a straight arm that stops where it runs out, and `TorchBody` draws the barrel
from wherever the hand got to out to where the beam starts. That is why the torch is drawn
between two points instead of parented to the hand: the two ends are decided by different
things and neither yields.

*A body that was the same colour all over.* §4's readability allowance was a flat emissive
added to every material, and at §4's ambient it was most of what the unlit player was — the
kit's red shirt, bare arms, yellow wristbands and black shorts all came out one pale
blue-grey, and the character read as a ghost. It is now a fraction of each surface's *own*
colour, which is what a very dim light on them would do. Not a shininess problem, which is
where the eye goes first: the kit's metalness is 0.4 and dropping it to zero changed the
unlit body by nothing visible, because the emissive was swamping everything either way.

*Tunable, because the two new numbers are look values.* §8.3's panel gains beam haze, lamp
haze and the readability lift. All three were read once at construction, so they join the
beam's cone and the night's two lights in `Run`'s re-push.

*Verified.* 561 unit tests (up from 529): 10 over the two-bone solver, 9 over the arm
weighting and the rig it builds, 9 over the shaft and the lamp handover, 3 over the
readability lift, and one over a thing that had just bitten — `TuningPanel` writes a heading
whenever the group changes as it walks the list, so a knob filed under `Player` but sitting
between the light ones prints a second `PLAYER` heading half a panel down. Nothing throws;
the panel just looks broken.

In a browser, on `phase3-test` and — where a wall with floor on both sides was needed —
`example`, since none of this is assertable from a test runner:

| Case | Measured |
| --- | --- |
| The rig, on the loaded player | 2 arm chains, `armUpperL` / `armUpperR` |
| Arms with no torch | both hands at `y = 0.872` — hanging, from shoulders at ~1.35 m |
| Arms holding the torch | both hands 0.18 m from the beam's origin, at `y = 1.525` |
| The hand against the walk's bob | walking 5.3 m → 12.4 m, the hips move 20.9 mm and the hand-to-beam gap 8.3 mm |
| §4.1's `hold` knobs, dragged in §8.3's panel | 0.35 m to the right moves the origin to `(19.59, 1.60, 13.49)` and the hand follows to `(19.70, 1.54, 13.55)`; 1.9 m up takes the hand to `y = 1.671` and opens the gap to 0.319, which is the short reach showing rather than hiding |
| Haze inside the beam | +12.4/255 against the same frame with the shaft off |
| Haze outside the cone | +0.00, exactly |
| Haze over a crate's floor shadow | +4.3, not 0 — the air *above* a low crate's shadow is still lit, so partial is the right answer here and this measures nothing about clipping |
| Beam held on a 3 m wall with open floor behind it | +31.8/255 in the air before the wall; **0.0 across every one of the ~185,000 pixels behind it** |
| The same, with the walls taken out of the shadow map | +13.8 behind the wall, peak 25 — the control, and the only thing that proves that region was inside the cone to begin with |
| The same, with the occluder at ~90% of the shadow camera's far plane | still 0.0 — the negative bias a mid-air sample needs does not leak where depth precision is worst |
| The shaft over the whole frame | 3.86% of pixels changed by more than 6/255, peak 186 |
| Lamp haze at 0.018 | 36% of pixels, mean 32/255 — at 0.06 the pools blow out, which is what set 0.018 |
| §7's cost | 3 extra draw calls and 72 extra triangles for three shafts |
| Shadow slots | 7 lamps lit, 2 casting, 2 shafts |
| The unlit body | red shirt, skin, yellow wristbands and black shorts all legible, screenshot `after-unlit.png` |

Frame rate is not among them, for the reason it never is here: a software rasteriser. The
shaft is the first thing in this project whose cost is *per fragment* rather than per draw
call, so it is also the first whose §7 budget cannot be argued from draw calls alone — the
step counts are in `config.ts` and the density sliders are in the tuner precisely because
that judgement has to be made on real hardware.

*Outstanding — the phase's actual content.*

- **The real level.** Authored in the external editors §1 names and dropped into
  `public/maps/`. Every map in the repo is scaffolding and none of them is the level.
- **The art pass — the models are in, the authoring is not.** `public/prefabs/` holds a real
  CC0 kit (KayKit Dungeon Remastered 1.0, Kay Lousberg, CC0 1.0), pinned to a commit and
  vendored with its licence; the six prefab roles all load from `.glb` and no placeholder box
  remains on the example map. The player, the spider and the Shadow Monster all have bodies,
  loaded through `CharacterLoader` rather than `AssetLoader` — a prefab is merged into one
  geometry with every node transform baked in, which is right for a wall and is deleting the
  skeleton for a character. Still outstanding: the audio, the level itself, and a real
  authored rig for the player (below).

  **The kit is medieval stone, and the prefab names are not.** `floor_concrete` is a
  flagstone and `fence_chainlink` is a timber barrier. The names are the *roles* the map
  pipeline asks for and predate the kit, so this is a map-data question (`tileset.json`) and
  not a code one — but it does mean the game currently looks like a dungeon rather than the
  modern-industrial place the names imply. Swapping kits is deleting six files: a prefab
  with no `.glb` falls back to a placeholder box, which is how it looked before.
- **The audio pass.** Real files replacing the synthesised placeholders; the bank already
  falls back, so this is a drop-in. The placeholders themselves are ZzFX parameter sets now
  rather than bespoke DSP (below), which makes them cheap to iterate on in the meantime.
- **The tuning pass.** Deterrence timers, attack wind-up, flicker ramp, battery rates, enemy
  speeds. Every one of them is a `config.ts` value citing its spec section, so a change is
  an edit in two places — but which way to move them is not knowable from here.

  A first pass rescaled every speed down by a third, on playtest feedback that movement was
  insane. It was reverted: the report was real but the cause was not the numbers — see the
  frame-loop bug below — and compensating for a bug by editing the design would have left
  the game a third too slow the moment it was fixed. What survived is what was true either
  way: `tests/player.test.ts` asserts §5's *ratios* rather than its values, and two tests
  that had a speed baked in as a distance ("walks past x = 11", "closes 3 m in two seconds")
  now derive it from the constant and the time.

- **A second frame loop, running the world at a multiple of real time.** Reported as
  "instantly moving from corner to corner of the map"; found by counting `SimClock.advance`
  calls per animation frame in the browser. `Run` re-registered its own
  `requestAnimationFrame` at the end of every frame while `main.ts` was already driving it,
  so the clock had two drivers. Worse, rAF hands its callback a *timestamp*, so the second
  driver passed `performance.now()` in milliseconds into a parameter measured in seconds —
  and the clamp in `advance`, which exists to bound one long frame, turned each of those
  into a whole 0.25 s of simulation. Measured before the fix: **12.75 simulation seconds in
  8 real ones**, with 51 `advance` calls across 6 animation frames and deltas up to 10,561.
  After: one call per frame, deltas 0.167–0.200 s, and **8.03 simulation seconds in 8 real
  ones**. Nothing stopped the stale loops on teardown either, so every restart added another
  driver and the game got faster the longer it was played.

  The debug readout had been saying so for weeks — `frame 9579604.10 ms (0 fps)` is
  `performance.now()` read as a frame time — and it was dismissed as a software-rasteriser
  artefact every time it appeared in a screenshot. §7 now states the rule the code was
  breaking, and `tests/run.test.ts` fails if a run drives itself again.

- **§7's frame rates on both tiers**, which stay unverified for the same reason they have in
  every phase: this environment renders through a software rasteriser.

## Phase 12 — Level Editor

§9's tile editor, served from the same site: two tile layers with paint, erase and
rectangle tools, entity placement with a properties sheet, undo/redo, the `facing` mount
rule (§9.2), the audit running live, clipboard export, autosave, and the hand-off that
plays a level without a round trip through the repository (§9.3).

Ordered before the shell because it unblocks the thing nothing else can start without: the
real level (§1, Phase 11). Every map in the repository is scaffolding until this exists.

Touch-first, because §9 exists to be usable on a phone. That is a constraint on the whole
design and not a coat of paint at the end: targets sized for a thumb, pan and pinch rather
than scroll wheel and drag, and no interaction that needs a hover state to be discoverable.

**Exit:** a level can be authored end to end on a phone — tiles, entities and their
properties — and played from the editor without saving anything; the audit's findings are
visible while editing; the exported JSON loads in the game unchanged; and a note cannot be
placed where the camera could not read it.

**Status: done.**

`?edit` boots the editor instead of a run. `src/editor/Document.ts` is the level as data —
two layers and an entity list in §2's shape, with snapshot undo — and it is where the rules
that can be tested without a browser live. `src/editor/palette.ts` holds the tile and entity
choices and §9.2's mounting maths. `src/editor/TileCanvas.ts` draws and owns the gestures;
`src/editor/EditorApp.ts` is the chrome around them.

Three things are worth knowing about how it turned out.

**A rectangle is one edit.** The tool previews while the finger is down and commits on
release, so dragging out a building costs one undo rather than one per tile crossed. Painting
still commits per tile entered, which is what a brush should do.

**The audit is the game's own.** The editor runs `parseMap` and `auditMap` on every change
rather than reimplementing either, so what the editor calls a valid level and what the game
calls one cannot drift apart. It is also the check that catches an entity placed on a solid
tile — it comes out as an unreachable note or switch, which is what that mistake actually is.

**The palette is a contract with the tilesets.** The editor writes ids, and an id the map's
`tileset.json` does not define renders as nothing (§2). Crates (id `6`) were in the palette
and missing from three checked-in tilesets, including `example` — the one §9.3's playtest
borrows — so a level drawn with crates would have played without them. All seven ids are now
defined by every tileset, and `tests/editor.test.ts` fails naming the map and the id if that
stops being true.

*Added afterwards — stamps (§9.4).* A fifth tool: `src/editor/stamps.ts` holds the
definitions and the expansion, `EditorApp` holds the palette, the quarter-turn button and
the preview. Three stamps to start — a soccer field, a playground and a grove — each of them
the arrangement of §2 landmarks that motivated the tier in the first place.

The design decision is that a stamp is a way of *drawing*, not a kind of thing a level
contains: placing one expands it into ordinary tiles and entities, and `map.json` has no
trace a field was ever placed. Move a goal afterwards and it is a field with a goal moved,
not a broken instance. That keeps §2 flat — a stamp surviving into the file would be a
container, and the walkability derivation, the pathfinder, the audit, the validator and undo
would each have had to learn about containers. The cost, and it is real, is that there is no
way to change every field in a level at once; a level is authored once and played many
times, and a format simple to *read* is worth more than one convenient to bulk-edit.

Rotation is quarter turns, because the grid is square and free angles would mean tiles at an
angle. It rotates the entities' own `rotation` as well as their positions, which is the part
worth testing: the pitch's goals face each other, and positions alone would give a field
with both goals facing the same way. `tests/stamps.test.ts` covers the expansion — cells
staying inside a footprint whose axes swap on odd turns, four turns returning to identity,
rotations normalised into 0–359, and the expansion naming nothing that refers back to the
stamp.

*And afterwards again — making them (§9.4).* The three shipped stamps were definitions in
the source, which meant a level designer could use a soccer field and could not make one.
`src/editor/stampLibrary.ts` closes that: a stamp is captured from the map by drawing the
arrangement with the ordinary tools and dragging a rectangle round it.

Capture rather than a second canvas, because a stamp is made of nothing but tiles and
entities — that is §9.4's whole point — so the map is already the right surface to author one
on. A separate stamp editor would have been a second canvas, a second tool set and a second
undo stack for drawing the same things the same way, and it would have broken the loop that
makes this worth having: place a stamp, fix what landed, capture the result as a better one.

A capture takes **every cell in the rectangle, empty ones included**, so a yard captured
with no walls in it clears the walls where it lands. That is what "writes over what is under
it" has to mean for laying ground to work at all — and it is the one thing a definition can
say that a capture cannot, since the shipped stamps write single layers and leave the rest
standing.

*A gap the captures opened.* `expandStamp` rotated an entity's `rotation` and nothing else.
None of the three shipped stamps carries a `facing`, so nothing noticed; a captured stamp
routinely does, and `facing` is *which wall a note is mounted on* (§9.2). Rotated without it,
the note stays pointing at a wall that has moved. Every angle an entity carries now turns
with the stamp, and because a quarter turn can leave a note facing north — where §3.2's
camera cannot read it — placement says so rather than laying down an unreadable note.

*The library, in and out.* Captured stamps sit beside the autosaved draft in browser storage
and survive a reload. The whole set copies to the clipboard as JSON and pastes back the same
way, which is §9.3's rule applied to stamps: no file system, no download permission, nothing
that fails on a phone. Import replaces by id rather than appending, so pasting back an export
gives what was exported and not two of everything, and a captured stamp can never take a
built-in's id — deleting one would otherwise delete a definition out of the project from a
text field.

Tiles are run-length encoded per layer over the footprint's row-major index, and the runs are
printed on one line. That is the difference between an export somebody pastes into a message
and one they do not: a captured 12 × 10 yard is **340 characters**, against 720 with the runs
indented per number and some six kilobytes as one object per cell. The codec is lossless in
both directions, which is the part that matters — a grove that touches one layer has to come
back touching one layer, or an imported grove would flatten walls the one in the project
leaves alone.

*And the third source — `public/stamps.json`.* Captured stamps live in one browser, so a
piece was only ever as permanent as its site data. The editor now loads the level's pieces
from a file in the repository, in exactly the format the export produces, so a stamp pasted
into a conversation and committed is present on every device and visible in a diff when it
changes.

Three sources, layered by id: defaults, then the project's, then this browser's, each
replacing an earlier one of the same id rather than sitting beside it. One id is one stamp,
so the palette never shows two things with the same name and no operation has to guess which
was meant. Only the top layer is deletable and only the top layer is exported.

The load is asynchronous and nothing waits for it, so a slow, missing or malformed file costs
the pieces in it and never the editor. There is no content-type probe of the kind the `.glb`
loaders need (§1), because parsing JSON *is* the reliable test: a static host answering an
unknown path with `index.html` and a 200 fails it immediately and for free.

*Editing a piece, which the first cut of this could not do.* A stamp could be added and
deleted and nothing else, so fixing one meant capturing it again under a second name and
being left holding both — and a committed piece could not be touched at all. Every stamp now
renames, re-cuts from a rectangle in place, and deletes, from one sheet rather than more chips
at the end of a strip a thumb flicks through.

A committed piece is edited by taking a copy of it, *under the same id*. That is the whole
reason the layers replace by id rather than renaming aside: the copy covers the original in
the palette, edits like anything else, and exports under the id it came from, so it lands back
in `stamps.json` over the entry it replaces. Delete the copy and the committed piece returns.
The alternative — a `soccer-field-2` that has to be renamed by hand on the way into the file —
is the kind of step somebody forgets exactly once.

Renaming moves the label and not the id. The id is what an override points at, and a rename
that moved it would quietly unhook a copy from the piece it was replacing. It does mean a
stamp renamed after capture keeps its original id, which is visible in the export and is
tidied when the piece lands in the file.

*And afterwards again — properties edited as what they are, and the audit read as sentences.*
Two gaps that only show up once somebody authors a level rather than a test map.

`mode` was a bare text field. §6.5 needs `latch` switches, the audit says so in as many words
on every map that lacks them, and the only way to make one was to already know the word and
type it into a box that gave no hint it wanted a word at all — an editor asking for something
it gave no way to supply. Any property with a fixed set of values is a row of buttons now
(`mode`, `locked`), and any property naming something else on the map offers the names the
level already contains, so a switch is wired to a lamp by picking its group instead of
spelling it the same way twice.

The audit was reported as a count. `3 warning(s)` is what an author reads while placing lamps
that will never come on, with `light group "Yard" has no switch and can never be powered
(§4.2)` — the sentence that would have told them exactly what was wrong — sitting unread
behind it. The status line carries the first finding in full now and a `Checks` panel carries
the rest, incomplete entities included.

*Sent back to the spec.* §9.4 argued that expanding on placement costs the ability to change
every field in a level at once. It does, and the cost is nothing: a stamp is a *piece* — the
soccer field, the playground, the loading bay — and a level places roughly one of each. The
objection assumed a level with many fields in it. There is one.

*Verified in Chromium on a 480 × 860 touch profile, against the dev server.* A
`stamps.json` holding one `Loading bay 6×4` appeared in the palette after the defaults,
offered no Delete when selected, placed as the wall its runs describe, and did not appear in
the export.

| Case | Measured |
| --- | --- |
| Rename a captured stamp | `Bay 12×8` → `Loading bay 12×8`, in place in the palette |
| Replace it from a 17×15 selection | `Loading bay replaced · 17×15`; one entry, not two |
| Edit sheet on a default | offers only "Take a copy to edit"; the copy's sheet says it exports over the original |
| Fork and rename the soccer field | palette reads `The pitch 12×8`, still first — an override does not move to the end |
| Export after forking | `[["bay", "Loading bay"], ["soccer-field", "The pitch"]]` — the fork keeps `soccer-field` |
| Revert the fork | `Reverted to the default Soccer field`, and the default is back in the palette |
| Stamp palette before any capture | `New from selection`, the three built-ins, `Rotate 0°`, `Edit` |
| Capture a 12 × 10 rectangle | sheet reads "New stamp from 12×10 tiles"; saved as `Back yard 12×10` |
| A map with a lamp on `Yard` and no switch for it | status line reads the finding in full; `Checks` lists it beside the exit's latch count |
| A switch's `mode` | a `toggle` / `latch` pair of buttons; tapping `latch` moves the exit's audit from "has 0" to "has 1" on the next frame |
| A switch's `targetId`, on that map | offers `Dock`, `MainExit`, `SideGate`, `Yard` — every group and gate id the level names |
| Palette after | the built-ins, `Back yard 12×10`, `Rotate`, and `Delete Back yard` — the delete offered only for a captured one |
| Placed at 90° | an 8 × 5 wall block lands as 5 × 8, and the chip reads `Back yard 10×12` |
| Export | 340 characters, layer 0 as the single run `[0, 120, 1]` and layer 1 as 33 numbers |
| Reload the browser | `Back yard 12×10` still in the palette |
| Paste an edited export back | `1 stamp(s) loaded`, listed beside the original rather than replacing it |

`tests/stampLibrary.test.ts` covers the parts a browser cannot show: the capture keeping the
empty cells, a drag in either direction giving the same stamp, rotation lifted out of the
properties so there is one copy of it, the codec round-tripping every built-in unchanged, a
malformed entry costing that entry and not the paste, and the library surviving a store that
is missing, full or full of nonsense.

*Verified in Chromium against the dev server.* One soccer field placed: 96 dirt tiles
(12×8), three landmarks, goals at (14,12)@90° and (23,12)@270° — 180° apart, facing each
other. Rotated and placed a second: 192 dirt tiles, six landmarks, its goals at (27,18)@180°
and (27,27)@0°, so the facing survives the turn. A drop off the left edge placed nothing
(§9.4 refuses rather than clipping). Undo took each field back in exactly one step, and the
second undo returned the document to its one spawn entity.

*Verified in Chromium on an iPhone 13 profile (390×844, DPR 3, touch events), against the dev
server.* Paint places one tile and erase clears it. A rectangle dragged (4,4)→(9,8) leaves
nothing until release, then 30 tiles; one undo removes all 30 and one redo restores them. A
note placed south of a wall block is offered `S` only — never `N`, which §9.2 forbids — and
one placed in open ground is refused with the reason. An entity with an unset required
property holds the status bar until it is filled. Every control clears a 44 px target and the
toolbar scrolls rather than hiding Copy and Play at 390 px wide.

The hand-off was driven end to end: `phase8-test`'s level opened in the editor (`1 warning ·
666 tiles reachable`), Copy produced 19,395 characters whose layers are byte-identical to the
file it came from, and Play loaded it into the game — `34×24 @ 2m`, 918 tiles in 4 instanced
meshes, 666/816 walkable, 10 entities, `0 blocking`, with the debug overlay on. Standing still
in the dark on that map, the monster caught the player, which is the level actually running
rather than merely parsing.

Two fixes went in beside the editor. `?map=playtest` with nothing in storage now says so,
instead of fetching a `maps/playtest/` that does not exist and failing on the dev server's
index page. And the tileset gap above.

*Left to Phase 13.* The editor is reached by URL; the title screen is what will link to it.

## Phase 13 — Shell: Title, Credits & Debug Mode

§8: the title screen the audio context is armed from (§4.3), the credits generated from the
constants the game already loads its assets by (§8.2), and debug mode moved from
on-by-default to behind `?debug` (§8.3).

**Exit:** a run is reachable only through the title; a fresh load shows no diagnostics and
no debug keys; `?debug` restores everything the Cross-Cutting harness describes; the credits
name the art, the libraries and the designer, and adding a dependency changes them without
anybody editing a screen.

**Status: done.**

`src/ui/TitleScreen.ts` is the title and the credits; `src/ui/credits.ts` is what they *say*,
derived from `PREFAB_SOURCE` and `CREDITS` rather than written out; `src/core/options.ts` is
what the URL is allowed to turn on. `main.ts` no longer starts a run on load — it builds the
title and waits.

**`Play` is where the audio context starts** (§4.3, §8.1), and it needed a method that did
not exist. `AudioCore.armGesture` waits for the *next* gesture, and a listener added while a
click is already dispatching does not hear that click — so pressing Play would have armed the
context for whatever the player touched second. `resume()` starts it from inside the handler,
which is the one place a browser allows it.

**Debug mode is one flag, read in one place.** `parseShellOptions` returns `debug` and gates
`?map=` and `?seed=` behind it, because a player following a link into `phase7-test` is
playing a fixture and one with a pinned seed is replaying a run somebody already knows. The
readout starts hidden *and unsampled* — the rows close over live systems and formatting them
several times a second is work a player should not pay for — and the keydown listener is not
registered at all without `?debug`, so there is no key a player can press to find a different
game. `?edit` stays open: authoring a level is not debugging a run, and §8.3 now says so.

*Verified in Chromium on an iPhone 13 profile.* A plain load shows the title with `Play` and
`Credits`, no run built and no readout in the DOM. Credits list Zack Newman, then KayKit with
its author and CC0 (and the line saying CC0 required none of it), then three.js, ZzFX, Vite,
TypeScript and Vitest with their licences; `Back` returns to the title. `Play` builds the run
and the title goes away, leaving the HUD as the only thing on screen. Pressing `P` on that
build does nothing; on `?debug` it pauses the clock — which is the honest way to ask whether
the debug keys are live, since the effect is on the handle. `?debug` also adds the `Editor`
button and shows the readout.

*Added afterwards — the balance tuner.* §8.3 gained a panel of sliders over the values
Phase 11 has to settle: player walk and sprint, the aim turn rate and acceleration, every
enemy speed, the spider's scare-time range (`T_flee`) and its flee and attack timings, the
monster's blink window, cooldown, threshold and severity ramp, the torch's drain, reach,
cone and brightness, and the night's two lights. 26 knobs. `src/debug/Tuning.ts` is the
model, `TuningPanel.ts` the DOM; `T` opens it, and it is hidden by default even under
`?debug` because two panels at once is most of the screen.

It writes to `config.ts`'s objects — which is the only thing that makes it worth having,
since those are what the systems read, and is why the two rules in §8.3 are rules. A player
never constructs it, so a browser with stored overrides still runs a player's game on the
spec's numbers. And it finds numbers rather than holding them: overrides are marked amber
in the panel and `copy` hands back only those, for the edit to the spec and `config.ts` that
actually decides anything.

Two values had to be made re-pushable rather than read-once: `Flashlight.refresh()`
re-derives the cone, the declination and the shadow camera's far plane, and `Run` pushes
`AMBIENT`/`MOON` back onto the night rig on every change. Everything else was already read
per tick — enemy speeds needed `ENEMY_PROFILES` writing too, since it snapshots them at
module load and every enemy of a kind shares the one profile object.

*Fixed afterwards — and the touch half of the same gap.* The torch had no on-screen button
either, so on a phone it was unreachable twice over. `TOUCH_BUTTONS` is the set of actions
that get one, and the touch layer renders a button per entry rather than the single
hard-coded `E`; `INPUT` gained the button geometry §3.1 now describes. `tests/input.test.ts`
holds the rule that produced the bug: an action the run reads as an edge is a tap, and a tap
with no button is an action a touch player cannot perform. Sprint stays off the list — it is
held, not tapped, and lives on the movement stick's rim.

*Fixed afterwards.* Moving the keydown listener behind `?debug` took the flashlight with
it. `F` was bound in `Input` as a player action from Phase 2 and never read by the run —
the only thing that toggled the torch was `debugKey`, so from this phase until now there
was no way to switch the beam on in normal play at all, on any device. `Run.frame` reads
`input.wasPressed('flashlight')` now, beside `interact`, and `debugKey` no longer handles
`F` (two paths would toggle twice under `?debug` and the beam would never come on).

*Fixed afterwards — the readout could not be got rid of on a phone.* `H` toggles it and a
key is not a control on a phone, so the only way out was a keyboard. Worse, `?map=` is gated
behind `?debug`, so testing a custom map *forced* the readout on, and on a phone it covers
the whole screen rather than the third it covers on a desktop. Two things closed it: the
readout carries its own tap targets under `?debug` (a `×` to dismiss, a 44 px `dbg` handle to
bring it back, both `stopPropagation`-ing their `pointerdown` like the action buttons do, or
dismissing it would anchor a movement stick and walk the player away), and `?overlay=0`
starts it hidden with the rest of the harness armed. `parseShellOptions` also stopped reading
flags by presence alone: `?debug=0` had been arming the harness, which is the opposite of
what anyone writing it means.

*Fixed at the same time — the readout ran off the side of a phone.* `white-space:pre` does
not wrap, so every row longer than the box was clipped by the glass: `frames`, `entities`,
`nearest`, `audio` and `MONSTER` all lost their values on a 412 px screen, which reads as the
readout not reporting them rather than as a layout bug. It now wraps, is bounded by
`min(46ch, calc(100vw - 24px))` rather than by a character count alone, and each row is its
own element with a `9ch` hanging indent so a folded line resumes under the value instead of
under an apparently blank label. The elements are pooled and reused — 58 rows rebuilt ten
times a second is churn for nothing. Measured on a Pixel 7 profile: 58 rows, 0 past the
viewport edge, `scrollWidth` equal to `clientWidth`.

*Verified in Chromium on a Pixel 7 profile* (`?debug&map=phase1-test`): the readout fills the
screen, tapping `×` clears it to the `dbg` handle, the player's position is unchanged across
the tap (`(3.00, 3.00)` before and after — the stick was not anchored), and tapping `dbg`
brings it back. `?debug&map=phase1-test&overlay=0` starts on a clean screen with the handle
in the corner and the map still loaded. `?debug=0&map=phase1-test` arms nothing and shows no
handle; a plain load shows no debug chrome at all. The DOM behaviour is browser-only — the
suite has no jsdom — so `tests/shell.test.ts` holds the invariant instead: `enableTouchToggle`
is called exactly once and only under `options.debug`.

`tests/shell.test.ts` covers the rules that rot quietly: the credits against `package.json`
(add a dependency without crediting it and the test fails naming it — checked by adding
`prettier` and watching it fail), debug being off by default, including that `?map=` and
`?seed=` are ignored without it and that a map name cannot climb out of `maps/`, and —
after the above — that every action `Input` binds a key for is actually read by the run.
That last one is the check that was missing: an action nobody consumes type-checks
perfectly, so nothing but a source-level assertion could have caught it. (Its two
source-level describes had been pasted in twice and ran as duplicates; one copy is gone.)

*Added afterwards — a map library (§9.3).* The editor kept one autosaved draft and nothing
else, so there was no way to keep two levels or to get back to one. It now saves and opens
maps by name, layered the way §9.4 layers stamps: the project's maps in `public/maps/` are
read-only and `example` is what a fresh browser opens, and this browser's are saved, renamed
and deleted. Saving out of a project map names a new one — `public/maps/` changes through a
commit, and a save that could overwrite it would put the level everybody shares one tap from
a draft. `src/editor/mapLibrary.ts` is the model (pure, so the naming and precedence rules
are testable), `EditorApp` the chrome. `EditorDocument` gained `replace`, which drops the
undo stack: an undo across an open would take one map's edits back into another.

The project's map list is derived from the tree by `import.meta.glob` rather than from a
checked-in manifest — only the keys are read, so no map is bundled and none is fetched until
it is opened, and there is no second generated file to go stale. The draft now records which
map it belongs to and is rewritten when that changes, not only when the document does: saving
and opening leave the document untouched, and a reload in between came back under the old
name.

The menu is a selector, a preview and the actions on what is selected, rather than a row per
map: choosing shows what a map is without opening it, and `src/editor/preview.ts` draws the
whole thing in the sheet at whatever zoom fits. Its fit is separated from its drawing and
tested, because a preview that overflows its box is a preview that looks like a map with
nothing along the bottom.

*Verified in Chromium on a Pixel 7 profile* (`?edit`): a fresh browser opens `example`
(`clean · 2306 tiles reachable`); saving out of it suggests `example 2` and refuses the name
`example` outright; saving as `the yard` writes the library and the draft together; one edit
puts `•` on the button; opening another map with unsaved work asks first; reopening `the
yard` and reloading both come back to it. Selecting `phase8-test` draws its preview
(`34×24 · 10 entities · read-only`) and leaves what is open alone; `Rename` and `Delete` are
disabled for the project's maps and live for this browser's. `tests/editor.test.ts` covers
the rules underneath — overwrite precedence, name collisions case-insensitively, a corrupt
stored library, the dropped undo stack, and the preview's fit.

*A trap, paid for here.* `.ed-row input` was `flex: 1` with no `min-width: 0`, so it would
not shrink below the input's intrinsic width. One label longer than the panel had ever
carried pushed the row 52 px past the sheet and clipped **every** label in the panel against
the left edge — which reads as a broken sheet, not as one row being too wide. Any row with a
long label had the same bug waiting in it.

*Fixed afterwards — the monster's jump-scare was a white thing.* It was a soft pale ellipse
scaling up on black: abstract, unreadable as anything, and the opposite of the creature it
was for. §5.2 makes the monster a spider-shaped shadow and says the silhouette is its entire
visual design, so a pale blob contradicted it twice — by drawing a body, and by drawing it
lit. Both scares are now the same inline-SVG spider silhouette (`SPIDER_SILHOUETTE`), told
apart the way §5.3 requires: the spider's is near-black on red, already on top of the player,
thrashing in discrete jerks; the monster's is pure black on black, visible only where it
crosses the last of the light, arriving in one accelerating rush.

The layer itself no longer animates. Scaling `.run-scare` scaled the ground it was drawn on,
so the black screen §5.3 asks for zoomed and faded in rather than being there from the first
frame with the shape arriving out of it — which is most of why the old one read as a floating
blob rather than as something approaching.

*Verified in Chromium on a Pixel 7 profile*, mounting `RunOverlays` on its own and pinning
the animations at 0.1 s, 0.5 s, 1.0 s and 1.45 s. Mean frame brightness (0–255): the
monster's goes 18.0 → 0.2 (max 7), so it ends fully black and resolves cleanly into the
game-over screen; the spider's holds 113.9 → 110.2 red throughout. Unmistakably different at
a glance, which is the criterion §5.3 actually sets. *A trap for the next person:* a paused
`Animation` is detached from the CSS lifecycle and survives the class change, so capturing
both scares from one page bleeds one into the other — a fresh page per capture is needed.

*Fixed afterwards — death had no sound.* `Run.resolveEnding` suspended the whole audio
context, so the loudest moment in the game was silent. §5.3 now gives each cause a sound,
unalike for the same reason the overlays are: `death_spider` is bright, dry and convulsive —
three stabs on an uneven beat, the shape the scare draws — and `death_monster` is one low
impact with a long decay and nothing bright in it, running the length of the 1.5 s hold. The
world is silenced by stopping its sources (`AudioCore.silenceWorld`) rather than by
suspending the context, which is what leaves room for the scare to have a voice.

Measured by the same band-share technique `footstep_heavy` is tested with: the monster's
sound has 49% of its energy below ~150 Hz against the spider's 3%, and the spider has 68% of
its energy above ~1 kHz against the monster's 3%. Fourteen times lower one way, twenty-six
times brighter the other — the pair separates by ear alone, which is the point, since a
player may be looking away when it lands.

*Two traps, both paid for here.* ZzFX's `filter` is a **high-pass** when positive (its biquad
is built from `sign(filter)`, and `b0 = (1 + sign · cos)/2` is the high-pass form), so the
first attempt at darkening the monster's sound thinned it instead. And `SpiderVoices` and
`LampVoices` update on the render loop outside the simulation guard, re-`play()`ing their
emitters the frame after the world was silenced — invisible for as long as death suspended
the context, and audible the moment it had to stay alive. Both are in `docs/ORIENTATION.md`.

*Verified in Chromium on a Pixel 7 profile* through real deaths on `phase8-test` and
`phase7-test`: playing sources go 2 → 1 → 0 for the monster and 4 → 1 → 0 for the spider —
the world silenced to exactly the death sound, then the sound running out — with the context
reporting `running` throughout and the right scare class up in each case.

*Added afterwards — the menu has music.* §8.1 gains one track, looping, on the title and the
credits and nowhere else, fading in when those screens come up and out when a run begins. A
run stays silent under it on purpose: §4.3 builds a run around hearing where things are, and
music takes the one channel the game gives a player for tracking what is coming. The ending
screens too — the jump-scare's sound (§5.3) is the last thing heard, and a tune after it
would answer it. `Falling Through Glass`, by Zack Newman, credited under a new **Music**
heading (§8.2) on the same grounds as the art.

Two decisions worth keeping:

- **It streams rather than decodes.** 4:48 at 48 kHz stereo is ~110 MB held as PCM, so it
  cannot go through the `SoundBank` like every other sound. `tests/audio.test.ts` asserts
  that figure from the file itself, so the check fails if anyone later moves the track into
  the bank.
- **It plays on the game's graph, not the device's media flow.** A bare `HTMLAudioElement`
  is *media* to a phone — lock-screen transport, notification shade, and it stops whatever
  the player was already listening to. `createMediaElementSource` on the listener's context
  makes it one more node in the graph the rest of the sound comes out of.

*On the pitch bug.* iOS takes the context's sample rate from whatever the audio is routed
through, so a raw `AudioBuffer` built at an assumed rate plays at the wrong speed and pitch.
That trap is real and this project already guards it — `SoundBank.synthesiseBuffer` builds at
`context.sampleRate` — but it does not reach the music: a media element source is resampled
by the graph, as decoded files are.

The project map indexed the mp3 as 30,065 "lines" with `§` citations scraped out of
compressed audio. `scripts/mp3-facts.mjs` now measures audio the way `glb-facts.mjs`
measures models: bytes, duration from the file's stated frame count, rate and channels.

*Verified in Chromium on a Pixel 7 profile*, on the real gesture path with no autoplay
override: before any input the music is stopped at volume 0 (asked, refused, waiting);
tapping `Credits` — a gesture that is not `Play` — starts it at 0.45 with `silent` false,
so the graph is carrying it; `Play` fades it out and pauses it for the run.
With `Play` as the very first gesture it starts and stops without the volume rising, so
there is no blip. The `music` readout row survives a restart, which is what `addShellRow`
is for.

*Added afterwards — the menu was silent on iOS Safari.* The element played — the phone
showed a media indicator — and nothing came out. §8.1 now says how the two gates open, and
`src/audio/Music.ts` opens them that way:

- **The track joins the graph only once the context is running.** A `MediaElementSource`
  built against a context that has never run is a node iOS never carries, and `Music` built
  exactly that in its constructor, which runs while the menu is still waiting for its first
  tap. It is held off the graph until then, and muted while it is off it, so the gap is
  silence rather than the track at the device's own volume.
- **The context and the element are asked for in the same gesture, and neither is awaited.**
  Safari counts a gesture as spent across an `await`.
- **A gesture that leaves the context not running re-arms.** iOS has an `interrupted` state
  the standard does not, where `resume` resolves with nothing changed; `AudioCore.armGesture`
  used to disarm on the first try and leave the session silent for good.
- **Where the graph carries nothing anyway, the track comes out as plain media.** The
  analyser reads the graph's own output for 2 s before believing it. The fallback costs the
  lock-screen transport and the level — a phone holds a media element at the device's volume,
  so the fade out becomes a cut — and it beats a menu that shows every sign of playing and
  makes no sound. An element cannot come off the graph once attached, so that fallback is a
  second element.

*Verified in Chromium*, since there is no iOS device in this environment: on the real gesture
path the music reaches `route: 'graph'` and comes up at 0.45 without the fallback firing,
which is the probe hearing the graph carry it; with `createMediaElementSource` stubbed to a node the
element never feeds, and again with `resume` stubbed never to resolve, it lands on
`route: 'media'`, playing, within ~2.5 s of the tap. **The fix is not verified on real iOS** —
what that device does with either path is still outstanding, and the `music` readout row now
carries the route and the context's state so the answer can be read off the phone.

*Added afterwards — the music was starting a second into itself.* Two things ate the
opening of the track, and both were invisible because each is small on its own:

- **The fade-in ran across it.** `MUSIC.fadeInSeconds` is 1.5 s and the track is four
  minutes, so the fade was never noticed as a fade — it was noticed as the music seeming to
  begin partway in, because the part that introduces it went past under a ramp. §8.1 now
  splits the two cases: the first start goes straight to level, and the fade is for a
  *return* to the menu, where a run interrupted the track mid-phrase and arriving rather
  than cutting is right.
- **The element played while it was muted and off the graph.** §8.1 holds it off the graph
  until the context is running and mutes it meanwhile, so the window between `play()`
  resolving and the route landing is real playback nobody can hear. It is now rewound on
  the first attach rather than skipped past.

*Verified in Chromium* on the real gesture path, polled every 20 ms: with a gesture that is
not `Play`, the track is audible from **0.011 s** in — the first poll after playback begins
— at a gain of **0.45** that does not move for the three seconds measured. Not one sampled
row sits at a partial level, which is what a fade-in would look like. `tests/music.test.ts`
covers both halves, and both of the new cases fail on the old code.

*Added afterwards — the menu's backdrop.* §8.1 had said nothing animated behind the title;
it now says a film of oily water, and gives the values it is made of. `src/ui/MenuBackdrop.ts`
is a domain-warped fBm field evaluated per sample on the CPU and drawn on a 144-sample canvas
that the browser scales to the screen — no assets, no video, nothing to go stale when the art
does. It sits behind both shell screens, with a scrim between it and the words and its own
sheet of black under the credits, which are the one place a wall of text sits over it.

**The rule §8.1 actually cares about is a lifetime, not a fast draw.** `TitleScreen.hide` stops
it, so nothing is scheduled while a run is; a hidden tab stops it too. Two more: a device whose
frames are over budget keeps the picture and stops turning it over, and `prefers-reduced-motion`
draws one frame and no more.

*Two things went wrong, and both are in the suite.* The over-budget rule was **one** frame,
and on a page still loading its assets exactly one frame is — the film stopped a second after
the menu appeared, on hardware drawing every other frame in half the budget, and looked
exactly like an animation that had never been wired up. It is the median of 12 frames now.
And the contrast stretch was centred on ½ while the field's median is 0.61, so an eighth of
every frame clipped to the highlight: broad pale plateaus that read as smoke rather than as
water. Neither is visible in a range check, which is why `tests/menuBackdrop.test.ts` checks
the *distribution* and the continuity-under-refinement instead — a step-size bound cannot tell
a seam from an honest gradient at this feature scale.

*Verified in Chromium at 1280×720* (`?debug&map=phase3-test&overlay=0`). One frame of the
field at 144×81: median 4.7 ms, worst of twelve 7.2 ms, against an 8 ms budget. Redraws
measured off the canvas rather than assumed: 44 in 2.01 s while the census itself held the
page to 72 rAF frames — the 30 Hz cap working. Two captures 8 s apart differ by a mean of
14.0/255 with 78.7% of pixels moved, so it turns over rather than sitting still. On `Play`:
`backdrop.running` false, shell hidden. `Credits` and `Back` both bring it back.

*Outstanding.* The budget rule is the part that cannot be checked here — this container
renders through a software rasteriser and its CPU is not a phone's, so whether a real
low-end device falls back to the still picture is unmeasured. What is measured is that the
rule no longer fires on a machine that can afford the film.

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
