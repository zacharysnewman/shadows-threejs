/**
 * Is this map playable? (§2, §6)
 *
 * The loader already refuses a map it cannot parse and warns about entities it had to
 * skip. This asks the question after that one: the file is valid, but can the level
 * actually be *finished*?
 *
 * That is a different kind of failure and a much quieter one. A switch walled off behind a
 * gate its own switch is behind, an exit needing three latches on a map with two, a note
 * whose text was never written — none of these break anything. The map loads, the run
 * starts, and the player walks the level twice before concluding the game is broken rather
 * than that they have missed something. §6 makes objective progress monotonic precisely so
 * a player cannot strand themselves; nothing yet stops the *level* stranding them.
 *
 * **Reachability is computed the way a player earns it**, not with a flood fill over the
 * finished map. Flood from the spawn; open any gate whose switch is inside what has been
 * reached; flood again; repeat until nothing new opens. What comes out is the set of tiles
 * a player can actually stand on, and a gate whose only switch is behind itself falls out
 * as unreachable rather than as a subtlety somebody has to notice.
 *
 * Pure arithmetic over the parsed map. No scene, no renderer — so it runs in a test over
 * every checked-in map, and in the browser at load time against whatever the author just
 * exported.
 */

import { INTERACTION, MAP_LIMITS } from '../config';
import type { EntityRegistry } from './EntityRegistry';
import type { GameMap, MapEntity, Tileset } from './types';
import { WalkabilityGrid } from './WalkabilityGrid';

export type AuditSeverity = 'blocking' | 'warning';

export interface AuditFinding {
  severity: AuditSeverity;
  /** Short machine-ish code, so a finding can be asserted without matching prose. */
  code: string;
  message: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  /** Walkable tiles a player can reach, having opened every gate they could get to. */
  reachableTiles: number;
  /** Walkable tiles that exist but that no sequence of interactions gets the player to. */
  strandedTiles: number;
  get blocking(): AuditFinding[];
}

/**
 * Everything the audit needs beyond the map itself. `noteIds` is what `notes.json` defines;
 * pass an empty set to skip that check rather than to fail every note.
 */
export interface AuditContext {
  noteIds?: ReadonlySet<string>;
}

