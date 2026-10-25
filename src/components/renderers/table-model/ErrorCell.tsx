// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { DatasetCellError } from '../../../lib/widgetData/types';
/** The same readable diagnostic in body cells and the independent totals footer. */
export function ErrorCell({ error }: { error: DatasetCellError }) {
  return <span role="img" data-error-code={error.code} aria-label={`Error: ${error.message}`}><span className="cell-error-icon" aria-hidden="true">⚠</span>{' '}#ERROR</span>;
}
