// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { filterKindFor } from '../tableFiltering';
import { inspectionPage, inspectionCounts } from './inspection';
import { selectionSummary } from './selection';
import { eligiblePresentedRows } from '../widgetData/tableOutput';
import type { CalculatedView, Revision, RowRequest, RowBlock, FacetResult, TotalResult, ChartResult, SubsetBatch, ViewReady, LogicalGroup, ResponseEnvelope, SelectionAction, SelectionResult, InspectionRequest, InspectionResult } from './types';
import type { DatasetRow } from '../widgetData/types';
import { ExecutionProtocolError } from './validation';
export interface ResultStore {
  ready(requestId: string, revision: Revision): ViewReady;
  selection(requestId: string, revision: Revision, action: SelectionAction, visibleIds: string[]): SelectionResult;
  rows(requestId: string, revision: Revision, request: RowRequest): RowBlock;
  facets(requestId: string, revision: Revision, categoryId: string): FacetResult;
  inspect(requestId: string, revision: Revision, request: InspectionRequest): InspectionResult;
  totals(requestId: string, revision: Revision): TotalResult;
  chartData(requestId: string, revision: Revision, fields: string[]): ChartResult;
  presented(requestId: string, revision: Revision, transferId: string, batchSize?: number, ignoreSelection?: boolean): Iterable<SubsetBatch>;
}
/** Private immutable snapshot; no delivery result can mutate later reads. */
export function createResultStore(view: CalculatedView, revision: Revision): ResultStore {
  view = structuredClone(view);
  revision = structuredClone(revision);
  const ownWarnings = view.analytical?.warnings ?? [];
  const modelWarnings = [...(view.modelWarnings ?? []), ...ownWarnings.map(w => ({
    code: w.code, message: w.message.slice(0, 1000), ...(w.categoryId ? { categoryId: w.categoryId } : {}),
    periodCount: w.periods?.length ?? 0, origin: revision,
  }))].slice(0, 100);
  const modelWarningCount = (view.modelWarningCount ?? view.modelWarnings?.length ?? 0) + ownWarnings.length;
  const context = (requestId: string, requested: Revision): ResponseEnvelope => {
    if (!requestId)
      throw new ExecutionProtocolError('INVALID_REQUEST', 'Missing request ID');
    if (['widgetId', 'input', 'model', 'output'].some(k => requested[k as keyof Revision] !== revision[k as keyof Revision]))
      throw new ExecutionProtocolError('REVISION_MISMATCH', 'Requested revision does not match stored revision');
    return { requestId, revision, completeness: view.completeness, diagnostics: view.diagnostics, ...(modelWarningCount ? { modelWarnings, modelWarningCount } : {}) };
  };
  const pivot = view.definition.table.pivot;
  const aggregations = pivot?.measures === undefined ? pivot?.aggregationFns ?? {}
    : Object.fromEntries(pivot.measures.flatMap(measure => measure.aggregation === undefined ? [] : [[measure.id, measure.aggregation]]));
  const rootRows = () => view.groups.length ? view.groups.map(g => g.rows[0]) : view.logicalRows;
  const projection = (rows: DatasetRow[], fields: string[]) => rows.map(r => ({ ...r, ...(r.cellFormats ? {cellFormats:Object.fromEntries(Object.entries(r.cellFormats).filter(([id])=>fields.includes(id)&&Object.hasOwn(r.values,id)))} : {}), ...(r.cellErrors ? {cellErrors:Object.fromEntries(Object.entries(r.cellErrors).filter(([id])=>fields.includes(id)))} : {}), values: Object.fromEntries(fields.filter(f => Object.hasOwn(r.values, f)).map(f => [f, r.values[f]])) }));
  const sourceValues=(view.analytical?.pool.universe.rows??view.selectionIdentityRows).map(row=>row.values);
  const statement = (view.definition.analytical as {kind?:string})?.kind === 'statement';
  const inputColumns=(statement ? view.inputColumns : view.analytical?.compiled.columns??view.inputColumns).map(column=>{
    if(column.dtype)return column;
    const kind=filterKindFor({field:column.id,header:column.label,renderFn:[],colorRules:[],hiddenByDefault:false},sourceValues);
    return kind==='none'?column:{...column,dtype:kind==='date'?'dateString' as const:kind};
  });
  return {
    ready(requestId, requested) { return structuredClone({ ...context(requestId, requested), kind: 'viewReady', selection: view.selection, selectionNamespace: view.selectionNamespace, columns: view.columns, ...(view.chartColumns ? { chartColumns: view.chartColumns } : {}), topLevelCount: rootRows().length, inspection: { inputColumns, inputPeriodicity: view.inputPeriodicity, definition: view.definition, aggregations, counts: inspectionCounts(view), ...(view.paramMatches ? {paramMatches:view.paramMatches} : {}) } }); },
    selection(requestId, requested, action, visibleIds) { return structuredClone({ ...context(requestId, requested), kind: 'selection', ...selectionSummary(view, action, visibleIds) }); },
    rows(requestId, requested, request) {
      const envelope = context(requestId, requested);
      if (!Number.isSafeInteger(request.offset) || request.offset < 0 || !Number.isSafeInteger(request.limit) || request.limit < 0)
        throw new ExecutionProtocolError('INVALID_REQUEST', 'Row range must be nonnegative safe integers');
      let siblings = rootRows();
      let children = view.groups;
      let group: LogicalGroup | undefined;
      for (const id of request.groupPath) {
        group = children.find(g => g.id === id);
        if (!group)
          throw new ExecutionProtocolError('INVALID_REQUEST', 'Unknown group path');
        children = group.children;
      }
      if (group)
        siblings = group.children.length ? group.children.map(g => g.rows[0]) : group.rows.slice(1);
      return structuredClone({ ...envelope, kind: 'rows', selection: selectionSummary(view, { kind: 'summary' }, siblings.slice(request.offset, request.offset + request.limit).map(row => row.id)), groupPath: request.groupPath, offset: request.offset, rows: projection(siblings.slice(request.offset, request.offset + request.limit), view.columns.map(c => c.id)), siblingCount: siblings.length, groups: children.slice(request.offset, request.offset + request.limit).map(g => ({ rowId: g.rows[0].id, path: g.path, childCount: g.children.length || g.rows.length - 1 })) });
    },
    facets(requestId, requested, categoryId) { const envelope = context(requestId, requested); const facet = view.facets[categoryId]; if (!Object.hasOwn(view.facets, categoryId))
      throw new ExecutionProtocolError('INVALID_REQUEST', `Unknown facet ${categoryId}`); return structuredClone({ ...envelope, ...facet, kind: 'facets', categoryId }); },
    inspect(requestId, requested, request) { return structuredClone({ ...context(requestId, requested), ...inspectionPage(view, request), kind: 'inspect' }); },
    totals(requestId, requested) { return structuredClone({ ...context(requestId, requested), ...view.totals, kind: 'totals' }); },
    chartData(requestId, requested, fields) { const envelope = context(requestId, requested); if (fields.some(f => !view.columns.some(c => c.id === f)))
      throw new ExecutionProtocolError('INVALID_REQUEST', 'Unknown chart field'); return structuredClone({ ...envelope, kind: 'chartData', columns: view.columns.filter(c => fields.includes(c.id)), rows: projection(view.presentedRows, fields), resultRevision: revision.model, outputRevision: revision.output, provenance: view.provenance, freshness: view.freshness }); },
    presented(requestId, requested, transferId, batchSize = 500, ignoreSelection = false) {
      const envelope = context(requestId, requested);
      if (!transferId || !Number.isSafeInteger(batchSize) || batchSize < 1)
        throw new ExecutionProtocolError('INVALID_REQUEST', 'Transfer ID and positive safe batch size required');
      const rows = projection(ignoreSelection ? eligiblePresentedRows(view) : view.presentedRows, view.columns.map(c => c.id));
      return (function* () { for (let offset = 0, sequence = 0; offset < Math.max(1, rows.length); offset += batchSize, sequence++)
        yield structuredClone({ ...envelope, kind: 'subset' as const, transferId, sequence, ...(sequence === 0 ? { columns: view.columns, provenance: { ...view.provenance, presentation: { scope: 'presented' as const, rowCount: rows.length, revision } }, freshness: view.freshness } : {}), rows: rows.slice(offset, offset + batchSize), final: offset + batchSize >= rows.length }); })();
    },
  };
}
