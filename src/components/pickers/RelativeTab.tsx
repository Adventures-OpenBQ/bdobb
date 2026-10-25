// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isExpression, isRangeType, type Offset, type Preview, type Unit } from "../../lib/dateExpressions";
import {
  ANCHOR_LABELS,
  RELATIVE_OPTIONS,
  UNIT_LABELS,
  expressionFromRows,
  presetsFor,
  rowsFromExpression,
  type AnchorKey,
  type AtomRows,
  type Preset,
  type RelativeType,
  type Rows,
} from "../../lib/presets";

/**
 * What a control hands its Relative tab beyond the value: how to resolve an
 * expression in ITS vocabulary (its type, year end and exchange calendar are
 * ParamControls' to know), and the dashboard's presets with the two writes
 * on them. Built once per control by ParamControls.
 */
export type RelativeContext = {
  /** The expression resolved in this control's vocabulary right now; null for a literal. */
  preview: (expr: string) => Preview | null;
  /** The dashboard's saved presets, unfiltered. */
  presets: Preset[];
  /**
   * The two writes. Absent in the viewer window, whose store refuses both and
   * only logs it: the tab then offers neither "Save as preset" nor a saved
   * chip's ×, rather than a save that looks as if it worked. Chips still
   * load the rows and Apply still commits — that write is the card's own.
   */
  onSavePreset?: (name: string, expr: string) => void;
  onDeletePreset?: (name: string) => void;
};

type Props = {
  type: RelativeType;
  /** The param's label: every control here is named from it. */
  label: string;
  /** The stored value; an expression seeds the rows. */
  value: string;
  context: RelativeContext;
  /** Apply: the canonical expression, committed by the caller through the normal path. */
  onApply: (expr: string) => void;
};

/**
 * The largest amount an offset row takes: the parser reads at most six
 * digits (a longer amount would hang a day-stepping resolve), so the rows
 * must never write a seventh.
 */
const MAX_AMOUNT = 999999;

/**
 * A business-day amount's cap: the parser reads at most four digits for
 * `bd` (each bd step walks the calendar a trading day at a time, and six
 * digits took over a second per resolve), so a bd row never writes a fifth.
 */
const MAX_BD_AMOUNT = 9999;
const maxAmount = (unit: Unit): number => (unit === "bd" ? MAX_BD_AMOUNT : MAX_AMOUNT);

/**
 * An offset row carries a stable id, given when the row is created, for its
 * React key: an index key would hand a removed middle row's DOM — focus and
 * all — to the row after it. The id rides along on the Offset (the rows are
 * still `Rows` to expressionFromRows, which reads sign, amount and unit only).
 */
type KeyedOffset = Offset & { id: number };
type KeyedAtom = { anchor: AnchorKey; offsets: KeyedOffset[] };
type KeyedRows = { start: KeyedAtom; end?: KeyedAtom };

let nextRowId = 0;
const keyOffset = (o: Offset): KeyedOffset => ({ ...o, id: nextRowId++ });
const keyAtom = (atom: AtomRows): KeyedAtom => ({ anchor: atom.anchor, offsets: atom.offsets.map(keyOffset) });
const keyRows = (rows: Rows | null): KeyedRows | null =>
  rows && { start: keyAtom(rows.start), end: rows.end ? keyAtom(rows.end) : undefined };

/** A fresh atom for a type: its first anchor, no offsets. */
const emptyAtom = (type: RelativeType): AtomRows => ({ anchor: RELATIVE_OPTIONS[type].anchors[0], offsets: [] });

function defaultRows(type: RelativeType): Rows {
  return isRangeType(type) ? { start: emptyAtom(type), end: emptyAtom(type) } : { start: emptyAtom(type) };
}

/**
 * One atom's rows: the anchor dropdown and the offset rows (sign, number,
 * unit). Native selects and a number input — a dropdown of nine words needs
 * no listbox — each named from `prefix` so a range's two ends are told apart.
 */