export function auditMap(
  map: GameMap,
  tileset: Tileset,
  entities: EntityRegistry,
  context: AuditContext = {},
): AuditResult {
  const findings: AuditFinding[] = [];
  const add = (severity: AuditSeverity, code: string, message: string): void => {
    findings.push({ severity, code, message });
  };

  const grid = new WalkabilityGrid(map, tileset);
  const spawn = entities.byType('PlayerSpawn')[0];
  const reach = spawn
    ? reachableFrom(grid, map, entities, spawn.gx, spawn.gy)
    : { tiles: new Set<number>(), openedGates: new Set<string>() };

  const index = (gx: number, gy: number): number => gy * map.width + gx;
  const reached = (gx: number, gy: number): boolean => reach.tiles.has(index(gx, gy));

  /**
   * Can the player act on this entity (§3.3)? It does not have to stand on walkable
   * ground — a switch is meant to be on a wall — but some reachable tile has to be inside
   * the interaction range of it.
   */
  const canInteractWith = (entity: MapEntity): boolean => {
    const span = Math.ceil(INTERACTION.range / map.tileSize) + 1;
    for (let gy = entity.gy - span; gy <= entity.gy + span; gy += 1) {
      for (let gx = entity.gx - span; gx <= entity.gx + span; gx += 1) {
        if (!reached(gx, gy)) continue;
        const { wx, wz } = grid.gridToWorld(gx, gy);
        if (Math.hypot(wx - entity.wx, wz - entity.wz) <= INTERACTION.range) return true;
      }
    }
    return false;
  };

  // --- The objective chain (§6) --------------------------------------------
  const exits = entities.byType('ExitGate');
  if (exits.length === 0) {
    add('warning', 'no-exit', 'no ExitGate: the run has no way to be won (§6)');
  } else if (exits.length > 1) {
    add('blocking', 'many-exits', `${exits.length} ExitGates; §6 describes one`);
  }

  const exit = exits[0];
  if (exit) {
    const latches = entities
      .byType('PowerSwitch')
      .filter((s) => s.targetId === exit.id && s.mode === 'latch');
    if (latches.length < exit.requiredSwitches) {
      add(
        'blocking',
        'exit-underfed',
        `ExitGate "${exit.id}" needs ${exit.requiredSwitches} latch switches and the map ` +
          `has ${latches.length}; the exit can never open (§6.5)`,
      );
    }

    const unreachable = latches.filter((s) => !canInteractWith(s));
    if (unreachable.length > 0 && latches.length - unreachable.length < exit.requiredSwitches) {
      add(
        'blocking',
        'exit-unreachable-switches',
        `only ${latches.length - unreachable.length} of ${latches.length} switches for ` +
          `"${exit.id}" can be reached, and ${exit.requiredSwitches} are needed`,
      );
    } else if (unreachable.length > 0) {
      add(
        'warning',
        'switch-unreachable',
        `${unreachable.length} switch(es) targeting "${exit.id}" cannot be reached ` +
          `(${unreachable.map((s) => `${s.gx},${s.gy}`).join('; ')})`,
      );
    }

    // The exit's own tile has to be stood on to win (§6). It is solid until it opens, so
    // what matters is that a reachable tile is next to it.
    if (!adjacentToReached(exit.gx, exit.gy, reached)) {
      add('blocking', 'exit-stranded', `ExitGate "${exit.id}" cannot be walked up to`);
    }
  }

  // --- Gates (§6.4) ---------------------------------------------------------
  const gateIds = new Set<string>();
  for (const gate of entities.byType('Gate')) {
    if (gateIds.has(gate.id)) {
      add('blocking', 'duplicate-gate-id', `two gates share the id "${gate.id}"`);
    }
    gateIds.add(gate.id);

    const switches = entities.byType('PowerSwitch').filter((s) => s.targetId === gate.id);
    if (switches.length === 0) {
      add('warning', 'gate-no-switch', `gate "${gate.id}" has no switch and never opens`);
    } else if (!reach.openedGates.has(gate.id) && switches.some((s) => canInteractWith(s))) {
      // Its switch is reachable but the fixed point never opened it: the switch is inside
      // a region only the gate leads to, which is the classic soft-lock.
      add('warning', 'gate-late', `gate "${gate.id}" opens only after something else does`);
    } else if (!reach.openedGates.has(gate.id)) {
      add(
        'blocking',
        'gate-locked-out',
        `gate "${gate.id}" can never be opened: no switch for it is reachable`,
      );
    }
  }

  // --- Switches, lights and notes -------------------------------------------
  const groupIds = new Set(entities.byType('EnvironmentLight').map((l) => l.groupId));
  for (const sw of entities.byType('PowerSwitch')) {
    const namesSomething =
      groupIds.has(sw.targetId) ||
      gateIds.has(sw.targetId) ||
      exits.some((e) => e.id === sw.targetId);
    if (!namesSomething) {
      add(
        'warning',
        'switch-targets-nothing',
        `switch at (${sw.gx}, ${sw.gy}) targets "${sw.targetId}", which nothing on the map answers to`,
      );
    }
    if (!canInteractWith(sw)) {
      add('warning', 'switch-unreachable', `switch at (${sw.gx}, ${sw.gy}) cannot be reached`);
    }
  }

  for (const groupId of groupIds) {
    if (![...entities.byType('PowerSwitch')].some((s) => s.targetId === groupId)) {
      add(
        'warning',
        'group-no-switch',
        `light group "${groupId}" has no switch and can never be powered (§4.2)`,
      );
    }
  }

  const noteIds = context.noteIds;
  for (const note of entities.byType('Note')) {
    if (noteIds && noteIds.size > 0 && !noteIds.has(note.noteId)) {
      add(
        'warning',
        'note-unwritten',
        `note "${note.noteId}" at (${note.gx}, ${note.gy}) has no entry in notes.json (§6.2)`,
      );
    }
    if (!canInteractWith(note)) {
      add('warning', 'note-unreachable', `note "${note.noteId}" cannot be reached`);
    }
  }

  // --- The flashlight and the enemies ---------------------------------------
  const torches = entities.byType('Flashlight');
  if (torches.length > 1) {
    add('warning', 'many-flashlights', `${torches.length} Flashlight pick-ups; one is enough`);
  }
  for (const torch of torches) {
    if (!canInteractWith(torch)) {
      add(
        'blocking',
        'flashlight-unreachable',
        `the flashlight at (${torch.gx}, ${torch.gy}) cannot be reached, and §6.1 gives the ` +
          `player none until they pick it up`,
      );
    }
  }

  for (const kind of ['SpiderEnemy', 'ShadowMonster'] as const) {
    for (const enemy of entities.byType(kind)) {
      if (!reached(enemy.gx, enemy.gy)) {
        add(
          'warning',
          'enemy-stranded',
          `${kind} at (${enemy.gx}, ${enemy.gy}) is walled off from the player`,
        );
      }
    }
  }

  // --- The shape of the level ------------------------------------------------
  let walkable = 0;
  for (let gy = 0; gy < map.height; gy += 1) {
    for (let gx = 0; gx < map.width; gx += 1) if (grid.isWalkable(gx, gy)) walkable += 1;
  }
  const stranded = walkable - reach.tiles.size;
  if (spawn && stranded > 0) {
    add(
      'warning',
      'stranded-ground',
      `${stranded} walkable tile(s) cannot be reached from the spawn`,
    );
  }
  if (!spawn) add('blocking', 'no-spawn', 'no PlayerSpawn');

  return {
    findings,
    reachableTiles: reach.tiles.size,
    strandedTiles: Math.max(0, stranded),
    get blocking() {
      return findings.filter((f) => f.severity === 'blocking');
    },
  };
}

