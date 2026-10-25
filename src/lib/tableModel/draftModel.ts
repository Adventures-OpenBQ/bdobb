// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { EMPTY_PIVOT } from "../pivotConfig";
import { orderFields, type TableColumn } from "../tableColumns";
import type { TableDefinition } from "../tableExecution/types";
import type { DatasetColumn } from "../widgetData/types";
import { migratePivot } from "./migration";
import type { TableModelV1 } from "./types";

/** What the drawer's "Enable report model" would save for a table with no model yet. */
export function draftModelFor(definition: TableDefinition, inputColumns: readonly DatasetColumn[]): TableModelV1 {
  const config = definition.table.pivot ?? EMPTY_PIVOT;
  const fields = inputColumns.map(c => ({ field: c.id }) as TableColumn);
  const draft = migratePivot({ ...config, enabled: true }, { columns: [...inputColumns], sourceOrder: orderFields(fields, definition.table.columnOrder) });
  // Only measures the user chose: a stored pivot's columns without an aggregation are not Data Columns.
  const measures = draft.measures.filter(m => m.aggregation !== undefined);
  return { ...draft, measures, layout: { ...draft.layout, values: measures.map(m => m.id) } };
}
