// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useRef, useState } from "react";
import { encodePanels, loopText, parsePanels, scaleOrder, type PanelDef } from "../../../lib/chart/panels";
import { parseExpression } from "../../../lib/dateExpressions";

/**
 * One panel's ten fields in the four groups of the layout editor's Panels tab
 * (spec 2026-09-24, "The panel tab"): position and size as percentages of the
 * chart body; axis margins as pixels or a panel reference; the time window as a
 * date expression, a group reference, a panel reference or blank; and the
 * y-axis bounds as a number, a panel reference or blank. Each group carries a
 * one-line note saying what its values may be, so the four kinds are not
 * guessed from a placeholder.
 *
 * The typed validation is PanelEditor's, relocated here (PanelEditor is
 * retired): a field is held in a per-field draft while it is typed, marks
 * itself invalid and says why, and commits the WHOLE panel to `onChange` on
 * blur or Enter only when accepted -- a refusal never outlives the field it was
 * typed into. The parent (LayoutEditor) records each accepted panel as a staged
 * op; nothing here reaches the chart.
 */

const NUMBERS = [
  ["top", "Top (%)"],
  ["left", "Left (%)"],
  ["width", "Width (%)"],
  ["height", "Height (%)"],
] as const;
const MARGINS = [
  ["xmargin", "X margin"],
  ["ymargin", "Y margin"],
] as const;
const XKEYS = [
  ["xs", "X start"],
  ["xe", "X end"],
] as const;
const YKEYS = [
  ["ymin", "Y min"],
  ["ymax", "Y max"],
] as const;

/**
 * The per-field caption shown under each input (spec 2026-09-25, J5, reference
 * 06): a one-line hint that names what the value means, keyed by field key so
 * the four field renderers below share one map. These sit under the input, next
 * to but distinct from each group's `<legend>`/note, which say what KIND of
 * value the whole group takes.
 */
const HINTS: Record<string, string> = {
  top: "Vertical position", left: "Horizontal position", width: "Panel width", height: "Panel height",
  xmargin: "Pixels or panel reference", ymargin: "Pixels or panel reference",
  xs: "A date, a $group: name, or P<n>", xe: "A date, a $group: name, or P<n>",
  ymin: "A number, or P<n>", ymax: "A number, or P<n>",
};

/**
 * The panel's editable field count, DERIVED from the four groups rather than
 * written as a literal (spec 2026-09-25, J5): it is the real number the render
 * produces, so the "PN parameters" count can never drift from what shows. The
 * reference 06 shows the same ten; PanelFields.test.tsx pins that value, so
 * adding or removing a field both changes this count and fails that test.
 */
const FIELD_COUNT = NUMBERS.length + MARGINS.length + XKEYS.length + YKEYS.length;

type NumberKey = (typeof NUMBERS)[number][0];
type MarginKey = (typeof MARGINS)[number][0];
type XKey = (typeof XKEYS)[number][0];
type YKey = (typeof YKEYS)[number][0];

/** What one field is holding while it is edited: the text as typed, why it was refused (null if not) and the panel it would commit (null when there is nothing to commit). */
type Draft = { key: string; value: string; error: string | null; next: PanelDef | null };

const marginRef = (panel: PanelDef, key: MarginKey): number | undefined =>
  key === "xmargin" ? panel.xmarginRef : panel.ymarginRef;
/** A margin shown as written: the panel it inherits from, else its pixels. */
const marginShown = (panel: PanelDef, key: MarginKey): string => {
  const ref = marginRef(panel, key);
  return ref === undefined ? String(panel[key]) : `P${ref}`;
};
const extraShown = (panel: PanelDef, key: XKey | YKey): string => {
  const value = panel[key];
  if (value === undefined) return "";
  return typeof value === "object" ? `P${value.ref}` : String(value);
};

