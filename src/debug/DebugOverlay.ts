/**
 * On-screen debug readout (Phase 0) and the registry the debug harness hangs off
 * (Cross-Cutting: "Most of this spec's behaviour is a state machine reacting to light —
 * without visualisation, tuning it is guesswork").
 *
 * Rows are pull-based: a system registers a label and a getter, and the overlay samples
 * it a few times a second. Nothing has to push updates, and a system that goes away just
 * unregisters.
 *
 * §8.3 — it can also be dismissed by touch. `H` toggles it, and a key is not a control on a
 * phone (§3.1), so under debug the readout carries a tap target to dismiss it and leaves one
 * behind to bring it back.
 */

export type RowProvider = () => string;

interface Binding {
  keys: string;
  label: string;
}

export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly bindingsEl: HTMLDivElement;
  private readonly rows = new Map<string, RowProvider>();
  private readonly bindings: Binding[] = [];
  /** The `×` on the readout and the handle that brings it back; both debug-only. */
  private readonly dismissEl: HTMLButtonElement;
  private readonly restoreEl: HTMLButtonElement;
  private touchToggle = false;

  /** Exponentially smoothed frame time in ms; a raw per-frame number is unreadable. */
  private smoothedFrameMs = 16.7;
  private sinceRefresh = 0;
  private visible = true;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:10',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#cfe3d0',
      'background:rgba(6,10,8,0.72)',
      'border:1px solid rgba(120,180,140,0.25)',
      'border-radius:6px',
      'padding:8px 10px',
      'pointer-events:none',
      'white-space:pre',
      'max-width:46ch',
    ].join(';');

    this.statsEl = document.createElement('div');
    this.bindingsEl = document.createElement('div');
    this.bindingsEl.style.cssText = 'margin-top:6px;opacity:0.62';

    this.root.append(this.statsEl, this.bindingsEl);

    this.dismissEl = this.tapTarget('\u00d7', 'hide the debug readout', () => this.setVisible(false));
    this.dismissEl.style.position = 'absolute';
    this.dismissEl.style.top = '2px';
    this.dismissEl.style.right = '2px';
    this.root.appendChild(this.dismissEl);

    // A sibling rather than a child, because the readout it restores is `display:none`.
    this.restoreEl = this.tapTarget('dbg', 'show the debug readout', () => this.setVisible(true));
    this.restoreEl.style.position = 'fixed';
    this.restoreEl.style.top = '8px';
    this.restoreEl.style.left = '8px';
    this.restoreEl.style.zIndex = '10';

    parent.append(this.root, this.restoreEl);
  }

  /**
   * A tap target for the readout's own controls. 44 px because that is the floor everything
   * touchable in this project is built to (`src/editor/style.ts`), with the glyph drawn
   * smaller than the target it sits in.
   */
  private tapTarget(glyph: string, label: string, onTap: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = glyph;
    // Named for what it does: `×` and `dbg` are legible on the glass and not to a reader.
    button.setAttribute('aria-label', label);
    button.style.cssText = [
      'width:44px',
      'height:44px',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'border:1px solid rgba(120,180,140,0.25)',
      'border-radius:6px',
      'background:rgba(6,10,8,0.72)',
      'color:#cfe3d0',
      'font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      // The root is `pointer-events:none` so the readout never eats a click meant for the
      // game; these two are the exception, and have to opt back in.
      'pointer-events:auto',
      'touch-action:none',
      '-webkit-tap-highlight-color:transparent',
    ].join(';');
    button.addEventListener('pointerdown', (event) => {
      // The same stop the on-screen action buttons need (`src/core/Input.ts`): without it
      // the tap also reaches the window listener and anchors a movement stick under the
      // readout, so dismissing it walks the player away.
      event.stopPropagation();
      onTap();
    });
    return button;
  }

  /**
   * §8.3 — arm the touch controls, which only debug mode does. A player never sees either
   * of them: the readout they toggle is not something a player can reach.
   */
  enableTouchToggle(): void {
    this.touchToggle = true;
    // Reserves the corner the `\u00d7` sits in, so it covers a padded edge and not the frame time.
    this.root.style.paddingRight = '50px';
    this.syncTouchTargets();
  }

  private syncTouchTargets(): void {
    this.dismissEl.style.display = this.touchToggle && this.visible ? 'flex' : 'none';
    this.restoreEl.style.display = this.touchToggle && !this.visible ? 'flex' : 'none';
  }

  addRow(label: string, provider: RowProvider): void {
    this.rows.set(label, provider);
  }

  /**
   * Drop every row. The rows close over the run that added them, so a restart has to clear
   * them or the readout keeps the previous run's objects alive and reports them.
   */
  clearRows(): void {
    this.rows.clear();
  }

  removeRow(label: string): void {
    this.rows.delete(label);
  }

  /** Register a key binding so the overlay documents the debug harness it exposes. */
  addBinding(keys: string, label: string): void {
    this.bindings.push({ keys, label });
    this.renderBindings();
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /**
   * §8.3 — debug mode is off by default, so the readout starts hidden and stays that way
   * unless `?debug` says otherwise. Hidden means *not sampled*: the rows close over live
   * systems and formatting them a few times a second is work a player should not be paying
   * for, on a phone least of all.
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
    this.syncTouchTargets();
  }

  /** Called once per rendered frame with the real frame delta in seconds. */
  update(realDeltaSeconds: number): void {
    this.smoothedFrameMs += (realDeltaSeconds * 1000 - this.smoothedFrameMs) * 0.1;

    this.sinceRefresh += realDeltaSeconds;
    if (this.sinceRefresh < 0.1 || !this.visible) return;
    this.sinceRefresh = 0;

    const fps = this.smoothedFrameMs > 0 ? 1000 / this.smoothedFrameMs : 0;
    const lines = [`frame    ${this.smoothedFrameMs.toFixed(2)} ms  (${fps.toFixed(0)} fps)`];
    for (const [label, provider] of this.rows) {
      lines.push(`${label.padEnd(8)} ${provider()}`);
    }
    this.statsEl.textContent = lines.join('\n');
  }

  private renderBindings(): void {
    this.bindingsEl.textContent = this.bindings
      .map((b) => `${b.keys.padEnd(8)} ${b.label}`)
      .join('\n');
  }

  dispose(): void {
    this.root.remove();
    this.restoreEl.remove();
  }
}
