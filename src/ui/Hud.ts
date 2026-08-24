/**
 * The player-facing UI (§6, §3.3).
 *
 * Three things, and deliberately only three: the prompt above whatever the context action
 * would act on, the note modal, and the exit counter. §3.4 is explicit that health is *not*
 * a HUD element — it reads through a vignette and a heartbeat — and §6.5 is equally
 * explicit that the exit counter *is* one, because without it the last switch is an
 * unmarked hunt across the map.
 *
 * Plain DOM over the canvas rather than anything in the scene: text in a 3D scene has to
 * fight the fog, the tone mapping and the camera pitch to stay legible, and none of that
 * is a fight worth having for a two-word prompt.
 *
 * The modal is the one piece with a simulation consequence — §6.2 pauses the world while
 * the player reads — and this class does not pause anything itself. It reports that the
 * modal is open and the caller owns the clock, so the pause is visible where the clock is.
 */

import type { NoteLibrary } from '../world/Notes';

export class Hud {
  readonly root: HTMLDivElement;

  private readonly prompt: HTMLDivElement;
  private readonly counter: HTMLDivElement;
  private readonly modal: HTMLDivElement;
  private readonly modalTitle: HTMLHeadingElement;
  private readonly modalBody: HTMLDivElement;

  private _openNote: string | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = STYLE;

    this.prompt = document.createElement('div');
    this.prompt.className = 'hud-prompt';
    this.prompt.hidden = true;

    this.counter = document.createElement('div');
    this.counter.className = 'hud-counter';

    this.modal = document.createElement('div');
    this.modal.className = 'hud-modal';
    this.modal.hidden = true;
    this.modalTitle = document.createElement('h2');
    this.modalBody = document.createElement('div');
    this.modalBody.className = 'hud-modal-body';
    const hint = document.createElement('p');
    hint.className = 'hud-modal-hint';
    hint.textContent = 'E or Esc to put it down';
    const card = document.createElement('div');
    card.className = 'hud-modal-card';
    card.append(this.modalTitle, this.modalBody, hint);
    this.modal.append(card);

    this.root.append(this.prompt, this.counter, this.modal);
    parent.append(this.root);
  }

  /** §6.2 — the id of the note being read, or null. The caller pauses on this. */
  get openNote(): string | null {
    return this._openNote;
  }

  get modalOpen(): boolean {
    return this._openNote !== null;
  }

  /**
   * Show the prompt over a target, or hide it. `screen` is the target's anchor projected
   * into pixels; null hides it, which is also what a modal being up must do (§3.3).
   */
  showPrompt(text: string | null, screen: { x: number; y: number } | null): void {
    if (!text || !screen || this.modalOpen) {
      this.prompt.hidden = true;
      return;
    }
    this.prompt.hidden = false;
    this.prompt.textContent = text;
    this.prompt.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`;
  }

  /** §6.5 — how many switches are left, and what the run has found so far. */
  showObjective(exit: { fired: number; required: number; unlocked: boolean }, notes: { read: number; total: number }): void {
    if (exit.required === 0) {
      this.counter.hidden = true;
      return;
    }
    this.counter.hidden = false;
    this.counter.classList.toggle('is-open', exit.unlocked);
    const power = exit.unlocked
      ? 'EXIT OPEN'
      : `Exit power &middot; ${exit.fired}/${exit.required} routed`;
    const found = notes.total > 0 ? ` &middot; notes ${notes.read}/${notes.total}` : '';
    this.counter.innerHTML = `${power}${found}`;
  }

  openNoteModal(noteId: string, notes: NoteLibrary): void {
    const note = notes.get(noteId);
    this._openNote = noteId;
    this.modalTitle.textContent = note.title;
    this.modalBody.textContent = '';
    for (const paragraph of note.body.split('\n\n')) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      this.modalBody.append(p);
    }
    this.modal.hidden = false;
    this.prompt.hidden = true;
  }

  closeNoteModal(): void {
    this._openNote = null;
    this.modal.hidden = true;
  }

  /**
   * Back to how a run starts (§6, Run Structure). The HUD outlives a run, so the state it
   * carries — an open note, a stale prompt, the last run's counter — has to be cleared or
   * the new life begins mid-sentence.
   */
  reset(): void {
    this.closeNoteModal();
    this.prompt.hidden = true;
    this.counter.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * Styles inline rather than in a stylesheet: the HUD is the only DOM the game owns, and a
 * second file to keep in sync with it would be a file nobody remembers exists.
 */
const STYLE = `<style>
.hud { position: fixed; inset: 0; pointer-events: none; z-index: 20;
  font: 500 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: #e8e4dc; }
.hud-prompt { position: absolute; top: 0; left: 0; padding: 6px 12px; border-radius: 999px;
  background: rgba(12, 16, 24, 0.82); border: 1px solid rgba(232, 228, 220, 0.28);
  white-space: nowrap; letter-spacing: 0.01em; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.hud-counter { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
  padding: 8px 18px; border-radius: 999px; background: rgba(12, 16, 24, 0.7);
  border: 1px solid rgba(232, 228, 220, 0.18); letter-spacing: 0.04em; font-size: 14px; }
.hud-counter.is-open { color: #8ff0b4; border-color: rgba(143, 240, 180, 0.5); }
.hud-modal { position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(4, 6, 10, 0.72); pointer-events: auto; }
/* A class setting \`display\` outbids the user agent's \`[hidden] { display: none }\`, so
   hiding these has to be said here or the modal is never actually hidden. */
.hud [hidden] { display: none !important; }
.hud-modal-card { max-width: 46ch; padding: 28px 32px; border-radius: 10px;
  background: #14171d; border: 1px solid rgba(232, 228, 220, 0.2);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6); }
.hud-modal-card h2 { margin: 0 0 14px; font-size: 19px; font-weight: 600; letter-spacing: 0.01em; }
.hud-modal-body p { margin: 0 0 12px; color: #cdc7bb; }
.hud-modal-hint { margin: 18px 0 0; font-size: 13px; color: #7d8592; letter-spacing: 0.05em; }
</style>`;
