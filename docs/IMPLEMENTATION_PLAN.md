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

## Phase 0 — Scaffold

Vite + TypeScript project, Three.js render loop with the fixed-timestep simulation clock
(§7), resize handling, and a debug overlay (frame time, sim tick, entity count). Stub asset
loader for `.glb` prefabs.

**Exit:** an empty lit scene renders at target frame rate; the sim clock is independently
steppable and pauseable, since every later phase's timers depend on it.

## Phase 1 — Map Pipeline

Loader and validator for `map.json` and `tileset.json` (§2): layer decoding, prefab
instancing with the merge/instancing budget from §7, box collider generation from Layer 1,
and derivation of the walkability grid. Entity records are parsed into a typed registry but
not yet spawned beyond placeholder markers.

**Exit:** the example map renders as navigable 3D geometry; the walkability grid is
queryable and visualisable as a debug overlay; an unknown entity type logs and skips
without throwing.

## Phase 2 — Player Controller & Camera

Movement, capsule collision against Phase 1 colliders, and the camera rig (§3.1–3.2),
plus the health pool with its regeneration delay and invulnerability window (§3.4), driven
by a debug damage key until real enemies exist. Input abstraction covering keyboard+mouse,
gamepad, and touch from the start — retrofitting a second input path onto a mouse-only aim
implementation is the expensive version of this.

**Exit:** the player traverses the example map, slides along walls without catching, the
camera tracks smoothly and clamps at map bounds, and debug damage produces the correct
regeneration delay and refill curve.

## Phase 3 — Lighting Core & Flashlight

The flashlight spotlight bound to aim, the battery charge/drain/recharge cycle with its
intensity falloff and re-enable lockout (§4.1), environmental light entities with a debug
toggle, and the shadow budget and quality settings (§7).

**Exit:** the beam casts hard floor shadows from a test prop; a full drain-to-empty cycle
behaves per spec including the lockout; frame rate holds with the shadow budget saturated.

## Phase 4 — Audio Core

Listener, positional source pooling, distance models (§4.3), and the autoplay-gesture gate.

**Exit:** a moving off-screen test emitter is locatable by ear alone.

## Phase 5 — Navigation & Enemy Base

A\* over the Phase 1 grid with the repath interval and local avoidance (§5), a base enemy
entity with the shared state machine skeleton and movement speeds, spawning from map
entities, and the shared contact check (§5.3) emitting a contact event that each AI
resolves its own way in Phases 7 and 8. No light reactions yet.

**Exit:** a placeholder enemy pursues the player around obstacles, repaths when the player
breaks line of sight, and the grid rebuild on a walkability change is picked up mid-path.

## Phase 6 — Illumination Detection Service

The single shared query answering *is entity E lit, and by how much* — the cheap
distance/angle test, the throttled confirming raycast, and environmental light coverage
(§4.1, §4.2). Both AIs consume this; neither implements its own.

**Exit:** a debug readout reports lit/unlit per entity correctly through walls, at beam
edges, and inside environmental light radii, at the specified raycast budget.

## Phase 7 — Spider AI

The four-step light reaction lifecycle (§5.1) on top of Phases 5 and 6: stun, randomised
deterrence timer, flee target selection, and interruption. Also its contact resolution —
damage, mutual knockback, and the post-hit recoil hold (§5.3).

**Exit:** every branch of the lifecycle is reachable and observable in a test map; the flee
raycast never targets an unwalkable point; three contacts from full health kill, and a
cornered player is never drained faster than the invulnerability window allows.

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
- **Test maps per phase**, small and purpose-built, checked in beside the example map. The
  real map (Phase 11) is the worst possible place to first exercise a flee raycast.
- **Determinism.** Every timer runs on the fixed sim clock (§7); seed the randomised values
  (§5.1, §5.2) from a per-run seed so a bug can be reproduced. With one life per run
  (§6), a bug that only surfaces deep into a run is otherwise expensive to reach — pair
  the seed with a debug warp so late-run state can be re-entered directly.
- **The spec is the source of truth for constants.** Load them from one typed config module
  mirroring the spec's values rather than scattering literals, so Phase 11's tuning is an
  edit in two places, not thirty.
