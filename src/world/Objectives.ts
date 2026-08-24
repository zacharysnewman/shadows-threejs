/**
 * The run's world state (§6).
 *
 * Latched switches, toggled light groups, notes read, the flashlight in hand, and which
 * gates have swung. All of it lives here for exactly one run and is discarded on death or
 * victory (§6, Run Structure) — there is no save, no checkpoint and nothing to persist, so
 * this class has no serialisation and should not grow one.
 *
 * **The asymmetry between the two switch modes is the whole design.** `toggle` is for
 * light groups, and it is reversible because killing a lit area is sometimes what the
 * player wants: a pool of light is a safe zone from the spiders and a place to be seen
 * standing in. `latch` is one-way, and that is what makes objective progress monotonic —
 * the exit's counter can only ever go up, so no sequence of presses can strand a player
 * who has already routed the power.
 *
 * Simulation-side only. It resolves an interaction into state changes and reports what
 * happened; drawing the prompt, the modal and the counter is the HUD's (§6).
 */

import type { EntityRegistry } from '../map/EntityRegistry';
import type { ExitGateEntity, GateEntity, PowerSwitchEntity } from '../map/types';
import type { Interactable } from './Interaction';

/** What an interaction did, for the HUD to say and the readout to show. */
export interface InteractionResult {
  kind: 'flashlight' | 'note' | 'switch' | 'gate' | 'exit' | 'refused';
  message: string;
  /** Set when a `Note` was opened: the modal's key into `notes.json` (§6.2). */
  noteId?: string;
}

/** Told when a gate should start swinging, so the animation lives outside this class. */
export type GateOpenListener = (gate: GateEntity | ExitGateEntity) => void;
/** Told when a light group's power changes (§4.2). */
export type PowerListener = (groupId: string, on: boolean) => void;

export class Objectives {
  /** §6 — `latch` switches that have fired, by entity key. Never removed from. */
  private readonly latched = new Set<string>();
  /** §6 — light groups the player has switched on. */
  private readonly powered = new Set<string>();
  /** Gates that have been triggered, by gate id. */
  private readonly opened = new Set<string>();
  /** §6.2 — distinct notes read, which is what the victory screen counts. */
  private readonly read = new Set<string>();
  private _hasFlashlight: boolean;

  private readonly gateListeners = new Set<GateOpenListener>();
  private readonly powerListeners = new Set<PowerListener>();

  constructor(private readonly entities: EntityRegistry) {
    // §6.1 — a map that authors a pick-up starts the player without one; a map that does
    // not is a map built to exercise something else, and should be playable as it stands.
    this._hasFlashlight = entities.byType('Flashlight').length === 0;
  }

  get hasFlashlight(): boolean {
    return this._hasFlashlight;
  }

  get notesRead(): number {
    return this.read.size;
  }

  get noteCount(): number {
    return this.entities.byType('Note').length;
  }

  hasRead(noteId: string): boolean {
    return this.read.has(noteId);
  }

  isLatched(key: string): boolean {
    return this.latched.has(key);
  }

  isGroupPowered(groupId: string): boolean {
    return this.powered.has(groupId);
  }

  isGateOpen(id: string): boolean {
    return this.opened.has(id);
  }

  /** True for a pick-up that is no longer on the map. */
  isCollected(key: string): boolean {
    return this._hasFlashlight && this.entities.byType('Flashlight').some((f) => f.key === key);
  }

  onGateOpen(listener: GateOpenListener): () => void {
    this.gateListeners.add(listener);
    return () => this.gateListeners.delete(listener);
  }

  onPowerChange(listener: PowerListener): () => void {
    this.powerListeners.add(listener);
    return () => this.powerListeners.delete(listener);
  }

  /**
   * §6.5 — how the exit stands: distinct `latch` switches fired against it, out of the
   * number it needs. This is the HUD counter, and the reason §6 has one at all: without
   * it the last switch is an unmarked hunt across the map.
   */
  exitProgress(): { fired: number; required: number; unlocked: boolean } {
    const exit = this.entities.byType('ExitGate')[0];
    if (!exit) return { fired: 0, required: 0, unlocked: false };

    const required = exit.requiredSwitches;
    const fired = this.switchesFor(exit.id).filter((s) => this.latched.has(s.key)).length;
    return { fired, required, unlocked: fired >= required || this.opened.has(exit.id) };
  }

