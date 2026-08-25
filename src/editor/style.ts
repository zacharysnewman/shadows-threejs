/**
 * The editor's styling (§9, Phase 12).
 *
 * Touch-first, which is a set of numbers rather than an attitude: nothing tappable is under
 * 44 px, the tool bar sits at the bottom where a thumb already is, and the map gets every
 * pixel the chrome does not need. `env(safe-area-inset-bottom)` keeps the bar clear of the
 * home indicator on a phone.
 *
 * Inline, like the HUD's: the editor is one screen, and a stylesheet to keep in sync with
 * it would be a file nobody remembers exists.
 */
export const EDITOR_STYLE = `<style>
.ed { position: fixed; inset: 0; display: flex; flex-direction: column;
  background: #0a0c11; color: #e8e4dc; overscroll-behavior: none;
  font: 500 15px/1.4 ui-sans-serif, system-ui, sans-serif; }
.ed-stage { flex: 1; min-height: 0; position: relative; }
.ed-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

.ed-status { padding: 8px 14px; font-size: 13px; color: #9aa3ae; background: #10131a;
  border-top: 1px solid rgba(255,255,255,0.07); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.ed-status[data-flash] { color: #8ff0b4; }

.ed-palette { display: flex; gap: 8px; padding: 10px 12px; overflow-x: auto;
  background: #10131a; -webkit-overflow-scrolling: touch; }
.ed-chip { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-height: 44px;
  padding: 0 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
  background: #171b24; color: #e8e4dc; font: inherit; }
.ed-chip.is-on { border-color: var(--chip); box-shadow: inset 0 0 0 1px var(--chip); }
.ed-swatch { width: 18px; height: 18px; border-radius: 4px; background: var(--chip); }
.ed-glyph { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
  background: var(--chip); color: #0a0c11; font-size: 12px; font-weight: 700; }

/* Scrolls rather than wrapping or shrinking: four groups of 44 px targets do not fit
   across a phone, and the alternatives are buttons too small to hit or a bar that changes
   height as the tool changes. Copy and Play live at the end, one flick away. */
.ed-bar { display: flex; gap: 10px; padding: 10px 12px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  overflow-x: auto; -webkit-overflow-scrolling: touch;
  background: #0d1017; border-top: 1px solid rgba(255,255,255,0.09); }
.ed-group { flex: 0 0 auto; }
.ed-group { display: flex; gap: 6px; flex: 0 0 auto; }
.ed-bar button { min-width: 46px; min-height: 44px; padding: 0 10px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12); background: #171b24; color: #e8e4dc; font: inherit; }
.ed-bar button.is-on { background: #2b6cb0; border-color: #4a90d9; }
.ed-bar button:disabled { opacity: 0.35; }

.ed-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; padding: 14px 16px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  background: #141821; border-top: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 -18px 40px rgba(0,0,0,0.5); max-height: 62%; overflow-y: auto; }
.ed-sheet[hidden] { display: none; }
.ed-sheet-title { font-weight: 600; margin-bottom: 10px; }
.ed-hint { color: #9aa3ae; font-size: 13px; margin-bottom: 10px; }
.ed-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ed-row > span { flex: 0 0 34%; color: #9aa3ae; font-size: 13px; }
.ed-row input { flex: 1; min-height: 42px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14); background: #0e1118; color: #e8e4dc; font: inherit; }
.ed-row button { min-height: 42px; padding: 0 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14); background: #171b24; color: #e8e4dc; font: inherit; }
.ed-danger { color: #ff9a8f !important; border-color: rgba(255,154,143,0.4) !important; }

.ed-facing { display: flex; gap: 6px; flex: 1; }
.ed-facing button { min-width: 44px; min-height: 42px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14); background: #171b24; color: #e8e4dc; font: inherit; }
.ed-facing button.is-on { background: #2b6cb0; border-color: #4a90d9; }
.ed-facing.is-bad { color: #ff9a8f; font-size: 13px; align-items: center; }
/* §9 — the audit's own findings, read as sentences rather than as a tally. */
.ed-note { display: block; margin-bottom: 8px; font-size: 13px; line-height: 1.4; color: #cdc7bb; }
.ed-note.is-bad { color: #ff9a8f; }
.ed-bar button.is-bad { color: #ff9a8f; border-color: rgba(255,154,143,0.4); }

.ed-dumpwrap { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column;
  gap: 10px; padding: 16px; background: rgba(6,8,12,0.96); }
.ed-dump { flex: 1; width: 100%; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
  background: #0e1118; color: #cdc7bb; font: 12px/1.4 ui-monospace, Menlo, monospace; padding: 10px; }
.ed-dumpbar { display: flex; gap: 10px; }
.ed-dumpwrap button { flex: 1; min-height: 46px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
  background: #171b24; color: #e8e4dc; font: inherit; }
.ed-chip.ed-danger { border-color: rgba(255,154,143,0.4); }
</style>`;
