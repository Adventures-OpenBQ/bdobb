// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { CellFormat } from "../format";
import type { Row } from "../tableColumns";
import type { AggName, Bucket, ColumnSpec } from "../types";

/** Structural group metadata preserves the source field and typed member value. */
export type DatasetGroupMember = {
  field: string;
  categoryId?: string;
  sourceBindingId?: string;
  transform?: 'native' | 'Y' | 'Q' | 'M' | 'FY' | 'FQ';
  value: CloneSafeValue;
  memberKey?: string;
  label?: string;
  bucket?: Bucket;
};
/** Generic structured descriptors can cross a worker boundary without executable code. */
export type CloneSafeValue = null | undefined | string | number | boolean | bigint
  | CloneSafeValue[] | { [key: string]: CloneSafeValue };
export type DatasetCellError = { code: string; message: string; definitionId?: string; dependencyIds?: string[]; affectedRecordCount?: number; recordPreview?: string[] };
export type DatasetRow = { id: string; values: Row; groupPath?: DatasetGroupMember[]; cellErrors?: Record<string, DatasetCellError>; cellFormats?: Record<string, CellFormat> };
/** Compact, revision-qualified warning observation; periodCount is not full bounds evidence. */
export type DatasetModelWarning = {
  code: import('../tableModel/types').ModelWarning['code'];
  message: string;
  categoryId?: string;
  periodCount: number;
  origin: { widgetId: string; input: number; model: number; output: number };
};
export type DatasetColumn = {
  /** Description of this presented value, never an executable upstream definition. */
  analytical?: { kind: 'formula' | 'category'; definitionId: string; name: string;
    scope?: 'source' | 'aggregate'; transform?: 'native' | 'Y' | 'Q' | 'M' | 'FY' | 'FQ'; valueKind?: 'number' };

  id: string;
  label: string;
  dtype?: ColumnSpec["cellDataType"];
  /** Declarative formatter name/precision; never a callback. */
  format?: CellFormat;
  sourceFieldId?: string;
  /** Measure instance in the producing table, independent of origin metadata. */
  measureId?: string;
  /** Current input column ID read by the producing table. */
  sourceBindingId?: string;
  splitPath?: DatasetGroupMember[];
  aggregation?: AggName;
  metadata?: { [key: string]: CloneSafeValue };
};
export type DatasetProvenance = {
  /** Immediate selected input scope, separate from original acquisition bounds. */
  presentation?: { scope: 'presented'; rowCount: number; revision: { widgetId: string; input: number; model: number; output: number } };
  sourceWidgetId: string;
  sourceKind?: string;
  inputMayContainAggregates?: boolean;
  sample?: string;
  lineage?: { widgetId: string; resultRevision: number; outputRevision: number }[];
  receipt?: { [key: string]: CloneSafeValue };
  parameters?: { [key: string]: CloneSafeValue };
  metadata?: { [key: string]: CloneSafeValue };
};
export type DatasetCompleteness = {
  kind: "complete" | "partial" | "sample" | "bounded" | "paged" | "unknown";
  acquiredRowCount?: number;
  totalRowCount?: number;
  totalRowCountKind?: "exact" | "estimated";
  warnings: string[];
};
export type DatasetFreshness = {
  availability: "available" | "unavailable" | "loading" | "updating" | "blocked" | "error";
  stale: boolean;
  lastSuccessAt?: number;
  error?: string;
  diagnostics?: string[];
};
/** Full worker input/subset/chart transfer payload, not main-thread publication state. */
export type WidgetDataset = {
  modelWarnings?: DatasetModelWarning[];
  modelWarningCount?: number;
  diagnostics?: { code: string; message: string; severity: "info" | "warning" | "error" }[];
  rows: DatasetRow[];
  columns: DatasetColumn[];
  resultRevision: number;
  outputRevision: number;
  provenance: DatasetProvenance;
  completeness: DatasetCompleteness;
  freshness: DatasetFreshness;
};
export type LinkedSource = { kind: "widget"; sourceWidgetId: string };
export type LinkedChartSettings = {
  type: "bar" | "column" | "line";
  category?: string;
  measures: string[];
  display: "grouped" | "stacked";
};
