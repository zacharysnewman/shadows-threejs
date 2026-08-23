/**
 * Entry point.
 *
 * Phase 1 wires the map pipeline to the render loop: load and validate a map, build its
 * static geometry, colliders, walkability grid and entity registry, and expose all of it
 * through the debug harness. There is no player yet (Phase 2) and no real lighting
 * (Phase 3) — the scene is flat-lit so the geometry is legible.
 *
 * `?map=<directory>` selects which map under `maps/` to load, so the per-phase test maps
 * are reachable without a rebuild.
 */

import * as THREE from 'three';
import { AssetLoader } from './core/AssetLoader';
import { SimClock } from './core/SimClock';
import { Viewport } from './core/Viewport';
import { ColliderOverlay } from './debug/ColliderOverlay';
import { DebugOverlay } from './debug/DebugOverlay';
import { EntityMarkers } from './debug/EntityMarkers';
import { FreeCamera } from './debug/FreeCamera';
import { WalkabilityOverlay } from './debug/WalkabilityOverlay';
import { loadMap, type LoadedMap } from './map/MapLoader';
import { MapValidationError } from './map/validate';

const DEFAULT_MAP = 'example';

function selectedMap(): string {
  const requested = new URLSearchParams(window.location.search).get('map');
  // Directory name only — no traversal out of `maps/`.
  const safe = requested && /^[\w-]+$/.test(requested) ? requested : DEFAULT_MAP;
  // Built from BASE_URL rather than left document-relative: the site is served from a
  // subpath on GitHub Pages, and a relative URL would resolve against whatever path the
  // page happens to be on.
  return `${import.meta.env.BASE_URL}maps/${safe}/`;
}

function showFatal(message: string): void {
  const panel = document.createElement('pre');
  panel.style.cssText = [
    'position:fixed',
    'inset:0',
    'margin:0',
    'padding:24px',
    'z-index:100',
    'overflow:auto',
    'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#ffb4a2',
    'background:#12060a',
    'white-space:pre-wrap',
  ].join(';');
  panel.textContent = message;
  document.body.appendChild(panel);
}

/** Placeholder lighting so Phase 1 geometry is visible; Phase 3 owns the real rig (§4). */
function addPlaceholderLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0x9fb6cd, 0x1a1d22, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-1, 2.2, 1.4);
  scene.add(key);
}