export function PanelFields({
  panel, index, panels, idPrefix, onChange,
}: {
  panel: PanelDef;
  index: number;
  panels: PanelDef[];
  idPrefix: string;
  onChange: (def: PanelDef) => void;
}) {
  // One field has focus at a time, so one draft is enough.
  const [draft, setDraft] = useState<Draft | null>(null);
  const errorRef = useRef<string | null>(null);
  errorRef.current = draft?.error ?? null;

  const editing = (key: string): boolean => draft !== null && draft.key === key;
  const shown = (key: string, encoded: string): string => (editing(key) ? (draft as Draft).value : encoded);
  const invalid = (key: string): "true" | undefined => (editing(key) && draft?.error !== null ? "true" : undefined);

  /** Blur or Enter: commit if accepted, and clear draft appropriately. A refusal never outlives the field: error feedback persists
   * for time window fields (where the user may refine a date), but reverts margin and y-bound fields to their encoded values
   * so the user sees what the system accepted (Review Focus 3, Focus 2).
   */
  const land = (): void => {
    if (draft === null) return;
    if (draft.next !== null) onChange(draft.next);
    const isTimeWindowField = draft.key === "xs" || draft.key === "xe";
    // For timewindow fields, keep draft in all cases (error or success) so field shows typed value and errors persist.
    // For other fields, clear draft in all cases so field reverts to encoded value.
    if (!isTimeWindowField) {
      setDraft(null);
    }
  };

  const setNumber = (key: NumberKey, raw: string): void => {
    const value = Number(raw);
    const ok = raw.trim() !== "" && Number.isFinite(value);
    setDraft({ key, value: raw, error: ok ? null : "not a number", next: ok ? { ...panel, [key]: value } : null });
  };

  const setMargin = (key: MarginKey, raw: string): void => {
    const refKey = key === "xmargin" ? "xmarginRef" : "ymarginRef";
    // A margin may name the panel it inherits from. The codec is the judge of
    // whether it can be followed: build the candidate list, encode + parse it,
    // and a problem on THIS row is the refusal (PanelEditor's own test).
    const ref = /^p(\d+)$/i.exec(raw.trim());
    if (ref !== null) {
      const n = Number(ref[1]);
      const candidate = panels.map((p, i) => (i === index ? { ...p, [refKey]: n } : p));
      const parsed = parsePanels(encodePanels(candidate));
      const mine = parsed.problems.find((problem) => problem.startsWith(`panel ${index + 1}: ${key}`));
      const error = mine === undefined ? null
        : n === index + 1 ? `P${n} is this panel`
          : n > panels.length || n < 1 ? `there is no panel P${n}` : `P${n} leads back to this panel`;
      setDraft({ key, value: raw, error, next: error === null ? parsed.panels[index] : null });
      return;
    }
    // A margin cannot be blank -- it would reach the codec as NaN (Review Focus 3).
    const value = Number(raw);
    const ok = raw.trim() !== "" && Number.isFinite(value);
    // A number typed over a reference clears it.
    setDraft({
      key, value: raw, error: ok ? null : "pixels or P<n>",
      next: ok ? { ...panel, [key]: value, [refKey]: undefined } : null,
    });
  };

  const setX = (key: XKey, raw: string): void => {
    const typed = raw.trim();
    const refuse = (error: string): void => setDraft({ key, value: raw, error, next: null });
    const accept = (value: string | { ref: number } | undefined): void =>
      setDraft({ key, value: raw, error: null, next: { ...panel, [key]: value } });
    if (typed === "") { accept(undefined); return; }            // blank clears the edge
    // A date GROUP reference resolves later, against the dashboard's groups; the
    // editor only checks the shape here.
    if (/^\$group:\S+$/.test(typed)) { accept(typed); return; }
    // P<n> takes that panel's own edge (user ruling 2026-09-24). Only the
    // panel's existence and a loop through this key are checked.
    const xref = /^P(\d+)$/.exec(typed);
    if (xref !== null) {
      const target = Number(xref[1]);
      if (target < 1 || target > panels.length) { refuse(`no panel ${target}`); return; }
      const seen = new Set<number>();
      const next = panels.map((p, i) => (i === index ? { ...p, [key]: { ref: target } } : p));
      for (let at: number | undefined = index + 1; at !== undefined; ) {
        if (seen.has(at)) { refuse(`P${at} loops back through ${key}`); return; }
        seen.add(at);
        const value: string | { ref: number } | undefined = next[at - 1]?.[key];
        at = typeof value === "object" ? value.ref : undefined;
      }
      accept({ ref: target });
      return;
    }
    const expr = parseExpression(typed);
    if (expr === null) { refuse("not a date expression"); return; }
    // Each of these is ONE end of the x-window; the grammar happily parses
    // `S..E` as a range, which means nothing here.
    if (expr.end !== undefined) { refuse("one date, not a range"); return; }
    accept(typed);
  };

  const setY = (key: YKey, raw: string): void => {
    const typed = raw.trim();
    const refuse = (error: string): void => setDraft({ key, value: raw, error, next: null });
    const accept = (value: number | { ref: number } | undefined): void =>
      setDraft({ key, value: raw, error: null, next: { ...panel, [key]: value } });
    if (typed === "") { accept(undefined); return; }            // blank clears the bound
    const ref = /^P(\d+)$/.exec(typed);
    if (ref === null) {
      const value = Number(typed);
      if (!Number.isFinite(value)) { refuse("a number or P<n>"); return; }
      accept(value);
      return;
    }
    const target = Number(ref[1]);
    if (target < 1 || target > panels.length) { refuse(`no panel ${target}`); return; }
    // The only check a y reference needs: sort the list it WOULD make, and see
    // whether this panel came out on a loop (Review Focus 2).
    const next = panels.map((p, i) => (i === index ? { ...p, [key]: { ref: target } } : p));
    const loop = scaleOrder(next).cycles.find((c) => c.includes(index + 1));
    if (loop !== undefined) { refuse(loopText(loop)); return; }
    accept({ ref: target });
  };

  const numberField = (key: NumberKey | MarginKey, label: string, kind: "num" | "margin") => (
    <label key={key} className="chart-fields-field">
      <span>{label}</span>
      <input
        id={`${idPrefix}-${key}`}
        aria-label={label}
        aria-describedby={`${idPrefix}-${key}-hint`}
        type={kind === "margin" ? "text" : "number"}
        inputMode={kind === "margin" ? "text" : undefined}
        step="any"
        spellCheck={false}
        value={shown(key, kind === "margin" ? marginShown(panel, key as MarginKey) : String(panel[key as NumberKey]))}
        data-invalid={invalid(key)}
        onChange={(e) => (kind === "margin" ? setMargin(key as MarginKey, e.target.value) : setNumber(key as NumberKey, e.target.value))}
        onBlur={land}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); land(); } }}
      />
      {/* The field's DESCRIPTION, tied to the input by aria-describedby. The
          input's name comes from its explicit aria-label, so without the id
          this caption was visible to sighted readers and reached nobody else
          (Task 3 review, 2026-09-26). */}
      <small id={`${idPrefix}-${key}-hint`} className="chart-fields-hint">{HINTS[key]}</small>
    </label>
  );

  const extraField = (key: XKey | YKey, label: string, kind: "x" | "y") => (
    <label key={key} className="chart-fields-field">
      <span>{label}</span>
      <input
        id={`${idPrefix}-${key}`}
        aria-label={label}
        aria-describedby={`${idPrefix}-${key}-hint`}
        type="text"
        spellCheck={false}
        value={shown(key, extraShown(panel, key))}
        data-invalid={invalid(key)}
        onChange={(e) => (kind === "x" ? setX(key as XKey, e.target.value) : setY(key as YKey, e.target.value))}
        onBlur={land}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); land(); } }}
      />
      {/* The field's DESCRIPTION, tied to the input by aria-describedby. The
          input's name comes from its explicit aria-label, so without the id
          this caption was visible to sighted readers and reached nobody else
          (Task 3 review, 2026-09-26). */}
      <small id={`${idPrefix}-${key}-hint`} className="chart-fields-hint">{HINTS[key]}</small>
    </label>
  );

  return (
    <div className="chart-fields">
      {/* The parameters heading (spec 2026-09-25, J5, reference 06): the panel
          being edited and its field count, above the fieldsets. */}
      <div className="chart-fields-head">
        <h3>P{index + 1} parameters</h3>
        <span className="chart-fields-count">{FIELD_COUNT} parameters</span>
      </div>
      {draft?.error != null && <p className="chart-popover-error" role="alert">{draft.error}</p>}
      <fieldset className="chart-fields-group">
        <legend>Position &amp; size</legend>
        <p className="chart-fields-note">Percent of the chart body, not relative panel weights.</p>
        {NUMBERS.map(([key, label]) => numberField(key, label, "num"))}
      </fieldset>
      <fieldset className="chart-fields-group">
        <legend>Axis margins</legend>
        <p className="chart-fields-note">Pixels, or P&lt;n&gt; to inherit another panel&apos;s margin.</p>
        {MARGINS.map(([key, label]) => numberField(key, label, "margin"))}
      </fieldset>
      <fieldset className="chart-fields-group">
        <legend>Time window</legend>
        <p className="chart-fields-note">A date expression, a $group: reference, P&lt;n&gt;, or blank for the chart&apos;s window.</p>
        {XKEYS.map(([key, label]) => extraField(key, label, "x"))}
      </fieldset>
      <fieldset className="chart-fields-group">
        <legend>Y-axis bounds</legend>
        <p className="chart-fields-note">A number, P&lt;n&gt; to borrow another panel&apos;s scale, or blank to autoscale.</p>
        {YKEYS.map(([key, label]) => extraField(key, label, "y"))}
      </fieldset>
    </div>
  );
}
