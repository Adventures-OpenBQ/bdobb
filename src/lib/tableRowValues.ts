// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { WidgetDataset } from './widgetData/types';
import { isRecord } from './isRecord';
/** One record of a table payload. */
export type Row = Record<string, unknown>;
/** Shared acquisition shape check, independent of renderer and Pivot calculation imports. */
export function tableRows(data: unknown): Row[] | null {
  return Array.isArray(data) && data.every(isRecord) ? data : null;
}

/** Identify an explicit acquisition envelope before a widget selects or transforms its rows. */
export function isTableSnapshotEnvelope(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && ['rows', 'completeness'].every(key => Object.hasOwn(data, key));
}

export type Snapshot = { receipt?: Record<string, string>; completeness: WidgetDataset['completeness']['kind'] };

/** An explicit acquisition receipt travels with the delivered rows. */
export function parseTableSnapshot(data: unknown): { data: unknown; snapshot?: Snapshot } {
  if (!isRecord(data) || (!Object.hasOwn(data, 'receipt') && !isTableSnapshotEnvelope(data))) return { data };
  const { rows, receipt, completeness } = data;
  const kinds = ['complete', 'bounded', 'paged', 'partial', 'sample', 'unknown'] as const;
  const kind = kinds.find(k => k === completeness);
  const keys = ['interval', 'start_date', 'end_date', 'symbol', 'currency', 'unit', 'date'];
  if (!Object.hasOwn(data, 'receipt') && tableRows(rows)) {
    // An explicit negative scope is meaningful on its own. An affirmative one needs its receipt.
    const scope = kind && kind !== 'complete' && kind !== 'bounded' ? kind : 'unknown';
    return { data: rows, snapshot: { completeness: scope } };
  }
  if (!kind || !tableRows(rows) || !isRecord(receipt) || Object.keys(data).some(k => !['rows', 'receipt', 'completeness'].includes(k))
    || !Object.entries(receipt).every(([k, v]) => keys.includes(k) && typeof v === 'string' && v.trim() && v.length <= 4096))
    throw new Error('Invalid table snapshot');
  return { data: rows, snapshot: { receipt: receipt as Record<string, string>, completeness: kind } };
}
