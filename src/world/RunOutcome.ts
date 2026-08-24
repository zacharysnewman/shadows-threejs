/**
 * How a run ends, as arithmetic (§5.3, §6).
 *
 * Four states and the rules for moving between them, with no DOM, no scene and no clock —
 * so the ordering that actually matters can be tested: that death takes the input away
 * *before* the jump-scare rather than after it, that the hold is real time because the
 * world has already stopped, and that a run cannot end twice.
 *
 * The last one is not hypothetical. Two spiders can land inside the same second (§5.3), and
 * a player who dies on the tile they were about to escape from would otherwise resolve as
 * both a death and a victory.
 */

import { RUN } from '../config';

export type Outcome = 'playing' | 'scare' | 'over' | 'won';
export type DeathCause = 'SpiderEnemy' | 'ShadowMonster';

export class RunOutcome {
  private _state: Outcome = 'playing';
  private _cause: DeathCause | null = null;
  private scareRemaining = 0;

  get state(): Outcome {
    return this._state;
  }

  get cause(): DeathCause | null {
    return this._cause;
  }

  /** §5.3, §6 — input is disabled the instant a run stops being played. */
  get inputEnabled(): boolean {
    return this._state === 'playing';
  }

  /** §5.3, §6 — the world stops too; only the jump-scare's own timer keeps running. */
  get simulating(): boolean {
    return this._state === 'playing';
  }

  /** True once there is a screen up that the interact action would dismiss (§6). */
  get awaitingRestart(): boolean {
    return this._state === 'over' || this._state === 'won';
  }

  /** §5.3 — the pool reached zero. The first one to arrive is the one that counts. */
  die(cause: DeathCause): boolean {
    if (this._state !== 'playing') return false;
    this._state = 'scare';
    this._cause = cause;
    this.scareRemaining = RUN.jumpScareSeconds;
    return true;
  }

  /** §6 — the player stood on the open exit. */
  win(): boolean {
    if (this._state !== 'playing') return false;
    this._state = 'won';
    return true;
  }

  /**
   * Advance the jump-scare's hold. Fed the *render* delta, not the simulation's: §5.3's
   * 1.5 s has to elapse while the world is stopped, and a hold on a paused clock is a hold
   * that never ends.
   */
  tick(realDelta: number): void {
    if (this._state !== 'scare') return;
    this.scareRemaining -= realDelta;
    if (this.scareRemaining <= 0) this._state = 'over';
  }
}
