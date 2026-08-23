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

`node scripts/gen-example-map.mjs` regenerates the example map's layer data.

## Debug harness

| Key | |
| --- | --- |
| `WASD` / arrows | pan the free camera; mouse wheel zooms |
| `G` | walkability overlay (green walkable, red blocked) |
| `C` | collider overlay — the merged Layer 1 boxes |
| `M` | entity markers |
| `P` | pause the simulation clock |
| `.` | step one simulation tick |
| `[` `]` | halve / double time scale |
| `H` | hide the readout |

Hovering the map reports the tile under the cursor and whether it is walkable.

## Status

Phases 0 and 1 are implemented: the fixed-timestep simulation clock and render loop, and
the map pipeline — `map.json` / `tileset.json` loading and validation, instanced prefab
geometry, merged box colliders, the walkability grid, and a typed entity registry. Entities
are parsed and indexed but not yet spawned beyond debug markers.

Not yet built: the player controller (Phase 2), the flashlight and lighting (Phase 3),
audio (Phase 4), enemies (Phases 5, 7, 8), and objectives (Phase 9). Prefab `.glb` assets
do not exist yet, so the asset loader stands in coloured placeholder boxes sized by prefab
name prefix.

## Layout

```
src/config.ts     constants mirroring the spec — tuning happens here, not in systems
src/core/         sim clock, viewport, asset loader
src/map/          validation, geometry, colliders, walkability, entity registry
src/debug/        overlay and debug visualisations
public/maps/      map data, one directory per map
tests/            unit tests, including fixture tests over the checked-in maps
```
