// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bucketOf } from '../pivotConfig';
import type { PivotConfig } from '../types';
import type { DatasetColumn } from '../widgetData/types';
import { resolveMeasures } from './measureMigration';
import type { CategoryDef, TableModelV1 } from './types';

/** Without source context only stored fields can be recovered; no unseen measure is invented. */
export function migratePivot(config: PivotConfig, context: { columns?: DatasetColumn[]; sourceOrder?: string[] } = {}): TableModelV1 {
  const categories: CategoryDef[] = [];
  const ids = new Map<string, string>();
  for (const sourceFieldId of [...config.grouping, ...config.split]) {
    if (ids.has(sourceFieldId)) continue;
    const bucket = bucketOf(config, sourceFieldId);
    const transform = bucket === 'year' ? 'Y' : bucket === 'quarter' ? 'Q' : 'native';
    // Tuple encoding avoids collisions and stays independent of display name and axis.
    const id = `category:${JSON.stringify([sourceFieldId, bucket])}`;
    ids.set(sourceFieldId, id);
    categories.push({ id, name: sourceFieldId, sourceFieldId, transform,
      ...(bucket !== 'native' && bucket !== 'year' && bucket !== 'quarter' ? { legacyBucket: bucket } : {}) });
  }
  const measures = resolveMeasures(config, context.columns ?? [], context.sourceOrder ?? []);
  return {
    schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: config.enabled, categories,
    measures,
    formulas: [],
    layout: { values: measures.map(m => m.id), rows: config.grouping.map(field => ids.get(field)!), columns: config.split.map(field => ids.get(field)!) },
    checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false },
    legacyPivot: structuredClone(config),
  };
}