async function main(): Promise<void> {
  const viewport = new Viewport();
  const overlay = new DebugOverlay();
  const clock = new SimClock();
  const assets = new AssetLoader();
  const freeCamera = new FreeCamera(viewport);

  addPlaceholderLighting(viewport.scene);

  const directory = selectedMap();
  let loaded: LoadedMap;
  try {
    loaded = await loadMap(directory, assets);
  } catch (error) {
    const detail = error instanceof MapValidationError ? error.message : String(error);
    showFatal(`Failed to load ${directory}\n\n${detail}`);
    throw error;
  }

  viewport.scene.add(loaded.root);

  const walkability = new WalkabilityOverlay(loaded.grid);
  const colliders = new ColliderOverlay(loaded.colliders);
  const markers = new EntityMarkers(loaded.entities);
  viewport.scene.add(walkability.object, colliders.object, markers.object);

  // Open on the whole map: Phase 1 is about seeing the level as data made geometry, and
  // the debug camera can be panned to the spawn from there.
  const extent = Math.max(loaded.data.width, loaded.data.height) * loaded.data.tileSize;
  freeCamera.lookAt(
    (loaded.data.width * loaded.data.tileSize) / 2,
    (loaded.data.height * loaded.data.tileSize) / 2,
    FreeCamera.fitDistance(extent),
  );

  // --- Debug readout ------------------------------------------------------
  const tileCount = loaded.data.width * loaded.data.height;
  overlay.addRow('sim', () =>
    `tick ${clock.tick} · ${clock.elapsed.toFixed(1)}s · ${clock.paused ? 'PAUSED' : `×${clock.timeScale.toFixed(2)}`}`,
  );
  overlay.addRow('map', () =>
    `${loaded.data.width}×${loaded.data.height} @ ${loaded.data.tileSize}m · ${loaded.data.layers.length} layers`,
  );
  overlay.addRow('static', () =>
    `${loaded.geometry.instanceCount} tiles in ${loaded.geometry.instancedMeshCount} instanced meshes`,
  );
  overlay.addRow('grid', () => {
    const walkable = loaded.grid.walkableCount();
    const pct = ((walkable / tileCount) * 100).toFixed(0);
    return `${walkable}/${tileCount} walkable (${pct}%) · v${loaded.grid.version}`;
  });
  overlay.addRow('colliders', () => `${loaded.colliders.length} boxes`);
  overlay.addRow('entities', () =>
    `${loaded.entities.count} · ${loaded.entities
      .countsByType()
      .map(([type, n]) => `${type}×${n}`)
      .join(' ')}`,
  );
  if (loaded.data.warnings.length > 0) {
    overlay.addRow('warnings', () => `${loaded.data.warnings.length} (see console)`);
  }
  if (loaded.geometry.placeholders.length > 0) {
    overlay.addRow('assets', () => `${loaded.geometry.placeholders.length} placeholder prefab(s)`);
  }

  // Hover readout: the walkability grid answering a query, live, at the cursor.
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let hovered = '—';
  viewport.renderer.domElement.addEventListener('pointermove', (event) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, viewport.camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
      hovered = '—';
      return;
    }
    const { gx, gy } = loaded.grid.worldToGrid(hit.x, hit.z);
    hovered = loaded.grid.inBounds(gx, gy)
      ? `(${gx}, ${gy}) ${loaded.grid.isWalkable(gx, gy) ? 'walkable' : 'blocked'}`
      : 'off-map';
  });
  overlay.addRow('hover', () => hovered);

  // --- Debug keys ---------------------------------------------------------
  overlay.addBinding('WASD', 'pan camera · wheel zoom');
  overlay.addBinding('G', 'walkability overlay');
  overlay.addBinding('C', 'collider overlay');
  overlay.addBinding('M', 'entity markers');
  overlay.addBinding('P', 'pause simulation');
  overlay.addBinding('.', 'step one tick');
  overlay.addBinding('[ ]', 'time scale');
  overlay.addBinding('H', 'hide this overlay');

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    switch (event.code) {
      case 'KeyG':
        walkability.toggle();
        break;
      case 'KeyC':
        colliders.toggle();
        break;
      case 'KeyM':
        markers.toggle();
        break;
      case 'KeyP':
        clock.paused = !clock.paused;
        break;
      case 'Period':
        clock.stepOnce();
        break;
      case 'BracketLeft':
        clock.timeScale = Math.max(0.05, clock.timeScale / 2);
        break;
      case 'BracketRight':
        clock.timeScale = Math.min(8, clock.timeScale * 2);
        break;
      case 'KeyH':
        overlay.toggle();
        break;
      default:
        break;
    }
  });

  // Walkability on by default in Phase 1: it is the phase's exit criterion.
  walkability.toggle();

  // --- Render loop --------------------------------------------------------
  let previous = performance.now();
  const frame = (now: number): void => {
    const realDelta = (now - previous) / 1000;
    previous = now;

    // §7 — the simulation advances in fixed ticks; rendering is whatever the display gives.
    clock.advance(realDelta);
    freeCamera.update(realDelta);
    overlay.update(realDelta);
    viewport.render();

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  console.info(
    `[map] loaded ${directory}: ${loaded.data.width}×${loaded.data.height}, ` +
      `${loaded.entities.count} entities, ${loaded.colliders.length} colliders, ` +
      `${loaded.data.warnings.length} warning(s)`,
  );
}

void main();
