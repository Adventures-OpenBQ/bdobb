// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import type { BuiltInFilterFn, FilterFn } from "@tanstack/react-table";
import { isIsoDate } from "../../lib/format";
import type { Row, TableColumn } from "../../lib/tableColumns";

/** One control per visible column, chosen by the column's data type. */
export type FilterKind = "text" | "number" | "date" | "boolean" | "none";

export type NumberFilter = { min?: number; max?: number };
export type DateFilter = { from?: string; to?: string };

const DECLARED_KIND: Record<NonNullable<TableColumn["cellDataType"]>, FilterKind> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  dateString: "date",
  object: "none",
};

/**
 * `cellDataType` when the spec gives one; otherwise the type of the column's
 * first non-null value, as the design specifies. A column that is null all
 * the way down gets no control rather than a guessed one.
 */
export function filterKindFor(column: TableColumn, rows: Row[]): FilterKind {
  const declared = column.cellDataType;
  if (declared !== undefined && Object.hasOwn(DECLARED_KIND, declared)) return DECLARED_KIND[declared];
  for (const row of rows) {
    const value = row[column.field];
    if (value === null || value === undefined) continue;
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "string") return isIsoDate(value) ? "date" : "text";
    return "none";
  }
  return "none";
}

const numberFilter: FilterFn<Row> = (row, columnId, value) => {
  const cell = row.getValue(columnId);
  if (typeof cell !== "number") return false;
  const { min, max } = value as NumberFilter;
  if (min !== undefined && cell < min) return false;
  if (max !== undefined && cell > max) return false;
  return true;
};

/**
 * Compares the leading YYYY-MM-DD as text. Deliberately never `new Date()`:
 * parsing a timezone-less date-time reads it as local time and can shift it
 * onto the next calendar day — the same contract formatCell keeps.
 */
const dateFilter: FilterFn<Row> = (row, columnId, value) => {
  const cell = row.getValue(columnId);
  if (typeof cell !== "string") return false;
  const day = cell.slice(0, 10);
  const { from, to } = value as DateFilter;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

/**
 * Ours rather than table-core's `equalsString`, which lower-cases the cell
 * before comparing: a column the spec declares `cellDataType: "boolean"` can
 * still hold the string "TRUE", and that would then match the select's
 * "true" where today it does not. Widening the match is a behaviour change,
 * not a simplification.
 */
const booleanFilter: FilterFn<Row> = (row, columnId, value) =>
  String(row.getValue(columnId)) === value;

/**
 * `text` is table-core's own `includesString` by name -- a built-in name needs
 * no `FilterFns` module augmentation, and its case-insensitive substring match
 * on the cell's string form is exactly what this row asked for. The other
 * three have no built-in equivalent and are handed over as functions.
 */
const FILTER_FNS: Record<FilterKind, BuiltInFilterFn | FilterFn<Row> | undefined> = {
  text: "includesString",
  number: numberFilter,
  date: dateFilter,
  boolean: booleanFilter,
  none: undefined,
};

export function filterFnFor(kind: FilterKind): BuiltInFilterFn | FilterFn<Row> | undefined {
  return FILTER_FNS[kind];
}

/**
 * `onChange(undefined)` is how a filter is removed: table-core's
 * shouldAutoRemoveFilter drops a filter whose value is `undefined` or `""`
 * regardless of the filter function, so the controls emit exactly that when
 * they are cleared. An empty `{}` would instead keep a filter alive that
 * matches everything.
 */
export function FilterControl({
  kind,
  header,
  value,
  bounds,
  onChange,
}: {
  kind: FilterKind;
  /** The column's rendered header, used for the control's accessible name. */
  header: string;
  value: unknown;
  /** A date column's first and last day in the loaded rows: the From and To
   * boxes' starting text. */
  bounds?: DateBounds;
  onChange: (next: unknown) => void;
}) {
  if (kind === "none") return null;

  if (kind === "text") {
    return (
      <input
        className="filter-input"
        type="text"
        aria-label={`Filter ${header}`}
        placeholder="contains"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <select
        className="filter-input"
        aria-label={`Filter ${header}`}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">any</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (kind === "number") {
    const range = (typeof value === "object" && value !== null ? value : {}) as NumberFilter;
    const emit = (next: NumberFilter) => {
      const merged = { ...range, ...next };
      const min = Number.isFinite(merged.min) ? merged.min : undefined;
      const max = Number.isFinite(merged.max) ? merged.max : undefined;
      onChange(min === undefined && max === undefined ? undefined : { min, max });
    };
    const asNumber = (raw: string) => (raw === "" ? undefined : Number(raw));
    return (
      <span className="filter-range">
        <input
          className="filter-input"
          type="number"
          aria-label={`Minimum ${header}`}
          placeholder="min"
          value={range.min ?? ""}
          onChange={(e) => emit({ min: asNumber(e.target.value) })}
        />
        <input
          className="filter-input"
          type="number"
          aria-label={`Maximum ${header}`}
          placeholder="max"
          value={range.max ?? ""}
          onChange={(e) => emit({ max: asNumber(e.target.value) })}
        />
      </span>
    );
  }

  const range = (typeof value === "object" && value !== null ? value : {}) as DateFilter;
  const emit = (next: DateFilter) => {
    const merged = { ...range, ...next };
    const from = merged.from || undefined;
    const to = merged.to || undefined;
    onChange(from === undefined && to === undefined ? undefined : { from, to });
  };
  return (
    <span className="filter-range">
      <DateBox
        label={`From ${header}`}
        applied={range.from}
        prefill={bounds?.first ?? ""}
        onBound={(from) => emit({ from })}
      />
      <DateBox
        label={`To ${header}`}
        applied={range.to}
        prefill={bounds?.last ?? ""}
        onBound={(to) => emit({ to })}
      />
    </span>
  );
}

export type DateBounds = { first: string; last: string };

export type DateBound = { ok: true; value: string | undefined } | { ok: false };

/**
 * A date box's text as a bound: blank is no bound, YYYY-MM-DD (on the
 * calendar) is that day, anything else is refused. The one place a typed
 * date is read -- v4 extends it with its date modifiers (T-1bd, FQ-4 ...).
 */
export function parseDateBound(text: string): DateBound {
  const t = text.trim();
  if (t === "") return { ok: true, value: undefined };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false };
  const [y, m, d] = t.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d
    ? { ok: true, value: t }
    : { ok: false };
}

/**
 * One end of a date range, as a text box. Not <input type=date>: WKWebView
 * draws an untyped segment as today's date in grey, so a half-typed date
 * looked real and filtered nothing (V3-005), and v4's date modifiers must be
 * typeable here. The box starts at the applied bound, else the column's own
 * first/last day -- which is no bound at all. Typing changes only the text;
 * Enter or leaving the box applies it.
 */
function DateBox({
  label,
  applied,
  prefill,
  onBound,
}: {
  label: string;
  applied: string | undefined;
  prefill: string;
  onBound: (next: string | undefined) => void;
}) {
  const shown = applied ?? prefill;
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  // Follows a change from outside (Clear, a fresh payload) during render, so
  // the box never shows a stale bound for a frame.
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setText(shown);
    setInvalid(false);
  }
  const apply = () => {
    const parsed = parseDateBound(text);
    setInvalid(!parsed.ok);
    if (!parsed.ok) return;
    const value = parsed.value === prefill ? undefined : parsed.value;
    if (value !== applied) onBound(value);
  };
  return (
    <input
      className="filter-input filter-date"
      type="text"
      inputMode="numeric"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? "Use YYYY-MM-DD" : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") apply();
      }}
    />
  );
}
