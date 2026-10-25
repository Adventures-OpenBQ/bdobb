// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { columnsOf } from "./export";

/**
 * The transposed view of a row array: the first column's values become the
 * headers, each remaining column becomes a row, and a leading `Field` column
 * names the original column. Pure — the input is never mutated — and each
 * output row is an ordinary row object, so the table renderer draws it
 * unchanged.
 *
 * `columns` is returned explicitly (`["Field", ...headers]`, in order)
 * because column order must never be derived from `Object.keys` of a
 * transposed row: JS enumerates integer-like keys (e.g. `"2024"`) before
 * string keys regardless of insertion order, which would push `Field` out of
 * first place. Every consumer must read column order from `columns`, not
 * from a row's own keys.
 *
 * Header text is `String(value)`; an empty first-column value shows as an em
 * dash; a header that repeats an earlier one (or collides with `Field`) gets
 * " (n)" appended, n counting from 2, so no two columns share a key.
 */
export const FIELD_COLUMN = "Field";

const EMPTY_HEADER = "—";

/** Shown wherever transposeRows returns null; one string, two call sites. */
export const NOTHING_TO_TRANSPOSE =
  "Nothing to transpose: the table needs at least one row and two columns.";

export type Transposed = {
  columns: string[];
  rows: Record<string, unknown>[];
};

export function transposeRows(
  rows: Record<string, unknown>[],
): Transposed | null {
  if (rows.length === 0) return null;

  // Column union in first-seen order: the same rule tableColumns applies.
  const columns = columnsOf(rows);
  if (columns.length < 2) return null;

  const [headerColumn, ...fieldColumns] = columns;
  // Object.hasOwn, as everywhere else in the repo a row is read by a computed
  // key: a column named e.g. "constructor" is an own key on the row that
  // declared it, but a bare index on a row that did not would walk
  // Object.prototype and transpose a function into the grid.
  const read = (row: Record<string, unknown>, key: string): unknown =>
    Object.hasOwn(row, key) ? row[key] : undefined;
  const headers = uniqueHeaders(rows.map((row) => headerText(read(row, headerColumn))));

  const outRows = fieldColumns.map((field) => {
    const out: Record<string, unknown> = { [FIELD_COLUMN]: field };
    rows.forEach((row, i) => {
      out[headers[i]] = read(row, field);
    });
    return out;
  });

  return { columns: [FIELD_COLUMN, ...headers], rows: outRows };
}

function headerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY_HEADER;
  return String(value);
}

function uniqueHeaders(texts: string[]): string[] {
  const taken = new Set<string>([FIELD_COLUMN]);
  // Where the next suffix for a given text should start, so a column value
  // repeated n times costs n steps rather than n². The `taken` check still
  // runs on every candidate: a generated "X (2)" must not collide with a
  // literal "X (2)" that arrived on its own, whatever the order.
  const nextSuffix = new Map<string, number>();
  return texts.map((text) => {
    let name = text;
    let n = nextSuffix.get(text) ?? 2;
    while (taken.has(name)) {
      name = `${text} (${n})`;
      n += 1;
    }
    nextSuffix.set(text, n);
    taken.add(name);
    return name;
  });
}
