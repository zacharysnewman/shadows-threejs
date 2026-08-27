/**
 * The sliders for `Tuning` (§8.3, Cross-Cutting: debug harness).
 *
 * A panel down the right-hand side, grouped by what the value belongs to, each row a
 * slider and the number it is currently on. A value that has been moved off the spec's is
 * marked, so at a glance the panel answers "what am I actually playing with here" — which
 * matters more than it sounds, because a session of tuning ends with somebody having to
 * write the survivors into `config.ts` and the spec.
 *
 * Hidden by default even under `?debug`. The readout is what a developer wants up all the
 * time; two panels up at once is most of the screen (§8.3). `T` brings it in, `T` or the
 * close button takes it away, and which of those it was is remembered along with the
 * values.
 *
 * `pointer-events` are live on this one, unlike the readout: it is a control surface. It
 * sits clear of the touch action buttons (§3.1) so the two never fight for a tap.
 */

import {
  TUNABLES,
  clearTuning,
  currentTuning,
  defaultFor,
  loadTuning,
  overriddenTuning,
  resetTuning,
  saveTuning,
  applyTuning,
  type Tunable,
} from './Tuning';

/** Where the panel's own open/closed state lives; the values have their own key. */
const VISIBLE_STORAGE_KEY = 'shadows:tuning:open';

interface Row {
  tunable: Tunable;
  /** A range for a number, a swatch for a colour — the panel's only difference between them. */
  input: HTMLInputElement;
  readout: HTMLElement;
  label: HTMLElement;
}

export class TuningPanel {
  private readonly root: HTMLDivElement;
  private readonly rows: Row[] = [];
  private visible = false;

  /**
   * Called after any change, so whatever holds the constructed scene can re-push the
   * values that were read once at build time (`needsPush`). Assigned by the run.
   */
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'bottom:8px',
      'z-index:11',
      'width:300px',
      'overflow-y:auto',
      'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#cfe3d0',
      'background:rgba(6,10,8,0.88)',
      'border:1px solid rgba(120,180,140,0.3)',
      'border-radius:6px',
      'padding:10px 12px',
      'display:none',
    ].join(';');

    this.root.appendChild(this.buildHeader());

    let group = '';
    for (const tunable of TUNABLES) {
      if (tunable.group !== group) {
        group = tunable.group;
        this.root.appendChild(heading(group));
      }
      this.root.appendChild(this.buildRow(tunable));
    }

    parent.appendChild(this.root);

    // Values first, then the panel's own state: applying is what makes the sliders true.
    applyTuning(loadTuning());
    this.refresh();
    this.setVisible(storedVisible());
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
    try {
      localStorage.setItem(VISIBLE_STORAGE_KEY, visible ? '1' : '0');
    } catch {
      /* A session that cannot remember the panel is still a session that can open it. */
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Pull every slider back into line with what the game is running on. */
  refresh(): void {
    for (const row of this.rows) {
      const value = row.tunable.get();
      row.input.value = row.tunable.kind === 'colour' ? toHex(value) : String(value);
      row.readout.textContent = format(value, row.tunable);
      const overridden = value !== defaultFor(row.tunable.key);
      row.label.style.color = overridden ? '#ffcf8a' : '#cfe3d0';
      row.label.style.opacity = overridden ? '1' : '0.78';
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

    const title = document.createElement('strong');
    title.textContent = 'tuning';
    title.style.cssText = 'flex:1;letter-spacing:0.06em;text-transform:uppercase';

    const reset = button('reset', () => {
      resetTuning();
      clearTuning();
      this.refresh();
      this.onChange?.();
    });
    const copy = button('copy', () => {
      // What the session is *for*: the overrides, ready to be argued into the spec and
      // typed into `config.ts`. Only the ones that moved — a dump of every value is a
      // dump nobody reads.
      const overrides = overriddenTuning();
      const text = Object.keys(overrides).length
        ? JSON.stringify(overrides, null, 2)
        : '// nothing overridden';
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      console.info('[tuning] overrides\n' + text);
    });
    const close = button('×', () => this.setVisible(false));

    header.append(title, reset, copy, close);
    return header;
  }

  private buildRow(tunable: Tunable): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin:0 0 7px';

    const label = document.createElement('div');
    label.style.cssText = 'display:flex;gap:6px;align-items:baseline';

    const name = document.createElement('span');
    name.textContent = tunable.label + (tunable.needsPush ? ' *' : '');
    name.style.flex = '1';

    const readout = document.createElement('span');
    readout.style.cssText = 'font-variant-numeric:tabular-nums;opacity:0.85';

    const colourful = tunable.kind === 'colour';
    const input = document.createElement('input');
    if (colourful) {
      input.type = 'color';
      // Full width like a slider, and tall enough to judge: the swatch *is* the readout for
      // a colour, and a 20 px chip of night-time earth against a dark panel is not one.
      input.style.cssText =
        'width:100%;height:22px;margin:2px 0 0;padding:0;border:0;background:none;cursor:pointer';
    } else {
      input.type = 'range';
      input.min = String(tunable.min);
      input.max = String(tunable.max);
      input.step = String(tunable.step);
      input.style.cssText = 'width:100%;margin:2px 0 0;accent-color:#8fd6a8';
    }
    input.addEventListener('input', () => {
      tunable.set(colourful ? fromHex(input.value) : Number(input.value));
      // Stored on every move rather than on release: a tuning session that loses its
      // numbers to a reload is a tuning session done twice.
      saveTuning(overriddenTuning());
      this.refresh();
      this.onChange?.();
    });

    label.append(name, readout);
    row.append(label, input);
    this.rows.push({ tunable, input, readout, label: name });
    return row;
  }
}

function heading(text: string): HTMLElement {
  const element = document.createElement('div');
  element.textContent = text;
  element.style.cssText =
    'margin:10px 0 4px;opacity:0.5;letter-spacing:0.08em;text-transform:uppercase;' +
    'border-bottom:1px solid rgba(120,180,140,0.18);padding-bottom:2px';
  return element;
}

function button(text: string, onClick: () => void): HTMLElement {
  const element = document.createElement('button');
  element.textContent = text;
  element.style.cssText = [
    'font:inherit',
    'color:#cfe3d0',
    'background:rgba(20,34,26,0.9)',
    'border:1px solid rgba(120,180,140,0.35)',
    'border-radius:4px',
    'padding:1px 7px',
    'cursor:pointer',
  ].join(';');
  element.addEventListener('click', onClick);
  return element;
}

/**
 * Two decimals reads as noise on a speed and as nothing at all on a drain rate, so the
 * drain gets what it actually means: how long a full charge lasts.
 */
/** `0xrrggbb` as the `#rrggbb` an `input[type=color]` speaks, and back. */
function toHex(value: number): string {
  return `#${Math.max(0, Math.round(value)).toString(16).padStart(6, '0').slice(-6)}`;
}

function fromHex(text: string): number {
  const parsed = Number.parseInt(text.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value: number, tunable: Tunable): string {
  if (tunable.kind === 'colour') return toHex(value);
  if (tunable.key === 'torch.drain') return `${(1 / value / 60).toFixed(1)} min`;
  const decimals = tunable.step >= 1 ? 0 : tunable.step >= 0.1 ? 1 : tunable.step >= 0.01 ? 2 : 3;
  return `${value.toFixed(decimals)}${tunable.unit ? ` ${tunable.unit}` : ''}`;
}

function storedVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Re-export so the shell can seed the config before a run is built. */
export { currentTuning };
