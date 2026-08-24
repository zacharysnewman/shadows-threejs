/**
 * One run of the game (§6, Run Structure).
 *
 * A run is a single life over one map, with no checkpoints, no saves and no mid-run
 * persistence — so everything that belongs to a run is built here and dropped here, and
 * `main` keeps only what outlives it: the renderer, the input devices, the decoded sound
 * bank and the HUD shell.
 *
 * That split is the reason this file exists at all. §5.3 ends a run and starts another,
 * and the way a game like this rots is a run leaving something behind: a light still in
 * the scene, an audio source still playing, a `keydown` listener still driving the dead
 * run's player. Making the boundary a module makes the leak a compile-time question —
 * anything a run touches is constructed inside `createRun` and torn down in `dispose`.
 *
 * The simulation clock is per-run too, which is what makes elapsed time on the victory
 * screen honest and what stops a timer surviving into the next life.
 */

import * as THREE from 'three';
import { FLASHLIGHT, HEALTH, ILLUMINATION, INTERACTION, PLAYER, SIM } from './config';
import type { AudioCore } from './audio/AudioCore';
import { FootstepCadence } from './audio/Footsteps';
import { EnemyManager } from './enemies/EnemyManager';
import { MonsterFootsteps } from './enemies/MonsterFootsteps';
import { Spider } from './enemies/Spider';
import { SpiderVoices } from './enemies/SpiderVoices';
import type { AssetLoader } from './core/AssetLoader';
import type { Input } from './core/Input';
import { OccluderFade } from './core/OccluderFade';
import { Rng } from './core/rng';
import { SimClock } from './core/SimClock';
import type { Viewport } from './core/Viewport';
import { AudioTestEmitter } from './debug/AudioTestEmitter';
import { ColliderOverlay } from './debug/ColliderOverlay';
import type { DebugOverlay } from './debug/DebugOverlay';
import { EntityMarkers } from './debug/EntityMarkers';
import { FreeCamera } from './debug/FreeCamera';
import { PathOverlay } from './debug/PathOverlay';
import { WalkabilityOverlay } from './debug/WalkabilityOverlay';
import { addNightAmbient } from './lighting/Ambient';
import { EnvironmentLights } from './lighting/EnvironmentLights';
import { Flashlight } from './lighting/Flashlight';
import { IlluminationService } from './lighting/Illumination';
import { LampVoices } from './lighting/LampVoices';
import { loadMap, type LoadedMap } from './map/MapLoader';
import { CameraRig } from './player/CameraRig';
import { ColliderIndex } from './player/collision';
import { Player } from './player/Player';
import type { Hud } from './ui/Hud';
import { Gates } from './world/Gates';
import { findTarget, isInteractable, type Interactable } from './world/Interaction';
import type { NoteLibrary } from './world/Notes';
import { Objectives } from './world/Objectives';
import { Props } from './world/Props';
import { RunOutcome } from './world/RunOutcome';
import { RunOverlays } from './ui/RunOverlays';

/** What `main` hands a run: the things that outlive it. */
/** Told when a run has ended and the player has asked for another (§5.3, §6). */
export type RestartRequest = () => void;

export interface RunShell {
  viewport: Viewport;
  overlay: DebugOverlay;
  input: Input;
  assets: AssetLoader;
  audio: AudioCore;
  freeCamera: FreeCamera;
  hud: Hud;
  notes: NoteLibrary;
  /** §6 — dismissing an end screen starts the next run, which the shell owns. */
  onRestart: RestartRequest;
}

export interface Run {
  /** One rendered frame, which also advances the simulation (§7). */
  frame(realDelta: number): void;
  /** The debug harness's keys, forwarded from the shell's one listener. */
  debugKey(code: string): void;
  /** Everything this run put into the world, taken back out. */
  dispose(): void;
  /** For the debug handle and for the checks that a teardown left nothing behind. */
  readonly handle: Record<string, unknown>;
}

