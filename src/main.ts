/**
 * Entry point.
 *
 * Phase 5 puts enemies on the map: A\* over the walkability grid, the state machine both
 * AIs are built on, and the shared contact check (§5). They pursue and they wander; they do
 * not yet react to light, which is the whole of what makes each of them itself (Phases 7
 * and 8).
 *
 * Phase 4 added ears. Phase 3 turned the lights out; The map the Phase 1 pipeline builds and the player Phase 2
 * drives are now lit only by the flashlight bound to the player's aim and by environmental
 * lights whose groups have been powered (§4) — the debug harness stands in for the switches
 * that arrive in Phase 9, and hands the player the flashlight the pick-up will hand them.
 *
 * with the map dark, the spatial audio in §4.3 is how an unseen thing is located at all —
 * the listener rides the player, sources come from a pool, and a debug emitter orbits
 * off-screen so the cue can be checked before there is anything real to hear.
 *
 * No enemies yet (Phase 5), and nothing consumes the beam as a detection query yet: that
 * shared "is this entity lit" service is Phase 6, built once for both AIs.
 *
 * `?map=<directory>` selects which map under `maps/` to load, so the per-phase test maps
 * are reachable without a rebuild.
 */

import * as THREE from 'three';
import { AudioCore } from './audio/AudioCore';
import { FootstepCadence } from './audio/Footsteps';
import { EnemyManager } from './enemies/EnemyManager';
import { AssetLoader } from './core/AssetLoader';
import { Input } from './core/Input';
import { OccluderFade } from './core/OccluderFade';
import { Rng } from './core/rng';
import { SimClock } from './core/SimClock';
import { Viewport } from './core/Viewport';
import { ColliderOverlay } from './debug/ColliderOverlay';
import { DebugOverlay } from './debug/DebugOverlay';
import { EntityMarkers } from './debug/EntityMarkers';
import { FreeCamera } from './debug/FreeCamera';
import { AudioTestEmitter } from './debug/AudioTestEmitter';
import { PathOverlay } from './debug/PathOverlay';
import { WalkabilityOverlay } from './debug/WalkabilityOverlay';
import { loadMap, type LoadedMap } from './map/MapLoader';
import { MapValidationError } from './map/validate';
import { addNightAmbient } from './lighting/Ambient';
import { EnvironmentLights } from './lighting/EnvironmentLights';
import { Flashlight } from './lighting/Flashlight';
import { CameraRig } from './player/CameraRig';
import { ColliderIndex } from './player/collision';
import { Player } from './player/Player';
import { FLASHLIGHT, HEALTH, PLAYER } from './config';

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

/**
 * The run's seed (Cross-Cutting: determinism). `?seed=<word or number>` replays a run's
 * randomised values — wander targets now, deterrence timers and flicker later (§5.1, §5.2).
 * Without one a seed is picked and reported, so a run that goes wrong can be repeated.
 */
