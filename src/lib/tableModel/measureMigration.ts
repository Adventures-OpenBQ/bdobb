// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { aggregationOf, dataFieldsOf } from '../pivotConfig';
import type { PivotConfig, PivotMeasure } from '../types';
import type { DatasetColumn } from '../widgetData/types';

/** Explicit instances are authoritative, including unset operators and absent inputs. */
export function resolveMeasures(config: PivotConfig, columns: DatasetColumn[], sourceOrder: string[]): PivotMeasure[] {
  if (config.measures !== undefined) return config.measures.map(measure => ({ ...measure }));
  // Keep unavailable stored fields repairable. Column IDs are current bindings;
  // sourceFieldId on DatasetColumn records provenance, not an accessible input.
  const order = [...new Set([...sourceOrder, ...columns.map(column => column.id), ...Object.keys(config.aggregationFns ?? {})])];
  return dataFieldsOf(order, config).map(sourceFieldId => {
    const aggregation = aggregationOf(config, sourceFieldId);
    return { id: sourceFieldId, sourceFieldId, ...(aggregation === undefined ? {} : { aggregation }) };
  });
}