export async function createRun(
  shell: RunShell,
  directory: string,
  seed: string | number | null,
): Promise<Run> {
  const { viewport, overlay, input, assets, audio, freeCamera, hud, notes } = shell;
  const clock = new SimClock();
  // §5.3, §6 — the run's ending, and the surface the player reads it on. Built first so
  // nothing below has to check whether they exist yet.
  const outcome = new RunOutcome();
  const overlays = new RunOverlays(viewport.renderer.domElement);
  overlays.onRestart(() => shell.onRestart());
  // The audio context is the shell's and may have been left paused by the run that ended.
  audio.setPaused(false);
  const rng = Rng.from(seed);

  const loaded: LoadedMap = await loadMap(directory, assets);

  const night = addNightAmbient(viewport.scene);

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

  // §4.1 — built once, consumed by both AIs when they arrive. Given the collider index so
  // that what blocks light is exactly what blocks walking.
  const illumination = new IlluminationService(flashlight, environment, colliderIndex);

  // §6 — the run's world state, the props that make it findable, and the swing that opens
  // a gate. Built before the HUD, because the HUD only ever reads them.
  const objectives = new Objectives(loaded.entities);
  const props = new Props(loaded.entities.all.filter(isInteractable));
  viewport.scene.add(props.root);
  const gates = new Gates(
    loaded.geometry,
    loaded.grid,
    colliderIndex,
    loaded.data.width,
    loaded.data.tileSize,
  );

  // §6.1 — the torch is a pick-up on maps that author one, and in hand on maps that do not.
  flashlight.held = objectives.hasFlashlight;
  // §6.3/§6.4 — the switches act through these, so nothing else has to know what a
  // `targetId` might name.
  objectives.onGateOpen((gate) => gates.open(gate));
  objectives.onPowerChange((groupId, on) => environment.setGroupPowered(groupId, on));

  const paths = new PathOverlay(enemies, loaded.grid);
  viewport.scene.add(paths.object);

  // §5.3 — the check reports contact and each enemy resolves it: a spider starts a lunge
  // (§5.3), and the Shadow Monster's kill is Phase 8's. This listener is the readout's, and
  // logs the monster's unresolved touches so the gap is visible rather than silent.
  const contacted = new Set<string>();
  enemies.onContact((enemy, distance) => {
    if (enemy.profile.kind === 'SpiderEnemy' || contacted.has(enemy.key)) return;
    contacted.add(enemy.key);
    console.info(
      `[contact] ${enemy.profile.kind} ${enemy.key} at ${distance.toFixed(2)}m — ` +
        `resolution is Phase 8's (§5.3)`,
    );
  });

  const footsteps = new FootstepCadence();
  // §5.1 — the spiders get a voice now that they have something to be heard doing.
  const voices = new SpiderVoices(audio, enemies.enemies);
  // §5.2 — and the monster gets the only tell it has at range.
  const monsterSteps = new MonsterFootsteps(audio);
  // §4.2 — a straining lamp is audible from anywhere, which is the half of the tell that
  // still works when the lamp is off screen.
  const lampVoices = new LampVoices(audio, environment);
  // §4.2's lamp flicker is randomised, and every randomised value comes from the run seed
  // so a sabotage cycle replays identically (Cross-Cutting: determinism).
  const sabotageRng = rng.stream('sabotage');
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
    // §5.3, §6 — and a run that has ended takes the input away entirely.
    const driving = outcome.inputEnabled && !freeCamera.enabled;
    const moveX = driving ? input.moveX : 0;
    const moveZ = driving ? input.moveZ : 0;
    const sprinting = driving && input.isHeld('sprint');
    const before = player.position.clone();
    player.tick(dt, moveX, moveZ, sprinting);
    flashlight.tick(dt);

    // The pool's first customer: a step every stride of ground actually covered, so a
    // player stopped against a wall makes no noise however hard they walk into it.
    if (footsteps.tick(before.distanceTo(player.position))) {
      audio.playAt('footstep_light', player.position.x, player.position.y);
    }

    illumination.tick(dt);
    enemies.tick(dt, {
      playerX: player.position.x,
      playerZ: player.position.y,
      illumination,
      player,
    });

    // §5.2 — the monsters decide what the beam is doing to itself, and the beam is told.
    // Deliberately after the enemies tick and deliberately not through the battery: a
    // monster interfering with the light is not the light running down (§4.1).
    flashlight.intensityScale = enemies.beamInterference;
    // §4.2 — the lamps find out who is standing under them.
    environment.tick(dt, enemies.monsterPositions(), () => sabotageRng.float());
    monsterSteps.tick(enemies.monsters);
    // §6.4 — a swing is the one piece of map geometry that moves, and it runs on the
    // simulation clock like everything else with a timer, so a note modal stops it too.
    gates.tick(dt);
    testEmitter.tick(dt, player.position.x, player.position.y);

    heartbeat(dt);
    resolveEnding();
  });

  /**
   * §3.4 — the heartbeat, on the simulation clock so it keeps time with the health it is
   * reporting. Its rate comes from the overlays, which own the curve; this only decides
   * when the next beat lands.
   */
  let sinceBeat = 0;
  function heartbeat(dt: number): void {
    const hz = overlays.showHealth(player.health.value);
    if (hz <= 0) {
      sinceBeat = 0;
      return;
    }
    sinceBeat += dt;
    if (sinceBeat < 1 / hz) return;
    sinceBeat = 0;
    audio.playAt('heartbeat', player.position.x, player.position.y);
  }

  /**
   * §5.3, §6 — has the run stopped being played?
   *
   * Death is checked before victory, because a player killed on the tile they were about
   * to escape from has died: two spiders can land inside the same second (§5.3), and the
   * last thing that happened is not necessarily the thing that ends the run.
   */
  function resolveEnding(): void {
    if (!outcome.simulating) return;

    if (player.health.dead) {
      // §5.3 divides contact into a *damage* and a *kill*, so which enemy it was is
      // already known from which of the two emptied the pool.
      if (outcome.die(player.killedBy ?? 'SpiderEnemy')) {
        overlays.showJumpScare(outcome.cause!);
        // The world has stopped, so its sound stops with it: a spider still chittering
        // over the jump-scare is a world that has not noticed the player is dead.
        audio.setPaused(true);
        console.info(`[run] died to ${outcome.cause} at ${clock.elapsed.toFixed(1)}s`);
      }
      return;
    }

    // §6 — standing on the exit's tile. A locked exit is a solid tile and cannot be stood
    // on at all, so the gate having swung is the whole of the "is it open" test (§6.4).
    const exit = loaded.entities.byType('ExitGate')[0];
    if (!exit) return;
    const here = loaded.grid.worldToGrid(player.position.x, player.position.y);
    if (here.gx !== exit.gx || here.gy !== exit.gy) return;
    if (!outcome.win()) return;
    audio.setPaused(true);
    overlays.showVictory({
      seconds: clock.elapsed,
      notesRead: objectives.notesRead,
      notesTotal: objectives.noteCount,
    });
    console.info(`[run] escaped at ${clock.elapsed.toFixed(1)}s`);
  }

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
      `${player.speed.toFixed(2)} m/s${player.sprinting ? ' · SPRINT' : ''}` +
      `${player.touchingWall ? ' · wall' : ''}`
    );
  });
  overlay.addRow('aim', () =>
    `(${player.aim.x.toFixed(2)}, ${player.aim.y.toFixed(2)}) · ` +
    `${player.sprinting ? 'locked to movement (§3.1)' : input.aimSource}`,
  );
  // §5.3, §6 — the run's ending, which is otherwise only visible as a screen.
  overlay.addRow('run', () => {
    const state = outcome.state;
    if (state === 'playing') return `playing · ${clock.elapsed.toFixed(1)}s elapsed`;
    if (state === 'scare') return `DEAD (${outcome.cause}) · jump-scare holding`;
    if (state === 'over') return `game over (${outcome.cause}) · E or click to restart`;
    return `ESCAPED at ${clock.elapsed.toFixed(1)}s · E or click to restart`;
  });
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
  // §4.1's exit criterion is this readout: lit/unlit per entity, and the raycast budget it
  // costs. Sampled here rather than in the tick because reading it must not change it.
  overlay.addRow('lit', () => {
    if (enemies.count === 0) return 'no entities to light';
    const parts = enemies.enemies.slice(0, 4).map((enemy) => {
      const sample = illumination.sample(enemy.key, enemy.position.x, enemy.position.y);
      const tag = enemy.profile.kind === 'SpiderEnemy' ? 'spider' : 'MONSTER';
      if (!sample.lit) return `${tag}:dark`;
      return `${tag}:${sample.source === 'flashlight' ? 'beam' : 'lamp'} ${(sample.amount * 100).toFixed(0)}%`;
    });
    return parts.join(' · ');
  });
  // §5.1's lifecycle is four steps and only one of them shows up in `state`; without the
  // timers beside it, "stunned" and "about to flee" look identical.
  overlay.addRow('spider', () => {
    const spiders = enemies.enemies.filter((enemy): enemy is Spider => enemy instanceof Spider);
    if (spiders.length === 0) return 'none on this map';
    const nearest = spiders
      .map((spider) => ({ spider, distance: spider.distanceTo(player.position.x, player.position.y) }))
      .sort((a, b) => a.distance - b.distance)[0]!;
    return (
      `${spiders.length} · nearest ${nearest.distance.toFixed(1)}m · ` +
      `${nearest.spider.state} · ${nearest.spider.lightStatus}`
    );
  });
  overlay.addRow('rays', () =>
    `${illumination.raycastsPerSecond}/s across ${illumination.subjectCount} subject(s)` +
    ` · budget ${ILLUMINATION.raycastHz}/s each`,
  );
  // §6 — the objective chain, which is otherwise entirely invisible from the scene: a
  // latched switch and an unpressed one look the same until the exit opens.
  overlay.addRow('objective', () => {
    const { fired, required, unlocked } = objectives.exitProgress();
    if (required === 0) return 'no exit on this map';
    return (
      `exit ${fired}/${required} routed${unlocked ? ' · OPEN' : ''} · ` +
      `notes ${objectives.notesRead}/${objectives.noteCount}` +
      `${objectives.hasFlashlight ? '' : ' · no torch yet'}`
    );
  });
  overlay.addRow('props', () => {
    const total = props.count;
    if (total === 0) return 'none on this map';
    const target = interactTarget ? `${interactTarget.type} — ${objectives.promptFor(interactTarget)}` : '—';
    return `${props.present.length}/${total} present · in reach: ${target}`;
  });
  overlay.addRow('gates', () =>
    loaded.entities.byType('Gate').length + loaded.entities.byType('ExitGate').length === 0
      ? 'none on this map'
      : `${gates.openedCount} opened · ${gates.swingingCount} swinging`,
  );
  overlay.addRow('seed', () => `${rng.seed}`);
  overlay.addRow('torch', () => {
    const { battery } = flashlight;
    const charge = `${(battery.charge * 100).toFixed(0)}%`;
    if (battery.on) {
      return `ON · ${charge} · beam ${(battery.intensityFraction * 100).toFixed(0)}%`;
    }
    return `off · ${charge}${battery.lockedOut ? ` · LOCKED OUT until ${FLASHLIGHT.reEnableCharge * 100}%` : ''}`;
  });
  overlay.addRow('lamps', () => {
    if (environment.lamps.length === 0) return 'none on this map';
    // §4.2 — straining and failed are the tell, so they belong beside the lit count.
    const sabotage =
      environment.strainingCount > 0 || environment.failedCount > 0
        ? ` · ${environment.strainingCount} STRAINING · ${environment.failedCount} out`
        : '';
    return (
      `${environment.litCount}/${environment.lamps.length} lit · ` +
      `${environment.shadowCasterCount} casting shadows${sabotage}`
    );
  });
  // §5.2's lifecycle is entirely invisible from `state`: frozen is frozen whether the ramp
  // is at 0.1 or one tick from a blink.
  overlay.addRow('MONSTER', () => {
    const monsters = enemies.monsters;
    if (monsters.length === 0) return 'none on this map';
    const nearest = monsters
      .map((monster) => ({ monster, distance: monster.distanceTo(player.position.x, player.position.y) }))
      .sort((a, b) => a.distance - b.distance)[0]!;
    return (
      `${monsters.length} · nearest ${nearest.distance.toFixed(1)}m · ${nearest.monster.state} · ` +
      `${nearest.monster.lightStatus} · ${nearest.monster.blinkCount} blink(s)`
    );
  });
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

  /** The one thing `E` would act on right now, or null (§3.3). */
  let interactTarget: Interactable | null = null;

  /**
   * §3.3 — pick a target and act on it. Runs per frame rather than per tick because it is
   * driven by an input edge, and the edge is cleared at the end of the frame it happened
   * in.
   */
  function resolveInteraction(): void {
    // §3.3 — interaction is disabled while a modal is up, and the modal's own key is the
    // only thing the action does there.
    if (hud.modalOpen) {
      interactTarget = null;
      if (input.wasPressed('interact')) closeNote();
      return;
    }

    interactTarget = freeCamera.enabled
      ? null
      : findTarget(props.present, {
          playerX: player.position.x,
          playerZ: player.position.y,
          aimX: player.aim.x,
          aimZ: player.aim.y,
        });

    if (!interactTarget || !input.wasPressed('interact')) return;

    const target = interactTarget;
    const result = objectives.use(target);
    if (result.kind === 'flashlight') {
      props.collect(target);
      flashlight.held = true;
    }
    if (result.kind === 'note' && result.noteId) openNote(result.noteId);
    if (result.message) console.info(`[interact] ${result.message}`);
  }

  /** §6.2 — reading pauses the world. The clock is paused here, where the clock lives. */
  function openNote(noteId: string): void {
    hud.openNoteModal(noteId, notes);
    clock.paused = true;
  }

  function closeNote(): void {
    hud.closeNoteModal();
    clock.paused = false;
  }

  /** Project the prompt anchor into pixels and hand the HUD everything it draws (§6). */
  function updateHud(): void {
    let screen: { x: number; y: number } | null = null;
    if (interactTarget) {
      _promptAnchor.set(
        interactTarget.wx,
        props.anchorFor(interactTarget) + INTERACTION.promptHeight,
        interactTarget.wz,
      );
      _promptAnchor.project(viewport.camera);
      // Behind the camera projects to a point in front of it; a prompt for something the
      // player cannot see would be a prompt pinned to the wrong place on screen.
      if (_promptAnchor.z <= 1) {
        const size = viewport.renderer.domElement;
        screen = {
          x: ((_promptAnchor.x + 1) / 2) * size.clientWidth,
          y: ((1 - _promptAnchor.y) / 2) * size.clientHeight,
        };
      }
    }
    hud.showPrompt(interactTarget ? objectives.promptFor(interactTarget) : null, screen);
    hud.showObjective(objectives.exitProgress(), {
      read: objectives.notesRead,
      total: objectives.noteCount,
    });
  }

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
  overlay.addBinding('E', 'interact — pick up, read, throw a switch (§3.3)');
  overlay.addBinding('Shift', 'sprint — aim locks to the way you are going');
  overlay.addBinding('V', 'free camera (WASD pans, wheel zooms)');
  overlay.addBinding('O', 'occluder fade');
  overlay.addBinding('Z', 'orbit a test emitter off-screen (audio)');
  overlay.addBinding('N', 'enemy paths');
  overlay.addBinding('X', 'block/unblock the hovered tile (walkability only)');
  overlay.addBinding('Y', 'disable the enemies');
  overlay.addBinding('I', 'draw the Shadow Monster\'s body (§5.2 says never)');
  overlay.addBinding('F', 'flashlight');
  overlay.addBinding('B', 'drain the battery to 5%');
  overlay.addBinding('L', 'debug override: power every light group, past the switches');
  overlay.addBinding('K', `debug damage (${HEALTH.spiderDamage})`);
  overlay.addBinding('J', 'heal to full');
  overlay.addBinding('G', 'walkability overlay');
  overlay.addBinding('C', 'collider overlay');
  overlay.addBinding('M', 'entity markers');
  overlay.addBinding('P', 'pause simulation');
  overlay.addBinding('.', 'step one tick');
  overlay.addBinding('[ ]', 'time scale');
  overlay.addBinding('R', 'restart the run (§6 gives the player E or a click)');
  overlay.addBinding('H', 'hide this overlay');

  /**
   * The debug harness's keys (Cross-Cutting). A method rather than a listener of its own,
   * so tearing a run down takes its keys with it: a listener left behind would drive the
   * previous run's objects and keep them alive.
   */
  function debugKey(code: string): void {
    switch (code) {
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
      case 'KeyI':
        // §5.2 — the Shadow Monster's body is never drawn. This draws it anyway, because
        // the harness cannot debug a thing by staring at where it is not.
        console.info(`[debug] invisible bodies ${enemies.toggleRevealBodies() ? 'shown' : 'hidden'}`);
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
      case 'Escape':
        // §6.2 — the modal's other way out. Not an action binding: `Escape` closing a
        // dialogue is not something a player should have to be told.
        if (hud.modalOpen) closeNote();
        break;
      case 'KeyR':
        shell.onRestart();
        break;
      case 'KeyH':
        overlay.toggle();
        break;
      default:
        break;
    }
  }

  /**
   * Debug handle (Cross-Cutting: debug harness). Everything the overlay reports, reachable
   * from the console and from automated checks — which is how some of this is verified at
   * all: "locatable by ear" (§4.3) cannot be asserted from a test runner, but the audio
   * graph can be tapped from here and measured.
   *
   * The shell publishes it on `window.shadows` in development builds only, and republishes
   * it on every restart, so the handle always names the run that is actually running.
   */
  const handle: Record<string, unknown> = {
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
    objectives,
    props,
    gates,
    hud,
    notes,
    voices,
    monsterSteps,
    lampVoices,
    rng,
    illumination,
    night,
  };

  /**
   * Take back everything this run put into the world (§6, Run Structure).
   *
   * Ordered scene-outwards: the things holding audio sources release them first, then the
   * things holding lights and geometry, then the map itself. Nothing here is optional —
   * a run that leaves a light in the scene is a run whose next life is brighter than its
   * first, and that is exactly the bug this ordering exists to make impossible.
   */
  function disposeRun(): void {
    voices.dispose();
    lampVoices.dispose();
    testEmitter.dispose();

    enemies.dispose();
    props.dispose();
    paths.dispose();
    walkability.dispose();
    colliders.dispose();
    markers.dispose();

    flashlight.dispose();
    environment.dispose();
    night.dispose();

    player.object.removeFromParent();
    loaded.dispose();

    overlays.dispose();
    clock.dispose();
    overlay.clearRows();
  }

  // --- The frame ----------------------------------------------------------
  function frame(realDelta: number): void {

    // Sampled once per frame, before the ticks: a frame that runs three ticks applies the
    // same input snapshot to all three rather than three different reads of the hardware.
    input.update();
    // §5.3 — the jump-scare's hold is real time: the world has already stopped, and a hold
    // on a paused clock is a hold that never ends. Clamped on §7's terms, like the
    // simulation's own catch-up: a backgrounded tab comes back with a multi-second delta,
    // and one frame must not swallow the whole 1.5 s the player is supposed to see.
    outcome.tick(Math.min(Math.max(realDelta, 0), SIM.maxFrameSeconds));
    if (outcome.state === 'over') overlays.showGameOver(outcome.cause ?? 'SpiderEnemy');

    if (outcome.awaitingRestart) {
      // §6 — the only thing the action means now is "again".
      if (input.wasPressed('interact')) overlays.dismiss();
    } else if (outcome.inputEnabled) {
      updateAim();
      resolveInteraction();
    }

    // §7 — the simulation advances in fixed ticks; rendering is whatever the display gives.
    // §5.3, §6 — and it does not advance at all once the run has ended: the jump-scare
    // plays over a world that has stopped, not one still walking around behind it.
    if (outcome.simulating) clock.advance(realDelta);

    player.render(clock.alpha);
    enemies.render(clock.alpha);
    voices.update();
    lampVoices.update();
    paths.update();
    // Bound to the interpolated position, not the tick position: a beam that stepped at
    // 60 Hz while the player moved smoothly would visibly swim around them.
    flashlight.update(
      player.object.position.x,
      player.object.position.z,
      player.aim.x,
      player.aim.y,
    );
    // §7 — the moon's shadow camera is fitted to what is on screen, so it travels with the
    // player rather than trying to cover the level.
    night.follow(player.object.position.x, player.object.position.z);

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
    props.refresh(objectives);
    updateHud();
    overlay.update(realDelta);
    viewport.render();
    input.endFrame();

    requestAnimationFrame(frame);
  }

  function dispose(): void {
    disposeRun();
  }

  /** Exposed for the checks that a run ended the way it was supposed to. */
  handle.outcome = outcome;
  handle.overlays = overlays;

  console.info(`[run] seed ${rng.seed} — replay with ?seed=${rng.seed}`);
  console.info(
    `[map] loaded ${directory}: ${loaded.data.width}×${loaded.data.height}, ` +
      `${loaded.entities.count} entities, ${loaded.colliders.length} colliders, ` +
      `${loaded.data.warnings.length} warning(s)`,
  );

  return { frame, debugKey, dispose, handle };
}

/** Scratch for projecting the prompt anchor; allocating one per frame is a per-frame GC. */
const _promptAnchor = new THREE.Vector3();