  /** Every `latch` switch on the map pointing at this target. */
  private switchesFor(targetId: string): PowerSwitchEntity[] {
    return this.entities
      .byType('PowerSwitch')
      .filter((s) => s.targetId === targetId && s.mode === 'latch');
  }

  /** What the prompt should read for a target the player could act on right now (§3.3). */
  promptFor(target: Interactable): string {
    switch (target.type) {
      case 'Flashlight':
        return 'Take the flashlight';
      case 'Note':
        return this.read.has(target.noteId) ? 'Read again' : 'Read';
      case 'PowerSwitch':
        if (target.mode === 'latch') {
          return this.latched.has(target.key) ? 'Already routed' : `Route power — ${target.targetId}`;
        }
        return `${this.isGroupPowered(target.targetId) ? 'Cut' : 'Restore'} ${target.targetId}`;
      case 'Gate':
        return this.opened.has(target.id) ? 'Open' : 'Locked';
      case 'ExitGate': {
        const { fired, required, unlocked } = this.exitProgress();
        return unlocked ? 'The way out' : `Unpowered — ${required - fired} switch(es) to route`;
      }
      default:
        return '';
    }
  }

  /** Resolve the context action on a target (§3.3, §6). */
  use(target: Interactable): InteractionResult {
    switch (target.type) {
      case 'Flashlight':
        this._hasFlashlight = true;
        return { kind: 'flashlight', message: 'Flashlight' };

      case 'Note':
        this.read.add(target.noteId);
        return { kind: 'note', message: 'Reading', noteId: target.noteId };

      case 'PowerSwitch':
        return this.useSwitch(target);

      case 'Gate':
      case 'ExitGate':
        // Neither is thrown by hand: a gate answers to its switch (§6.3) and the exit
        // answers to the counter (§6.5). Pressing them reports where they stand.
        return { kind: 'refused', message: this.promptFor(target) };

      default:
        return { kind: 'refused', message: '' };
    }
  }

  private useSwitch(target: PowerSwitchEntity): InteractionResult {
    if (target.mode === 'latch') {
      // §6.3 — one-way. Firing it twice is not an error and is not progress either, which
      // is exactly what keeps the exit's counter monotonic.
      if (this.latched.has(target.key)) {
        return { kind: 'refused', message: `${target.targetId} is already routed` };
      }
      this.latched.add(target.key);
      const opened = this.openTargets(target.targetId);
      const { fired, required, unlocked } = this.exitProgress();
      const exit = this.entities.byType('ExitGate')[0];
      if (exit && target.targetId === exit.id) {
        return {
          kind: 'switch',
          message: unlocked
            ? 'Power routed — the exit is open'
            : `Power routed — ${required - fired} to go`,
        };
      }
      return {
        kind: 'switch',
        message: opened > 0 ? `${target.targetId} opening` : `${target.targetId} powered`,
      };
    }

    // §6.3 — two-way, and only ever aimed at light groups.
    const on = !this.powered.has(target.targetId);
    if (on) this.powered.add(target.targetId);
    else this.powered.delete(target.targetId);
    for (const listener of this.powerListeners) listener(target.targetId, on);
    return { kind: 'switch', message: `${target.targetId} ${on ? 'on' : 'off'}` };
  }

  /**
   * Fire everything a `latch` names: a `Gate` with that id, the `ExitGate` if the counter
   * is now met, and any light group. Returns how many gates began to swing.
   */
  private openTargets(targetId: string): number {
    let opened = 0;

    for (const gate of this.entities.byType('Gate')) {
      if (gate.id !== targetId || this.opened.has(gate.id)) continue;
      this.opened.add(gate.id);
      for (const listener of this.gateListeners) listener(gate);
      opened += 1;
    }

    const exit = this.entities.byType('ExitGate')[0];
    if (exit && exit.id === targetId && !this.opened.has(exit.id)) {
      const { fired, required } = this.exitProgress();
      // §6.5 — the last switch routes the power and the gate opens where it stands. There
      // is nothing to press at the exit itself.
      if (fired >= required) {
        this.opened.add(exit.id);
        for (const listener of this.gateListeners) listener(exit);
        opened += 1;
      }
    }

    // A `latch` may also name a light group — one-way power, which §6.3 allows and the
    // example map does not use. Powered, never un-powered.
    if (this.entities.byType('EnvironmentLight').some((l) => l.groupId === targetId)) {
      if (!this.powered.has(targetId)) {
        this.powered.add(targetId);
        for (const listener of this.powerListeners) listener(targetId, true);
      }
    }

    return opened;
  }
}
