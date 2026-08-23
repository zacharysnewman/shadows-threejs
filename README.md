# shadows-threejs

A browser-based top-down horror game built on a 2D-to-3D pipeline: levels are authored as
tile JSON and turned into a lit 3D scene by a Three.js runtime, where both enemies are
defined by how they react to light.

- [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md) — the design and technical specification. It is
  the source of truth; where code and spec disagree, the spec wins.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — build order and per-phase
  exit criteria.

## Running

```bash
npm install
npm run dev        # dev server
npm run build      # typecheck + production build
npm test           # unit tests
```

`?map=<name>` selects a map from `public/maps/`:

- `/` — the 50×50 example map (default)
- `/?map=phase1-test` — a small map that deliberately contains authoring errors, to
  exercise the loader's skip-and-warn paths
- `/?map=phase2-test` — a small map built to catch the player capsule out: a diagonal
  pillar staircase, one-tile doorways, a fence run, a pit with no floor, a dead-end
  alcove, and walkable ground against every map edge for the camera clamp
- `/?map=phase3-test` — a map for the lighting: a field of free-standing props to throw
  beam shadows from, seven lamps in three groups (more than the two that may cast shadows
  at once), and a corridor no lamp reaches
- `/?map=phase5-test` — a map for navigation: a central block with a route round either
  side, a wall with one doorway to shut mid-chase, and a dead end

`?seed=<word|number>` replays a run's randomised values; without one a seed is picked and
logged. Every map here is a **prototype**, not the level — see `CLAUDE.md`.

The `scripts/gen-*-map.mjs` generators regenerate those maps' layer data.

## CI

`.github/workflows/ci.yml` runs the tests and the build on every pull request — the same
steps the deploy runs, so a PR that would break the deploy fails while it is still a PR.

## Deployment

The site is a static bundle published to GitHub Pages from this repository.
`.github/workflows/deploy.yml` runs the tests, builds, and hands the artifact to Pages on
every push to `main` — `dist/` is never committed, so the deployed site cannot drift from
the commit it was built from. `workflow_dispatch` redeploys without a new commit.

Two one-time settings, both in the repository's GitHub settings:

1. **Settings → Pages → Source → "GitHub Actions."**
2. The repository must be **public**, unless the account has GitHub Pro — the Free plan
   only serves Pages from public repositories.

It is served as a **project** site, at `https://<user>.github.io/shadows-threejs/` rather
than a domain root. That subpath is baked in at build time, so `vite.config.ts` sets `base`
to `/shadows-threejs/` and every runtime fetch is built from `import.meta.env.BASE_URL`
rather than left document-relative.

Set `BASE_PATH` to build for a different location:

```bash
BASE_PATH=/ npm run build                  # user site or custom domain
BASE_PATH=/other-repo/ npm run build       # published from a different repository
```

`base` applies in dev too, so `npm run dev` serves from the same subpath as production —
a base-path mistake shows up locally rather than as a wall of 404s after deploying.

## Debug harness

| Key | |
| --- | --- |
| `WASD` / arrows | move; the mouse aims |
| `Shift` | sprint — the aim locks to the way you are going |
| `V` | hand the camera to the debug free camera — `WASD` then pans, wheel zooms |
| `F` | flashlight on/off |
| `B` | drain the battery to 5%, to reach the cut-out and lockout without waiting 45 s |
| `L` | power every light group — Phase 9 replaces this with the switches |
| `O` | occluder fade (geometry between the camera and the player) |
| `Z` | orbit a test emitter off-screen — audio only, nothing to see |
| `N` | enemy paths, coloured by state |
| `X` | block/unblock the hovered tile — walkability only, the way a gate does |
| `Y` | switch the enemies off |
| `K` | debug damage: one spider contact's worth (0.34) |
| `J` | heal to full |
| `G` | walkability overlay (green walkable, red blocked) |
| `C` | collider overlay — obstacles in amber, floor gaps in blue |
| `M` | entity markers |
| `P` | pause the simulation clock |
| `.` | step one simulation tick |
| `[` `]` | halve / double time scale |
| `H` | hide the readout |

