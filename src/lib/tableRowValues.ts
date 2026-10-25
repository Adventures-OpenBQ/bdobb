// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from './isRecord';
/** One record of a table payload. */
export type Row = Record<string, unknown>;
/** Shared acquisition shape check, independent of renderer and Pivot calculation imports. */
export function tableRows(data: unknown): Row[] | null {
  return Array.isArray(data) && data.every(isRecord) ? data : null;
}