function selectedSeed(): Rng {
  return Rng.from(new URLSearchParams(window.location.search).get('seed'));
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

async function main(): Promise<void> {
  const viewport = new Viewport();
  const overlay = new DebugOverlay();
  const clock = new SimClock();
  const assets = new AssetLoader();
  const input = new Input(viewport.renderer.domElement);
  const freeCamera = new FreeCamera(viewport);
  const rng = selectedSeed();
  const audio = new AudioCore(viewport.scene);
  // §4.3 — the context starts suspended until the player touches something.
  audio.armGesture();

  addNightAmbient(viewport.scene);

  // Sounds are decoded up front, alongside the map: one that has to be fetched when it is
  // needed arrives after the thing it was meant to announce.
  const audioReady = audio.load();

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

  // §3.2 — nothing between the camera and the player may hide the player. Attached to the
  // static geometry's shared materials, so it survives the instancing §7 requires.
  const occluders = new OccluderFade();
  occluders.attach(loaded.root);

  const walkability = new WalkabilityOverlay(loaded.grid);
  const colliders = new ColliderOverlay(loaded.colliders);
  const markers = new EntityMarkers(loaded.entities);
  viewport.scene.add(walkability.object, colliders.object, markers.object);

  // --- Player -------------------------------------------------------------
  const colliderIndex = new ColliderIndex(
    loaded.colliders,
    loaded.data.width,
    loaded.data.height,
    loaded.data.tileSize,
  );
  const player = new Player(loaded.entities.playerSpawn, colliderIndex);
  viewport.scene.add(player.object);

  // --- Lighting -----------------------------------------------------------
  const flashlight = new Flashlight(viewport.scene);
  const environment = new EnvironmentLights(loaded.entities.byType('EnvironmentLight'));
  viewport.scene.add(environment.root);

  // §5 — enemies spawn from the map's entities, on the grid the Phase 1 pipeline derived.
  const enemies = new EnemyManager(loaded.entities, loaded.grid, colliderIndex, rng.stream('enemies'));
  viewport.scene.add(enemies.root);

  const paths = new PathOverlay(enemies, loaded.grid);
  viewport.scene.add(paths.object);

  // §5.3 — the check reports contact; each AI resolves it its own way in Phases 7 and 8.
  // Until they exist, the first touch from each enemy is logged and nothing happens.
  const contacted = new Set<string>();
  enemies.onContact((enemy, distance) => {
    if (contacted.has(enemy.key)) return;
    contacted.add(enemy.key);
    console.info(
      `[contact] ${enemy.profile.kind} ${enemy.key} at ${distance.toFixed(2)}m — ` +
        `resolution is Phase ${enemy.profile.kind === 'SpiderEnemy' ? '7' : '8'}'s (§5.3)`,
    );
  });

  await audioReady;
  const footsteps = new FootstepCadence();
  const testEmitter = new AudioTestEmitter(audio);

  const rig = new CameraRig(viewport, loaded.bounds);
  rig.snapTo(player.position.x, player.position.y);
  // The free camera starts where the player is, so toggling to it does not jump the view.
  freeCamera.lookAt(player.position.x, player.position.y, FreeCamera.fitDistance(40));

  // §7 — everything with a timer runs on the fixed clock, movement included, so the
  // distance covered in a second does not depend on the frame rate.
  clock.onTick((dt) => {
    // While the free camera has the keys, the player gets no movement intent (§ debug
    // harness) — otherwise panning the debug view walks the player across the map.
    const moveX = freeCamera.enabled ? 0 : input.moveX;
    const moveZ = freeCamera.enabled ? 0 : input.moveZ;
    const before = player.position.clone();
    player.tick(dt, moveX, moveZ);
    flashlight.tick(dt);

    // The pool's first customer: a step every stride of ground actually covered, so a
    // player stopped against a wall makes no noise however hard they walk into it.
    if (footsteps.tick(before.distanceTo(player.position))) {
      audio.playAt('footstep_light', player.position.x, player.position.y);
    }

    enemies.tick(dt, player.position.x, player.position.y);
    testEmitter.tick(dt, player.position.x, player.position.y);
  });

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
  overlay.addRow('colliders', () => {
    const gaps = loaded.colliders.filter((collider) => collider.kind === 'gap').length;
    return `${loaded.colliders.length} boxes (${gaps} floor gap${gaps === 1 ? '' : 's'})`;
  });
  overlay.addRow('entities', () =>
    `${loaded.entities.count} · ${loaded.entities
      .countsByType()
      .map(([type, n]) => `${type}×${n}`)
      .join(' ')}`,
  );
  overlay.addRow('player', () => {
    const { gx, gy } = loaded.grid.worldToGrid(player.position.x, player.position.y);
    return (
      `(${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}) tile (${gx}, ${gy}) · ` +
      `${player.speed.toFixed(2)} m/s${player.touchingWall ? ' · wall' : ''}`
    );
  });
  overlay.addRow('aim', () =>
    `(${player.aim.x.toFixed(2)}, ${player.aim.y.toFixed(2)}) · ${input.aimSource}`,
  );
  overlay.addRow('health', () => {
    const { health } = player;
    if (health.dead) return '0.00 · DEAD';
    const state = health.regenerating
      ? `regen +${HEALTH.regenRate.toFixed(2)}/s`
      : health.value >= HEALTH.max
        ? 'full'
        : `regen in ${health.regenDelayRemaining.toFixed(1)}s`;
    return `${health.value.toFixed(2)} · ${state}${health.critical ? ' · CRITICAL' : ''}`;
  });
  overlay.addRow('enemies', () =>
    enemies.count === 0
      ? 'none on this map'
      : `${enemies.count} · ${enemies.countsByState()}${enemies.enabled ? '' : ' · DISABLED'}`,
  );
  overlay.addRow('nearest', () => {
    const nearest = enemies.enemies
      .map((enemy) => ({ enemy, distance: enemy.distanceTo(player.position.x, player.position.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return '—';
    return (
      `${nearest.enemy.profile.kind} ${nearest.distance.toFixed(1)}m · ${nearest.enemy.state}` +
      ` · ${nearest.enemy.speed.toFixed(1)} m/s · ${nearest.enemy.waypoints.length} waypoints`
    );
  });
  overlay.addRow('seed', () => `${rng.seed}`);
  overlay.addRow('torch', () => {
    const { battery } = flashlight;
    const charge = `${(battery.charge * 100).toFixed(0)}%`;
    if (battery.on) {
      return `ON · ${charge} · beam ${(battery.intensityFraction * 100).toFixed(0)}%`;
    }
    return `off · ${charge}${battery.lockedOut ? ` · LOCKED OUT until ${FLASHLIGHT.reEnableCharge * 100}%` : ''}`;
  });
  overlay.addRow('lamps', () =>
    environment.lamps.length === 0
      ? 'none on this map'
      : `${environment.litCount}/${environment.lamps.length} lit · ${environment.shadowCasterCount} casting shadows`,
  );
  overlay.addRow('audio', () => {
    const placeholders = audio.bank?.placeholders.length ?? 0;
    return (
      `${audio.state} · ${audio.playingCount} playing` +
      (placeholders > 0 ? ` · ${placeholders} placeholder sound(s)` : '')
    );
  });
  overlay.addRow('emitter', () => testEmitter.describe());
  overlay.addRow('camera', () =>
    `(${rig.targetX.toFixed(1)}, ${rig.targetZ.toFixed(1)})${freeCamera.enabled ? ' · FREE' : ''}`,
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
  let hoveredTile: { gx: number; gy: number } | null = null;
  viewport.renderer.domElement.addEventListener('pointermove', (event) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, viewport.camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
      hovered = '—';
      hoveredTile = null;
      return;
    }
    const { gx, gy } = loaded.grid.worldToGrid(hit.x, hit.z);
    const inside = loaded.grid.inBounds(gx, gy);
    hoveredTile = inside ? { gx, gy } : null;
    hovered = inside
      ? `(${gx}, ${gy}) ${loaded.grid.isWalkable(gx, gy) ? 'walkable' : 'blocked'}`
      : 'off-map';
  });
  overlay.addRow('hover', () => hovered);

  /**
   * Resolve aim intent to a world direction (§3.1). A pointer names a screen position, so
   * it has to be projected onto the ground plane through the current camera; a stick
   * already names a direction. Run per rendered frame so aim tracks the cursor at display
   * rate rather than at the 60 Hz tick.
   */
  function updateAim(): void {
    if (input.aimSource === 'stick') {
      player.aimTowards(input.aimX, input.aimZ);
      return;
    }
    if (input.aimSource !== 'pointer') return;
    pointer.set(input.pointerNdcX, input.pointerNdcY);
    raycaster.setFromCamera(pointer, viewport.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) player.aimAt(hit.x, hit.z);
  }

  // --- Debug keys ---------------------------------------------------------
  overlay.addBinding('WASD', 'move · mouse aims');
  overlay.addBinding('V', 'free camera (WASD pans, wheel zooms)');
  overlay.addBinding('O', 'occluder fade');
  overlay.addBinding('Z', 'orbit a test emitter off-screen (audio)');
  overlay.addBinding('N', 'enemy paths');
  overlay.addBinding('X', 'block/unblock the hovered tile (walkability only)');
  overlay.addBinding('Y', 'disable the enemies');
  overlay.addBinding('F', 'flashlight');
  overlay.addBinding('B', 'drain the battery to 5%');
  overlay.addBinding('L', 'power every light group (Phase 9 owns the switches)');
  overlay.addBinding('K', `debug damage (${HEALTH.spiderDamage})`);
  overlay.addBinding('J', 'heal to full');
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
      case 'KeyV':
        freeCamera.enabled = !freeCamera.enabled;
        if (freeCamera.enabled) {
          freeCamera.lookAt(player.position.x, player.position.y);
        } else {
          // Snap rather than smooth: returning from the far side of the map would
          // otherwise sail the camera across it.
          rig.snapTo(player.position.x, player.position.y);
        }
        break;
      case 'KeyN':
        paths.toggle();
        break;
      case 'KeyY':
        enemies.enabled = !enemies.enabled;
        break;
      case 'KeyX': {
        // Flips walkability under the cursor without touching geometry, which is what a
        // gate does when it opens (§6) — and the cheapest way to watch enemies pick up a
        // grid rebuild mid-path (§2).
        if (!hoveredTile) break;
        const { gx, gy } = hoveredTile;
        const blocked = !loaded.grid.isWalkable(gx, gy);
        loaded.grid.setOverride(gx, gy, blocked ? null : false);
        console.info(`[grid] (${gx}, ${gy}) ${blocked ? 'restored' : 'blocked'} · v${loaded.grid.version}`);
        break;
      }
      case 'KeyZ':
        testEmitter.toggle(player.position.x, player.position.y);
        break;
      case 'KeyO':
        occluders.enabled = !occluders.enabled;
        break;
      case 'KeyF':
        // §4.1 — refused while the battery is flat or still locked out.
        if (!flashlight.toggle() && flashlight.battery.lockedOut) {
          console.info(
            `[torch] locked out at ${(flashlight.battery.charge * 100).toFixed(0)}%; ` +
              `needs ${FLASHLIGHT.reEnableCharge * 100}%`,
          );
        }
        break;
      case 'KeyB':
        flashlight.battery.set(0.05);
        break;
      case 'KeyL':
        environment.toggleAll();
        break;
      case 'KeyK':
        // §3.4 — one spider's worth of damage, the only damage source until Phase 7.
        if (player.health.damage()) console.info('[player] health reached 0 (Phase 10 owns death)');
        break;
      case 'KeyJ':
        player.health.reset();
        break;
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
        // §4.3 — the world going quiet is part of pausing it.
        audio.setPaused(clock.paused);
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

  /**
   * Debug handle (Cross-Cutting: debug harness). Everything the overlay reports, reachable
   * from the console and from automated checks — which is how this phase is verified at
   * all: "locatable by ear" cannot be asserted from a test runner, but the audio graph can
   * be tapped from here and measured.
   */
  (window as unknown as { shadows: unknown }).shadows = {
    clock,
    input,
    loaded,
    player,
    rig,
    flashlight,
    environment,
    audio,
    testEmitter,
    occluders,
    enemies,
    rng,
  };

  // --- Render loop --------------------------------------------------------
  let previous = performance.now();
  const frame = (now: number): void => {
    const realDelta = (now - previous) / 1000;
    previous = now;

    // Sampled once per frame, before the ticks: a frame that runs three ticks applies the
    // same input snapshot to all three rather than three different reads of the hardware.
    input.update();
    updateAim();

    // §7 — the simulation advances in fixed ticks; rendering is whatever the display gives.
    clock.advance(realDelta);

    player.render(clock.alpha);
    enemies.render(clock.alpha);
    paths.update();
    // Bound to the interpolated position, not the tick position: a beam that stepped at
    // 60 Hz while the player moved smoothly would visibly swim around them.
    flashlight.update(
      player.object.position.x,
      player.object.position.z,
      player.aim.x,
      player.aim.y,
    );
    // The listener rides the player, not the camera (§4.3): every distance in the spec is
    // measured from where the player stands, and the camera is 14 m away from that.
    audio.update(player.object.position.x, player.object.position.z);

    // Fed the interpolated position for the same reason the beam is: it is a visual
    // effect, and following the tick position would make the window stutter.
    occluders.update(
      viewport.camera,
      player.object.position.x,
      PLAYER.height * 0.5,
      player.object.position.z,
    );

    if (freeCamera.enabled) {
      freeCamera.update(realDelta);
    } else {
      // Follows the *interpolated* position for the same reason it runs on the render
      // delta: both are presentation, and following the tick position would reintroduce
      // the 60 Hz staircase the interpolation just removed.
      rig.update(realDelta, player.object.position.x, player.object.position.z);
    }

    environment.update(viewport.camera);
    overlay.update(realDelta);
    viewport.render();
    input.endFrame();

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  console.info(`[run] seed ${rng.seed} — replay with ?seed=${rng.seed}`);
  console.info(
    `[map] loaded ${directory}: ${loaded.data.width}×${loaded.data.height}, ` +
      `${loaded.entities.count} entities, ${loaded.colliders.length} colliders, ` +
      `${loaded.data.warnings.length} warning(s)`,
  );
}

void main();
