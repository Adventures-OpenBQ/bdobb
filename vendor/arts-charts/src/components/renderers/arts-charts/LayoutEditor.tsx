// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { open } from "../../../host/dialog";
import { stat, readTextFile } from "../../../host/fs";
import { loopText, scaleOrder, type PanelDef , overlapRects} from "../../../lib/chart/panels";
import { movePanel, panelLabel, removePanel, seriesLabel, widen } from "../../../lib/chart/series";
import type { CatalogEntry } from "../../../lib/chart/studyExpression";
import { layoutFromCard } from "../../../lib/chart/layouts";
import { layoutsToMacroFile, planLayoutImport } from "../../../lib/chartMacroFile";
import type { ChartLayout } from "../../../lib/chartLayoutsFile";
import { importRefusal } from "../../../lib/importLimits";
import { logError } from "../../../lib/logger";
import { saveTextFile } from "../../../lib/saveTextFile";
import type { Series } from "../../../lib/types";
import { PanelFields } from "./PanelFields";

/**
 * The one Layout editor (spec 2026-09-24, sub-project C): a panel-structure
 * sidebar on the left, a Series tab and a Panels tab on the right, and a footer
 * of Cancel and OK. Series changes apply at once (D2) -- they reach the chart
 * through the seriesTab pane's own callbacks -- while panel work STAGES: field
 * edits, adds, removals and reorders reach the chart on OK and are discarded on
 * Cancel, because a half-built layout is not something to watch land.
 *
 * The draft is an OP LOG, not a copy of the series (D11): OK folds the ops over
 * whatever series exist at commit time, so a series added on the Series tab
 * mid-edit is renumbered along with the rest. The sidebar shows the draft; the
 * Series tab's panel picker shows the LIVE panels the chart is drawing, so the
 * two disagree until OK -- the editor says so in one line rather than disabling
 * the picker.
 */

/** A staged panel operation. Field/add do not touch series; remove/move do, through C0's functions. */
type PanelOp =
  | { kind: "field"; index: number; def: PanelDef }
  | { kind: "add" }
  | { kind: "remove"; index: number; deleteSeries: boolean }
  | { kind: "move"; from: number; to: number };

/**
 * Fold the staged ops over a live panels-and-series pair. Field replaces one
 * panel (series untouched); add splits the last panel in two (widen, D4);
 * remove and move are C0's removePanel/movePanel, which move the series with
 * the layout. Replayed in order from the live inputs, so the result is correct
 * for whatever series exist when it is called (D11).
 */
function applyOps(ops: PanelOp[], panels: PanelDef[], series: Series[]): { panels: PanelDef[]; series: Series[] } {
  let out = { panels, series };
  for (const op of ops) {
    if (op.kind === "field") out = { panels: out.panels.map((p, i) => (i === op.index ? op.def : p)), series: out.series };
    else if (op.kind === "add") out = { panels: widen(out.panels, 1), series: out.series };
    else if (op.kind === "remove") {
      // Delete drops the series on the removed panel first, so removePanel has
      // none to move; move (the default, D7) leaves them for removePanel to
      // carry to the panel that takes its place -- exactly what C0 does.
      const kept = op.deleteSeries ? out.series.filter((s) => s.panel !== op.index + 1) : out.series;
      out = removePanel(out.panels, kept, op.index);
    }
    else out = movePanel(out.panels, out.series, op.from, op.to);
  }
  return out;
}

