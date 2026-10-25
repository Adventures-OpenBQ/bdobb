// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetColumn, CloneSafeValue } from '../widgetData/types';
import { ExecutionProtocolError } from './validation';
const isCount = (column: DatasetColumn) => column.aggregation === 'count' || column.aggregation === 'uniqueCount';
/** Aggregation metadata proves counts; source/leaf strings are never coerced. */
export function countColumn(column: DatasetColumn): DatasetColumn {
  return isCount(column) ? { ...column, dtype: 'number', format: { formatterFn: 'int' } } : column;
}
export function countValues(values: Record<string, unknown>, columns: DatasetColumn[]): Record<string, CloneSafeValue> {
  const result = { ...values };
  for (const column of columns) {
    const raw = values[column.id];
    if (!isCount(column) || raw == null || raw instanceof Error || raw === '#ERROR') continue;
    const number = typeof raw === 'number' ? raw : typeof raw === 'bigint' || typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(number) || number < 0) throw new ExecutionProtocolError('INVALID_REQUEST', 'Count exceeds the exact safe numeric range');
    Object.defineProperty(result, column.id, { value: number, enumerable: true, configurable: true, writable: true });
  }
  return result as Record<string, CloneSafeValue>;
}
