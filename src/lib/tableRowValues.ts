// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { TableSpec } from './types';
import { isRecord } from './isRecord';
/** One record of a table payload. */
export type Row = Record<string, unknown>;
/** Shared acquisition shape check, independent of renderer and Pivot calculation imports. */
export function tableRows(data: unknown, spec?: TableSpec): Row[] | null {
  if (Array.isArray(data)) return data.every(isRecord) ? data : null;
  // Some model endpoints (ECB reference rates) return one record. Only a
  // declared schema can establish that an object is a row, not an envelope
  // or error. Preserve exact wire keys and leave the source object untouched.
  if (isRecord(data) && spec?.columns.length) {
    const keys = Object.keys(data);
    const declared = new Set(spec.columns.map(c => c.field));
    if (keys.length > 0 && keys.every(key => declared.has(key))) return [data];
  }
  return null;
}
