// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { compileStatement, StatementCompilationError } from '../statementModel/compile';
import type { StatementIntent } from '../statementModel/types';
import { unpivotDatasetWithDescriptors } from '../tableModel/unpivot';
import { validateRuntimeParams, runtimeMatches, type RuntimeParams } from './runtimeParams';
import { countColumn, countValues } from './counts';
import { calculateTable, compactCellError } from '../tableModel/calculate';
import { validateTableModel as validateDefinition } from './validation';
import { createTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, type ColumnDef } from '@tanstack/react-table';
import { detectPeriodicity } from "../periodicity";
import { accessorFor, filterFnFor, filterKindFor } from '../tableFiltering';
import { activeLists, EMPTY_PIVOT } from '../pivotConfig';
import { resolveMeasures } from '../tableModel/measureMigration';
import { pivotTable, KEY_SEP, LABEL_FIELD } from '../pivotTable';
import { groupIdentity } from '../widgetData/identity';
import { pivotValueKey, pivotFoldWarnings } from '../pivotKeys';
import type { TableColumn } from '../tableColumns';
import type { WidgetDataset, DatasetColumn, DatasetRow, DatasetGroupMember, CloneSafeValue } from '../widgetData/types';
import type { CalculatedView, TableDefinition, SelectionSpec, LogicalGroup } from './types';
import { ExecutionProtocolError } from './validation';
import { selectPresentedRows } from './selection';
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
function member(key: string, field: string, bucket: DatasetGroupMember['bucket']): DatasetGroupMember {
  const [tag, value] = JSON.parse(key) as [
    string,
    CloneSafeValue
  ];
  const decoded = tag === 'bigint' ? BigInt(value as string) : tag === 'number' && typeof value === 'string' ? Number(value) : value;
  return { field, value: decoded, memberKey: key, bucket };
}
/** Calculate once from the complete acquired input, never from delivery blocks. */
export function calculateView(input: WidgetDataset, definition: TableDefinition, selection: SelectionSpec, reconcileMissing = true, previousSelectionNamespace?: string, provenAbsentIds: string[] = [], runtimeParams?: RuntimeParams): CalculatedView {
  return calculate(input, definition, selection, reconcileMissing, previousSelectionNamespace, provenAbsentIds, validateRuntimeParams(runtimeParams,definition));
}
function calculate(input: WidgetDataset, definition: TableDefinition, selection: SelectionSpec, reconcile: boolean, previousSelectionNamespace?: string, provenAbsentIds: string[] = [], runtimeParams?: RuntimeParams): CalculatedView {
  input = structuredClone(input);
  definition = structuredClone(definition);
  selection = structuredClone(selection);
  if (definition.analytical !== undefined) {
    validateDefinition(definition,selection);
    return calculateAnalyticalView(input,definition,selection,reconcile,previousSelectionNamespace,provenAbsentIds,runtimeParams);
  }
  const state = definition.table;
  const config = state.pivot ?? EMPTY_PIVOT;
  const known = new Set(input.columns.map(c => c.id));
  const inputBindings = [
    ...(config.enabled ? [...config.grouping, ...config.split, ...(config.measures === undefined ? Object.keys(config.aggregationFns ?? {}) : config.measures.map(m => m.sourceFieldId))] : []),
    ...(state.columnFilters ?? []).map(filter => filter.id),
  ];
  const missingInput = inputBindings.filter(field => !known.has(field));
  if (missingInput.length)
    throw new ExecutionProtocolError('MISSING_FIELD', `Missing source field: ${[...new Set(missingInput)].join(', ')}; restore field or edit definition`);
  const lists = activeLists(config, known);
  const visibleSources = input.columns.filter(column => !state.hidden?.includes(column.id));
  const measures = resolveMeasures({ ...config, ...lists }, [], visibleSources.map(column => column.id)).filter(measure => config.measures !== undefined || visibleSources.some(column => column.id === measure.sourceFieldId));
  const dataFields = measures.map(measure => measure.id);
  const validSort = (id: string) => {
    // Input sorts keep their existing pre-pivot scope; generated sorts bind to the output definition.
    const explicitPivot = config.enabled && config.measures !== undefined && lists.grouping.length + lists.split.length > 0;
    if (known.has(id) && (!explicitPivot || lists.grouping.includes(id) || lists.split.includes(id))) return true;
    if (!config.enabled || lists.grouping.length + lists.split.length === 0) return false;
    if (id === LABEL_FIELD) return true;
    if (!lists.split.length) return dataFields.includes(id);
    return dataFields.some(field => {
      const suffix = KEY_SEP + field;
      if (!id.endsWith(suffix)) return false;
      const members = id.slice(0, -suffix.length).split(KEY_SEP);
      return members.length === lists.split.length && members.every(validPivotMemberKey);
    });
  };
  const missingSort = (state.sorting ?? []).filter(sort => !validSort(sort.id)).map(sort => sort.id);
  if (missingSort.length)
    throw new ExecutionProtocolError('MISSING_FIELD', `Missing source field or output sort binding: ${missingSort.join(', ')}; restore field or edit definition`);
  const columns: TableColumn[] = input.columns.map(c => ({ field: c.id, header: c.label, cellDataType: c.dtype, format: c.format, renderFn: [], colorRules: [], hiddenByDefault: false }));
  const values = input.rows.map(r => r.values);
  const kinds = new Map(columns.map(c => [c.field, filterKindFor(c, values)]));
  const defs: ColumnDef<DatasetRow>[] = columns.map(c => ({
    id: c.field,
    accessorFn: r => accessorFor(c)(r.values),
    filterFn: filterFnFor(kinds.get(c.field) ?? 'none') as ColumnDef<DatasetRow>['filterFn'],
    sortingFn: (a, b, id) => {
      const x = a.getValue(id), y = b.getValue(id);
      const xm = x == null, ym = y == null;
      const desc = state.sorting?.find(s => s.id === id)?.desc ?? false;
      if (xm || ym) return xm === ym ? 0 : xm !== desc ? 1 : -1;
      return kinds.get(id) === 'number' && typeof x === 'number' && typeof y === 'number'
        ? x - y : collator.compare(String(x), String(y));
    },
    sortUndefined: false,
  }));
  const table = createTable<DatasetRow>({
    data: input.rows,
    columns: defs,
    state: {
      columnFilters: (state.columnFilters ?? []).filter(f => known.has(f.id)),
      sorting: (state.sorting ?? []).filter(s => known.has(s.id)),
    },
    onStateChange: () => {},
    renderFallbackValue: undefined,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const search = definition.search.toLowerCase();
  const filtered = table.getFilteredRowModel().rows.map(r => r.original).filter(r => !search || columns.some(c => String(accessorFor(c)(r.values) ?? '').toLowerCase().includes(search)));
  const hidden = new Set(state.hidden ?? []);
  const order = [...(state.columnOrder ?? []), ...input.columns.map(c => c.id)].filter((f, i, a) => known.has(f) && !hidden.has(f) && a.indexOf(f) === i);
  const base = { rows: filtered.map(r => r.values), columns, kinds, order, config: { ...config, expanded: true as const }, sorting: state.sorting ?? [] };
  const result = pivotTable(base);
  if (result && !result.ok)
    throw new ExecutionProtocolError('INVALID_REQUEST', result.reason);
  const signature = JSON.stringify(lists.grouping.map(f => [f, config.buckets?.[f] ?? 'native']));
  const selectionNamespace = result?.ok ? lists.grouping.length ? signature : JSON.stringify([lists, config.buckets ?? {}]) : undefined;
  let logicalRows: DatasetRow[] = [];
  const groups: LogicalGroup[] = [];
  let eligible: DatasetRow[] = [];
  let outputColumns = input.columns.filter(c => order.includes(c.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  if (result?.ok) {
    outputColumns = result.columns.map(c => {
      const source = input.columns.find(s => s.id === (c.source ?? c.field));
      const splitKeys = c.splitKeys ?? [];
      return countColumn({
        ...source,
        id: c.field,
        label: c.header,
        sourceFieldId: source?.sourceFieldId ?? c.source,
        aggregation: c.aggregation,
        measureId: c.measureId,
        sourceBindingId: c.source,
        splitPath: splitKeys.length
          ? splitKeys.map((key, i) => member(key, lists.split[i], config.buckets?.[lists.split[i]]))
          : source?.splitPath,
      });
    });
    const byPath = new Map<string, LogicalGroup>();
    const originals = new Map(filtered.map(r => [r.values, r]));
    const stack: LogicalGroup[] = [];
    result.rows.forEach((values, i) => {
      const meta = result.meta[i];
      if (meta.kind === 'group') {
        const keys = meta.path.split(KEY_SEP);
        const path = keys.map((_, j) => groupIdentity(keys.slice(0, j + 1).join(KEY_SEP), signature));
        const row: DatasetRow = { id: path[path.length - 1], values: countValues(values, outputColumns), groupPath: keys.map((key, j) => member(key, lists.grouping[j], config.buckets?.[lists.grouping[j]])) };
        const node: LogicalGroup = { id: row.id, path, rows: [row], children: [] };
        byPath.set(meta.path, node);
        const parent = keys.length > 1 ? byPath.get(keys.slice(0, -1).join(KEY_SEP)) : undefined;
        if (parent)
          parent.children.push(node);
        else
          groups.push(node);
        stack[meta.depth] = node;
        stack.length = meta.depth + 1;
        logicalRows.push(row);
      }
      else if (meta.kind === 'leaf') {
        const original = meta.sourceIndex === undefined ? originals.get(values)! : filtered[meta.sourceIndex];
        const row = values === original.values ? original : { ...original, values };
        logicalRows.push(row);
        stack[stack.length - 1]?.rows.push(row);
      }
      else {
        // Split-only pivots have one logical aggregate, distinct from a pinned total.
        const row = { id: groupIdentity('', selectionNamespace!), values: countValues(values, outputColumns) };
        logicalRows.push(row);
        eligible.push(row);
      }
    });
    const deepest = (g: LogicalGroup) => { if (g.children.length)
      g.children.forEach(deepest);
    else
      eligible.push(g.rows[0]); };
    groups.forEach(deepest);
  }
  else {
    const survivors = new Set(filtered);
    logicalRows = table.getSortedRowModel().rows.map(r => r.original).filter(r => survivors.has(r));
    eligible = logicalRows;
  }
  if (filtered.length === 0) {
    logicalRows = [];
    eligible = [];
  }
  const total = pivotTable({ ...base, aggregateOnly: true, config: { ...config, enabled: true, grouping: [] }, sorting: [] });
  const facets = Object.fromEntries(input.columns.map(c => {
    const counts = new Map<string, number>();
    for (const row of filtered) {
      const key = String(Object.hasOwn(row.values, c.id) ? row.values[c.id] : '');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [c.id, { scope: 'filtered' as const, values: Object.fromEntries(counts) }];
  }));
  // The UI gets declarative schema hints inferred over the complete worker input.
  const withKind = (column: DatasetColumn, binding = column.id): DatasetColumn => {
    const kind = kinds.get(binding);
    return column.dtype !== undefined || kind === undefined || kind === 'none'
      ? column : { ...column, dtype: kind };
  };
  const view: CalculatedView = {
    modelWarnings: input.modelWarnings, modelWarningCount: input.modelWarningCount,
    inputColumns: input.columns.map(column => withKind(column)), inputPeriodicity: Object.fromEntries(input.columns.filter(c => kinds.get(c.id) === 'date').map(c => [c.id, detectPeriodicity(input.rows.map(r => r.values[c.id]))])), columns: outputColumns.map(column => withKind(column, result?.ok ? column.sourceBindingId ?? column.id : column.id)),
    logicalRows, groups, selectionEligibleRows: eligible, selection, selectionNamespace, selectionHierarchy: new Map(), selectionIdentityRows: [],
    presentedRows: [], definition, freshness: input.freshness, facets,
    totals: {
      scope: 'filtered',
      values: filtered.length > 0 && total?.ok
        ? countValues(Object.fromEntries(Object.entries(total.rows[0] ?? {}).filter(([k]) => k !== '\x1egroup')) as Record<string, CloneSafeValue>, total.columns.map(c => ({ id: c.field, label: c.header, aggregation: c.aggregation })))
        : {},
    },
    diagnostics: [...(input.diagnostics ?? []), ...pivotFoldWarnings(config).map(message => ({ code: 'LEGACY_FOLDS', message, severity: 'warning' as const }))],
    completeness: input.completeness,
    provenance: { ...input.provenance, ...(result?.ok ? { inputMayContainAggregates: true } : {}) },
  };
  // Reconciliation uses the unfiltered source hierarchy, never delivery blocks or
  // filtered survivors. The private second calculation cannot recursively reconcile.
  const universe = (definition.search || state.columnFilters?.length)
    ? calculate(input, { ...definition, search: '', table: { ...state, columnFilters: [] } }, { kind: 'none' }, false) : view;
  // Chart bindings retain observed split identities even when local filters hide them.
  // The presented table schema and values still contain only current survivors.
  if (lists.split.length) view.chartColumns = universe.columns;
  const identities: DatasetRow[] = [];
  const visit = (group: LogicalGroup): string[] => {
    identities.push(group.rows[0]);
    const descendants = group.children.flatMap(child => [child.id, ...visit(child)]);
    view.selectionHierarchy.set(group.id, descendants);
    return descendants;
  };
  universe.groups.forEach(visit);
  view.selectionIdentityRows = universe.groups.length ? identities : universe.selectionEligibleRows;
  return reconcileView(view,selection,reconcile,previousSelectionNamespace,provenAbsentIds);
}
function reconcileView(view: CalculatedView, selection: SelectionSpec, reconcile: boolean, previousSelectionNamespace?: string, provenAbsentIds: string[] = []): CalculatedView {
  const selectionNamespace = view.selectionNamespace;
  if (selection.kind !== 'none') {
    const knownIds = new Set(view.selectionIdentityRows.map(row => row.id));
    const absent = new Set(provenAbsentIds);
    const original = [...new Set(selection.kind === 'explicit' ? selection.ids : selection.excludedIds)];
    const retained = original.filter(id => {
      if (knownIds.has(id)) return true;
      if (reconcile || absent.has(id)) return false;
      const namespace = groupNamespace(id);
      // A current pivot defines exactly which ID namespace it can generate.
      // Compatible absent IDs may still be hidden upstream and must survive.
      if (selectionNamespace !== undefined) return namespace === selectionNamespace;
      // Ordinary linked input can itself contain upstream group IDs. Only a
      // prior locally generated namespace proves a pivot-off incompatibility.
      return previousSelectionNamespace === undefined || namespace !== previousSelectionNamespace;
    });
    if (retained.length < original.length) {
      selection = selection.kind === 'explicit'
        ? retained.length ? { kind: 'explicit', ids: retained } : { kind: 'none' }
        : { kind: 'allMatching', excludedIds: retained };
      view.diagnostics.push({ code: 'SELECTION_RECONCILED', severity: 'info', message: `${original.length - retained.length} selection identities removed because they are no longer available in this arrangement.` });
    }
  }
  if (selection.kind === 'explicit') {
    const ids = [...new Set(selection.ids)];
    const covered = new Set(ids.flatMap(id => view.selectionHierarchy.get(id) ?? []));
    selection = { kind: 'explicit', ids: ids.filter(id => !covered.has(id)) };
  } else if (selection.kind === 'allMatching') selection = { kind: 'allMatching', excludedIds: [...new Set(selection.excludedIds)] };
  view.selection = selection;
  view.presentedRows = selectPresentedRows(view, selection);
  return view;
}

/** Generated member sorts remain bound while their member has no current rows. */
function validPivotMemberKey(key: string): boolean {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [tag, content] = value;
    if (tag === 'blank') return content === null && key === pivotValueKey(null);
    if (tag === 'string' || tag === 'boolean') return typeof content === tag && key === pivotValueKey(content);
    if (tag === 'number') {
      const number = typeof content === 'number' ? content : content === 'NaN' ? NaN : content === 'Infinity' ? Infinity : content === '-Infinity' ? -Infinity : undefined;
      return number !== undefined && key === pivotValueKey(number);
    }
    if (tag === 'bigint' && typeof content === 'string') return key === pivotValueKey(BigInt(content));
    // Legacy object-valued dimensions are encoded as their type and display string.
    return tag === 'object' && typeof content === 'string' && key === JSON.stringify(value);
  } catch { return false; }
}

/** Read only the typed local group namespace; never infer origin from a prefix. */
function groupNamespace(id: string): string | undefined {
  try {
    const value: unknown = JSON.parse(id);
    return Array.isArray(value) && value.length === 3 && value[0] === 'group'
      && typeof value[1] === 'string' && typeof value[2] === 'string' ? value[1] : undefined;
  } catch { return undefined; }
}

/** Adapt the single private analytical result to existing bounded delivery and selection. */
function calculateAnalyticalView(input: WidgetDataset, definition: TableDefinition, selection: SelectionSpec, reconcile: boolean, previousSelectionNamespace?: string, provenAbsentIds: string[] = [], runtimeParams?: RuntimeParams): CalculatedView {
  const statement = (definition.analytical as {schemaVersion?:number})?.schemaVersion === 2 ? definition.analytical as StatementIntent : undefined;
  const effective = statement ? compileStatement(statement,input.columns) : undefined;
  let source = input;
  if (effective && statement) {
    if (input.rows.some(row=>row.values[statement.bindings.periodKindFieldId]!==statement.periodKind)) throw new StatementCompilationError([{code:'invalid-structure',severity:'error',path:'periodKind',message:`Source facts must all have the selected ${statement.periodKind} period kind; FY/FQ overlap is not permitted.`}]);
    if (effective.unpivot) { const projectionInput={...input,rows:input.rows.map(row=>({...row,values:{...row.values,...Object.fromEntries(effective.unpivot!.mappings.filter(m=>row.cellErrors?.[m.sourceFieldId]).map(m=>[m.sourceFieldId,null]))}}))};
      const projected=unpivotDatasetWithDescriptors(projectionInput,effective.unpivot);source=projected.dataset;effective.execution.sourceColumnsByRowId=projected.sourceColumnsByRowId; }
    const itemField=effective.unpivot?.itemFieldId??statement.bindings.longFields!.itemFieldId;
    if(source.rows.some(row=>!Object.hasOwn(effective.sectionByLine,String(row.values[itemField])))) throw new StatementCompilationError([{code:'missing-reference',severity:'error',path:'bindings.longFields.itemFieldId',message:'Source line item is not declared in the template; repair the item binding.'}]);
    source={...source,columns:[...source.columns,{id:effective.sectionField,label:'Section'}],rows:source.rows.map(row=>({...row,values:{...row.values,[effective.sectionField]:effective.sectionByLine[String(row.values[itemField])]}}))};
  }
  const result = calculateTable({source,model:effective?.model??definition.analytical,table:definition.table,search:definition.search,runtimeParams,context:{execution:effective?.execution}});
  const diagnosticMap = new Map<string, CalculatedView['diagnostics'][number]>();
  for (const error of result.errors) diagnosticMap.set(JSON.stringify([error.code,error.message]),{code:error.code,message:error.message,severity:'error'});
  for (const warning of result.warnings) diagnosticMap.set(JSON.stringify([warning.code,warning.message]),{code:warning.code,message:warning.message,severity:'warning'});
  const diagnostics = [...result.paramDiagnostics,...(input.diagnostics ?? []),...diagnosticMap.values()].slice(0,100);
  if (diagnosticMap.size > 100) diagnostics.push({code:'ADDITIONAL_ERRORS',message:`${diagnosticMap.size-100} additional diagnostic kinds are retained in the calculation.`,severity:'warning'});
  const values: Record<string,CloneSafeValue> = {};
  const cellErrors: NonNullable<DatasetRow['cellErrors']> = {};
  if (!result.totals.empty) for (const [id,cell] of result.totalCells) {
    Object.defineProperty(values,id,{value:cell.ok ? cell.value : '#ERROR',enumerable:true});
    if (!cell.ok) Object.defineProperty(cellErrors,id,{value:compactCellError(cell.error),enumerable:true});
  }
  const completeness = {...input.completeness,warnings:[...input.completeness.warnings,...result.warnings.map(w=>w.message),...(result.complete?[]:['Calculation is incomplete because required constraints could not be evaluated.'])],...(!result.complete&&input.completeness.kind==='complete'?{kind:'partial' as const}:{})};
  const view: CalculatedView = {paramMatches:runtimeMatches(runtimeParams??{},result.compiled.model,result.pool,result.groupResolutions),modelWarnings:input.modelWarnings,modelWarningCount:input.modelWarningCount,analytical:result,selection,selectionNamespace:result.selectionNamespace,selectionHierarchy:new Map(),selectionIdentityRows:[],inputColumns:statement ? input.columns : result.pool.columns,inputPeriodicity:{},definition,freshness:input.freshness,presentedRows:[],columns:result.columns,logicalRows:result.rows,groups:result.groups,selectionEligibleRows:result.eligibleRows,
    facets:Object.fromEntries(Object.entries(result.facets).map(([id,members])=>[id,{scope:'filtered' as const,values:Object.fromEntries(members.map(m=>[m.key,m.count])),members:members.map(m=>({key:m.key,label:m.label,value:m.value as CloneSafeValue,count:m.count}))}])),
    totals:{scope:'filtered',values,empty:result.totals.empty,...(Object.keys(cellErrors).length?{cellErrors}:{})},diagnostics,completeness,provenance:result.provenance};
  const model = result.compiled.model;
  if (model.enabled && model.layout.columns.length) {
    const constrained = definition.search || definition.table.columnFilters?.length || model.checklists.length || model.resultFilters.length || model.layout.page || Object.keys(runtimeParams ?? {}).length;
    view.chartColumns = constrained ? calculateTable({ source: input,
      model: { ...model, checklists: [], resultFilters: [], layout: { ...model.layout, page: undefined } },
      table: { ...definition.table, columnFilters: [] }, search: '' }).columns : result.columns;
  }
  const rowCategories = result.compiled.model.enabled ? result.compiled.model.layout.rows : [];
  if (rowCategories.length) {
    const ids = new Map<string,DatasetRow>();
    for (const row of result.pool.universe.rows) {
      const keys: string[] = []; const path: string[] = [];
      for (const categoryId of rowCategories) {
        const member = result.pool.members.get(row.id)?.get(categoryId); if (!member?.ok) break;
        keys.push(member.value.key); const id=groupIdentity(keys.join(KEY_SEP),result.selectionNamespace!); path.push(id); ids.set(id,{id,values:{}});
        for (const ancestor of path.slice(0,-1)) {const children=view.selectionHierarchy.get(ancestor)??[];if(!children.includes(id))children.push(id);view.selectionHierarchy.set(ancestor,children);}
      }
    }
    if(effective) for(const row of result.eligibleRows) ids.set(row.id,row);
    if(effective) { const visit=(nodes:LogicalGroup[])=>{for(const node of nodes){view.selectionHierarchy.set(node.id,node.children.map(c=>c.id));visit(node.children);}};visit(result.groups); }
    view.selectionIdentityRows=[...ids.values()];
  } else view.selectionIdentityRows=result.selectionNamespace===undefined?result.pool.universe.rows:result.eligibleRows;
  return reconcileView(view,selection,reconcile,previousSelectionNamespace,provenAbsentIds);
}