function AtomEditor({
  prefix,
  type,
  rows,
  onChange,
}: {
  prefix: string;
  type: RelativeType;
  rows: KeyedAtom;
  onChange: (next: KeyedAtom) => void;
}) {
  const { anchors, units } = RELATIVE_OPTIONS[type];
  // Removing a row unmounts the × that was clicked; the add button stays, so
  // focus goes there rather than falling out of the popover (see RelativeTab).
  const addRef = useRef<HTMLButtonElement>(null);
  const setOffset = (i: number, patch: Partial<Offset>) =>
    onChange({ ...rows, offsets: rows.offsets.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="relative-atom">
      <select aria-label={`${prefix} anchor`} value={rows.anchor} onChange={(e) => onChange({ ...rows, anchor: e.target.value as AnchorKey })}>
        {anchors.map((a) => (
          <option key={a} value={a}>
            {ANCHOR_LABELS[a]}
          </option>
        ))}
      </select>
      {rows.offsets.map((o, i) => (
        <div key={o.id} className="relative-offset">
          <select aria-label={`${prefix} offset ${i + 1} sign`} value={o.sign < 0 ? "-" : "+"} onChange={(e) => setOffset(i, { sign: e.target.value === "-" ? -1 : 1 })}>
            <option value="-">−</option>
            <option value="+">+</option>
          </select>
          <input
            type="number"
            min={0}
            max={maxAmount(o.unit)}
            step={1}
            aria-label={`${prefix} offset ${i + 1} amount`}
            value={o.amount}
            // An empty or negative field reads as 0 rather than NaN: the sign
            // select carries the direction, and the preview stays honest. A
            // seventh digit clamps to MAX_AMOUNT rather than being written.
            // A bd row clamps at MAX_BD_AMOUNT, its fifth digit, the same way.
            onChange={(e) => setOffset(i, { amount: Math.min(maxAmount(o.unit), Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
          />
          {/* Switching the unit clamps the amount to the new unit's cap: 50000 d switched to bd is 9999 bd, never an unparseable row. */}
          <select
            aria-label={`${prefix} offset ${i + 1} unit`}
            value={o.unit}
            onChange={(e) => {
              const unit = e.target.value as Unit;
              setOffset(i, { unit, amount: Math.min(maxAmount(unit), o.amount) });
            }}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`${prefix} remove offset ${i + 1}`}
            onClick={() => {
              addRef.current?.focus();
              onChange({ ...rows, offsets: rows.offsets.filter((_, j) => j !== i) });
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        ref={addRef}
        type="button"
        className="relative-add"
        aria-label={`${prefix} add offset`}
        onClick={() => onChange({ ...rows, offsets: [...rows.offsets, keyOffset({ sign: -1, amount: 1, unit: units[0] })] })}
      >
        + offset
      </button>
    </div>
  );
}

/**
 * The Relative tab (spec §4): anchor + offset rows (twice for a range), the
 * preset chips filtered to this type, a live preview with ⚠ when a fallback
 * calendar answered, Apply, and Save as preset. A stored expression the rows
 * cannot express (`now-1h` on a date) is shown read-only with its preview,
 * so nothing is ever silently rewritten; Apply is off there.
 *
 * The rows are local state: the popover unmounts on close, so reopening
 * re-seeds from the stored value. A chip LOADS the rows — the preview then
 * says what it resolves to — and Apply writes; nothing here writes on its
 * own. The name field replaces window.prompt, which WKWebView does not have
 * (the InlineRename precedent).
 *
 * Focus never falls out of the popover. The period popover's nested Dialog
 * turns off the Popover's focus containment, and its Escape handler sits on
 * the overlay element only, so a focused control that unmounts would drop
 * focus to <body> — the keyboard user loses their place and Escape stops
 * closing the popover. Every action here that unmounts what it was fired
 * from moves focus first: starting the name ("Save as preset" unmounts)
 * focuses the name field as it mounts; ending the name (Save, Enter,
 * Cancel, Escape) returns it to "Save as preset"; deleting a saved chip
 * moves it to the adjacent chip, or to the Presets group when none is left.
 */
export function RelativeTab({ type, label, value, context, onApply }: Props) {
  const [rows, setRows] = useState<KeyedRows | null>(() =>
    keyRows(rowsFromExpression(type, value) ?? (isExpression(type, value) ? null : defaultRows(type))),
  );
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const presetNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (naming) presetNameRef.current?.focus(); }, [naming]);
  const saveAsRef = useRef<HTMLButtonElement>(null);
  const presetsRef = useRef<HTMLDivElement>(null);
  // "Save as preset" is not in the DOM while naming; set when naming ends so
  // the effect below focuses it once it has re-mounted.
  const refocusSaveAs = useRef(false);

  useEffect(() => {
    if (naming || !refocusSaveAs.current) return;
    refocusSaveAs.current = false;
    saveAsRef.current?.focus();
  }, [naming]);

  const expr = rows ? expressionFromRows(rows) : value;
  const preview = context.preview(expr);
  const rangePrefix = (end: boolean) => (isRangeType(type) ? `${label} ${end ? "end" : "start"}` : label);

  const endNaming = () => {
    refocusSaveAs.current = true;
    setNaming(false);
    setName("");
  };
  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    context.onSavePreset?.(trimmed, expr);
    endNaming();
  };
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Saving moves focus to "Save as preset" during this keydown; unless it
      // is prevented, Enter's keypress then lands on that button and clicks
      // it, reopening the name field it just closed.
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      // The popover's own Escape must not fire from inside the name field:
      // cancelling the name is one step, closing the popover another.
      e.stopPropagation();
      endNaming();
    }
  };
  const deletePreset = (presetName: string, chip: Element | null) => {
    const chips = Array.from(presetsRef.current?.querySelectorAll<HTMLButtonElement>("button.preset-chip") ?? []);
    const i = chips.indexOf(chip as HTMLButtonElement);
    (chips[i + 1] ?? chips[i - 1] ?? presetsRef.current)?.focus();
    context.onDeletePreset?.(presetName);
  };

  const offered = presetsFor(type, context.presets);
  const groups = [...new Set(offered.map((p) => p.group))];

  return (
    <div className="relative-tab">
      {rows ? (
        <>
          <AtomEditor prefix={rangePrefix(false)} type={type} rows={rows.start} onChange={(start) => setRows({ ...rows, start })} />
          {rows.end ? (
            <AtomEditor prefix={rangePrefix(true)} type={type} rows={rows.end} onChange={(end) => setRows({ ...rows, end })} />
          ) : null}
        </>
      ) : (
        <p className="relative-readonly">{value}</p>
      )}
      {/* tabIndex -1: focusable from script only, where a deleted last chip sends focus. */}
      <div ref={presetsRef} role="group" aria-label="Presets" className="relative-presets" tabIndex={-1}>
        {groups.map((group) => (
          <div key={group} className="relative-preset-group">
            <span className="relative-group-name">{group}</span>
            {offered
              .filter((p) => p.group === group)
              .map((p) => (
                <span key={p.name} className="preset-chip-wrap">
                  <button type="button" className="preset-chip" onClick={() => setRows(keyRows(rowsFromExpression(type, p.expr)))}>
                    {p.name}
                  </button>
                  {p.saved && context.onDeletePreset ? (
                    <button
                      type="button"
                      className="preset-delete"
                      aria-label={`Delete preset ${p.name}`}
                      onClick={(e) => deletePreset(p.name, e.currentTarget.previousElementSibling)}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
          </div>
        ))}
      </div>
      <p className="relative-preview" aria-live="polite" title={preview?.error ?? preview?.reason}>
        {preview
          ? preview.error !== undefined
            ? `⚠ ${preview.error}`
            : `resolves now to ${preview.text}${preview.fallback ? " ⚠" : ""}${preview.provisional ? " (provisional)" : ""}`
          : "—"}
      </p>
      <div className="relative-actions">
        <button type="button" className="relative-apply" disabled={rows === null || preview === null || preview.error !== undefined} onClick={() => onApply(expr)}>
          Apply
        </button>
        {!context.onSavePreset ? null : naming ? (
          <>
            {/* Move focus once from the explicit Save as preset action into its name field. */}
            <input type="text" aria-label="Preset name" ref={presetNameRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onNameKey} />
            <button type="button" onClick={save}>
              Save
            </button>
            <button type="button" onClick={endNaming}>
              Cancel
            </button>
          </>
        ) : (
          <button ref={saveAsRef} type="button" disabled={preview === null || preview.error !== undefined} onClick={() => setNaming(true)}>
            Save as preset
          </button>
        )}
      </div>
    </div>
  );
}