/**
 * Tiles the player can stand on, and the gates they got open doing it.
 *
 * Iterated to a fixed point rather than flooded once: opening a gate makes new ground
 * reachable, which may put a new switch in reach, which opens another gate. A single pass
 * over the closed map understates the level, and a single pass over the map with every
 * gate open overstates it — the fixed point is the only one of the three that answers the
 * question actually being asked.
 */
function reachableFrom(
  grid: WalkabilityGrid,
  map: GameMap,
  entities: EntityRegistry,
  startX: number,
  startY: number,
): { tiles: Set<number>; openedGates: Set<string> } {
  const openedGates = new Set<string>();
  const openedTiles = new Set<number>();
  let tiles = flood(grid, map, startX, startY, openedTiles);

  for (let pass = 0; pass < MAP_LIMITS.maxGateCascade; pass += 1) {
    let opened = false;

    for (const gate of entities.byType('Gate')) {
      if (openedGates.has(gate.id)) continue;
      const switches = entities.byType('PowerSwitch').filter((s) => s.targetId === gate.id);
      // A switch counts as reachable if any reached tile is within interaction range.
      const usable = switches.some((sw) => withinReach(grid, map, tiles, sw.wx, sw.wz));
      if (!usable) continue;
      openedGates.add(gate.id);
      openedTiles.add(gate.gy * map.width + gate.gx);
      opened = true;
    }

    if (!opened) break;
    tiles = flood(grid, map, startX, startY, openedTiles);
  }

  return { tiles, openedGates };
}

function withinReach(
  grid: WalkabilityGrid,
  map: GameMap,
  tiles: ReadonlySet<number>,
  wx: number,
  wz: number,
): boolean {
  const span = Math.ceil(INTERACTION.range / map.tileSize) + 1;
  const here = grid.worldToGrid(wx, wz);
  for (let gy = here.gy - span; gy <= here.gy + span; gy += 1) {
    for (let gx = here.gx - span; gx <= here.gx + span; gx += 1) {
      if (!tiles.has(gy * map.width + gx)) continue;
      const world = grid.gridToWorld(gx, gy);
      if (Math.hypot(world.wx - wx, world.wz - wz) <= INTERACTION.range) return true;
    }
  }
  return false;
}

/** Four-connected flood, because a player cannot squeeze through a diagonal gap. */
function flood(
  grid: WalkabilityGrid,
  map: GameMap,
  startX: number,
  startY: number,
  extra: ReadonlySet<number>,
): Set<number> {
  const seen = new Set<number>();
  const walkable = (gx: number, gy: number): boolean =>
    grid.isWalkable(gx, gy) || extra.has(gy * map.width + gx);
  if (!walkable(startX, startY)) return seen;

  const queue = [startY * map.width + startX];
  seen.add(queue[0]!);
  while (queue.length > 0) {
    const current = queue.pop()!;
    const gx = current % map.width;
    const gy = Math.floor(current / map.width);
    for (const [nx, ny] of [
      [gx - 1, gy],
      [gx + 1, gy],
      [gx, gy - 1],
      [gx, gy + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = ny * map.width + nx;
      if (seen.has(next) || !walkable(nx, ny)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function adjacentToReached(
  gx: number,
  gy: number,
  reached: (x: number, y: number) => boolean,
): boolean {
  return (
    reached(gx - 1, gy) || reached(gx + 1, gy) || reached(gx, gy - 1) || reached(gx, gy + 1)
  );
}