A gamepad works without any setup — left stick moves, right stick aims, `A` interacts,
left stick click sprints. On
touch, the left half of the screen is a floating movement stick and the right half a
floating aim stick, with an on-screen action button; pushing the movement stick to its rim
sprints. The touch chrome only appears once a touch is seen, so a desktop session never
renders it.

**Development builds** additionally expose `window.shadows` — the clock, player, camera
rig, flashlight, lights, audio core and map, reachable from the console. Some behaviour can
only be checked through it: "a moving off-screen emitter is locatable by ear" (§4.3) is not
something a test runner can assert, but the live audio graph can be tapped from the handle
and measured. It is compiled out of production builds, so anything driving it — a console
session, a Playwright check — has to run against `npm run dev` rather than `npm run
preview`.

Hovering the map reports the tile under the cursor and whether it is walkable.

## Status

Phases 0–6 are implemented:

- **Phase 0** — fixed-timestep simulation clock and render loop, viewport and debug readout.
- **Phase 1** — the map pipeline: `map.json` / `tileset.json` loading and validation,
  instanced prefab geometry, merged box colliders, the walkability grid, and a typed entity
  registry. Entities other than the player spawn are parsed and indexed but not yet spawned
  beyond debug markers.
- **Phase 2** — the player: input abstraction over keyboard/mouse, gamepad and touch;
  movement with the spec's speeds and smoothing, including the sprint that trades
  independent aim for speed; the 0.4 m capsule sliding along contact
  normals against walls, floor holes and the map edge; the camera rig with its bounds
  clamp; and the health pool with its regeneration delay and refill, driven by a debug
  damage key until enemies exist.

- **Phase 3** — the lighting: the map is dark, and lit by the flashlight bound to the
  player's aim — with its battery drain, recharge, intensity falloff and re-enable
  lockout — plus environmental lamps that light in groups, of which at most two cast
  shadows at a time.

- **Phase 4** — spatial audio: the listener rides the player, sources come from a pool,
  §4.3's two distance models are in place, and the `AudioContext` waits for a gesture.
  Sounds are synthesised placeholders until real files exist.

- **Phase 5** — navigation and the enemy base: grid A\* with line-of-sight straightening,
  the state machine both AIs are built on, §5's movement speeds, local avoidance, spawning
  from map entities, and the shared contact check. No light reactions yet.

- **Phase 6** — the shared illumination query: one service answering whether an entity is
  lit and by how much, with the cone and lamp-pool tests, occlusion against the same
  obstacles that block walking, and the confirming raycast throttled to 10 Hz per entity.
  Both AIs will consume it; neither will implement its own.

Not yet built: the light reactions that make each enemy itself (Phases 7 and 8), interaction
and objectives (Phase 9), and the run lifecycle (Phase 10) — health reaching zero currently
logs and nothing more. Nothing yet asks whether an entity is *lit*; that shared query is Phase 6.
Prefab `.glb` assets do not exist yet, so the asset loader stands in coloured placeholder
boxes sized by prefab name prefix.

`docs/IMPLEMENTATION_PLAN.md` carries the per-phase detail, including what each finished
phase deliberately left for later.

## Layout

```
src/config.ts     constants mirroring the spec — tuning happens here, not in systems
src/core/         sim clock, viewport, asset loader, input, occluder fade
src/map/          validation, geometry, colliders, walkability, entity registry
src/player/       movement, collision, camera rig, health
src/lighting/     flashlight, battery, environmental lights, night ambient, illumination query
src/audio/        listener, source pool, distance profiles, sound bank
src/nav/          grid A*, line of sight, segment occlusion
src/enemies/      shared enemy, state machine, spawning, contact check
src/debug/        overlay and debug visualisations
public/maps/      map data, one directory per map
scripts/          map generators for the checked-in maps
tests/            unit tests, including fixture tests over the checked-in maps
```
