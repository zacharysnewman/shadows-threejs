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
  /**
   * Rows belonging to the shell rather than to a run (§8.3). Kept apart because
   * `clearRows` exists for the opposite case: a run's rows close over its objects and have
   * to go when it does, and a shell row closes over something that outlives every run —
   * clearing it would delete the readout's only view of, say, the menu's music after the
   * first restart.
   */
  private readonly shellRows = new Map<string, RowProvider>();
  private readonly bindings: Binding[] = [];
  /** The `×` on the readout and the handle that brings it back; both debug-only. */
  private readonly dismissEl: HTMLButtonElement;
  private readonly restoreEl: HTMLButtonElement;
  private touchToggle = false;
  /** Reused row elements for the two blocks. See `renderRows`. */
  private readonly statRows: HTMLDivElement[] = [];
  private readonly bindingRows: HTMLDivElement[] = [];

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
      // `pre` alone clips: a row longer than the box does not wrap, it just runs off the
      // right of a phone and takes its value with it. `pre-wrap` keeps the columns and
      // lets the long rows fold; `max-width` is whichever of the two is smaller, so the
      // box never reaches past the glass.
      'white-space:pre-wrap',
      'overflow-wrap:anywhere',
      'max-width:min(46ch, calc(100vw - 24px))',
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

  /** §8.3 — a row that outlives the run, and so survives `clearRows`. */
  addShellRow(label: string, provider: RowProvider): void {
    this.shellRows.set(label, provider);
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

  /**
   * Draw `lines` into `container`, one element per row, reusing the elements between
   * refreshes — twenty-eight rows rebuilt ten times a second is churn for nothing.
   *
   * A row rather than one block of text because of the hanging indent: every line here is
   * an 8-character label, a space, then a value, and a folded row has to resume under the
   * value. `text-indent` applies to the first line of a *block*, so each row has to be one.
   */
  private static renderRows(
    container: HTMLElement,
    pool: HTMLDivElement[],
    lines: readonly string[],
  ): void {
    while (pool.length < lines.length) {
      const row = document.createElement('div');
      // The label is 8 wide and the value starts at 9; `ch` is a character in a monospace
      // face, so the negative indent puts the first line back at the label.
      row.style.cssText = 'padding-left:9ch;text-indent:-9ch';
      pool.push(row);
      container.appendChild(row);
    }
    for (let i = 0; i < pool.length; i += 1) {
      const row = pool[i]!;
      const line = lines[i];
      if (line === undefined) {
        row.style.display = 'none';
        continue;
      }
      row.style.removeProperty('display');
      // Compared before assigning: writing the same string still invalidates layout.
      if (row.textContent !== line) row.textContent = line;
    }
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
    for (const [label, provider] of [...this.rows, ...this.shellRows]) {
      lines.push(`${label.padEnd(8)} ${provider()}`);
    }
    DebugOverlay.renderRows(this.statsEl, this.statRows, lines);
  }

  private renderBindings(): void {
    DebugOverlay.renderRows(
      this.bindingsEl,
      this.bindingRows,
      this.bindings.map((b) => `${b.keys.padEnd(8)} ${b.label}`),
    );
  }

  dispose(): void {
    this.root.remove();
    this.restoreEl.remove();
  }
}
