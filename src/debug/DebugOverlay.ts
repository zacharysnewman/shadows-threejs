/**
 * On-screen debug readout (Phase 0) and the registry the debug harness hangs off
 * (Cross-Cutting: "Most of this spec's behaviour is a state machine reacting to light —
 * without visualisation, tuning it is guesswork").
 *
 * Rows are pull-based: a system registers a label and a getter, and the overlay samples
 * it a few times a second. Nothing has to push updates, and a system that goes away just
 * unregisters.
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
    parent.appendChild(this.root);
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
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
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
  }
}
