// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { detectTimeColumn, rowsOf } from "./chartShapes";

/**
 * v5.3.0 §3 `data_bounds`: the first and last instant of the data a widget has
 * loaded, for the `earliest` / `latest` anchors. Read off the payload's own date
 * column -- the one the chart already plots against (detectTimeColumn: the
 * first date-valued column) -- so "the data's bounds" means the same column the
 * card already treats as its dates.
 *
 * undefined when the payload has no rows or no date column: the anchor then
 * DEFERS (resolveValue leaves the value out), it does not guess.
 */
/**
 * A bare `YYYY-MM-DD` is a CALENDAR date, not an instant: `Date.parse` reads it as
 * UTC midnight, which is the day before anywhere west of Greenwich -- `earliest`
 * resolved to 2019-01-01 for data that starts 2019-01-02 (caught by the hook's own
 * test, 2026-09-21). Read at local NOON instead, so the day survives the resolver's
 * projection into any zone within twelve hours of the viewer's. A value that carries
 * a time is an instant and is parsed as one.
 */
function instantOf(value: string): number {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]), 12).getTime() : Date.parse(value);
}

export function dataBounds(data: unknown): { min: Date; max: Date } | undefined {
  // Rows as they are, or OpenBB's `{ results: [...] }` envelope around them.
  const rows = rowsOf(data) ?? rowsOf((data as { results?: unknown } | null)?.results);
  if (rows === null || rows.length === 0) return undefined;
  const column = detectTimeColumn(rows);
  if (column === null) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const value = row[column];
    const at = typeof value === "number" ? value : instantOf(String(value));
    if (!Number.isFinite(at)) continue;
    if (at < min) min = at;
    if (at > max) max = at;
  }
  return Number.isFinite(min) ? { min: new Date(min), max: new Date(max) } : undefined;
}