/** A free "<name> (n)" suffix against a TAKEN set (E5): counts from (2) up, so the same file imported thrice with Keep both gives (2) then (3), never a clash. */
function freeName(name: string, taken: Set<string>): string {
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

/**
 * Resolve every incoming layout's commit name for ONE import batch,
 * sequentially (whole-plan review, Task 3 finding 1). Whatever a row
 * resolves to -- a kept Replace name, a plain pass-through, or a generated
 * Keep-both suffix -- is reserved in `taken` before the NEXT row is
 * resolved, seeded from the library (`existing`) so a name two rows in the
 * same file would otherwise both land on collides with `taken`, not just
 * with the library. Without this, two rows that independently resolve to
 * the same name silently overwrite each other in the store's
 * upsert-by-name fold -- exactly the data loss E5 (Keep both never
 * clashes) was written to rule out. `keepBothPreview` is what Keep-both
 * would produce for a row regardless of ITS OWN choice -- the radio's
 * preview, built from everything before it -- and `resolved` is the name
 * the row actually commits under given its real choice; both come out of
 * the same pass, so the review can never show one name and write another.
 */
function planImportNames(
  layouts: ChartLayout[],
  choice: Record<string, "replace" | "keep">,
  existing: string[],
): { keepBothPreview: string; resolved: string }[] {
  const taken = new Set(existing);
  return layouts.map((l) => {
    const conflict = existing.includes(l.name);
    const keepBothPreview = taken.has(l.name) ? freeName(l.name, taken) : l.name;
    const wantsReplace = conflict && (choice[l.name] ?? "keep") === "replace";
    const resolved = wantsReplace ? l.name : keepBothPreview;
    taken.add(resolved);
    return { keepBothPreview, resolved };
  });
}

/** The pending removal a confirmation is asking about, or null. `mode` is the series choice (D7): move (default) or delete. `moveTarget` names where the moved series land (spec 2026-09-25, J9), e.g. "P1 · Price". */
type Removal = { index: number; label: string; moveTarget: string; series: Series[]; warning: string | null; mode: "move" | "delete" };

export function LayoutEditor({
  initialTab, panels, series, seriesTab, onCommitPanels, onClose,
  layoutNames = [],
  onSaveLayout = async () => false,
  savedLayouts = [],
  lookup = () => undefined,
  onImportLayouts = async () => false,
  basis,
}: {
  initialTab: "series" | "panels";
  panels: PanelDef[];
  series: Series[];
  /**
   * The Series tab's pane. A function form (2026-09-26, master-detail) is
   * passed the SELECTED panel number (1-based) so the pane can scope its list
   * and its "+ Add series" to the panel picked on the left, the same panel the
   * sidebar card and the Dimensions tab detail follow. A plain node is still
   * accepted (tests, and any caller that does not scope) and ignores the panel.
   */
  seriesTab: ReactNode | ((selectedPanel: number) => ReactNode);
  onCommitPanels: (panels: PanelDef[], series: Series[]) => void;
  onClose: () => void;
  /** The names already in the library (spec 2026-09-24, D5): offered in the Save dialog, and used to ask again before replacing one, Default included. */
  layoutNames?: string[];
  /** Save as layout (D7/D8): the caller writes it and resolves true only once on disk; false leaves the dialog open with an error. */
  onSaveLayout?: (layout: ChartLayout) => Promise<boolean>;
  /** The full saved library (spec 2026-09-25, E8): Export lists these with a checkbox each. */
  savedLayouts?: ChartLayout[];
  /** The study catalog (spec 2026-09-25, E11): planLayoutImport validates studies and regenerates their expressions through it. */
  lookup?: (name: string) => CatalogEntry | undefined;
  /** Import (E6/E7): the caller writes the merged file to the shared library; false surfaces the failure. Never applies anything to the chart. */
  onImportLayouts?: (list: ChartLayout[]) => Promise<boolean>;
  /** The saved layout this draft is based on (spec 2026-09-25, J3): the context bar names it. Absent -> a neutral "Custom layout" chip. */
  basis?: { name: string; loaded: boolean };
}) {
  const id = useId();
  const [tab, setTab] = useState<"series" | "panels">(initialTab);
  const [ops, setOps] = useState<PanelOp[]>([]);
  const [selected, setSelected] = useState(0);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  // The Save-as-macro sub-dialog (spec 2026-09-24, D5/D8; spec 2026-09-25,
  // J7/J8). `saving` is null when it is closed; open, it holds the typed name
  // and note, whether an overwrite is being confirmed, the last write failure,
  // and `apply` -- the "Apply on close" checkbox. It saves the DRAFT (what the
  // user sees, staged panel edits included).
  //
  // `apply` is R1's opt-in and defaults OFF: unchecked, Save behaves exactly as
  // decision D8 describes -- it writes the library and closes only this
  // sub-dialog, leaving the chart and the editor alone. Checked, a successful
  // write also commits the draft (the OK path) and closes the editor. R1 (a
  // later user ruling) reverses D8's "the checkbox is therefore not built";
  // see 2026-09-24-arts-charts-layout-library-design.md, D8.
  const [saving, setSaving] = useState<{ name: string; note: string; confirm: boolean; error: string | null; apply: boolean } | null>(null);
  // The Export sub-panel (spec 2026-09-25, E8/E6). Null when closed; open, it
  // holds the names the user has ticked (all of them to start) and the last
  // write failure. It writes a file and changes NOTHING -- not the library,
  // not the chart. A CANCELLED save dialog (saveTextFile resolving false)
  // reports nothing -- that is the user's own choice, not a failure -- but a
  // write that THROWS (disk full, permission denied) is a failure the spec
  // says must be shown, the same rule D7/D8 already give Save as layout.
  const [exporting, setExporting] = useState<{ names: Set<string>; error: string | null } | null>(null);
  // The Import review (spec 2026-09-25, E5/E7). `layouts` are the validated
  // incoming ones; `choice` is per incoming name, "replace" or "keep" (default
  // "keep" so a conflict never silently overwrites). `refusal` holds the one
  // line a malformed file shows, with only Cancel. Null means the panel is
  // closed. Import writes the LIBRARY only -- never the chart (E7).
  const [review, setReview] = useState<{ layouts: ChartLayout[]; choice: Record<string, "replace" | "keep">; refusal: string | null } | null>(null);

  // The draft, folded fresh each render from the LIVE series -- so a series
  // added on the Series tab appears here and is remapped by OK (D11).
  const draft = applyOps(ops, panels, series);
  const dirty = ops.length > 0;
  const draftCycles = scaleOrder(draft.panels).cycles;
  const at = Math.min(selected, draft.panels.length - 1);

  // The whole review's name resolution, folded fresh each render so a
  // choice flip is reflected at once -- the same batch-sequential pass
  // commitImport uses, so the preview never drifts from what gets written.
  const importPlan = review === null ? [] : planImportNames(review.layouts, review.choice, layoutNames);

  // A real modal dialog, the SettingsDialog idiom: showModal() puts it in the
  // top layer over every card, the rest of the app goes inert, focus is
  // trapped, and Escape is handled on the document bubble path so one press
  // closes this and nothing else.
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The editor keeps its single document-level Escape authority (one press,
      // and nothing else in the app reacts). J2 (spec 2026-09-25) makes that one
      // press close the TOP-MOST surface only: while a nested confirmation is
      // open it is that surface, so Escape closes IT and leaves the editor
      // standing -- native showModal() inertness gives this in a real browser,
      // and closing the open confirmation here makes it hold in every host
      // (jsdom included). With none open, Escape closes the editor as before.
      e.stopImmediatePropagation();
      e.preventDefault();
      if (review !== null) setReview(null);
      else if (exporting !== null) setExporting(null);
      else if (saving !== null) setSaving(null);
      else if (removal !== null) setRemoval(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, review, exporting, saving, removal]);

  const addField = (def: PanelDef): void => setOps((prev) => [...prev, { kind: "field", index: at, def }]);
  const addPanel = (): void => { setOps((prev) => [...prev, { kind: "add" }]); setSelected(draft.panels.length); };
  const moveTo = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= draft.panels.length) return;
    setOps((prev) => [...prev, { kind: "move", from, to }]);
    setSelected(to);
  };

  const askRemove = (index: number): void => {
    // Warned, not refused (D6/D8): the confirmation names the panels that point
    // at this one and the series it holds, and defaults to moving them.
    const here = draft.series.filter((s) => s.panel === index + 1);
    const referrers = draft.panels
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== index && refsTo(p, index + 1))
      .map(({ i }) => `P${i + 1}`);
    // Where the moved series land (spec 2026-09-25, J9, reference 09). removePanel
    // (spec D4) moves the series of the removed panel to Math.min(gone, length) in
    // the POST-removal numbering: when the last panel goes they move UP to the
    // panel above, otherwise to the panel that slides into the vacated slot. Map
    // that back to the CURRENT draft to name it, so the option shows exactly the
    // destination -- removing P2 in a two-panel card lands them on "P1 · Price".
    // (The brief's own index expression named the wrong panel here; the reference
    // and the removePanel contract win.)
    const gone = index + 1;
    const targetNew = Math.min(gone, draft.panels.length - 1);
    const targetOld = targetNew < gone ? targetNew : targetNew + 1;
    setRemoval({
      index,
      label: panelLabel(draft.series, index + 1),
      moveTarget: `P${targetNew} · ${panelLabel(draft.series, targetOld)}`,
      series: here,
      warning: referrers.length === 0 ? null : `${referrers.join(", ")} link to this panel; the links will drop.`,
      mode: "move", // default (D7): move the series to the panel that takes this one's place
    });
  };
  const confirmRemove = (): void => {
    if (removal !== null) {
      setOps((prev) => [...prev, { kind: "remove", index: removal.index, deleteSeries: removal.mode === "delete" }]);
    }
    setRemoval(null);
    setSelected(0);
  };

  const commit = (): void => {
    // OK on a CLEAN draft writes nothing (Review Focus 1): opening the editor
    // to add a study and clicking OK must not rewrite -- or migrate -- the
    // layout. A dirty draft writes the panels and the remapped series together,
    // the same pair-write the renderer's series path makes.
    if (dirty) onCommitPanels(draft.panels, draft.series);
    onClose();
  };

  // Save as macro: snapshot the DRAFT (D8) under the typed name. An existing
  // name asks again first (D5); a failed write is reported and the dialog
  // stays open (D7); a success closes the sub-dialog. With "Apply on close"
  // ticked (R1), a success also applies the layout and closes the editor.
  const saveLayout = async (): Promise<void> => {
    if (saving === null || saving.name.trim() === "") return;
    const name = saving.name.trim();
    if (layoutNames.includes(name) && !saving.confirm) {
      setSaving({ ...saving, confirm: true });
      return;
    }
    const ok = await onSaveLayout(layoutFromCard(name, saving.note, draft.panels, draft.series));
    if (ok) {
      setSaving(null);
      // R1 (spec 2026-09-25, J8): "Apply on close" saves the macro AND applies
      // this layout AND closes the editor -- the OK path, run only after the
      // write succeeds. It is the same commit path commit() takes: a dirty
      // draft is written to the chart, a clean one writes nothing (Review
      // Focus 1). Unchecked (the default) leaves the chart and the editor
      // exactly as before -- the opt-in that keeps D8's current path unchanged.
      if (saving.apply) { if (dirty) onCommitPanels(draft.panels, draft.series); onClose(); }
    } else setSaving({ ...saving, confirm: false, error: "could not save this macro. It has not been added." });
  };

  // Export the ticked layouts (E8): one file through saveTextFile so the
  // desktop, iOS and browser-mode paths all work. The filename is the single
  // layout's name when one is ticked, else `chart-layouts`, sanitised. A
  // cancelled dialog (saveTextFile resolving false) reports nothing -- the
  // user's own choice. A write that THROWS is a failure, not a cancel: the
  // spec requires a save that cannot be written to say so (E6, matching D7's
  // rule for Save as layout), so it is logged AND shown, and the panel stays
  // open with the ticked selection intact for a retry.
  const exportLayouts = async (): Promise<void> => {
    if (exporting === null) return;
    const chosen = savedLayouts.filter((l) => exporting.names.has(l.name));
    if (chosen.length === 0) return;
    const base = chosen.length === 1 ? chosen[0].name.replace(/[^a-z0-9_-]+/gi, "-") : "chart-layouts";
    try {
      const written = await saveTextFile(`${base}.json`, "Art's Charts layouts", layoutsToMacroFile(chosen));
      if (written) setExporting(null);
    } catch (err) {
      await logError(`failed to export layouts: ${(err as Error).message}`);
      setExporting({ ...exporting, error: "could not export these layouts. Nothing was written." });
    }
  };

  // Import… : open a file, then size it and check it against the ceiling
  // BEFORE reading it -- importLimits' own contract is that the byte cap is
  // checked before the file is read, because an unbounded read is the freeze
  // it guards against, and a stat() was already free. planLayoutImport keeps
  // its own copy of this same check (it is that pure module's contract, and
  // other callers depend on it independent of this gate), but a refusal here
  // means readTextFile is never called at all. A cancelled dialog does
  // nothing (Review Focus 1). A refusal shows one line.
  const beginImport = async (): Promise<void> => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "Art's Charts layouts", extensions: ["json"] }] });
      if (path === null || Array.isArray(path)) return;
      const bytes = (await stat(path)).size;
      const oversize = importRefusal(bytes);
      if (oversize !== null) { setReview({ layouts: [], choice: {}, refusal: oversize }); return; }
      const plan = planLayoutImport(await readTextFile(path), bytes, lookup);
      if (!plan.ok) { setReview({ layouts: [], choice: {}, refusal: plan.refusal }); return; }
      setReview({ layouts: plan.layouts, choice: {}, refusal: null });
    } catch (err) {
      setReview({ layouts: [], choice: {}, refusal: `Import failed: ${(err as Error).message}` });
      await logError(`failed to import layouts: ${(err as Error).message}`);
    }
  };

  // Commit the review (E5/E6): a Replace keeps the incoming name; a Keep both
  // renames the copy, resolved batch-sequentially by importPlan so two rows
  // never land on the same name (Task 3 finding 1). One list to the store,
  // which merges and persists once.
  const commitImport = async (): Promise<void> => {
    if (review === null || review.refusal !== null) return;
    const list = review.layouts.map((l, i) => ({ ...l, name: importPlan[i].resolved }));
    const ok = await onImportLayouts(list);
    if (ok) setReview(null);
    else setReview({ ...review, refusal: "could not save the imported layouts." });
  };

  return (
    <dialog ref={dialogRef} className="modal-backdrop chart-layout" aria-label="Current layout" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {/* The app modal base (spec 2026-09-25, J2): the <dialog> is the transparent
          backdrop and this .modal is the panel that owns the look. Only the
          panel's size/grid is ours (.chart-layout-panel); centring, dimming and
          the top layer come from .modal-backdrop, the same as every other modal. */}
      <div className="modal chart-layout-panel">
      <div className="chart-layout-head">
        {/* The reference header (spec 2026-09-25, J3): an eyebrow, the title
            "Current layout" (the thing being edited now), and a subtitle that
            says saving a macro is optional -- the naming split of J4, where the
            reusable named copy is the "macro" and this is the live layout. */}
        <div className="chart-layout-title">
          <span className="chart-layout-eyebrow">LAYOUT EDITOR</span>
          <h2>Current layout</h2>
          <p>Edit series and panels. Saving a macro is optional.</p>
        </div>
        {/* Import…/Export… live in the header now (spec 2026-09-25, J3): they are
            library operations on the saved macros, not part of the OK/Cancel
            transaction, so they sit apart from the footer's three buttons. */}
        {/* Part B (2026-09-26): the chart's dialogs adopt the app's bd-button
            system (src/styles/dialogs.css, the same buttons ConnectionsDialog and
            SettingsDialog use). Import…/Export… are library operations, not the
            OK/Cancel transaction, so they are ghost buttons; the close × is the
            icon variant. dialogs.css is imported globally in main.tsx and its
            .bd-button* selectors are top-level (not scoped under .bd-dialog), so
            they style these buttons even though the editor is a .chart-layout
            modal rather than a .bd-dialog. */}
        <div className="chart-layout-head-actions">
          <button type="button" className="bd-button bd-button--ghost" onClick={() => { void beginImport(); }}>Import…</button>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => setExporting({ names: new Set(savedLayouts.map((l) => l.name)), error: null })}>Export…</button>
          <button type="button" className="bd-button bd-button--icon" aria-label="Close" onClick={onClose}>×</button>
        </div>
      </div>
      {/* The context bar (spec 2026-09-25, J3): a chip plus one line saying what
          this layout was based on. Neutral when the caller gives no basis, so
          callers and tests that omit it still render a clean bar. */}
      <div className="chart-layout-context">
        <span className="chart-layout-chip">{basis?.loaded ? "From saved macro" : "Custom layout"}</span>
        {basis !== undefined && (
          <p>{basis.loaded ? `Loaded from “${basis.name}”. Edits do not change the saved macro.` : `Modified from “${basis.name}”. Save as a macro only if you want to reuse it.`}</p>
        )}
      </div>
      <div className="chart-layout-body">
        <aside className="chart-layout-side" aria-label="Panel structure">
          {/* The sidebar heading and panel count (spec 2026-09-25, J5, reference
              06): "PANEL STRUCTURE" with the number of panels floated right. */}
          <div className="chart-layout-structure-head"><span>PANEL STRUCTURE</span><span>{draft.panels.length}</span></div>
          <ul>
            {draft.panels.map((p, i) => (
              <li
                key={i}
                aria-label={`P${i + 1} · ${panelLabel(draft.series, i + 1)}`}
                aria-current={i === at || undefined}
                onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
                onDrop={() => { if (dragFrom !== null) { moveTo(dragFrom, i); setDragFrom(null); } }}
              >
                {/* The grip: drag to reorder, Alt+↑/↓ from the keyboard (D5). */}
                <button
                  type="button"
                  className="chart-layout-grip"
                  aria-label={`Reorder P${i + 1}`}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragEnd={() => setDragFrom(null)}
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    if (e.key === "ArrowUp") { e.preventDefault(); moveTo(i, i - 1); }
                    if (e.key === "ArrowDown") { e.preventDefault(); moveTo(i, i + 1); }
                  }}
                >
                  ⋮⋮
                </button>
                <button type="button" className="chart-layout-card" aria-label={`P${i + 1}`} aria-pressed={i === at} onClick={() => setSelected(i)}>
                  <span className="chart-layout-name">{"P" + (i + 1) + " · " + panelLabel(draft.series, i + 1)}</span>
                  {/* One span per series (spec 2026-09-25, J5, reference 06):
                      the card lists its series one per line, not comma-joined. */}
                  <span className="chart-layout-holds">
                    {draft.series.filter((s) => s.panel === i + 1).map((s) => (
                      <span key={s.id} className="chart-layout-hold">{seriesLabel(s)}</span>
                    ))}
                    {draft.series.every((s) => s.panel !== i + 1) && <span className="chart-layout-hold">empty</span>}
                  </span>
                </button>
                {/* Master-detail (2026-09-26): the "Remove panel" footer strip
                    became a small × where the height used to sit (the card's
                    top-right), with the height moved UNDERNEATH it. The × keeps
                    its real accessible name via aria-label ("Remove panel 2"),
                    stays disabled at the last panel, and still routes through
                    askRemove -> the confirmation that names the panels pointing
                    at this one and the series it holds -- an icon swap must not
                    turn a warned removal into a silent delete. The × glyph is
                    plain content; the aria-label is what a screen reader
                    announces (it overrides the visible "×"). The card is a
                    <button>, so the × and the height are its SIBLINGS in the
                    <li> grid, not nested inside it (a button in a button is
                    invalid). */}
                <div className="chart-layout-corner">
                  <button
                    type="button"
                    className="bd-button bd-button--danger bd-button--icon"
                    aria-label={`Remove panel ${i + 1}`}
                    disabled={draft.panels.length < 2}
                    onClick={() => askRemove(i)}
                  >
                    ×
                  </button>
                  <span className="chart-layout-h">{p.height}% high</span>
                  {/* A map of the whole chart area with THIS panel's band shaded
                      in place (user, 2026-09-26), so the sidebar shows the stack
                      at a glance. Accent when the card is selected, muted when
                      not -- driven off the card's own `aria-pressed` in CSS, so
                      the colour cannot disagree with the selection.

                      It lives in the CORNER, under the height (user,
                      2026-09-27): in the card body it took a column the series
                      list wanted -- "that leaves more room to list the studies".
                      That also puts it outside the card's <button>, which is why
                      it can sit in this <div> at all: an <svg> inside the button
                      was fine, but the corner is where the geometry readout
                      already is.

                      viewBox is 0 0 100 100 with preserveAspectRatio="none", so
                      the panel's percentages drop straight in as SVG units and
                      the box does the scaling -- which is why shrinking it is a
                      width/height change and nothing else. All FOUR values are
                      used, not just top/height: panels carry `left`/`width` too,
                      and although every panel is full-width today the geometry
                      allows side-by-side, which this would otherwise draw
                      wrongly.

                      aria-hidden: the card already announces "P1" and its
                      series, and the map is a restatement of the geometry the
                      fields below hold. */}
                  <svg className="chart-layout-map" width="48" height="29" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="chart-layout-map-band" x={p.left} y={p.top} width={p.width} height={p.height} />
                    {/* Any region this panel shares with another, drawn red over
                        its own band (user, 2026-09-26). Panels that merely TOUCH
                        are adjacent, not overlapping, so nothing is drawn for a
                        normal stack -- `overlapRects` compares strictly. */}
                    {overlapRects(draft.panels, i).map((r, k) => (
                      <rect key={k} className="chart-layout-map-clash" x={r.left} y={r.top} width={r.width} height={r.height} />
                    ))}
                  </svg>
                </div>
              </li>
            ))}
          </ul>
          {/* Dashed, full-width Add panel (spec 2026-09-25, J5, reference 06).
              The "+" is an aria-hidden span, NOT a CSS ::before. The comment
              here used to claim a ::before kept it out of the accessible name;
              that is wrong. AccName includes generated content, and Chrome,
              Firefox and Safari all implement it, so a screen reader announced
              "+ Add panel" while the unit test read "Add panel" and passed --
              jsdom does not evaluate pseudo-element content, so the test was a
              false negative guarding the exact thing it looked like it guarded.
              Marking the glyph aria-hidden keeps the name "Add panel" in a real
              browser as well as in the test (Task 3 review, 2026-09-26). */}
          <button type="button" className="bd-button chart-layout-add" onClick={addPanel}>
            <span aria-hidden="true">+ </span>Add panel
          </button>
          {/* The two structure notes below Add panel (spec 2026-09-25, J5). */}
          <p className="chart-layout-structure-note">Select a panel to edit its parameters. Drag list grips to reorder; explicit layout coordinates stay unchanged.</p>
          <p className="chart-layout-structure-note">Panel links and series assignments follow the same panel when its number changes.</p>
          {/* The reorder keyboard hint (reference 06). It sits here rather than
              in the reference's middle column because J5 folded that column --
              the sidebar cards own the drag grips, so there was no third region
              of content to put it in. Folding the column dropped this line
              entirely, which Task 3's review caught: the grips are operable from
              the keyboard and nothing said so. Relocated beside the grips it
              describes (Task 3 review, 2026-09-26). */}
          <p className="chart-layout-structure-note">Drag the grip to reorder. Keyboard: Alt + ↑ / ↓.</p>
          {draftCycles.length > 0 && (
            <p className="chart-popover-error">panel links: circular ({draftCycles.map(loopText).join(", ")})</p>
          )}
        </aside>
        <section className="chart-layout-main">
          <div role="tablist" aria-label="Layout tabs" className="chart-layout-tabs">
            {/* The count pill after each tab name (spec 2026-09-25, J5,
                reference 06: "Series 4" / "Panels 2"). It is an aria-hidden
                <span>, NOT a CSS ::before: W3C AccName includes generated
                content (and Chrome/Firefox/Safari implement it), so a ::before
                count would rename the tab to "Series 4" for a screen reader
                while jsdom -- which never evaluates pseudo content -- reported
                it clean. aria-hidden keeps each tab's accessible name exactly
                "Series"/"Dimensions" in a real browser as well as in the test,
                the same guard the opener buttons and "+ Add" glyphs use.

                Master-detail (2026-09-26): the Series tab is scoped to the
                SELECTED panel, so its count is that panel's series count, not
                the card's total -- a "6" over a list of 2 would be a lie. The
                "Panels" tab became "Dimensions" (it shows one panel's geometry,
                the panel chosen on the left) and carries NO count: one panel by
                definition, so there is nothing to tally. */}
            <button type="button" role="tab" aria-selected={tab === "series"} onClick={() => setTab("series")}>Series<span aria-hidden="true">{draft.series.filter((s) => s.panel === at + 1).length}</span></button>
            <button type="button" role="tab" aria-selected={tab === "panels"} onClick={() => setTab("panels")}>Dimensions</button>
          </div>
          {tab === "series" ? (
            <div role="tabpanel" aria-label="Series">
              {dirty && <p className="chart-layout-note">Panel changes apply on OK; these panels are what the chart is drawing now.</p>}
              {/* Master-detail (2026-09-26): the Series pane is scoped to the
                  selected panel. The function form is handed the selected panel
                  number (1-based) so it can filter its list and default its
                  "+ Add series" to that panel; a plain node ignores it. `at` is
                  the clamped selection, so a stale index never names a panel the
                  draft no longer has. */}
              {typeof seriesTab === "function" ? seriesTab(at + 1) : seriesTab}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Dimensions">
              {/* The Panels detail opens with a section heading (spec 2026-09-25,
                  J5, reference 06), above the reorder note. */}
              <h3 className="chart-layout-section">Panel configuration</h3>
              <p className="chart-layout-note">Drag to reorder. Coordinates stay unchanged.</p>
              {draft.panels[at] !== undefined && (
                <PanelFields
                  key={at}
                  panel={draft.panels[at]}
                  index={at}
                  panels={draft.panels}
                  idPrefix={`${id}-p${at}`}
                  onChange={addField}
                />
              )}
            </div>
          )}
        </section>
      </div>
      {/* J2 (spec 2026-09-25) moved the editor's inertness onto the nested
          confirmations themselves: each is now a showModal() <dialog> in the top
          layer, so the editor beneath goes inert natively and the hand-rolled
          inert/aria-hidden juggling this footer needed while the Import review
          was up is gone. Escape over an open confirmation is handled by the
          editor's own document-level authority (see the Escape effect), which
          closes only that confirmation. */}
      {/* The footer is Cancel / Save as macro… / OK only (spec 2026-09-25, J3/J4):
          Import…/Export… moved to the header, and Save as layout became "Save as
          macro…" -- the reusable named copy is a macro; OK just applies the
          layout. DOM order matches the reference screenshot's footer
          (Cancel, then Save as macro…, then the primary OK). */}
      <div className="chart-layout-foot">
        <span className="chart-layout-foot-note">OK applies this layout. No macro is required.</span>
        <button type="button" className="bd-button bd-button--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="bd-button" onClick={() => setSaving({ name: "", note: "", confirm: false, error: null, apply: false })}>Save as macro…</button>
        <button type="button" className="bd-button bd-button--primary" onClick={commit}>OK</button>
      </div>
      </div>
      {removal !== null && (
        <ConfirmDialog aria-label={`Remove panel P${removal.index + 1}`}>
          {/* Title as a heading (spec 2026-09-25, J9, reference 09): was a bare
              <p> "Remove P2 · Volume?". */}
          <h2 className="chart-layout-confirm-title">Remove panel P{removal.index + 1}?</h2>
          {removal.series.length > 0 && (
            // The series it holds (D7): move them to the panel that takes this
            // one's place (the default, C0's own behaviour) or delete them. The
            // move option names that destination (J9) so the choice is concrete.
            <label className="chart-layout-assigned">
              <span>This panel contains {removal.series.map((s) => seriesLabel(s)).join(", ")}. Choose what happens to its series.</span>
              <select
                aria-label="Assigned series"
                value={removal.mode}
                onChange={(e) => setRemoval({ ...removal, mode: e.target.value as "move" | "delete" })}
              >
                <option value="move">Move series to {removal.moveTarget}</option>
                <option value="delete">Delete the series</option>
              </select>
            </label>
          )}
          {removal.warning !== null && <p className="chart-popover-error">{removal.warning}</p>}
          <p className="chart-layout-confirm-note">Only the layout draft changes. Cancel the layout editor to discard the removal.</p>
          {/* The destructive action carries bd-button--danger (Part B; was J9's
              .danger-button) AND says "Remove panel" -- the meaning is in the
              accessible name and the surrounding copy, not the red alone, so it
              still reads as destructive without colour. */}
          <div className="chart-layout-confirm-actions">
            <button type="button" className="bd-button bd-button--ghost" onClick={() => setRemoval(null)}>Keep panel</button>
            <button type="button" className="bd-button bd-button--danger" onClick={confirmRemove}>Remove panel</button>
          </div>
        </ConfirmDialog>
      )}
      {saving !== null && (
        // The Save-as-macro dialog (spec 2026-09-25, J7, reference 07): a title,
        // intro prose, the "Macro name" input, a "Description / notes" textarea
        // (the reference's multi-line field, not the old single-line input), the
        // "Apply on close" checkbox (R1), and the "Back to layout" / "Save
        // macro" buttons. The dialog's accessible name matches its visible title.
        <ConfirmDialog aria-label="Save layout as a macro">
          <h2 className="chart-layout-confirm-title">Save layout as a macro</h2>
          <p className="chart-layout-confirm-note">Save a reusable snapshot of these series and panels. Later layout edits will not change the saved macro.</p>
          <label className="chart-layout-assigned">
            <span>Macro name</span>
            <input
              type="text"
              aria-label="Macro name"
              list="chart-layout-names"
              spellCheck={false}
              value={saving.name}
              onChange={(e) => setSaving({ ...saving, name: e.target.value, confirm: false, error: null })}
            />
          </label>
          {/* The names already saved, offered as completions (D5): picking one
              is how the user overwrites Default or any other. */}
          <datalist id="chart-layout-names">
            {layoutNames.map((n) => <option key={n} value={n} />)}
          </datalist>
          <label className="chart-layout-assigned">
            <span>Description / notes</span>
            <textarea aria-label="Description / notes" spellCheck={false} value={saving.note} onChange={(e) => setSaving({ ...saving, note: e.target.value })} />
          </label>
          {/* "Apply on close" (spec 2026-09-25, J7/J8; R1), default OFF. The
              helper line is a SIBLING of the label, NOT nested inside it: the
              accessible name of a checkbox wrapped in a <label> is the label's
              whole text content, so a nested <small> would fold the helper into
              the name -- "Apply on close Save the macro, apply this layout..." --
              breaking getByLabelText("Apply on close") in a real browser as well
              as here. Keeping the helper outside the label leaves the name
              exactly "Apply on close" everywhere. */}
          <label className="chart-layout-apply">
            <input type="checkbox" checked={saving.apply} onChange={(e) => setSaving({ ...saving, apply: e.target.checked })} />
            <span>Apply on close</span>
          </label>
          <p className="chart-layout-apply-note">Save the macro, apply this layout, and close the layout editor.</p>
          {saving.confirm && (
            <p className="chart-popover-error">A macro named {saving.name.trim()} exists. Replace it?</p>
          )}
          {saving.error !== null && <p className="chart-popover-error" role="alert">{saving.error}</p>}
          <div className="chart-layout-confirm-actions">
            <button type="button" className="bd-button bd-button--ghost" onClick={() => setSaving(null)}>Back to layout</button>
            <button type="button" className="bd-button bd-button--primary" disabled={saving.name.trim() === ""} onClick={() => { void saveLayout(); }}>
              {saving.confirm ? "Replace" : "Save macro"}
            </button>
          </div>
        </ConfirmDialog>
      )}
      {review !== null && (
        // J closeout (2026-09-26, item 5): the accessible name matches the
        // visible "Import macros" title -- a Label-in-Name fix, so a speech-input
        // user saying what they SEE ("macros") can address the dialog, and the
        // reference (screenshot 13) titles it "Import macros".
        <ConfirmDialog aria-label="Import macros">
          <h2 className="chart-layout-confirm-title">Import macros</h2>
          {/* The file is chosen through the native Tauri picker before this review
              opens (spec E7); the reference's in-dialog "Choose File" is a
              surfaced conflict (spec J, conflict 2), not changed here -- J takes
              only the reference's copy. */}
          <p className="chart-layout-confirm-note">Add saved macros from a JSON file. Review names and replacements before importing. The current layout and chart stay unchanged.</p>
          {review.layouts.length === 0 ? (
            // A malformed or oversize file (planLayoutImport refused before there
            // was anything to review): one line, only Cancel -- there is no
            // partial import (E6).
            <>
              <p className="chart-popover-error" role="alert">{review.refusal}</p>
              <div className="chart-layout-confirm-actions">
                <button type="button" className="bd-button bd-button--ghost" onClick={() => setReview(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              {review.layouts.map((l, i) => {
                const conflict = layoutNames.includes(l.name);
                const choice = review.choice[l.name] ?? "keep";
                const { keepBothPreview, resolved } = importPlan[i];
                return (
                  <div key={l.name} className="chart-layout-assigned">
                    <span className="chart-layout-name">{l.name}{conflict && <em> · already exists</em>}</span>
                    <small>{l.panels.length} {l.panels.length === 1 ? "panel" : "panels"} · {l.series.length} series{l.note ? ` · ${l.note}` : ""}</small>
                    {/* A row that was never flagged a library conflict can still
                        collide with what an EARLIER row in this same file
                        resolves to (Task 3 finding 1's own repro: a second
                        incoming layout literally named "<name> (2)"). It gets no
                        radio group -- there is no library conflict to choose
                        between -- but it still needs to say so, so the name
                        shown here always matches the name that commits. */}
                    {!conflict && resolved !== l.name && <small>Will be saved as {resolved}</small>}
                    {conflict && (
                      <div role="radiogroup" aria-label={`${l.name} conflict`}>
                        <label><input type="radio" name={`c-${l.name}`} aria-label="Replace" checked={choice === "replace"} onChange={() => setReview({ ...review, choice: { ...review.choice, [l.name]: "replace" } })} /> Replace</label>
                        <label><input type="radio" name={`c-${l.name}`} aria-label="Keep both" checked={choice === "keep"} onChange={() => setReview({ ...review, choice: { ...review.choice, [l.name]: "keep" } })} /> Keep both <small>{keepBothPreview}</small></label>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* A failed WRITE (onImportLayouts resolved false), distinct from
                  the malformed-file case above: the per-layout choices survive
                  so a retry does not make the user redo them, the same retry
                  shape Export and Save as layout already give (E6, Task 3's
                  ruling that a failure must say so visibly). */}
              {review.refusal !== null && <p className="chart-popover-error" role="alert">{review.refusal}</p>}
              <div className="chart-layout-confirm-actions">
                <button type="button" className="bd-button bd-button--ghost" onClick={() => setReview(null)}>Cancel</button>
                {/* J closeout (2026-09-26, item 5): "Import macros", matching the
                    dialog title, the visible wording and the reference (screenshot
                    13) -- the Label-in-Name fix, was "Import layouts". */}
                <button type="button" className="bd-button bd-button--primary" onClick={() => { void commitImport(); }}>Import macros</button>
              </div>
            </>
          )}
        </ConfirmDialog>
      )}
      {exporting !== null && (
        // J closeout (2026-09-26, item 5): the accessible name matches the
        // visible "Export macros" title (Label-in-Name); the primary button is
        // "Export JSON" (reference screenshot 12), which needs no rename.
        <ConfirmDialog aria-label="Export macros">
          <h2 className="chart-layout-confirm-title">Export macros</h2>
          <p className="chart-layout-confirm-note">Download a saved macro or the full library as JSON, including notes, panels, series and appearance. Save draft edits as a macro first.</p>
          {savedLayouts.map((l) => (
            // Checkbox selection kept (spec E8); the reference's scope-dropdown
            // model is a surfaced conflict (spec J, conflict 4), not resolved
            // here. J adds only the reference's descriptive preview: each row now
            // reads name + "N panels · N series" + note. The "N panels · N series"
            // summary and the note are SEPARATE elements (not one joined line) so
            // each reads on its own row as reference 12 shows -- and so an exact
            // getByText matches one without the other, since getNodeText joins
            // only an element's direct text.
            <label key={l.name} className="chart-layout-assigned chart-layout-export-row">
              <input
                type="checkbox"
                aria-label={l.name}
                checked={exporting.names.has(l.name)}
                onChange={(e) => {
                  const next = new Set(exporting.names);
                  if (e.target.checked) next.add(l.name); else next.delete(l.name);
                  // A changed selection retires the previous failure (E6): it was
                  // about the old ticked set, not necessarily this one.
                  setExporting({ names: next, error: null });
                }}
              />
              <span className="chart-layout-name">{l.name}</span>
              <small>{l.panels.length} {l.panels.length === 1 ? "panel" : "panels"} · {l.series.length} series</small>
              {l.note && <small>{l.note}</small>}
            </label>
          ))}
          {exporting.error !== null && <p className="chart-popover-error" role="alert">{exporting.error}</p>}
          <div className="chart-layout-confirm-actions">
            <button type="button" className="bd-button bd-button--ghost" onClick={() => setExporting(null)}>Cancel</button>
            <button type="button" className="bd-button bd-button--primary" disabled={exporting.names.size === 0} onClick={() => { void exportLayouts(); }}>Export JSON</button>
          </div>
        </ConfirmDialog>
      )}
    </dialog>
  );
}

/**
 * A nested modal confirmation over the Layout editor (spec 2026-09-25, J2). The
 * codebase's SettingsDialog idiom: a <dialog> put in the top layer by
 * showModal(), so the editor beneath goes inert and this centres, ::backdrop
 * dims it, and focus is trapped. This is what replaces the hand-rolled
 * inert/aria-hidden juggling the bare-div confirmations needed -- a real
 * modal-over-modal gives all of that for free. It has no onCancel: Escape over
 * an open confirmation is caught by the editor's own document-level Escape
 * authority, which closes only the open confirmation and leaves the editor (see
 * the Escape effect in LayoutEditor). The <dialog> carries the dialog role and
 * the caller's aria-label, so getByRole("dialog", { name }) is unchanged.
 */
function ConfirmDialog({ children, "aria-label": label }: { children: ReactNode; "aria-label": string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal-backdrop chart-layout-confirm-shell" aria-label={label} aria-modal="true">
      <div className="modal chart-layout-confirm">{children}</div>
    </dialog>
  );
}

/** Whether panel `p` names panel number `n` in any of its reference fields (for the removal warning). */
function refsTo(p: PanelDef, n: number): boolean {
  const isRef = (v: unknown): boolean => typeof v === "object" && v !== null && (v as { ref: number }).ref === n;
  return p.xmarginRef === n || p.ymarginRef === n || isRef(p.xs) || isRef(p.xe) || isRef(p.ymin) || isRef(p.ymax);
}
