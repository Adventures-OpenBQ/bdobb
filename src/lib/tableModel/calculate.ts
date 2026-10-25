// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { AnalyticalExecutionDescriptor } from './executionDescriptor';
import { sliceCategories } from './scopes';
import { observedGroupResolution, type GroupResolution } from './groupResolution';
import { activeRuntimeKeys, effectiveRuntimeModel, type RuntimeParams } from '../tableExecution/runtimeParams';
import { memberLabel, type ParamDiagnostic } from './pivotParams';
import type { DatasetColumn, DatasetRow, CloneSafeValue, DatasetCellError, WidgetDataset } from '../widgetData/types';
import type { TableCardState } from '../types';
import type { TableModelV1, ModelValidation } from './types';
import type { CompiledModel } from './formulaEvaluation';
import { validateFiscalContext, type FiscalContext } from './fiscalContext';
import type { ModelSymbols } from './formulaBinding';
import { validateTableModel } from './validation';
import { validateFormulaGraph } from './formulaGraph';
import { measureLabel } from './measures';
import { dataIds } from './layoutValues';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { eligiblePool, activePage, categoryFacets, type EligiblePool, type MemberFacet } from './facets';
import { calculateTotals, temporalContext, type CalculatedTotals } from './totals';
import { qualifyGroups, type CalculatedGroup } from './resultFilters';
import { pivotTable, compareSorted, KEY_SEP, LABEL_FIELD } from '../pivotTable';
import { prepareCategoryPivot } from './categories';
import { groupIdentity } from '../widgetData/identity';
import type { CellResult, ModelError, ModelWarning } from './types';
import { scopeErrors, type CalculationScope, type ContextSlice } from './scopes';
import type { LogicalGroup } from '../tableExecution/types';
export type AnalyticalModel = CompiledModel & {
    validation: ModelValidation;
    model: TableModelV1;
};
export type CompilationContext = {
    columns: readonly DatasetColumn[];
    fiscal?: FiscalContext;
    execution?: AnalyticalExecutionDescriptor;
};
/** Committed ASTs retain ID bindings. This compiler never reparses display expressions. */
export function compileAnalyticalModel(raw: unknown, context?: CompilationContext): AnalyticalModel {
    const validation = validateTableModel(raw);
    // Unsafe or unsupported input never reaches subsequent property reads.
    const guarded = validation.categories.length || validation.measures.length || validation.formulas.length || validation.model || (validation.diagnostics.length && !validation.diagnostics.some(d => d.path === '' || d.path === 'schemaVersion'));
    const data = guarded ? raw as TableModelV1 : undefined;
    const categories = validation.categories.flatMap(e => e.value ? [e.value] : []);
    const measures = validation.measures.flatMap(e => e.value ? [e.value] : []);
    const headers = validation.formulas.flatMap(e => {
        const f = e.raw as Partial<TableModelV1['formulas'][number]> | null;
        return f && typeof f.id === 'string' && typeof f.name === 'string' && (f.scope === 'source' || f.scope === 'aggregate') ? [{ id: f.id, name: f.name, scope: f.scope }] : [];
    });
    const columns = [...context?.columns ?? []];
    const symbols: ModelSymbols = { fields: columns.map(c => ({ id: c.id, name: c.label })), formulas: headers,
        measures: measures.map(m => { const name = columns.find(c => c.id === m.sourceFieldId)?.label ?? headers.find(f => f.id === m.sourceFieldId)?.name ?? m.sourceFieldId; return { ...m, name: measureLabel(m, name, measures), aliases: [name, ...(m.customLabel === undefined ? [] : [m.customLabel])] }; }),
        categories: categories.map(c => ({ ...c, members: [] })) };
    const graph = validateFormulaGraph(validation.formulas.map(e => e.raw), context ? symbols : undefined, { boundMembers: 'structural' });
    const safeControl = (key: string) => !validation.diagnostics.some(d => d.code === 'invalid-structure' && (d.path === key || d.path.startsWith(`${key}.`)));
    const model: TableModelV1 = { schemaVersion: 1, params: data && !validation.diagnostics.some(d => d.path === 'params' || d.path.startsWith('params.')) ? data.params : { promotePage: false, filters: [] }, enabled: data && typeof data.enabled === 'boolean' ? data.enabled : false, categories, measures, formulas: graph.entries.flatMap(e => e.value ? [e.value] : []),
        layout: data && safeControl('layout') ? data.layout : { rows: [], columns: [], values: [] },
        checklists: data && safeControl('checklists') ? data.checklists : [], resultFilters: data && safeControl('resultFilters') ? data.resultFilters : [],
        subtotals: data && safeControl('subtotals') ? data.subtotals : { grandTotal: true, groups: true } };
    return { execution: context?.execution, graph, symbols, categories, columns, fiscal: context?.fiscal ?? {}, validation, model };
}
export type CalculatedTable = {
    paramDiagnostics: ParamDiagnostic[];
    groupResolutions: Record<string,GroupResolution>;
    compiled: AnalyticalModel;
    pool: EligiblePool;
    recordIds: Set<string>;
    groups: LogicalGroup[];
    rows: DatasetRow[];
    columns: DatasetColumn[];
    totals: CalculatedTotals;
    totalCells: Map<string, CellResult>;
    facets: Record<string, MemberFacet[]>;
    errors: ModelError[];
    warnings: ModelWarning[];
    complete: boolean;
    selectionNamespace?: string;
    eligibleRows: DatasetRow[];
    provenance: WidgetDataset['provenance'];
};
// Rows bucketed by one category's member key, per pool and (never mutated) rows array: one group no longer rescans every row.
const rowIndexes = new WeakMap<EligiblePool, WeakMap<DatasetRow[], Map<string, Map<string, DatasetRow[]>>>>();
function scopeRows(rows: DatasetRow[], pool: EligiblePool, constraints: ReadonlyMap<string, string>): DatasetRow[] {
    const matches = (row: DatasetRow) => [...constraints].every(([id, key]) => { const member = pool.members.get(row.id)?.get(id); return member?.ok && member.value.key === key; });
    const first = constraints.keys().next().value;
    if (first === undefined) return rows.filter(matches);
    let byRows = rowIndexes.get(pool); if (!byRows) { byRows = new WeakMap(); rowIndexes.set(pool, byRows); }
    let byCategory = byRows.get(rows); if (!byCategory) { byCategory = new Map(); byRows.set(rows, byCategory); }
    let byKey = byCategory.get(first);
    if (!byKey) {
        byKey = new Map();
        for (const row of rows) { const member = pool.members.get(row.id)?.get(first); if (member?.ok) { const bucket = byKey.get(member.value.key); if (bucket) bucket.push(row); else byKey.set(member.value.key, [row]); } }
        byCategory.set(first, byKey);
    }
    return (byKey.get(constraints.get(first)!) ?? []).filter(matches);
}
function partitions(rows: DatasetRow[], pool: EligiblePool, ids: string[]): Map<string, string>[] {
    const result = new Map<string, Map<string, string>>();
    for (const row of rows) {
        const pairs = ids.map(id => [id, pool.members.get(row.id)?.get(id)] as const);
        if (pairs.some(([, member]) => !member?.ok))
            continue;
        const constraints = new Map(pairs.map(([id, member]) => [id, member!.ok ? member!.value.key : '']));
        result.set(JSON.stringify([...constraints]), constraints);
    }
    return [...result.values()];
}
export function compactCellError(error: ModelError): DatasetCellError { return { code: error.code, message: error.message.slice(0, 1000), ...(error.definitionId ? { definitionId: error.definitionId } : {}), ...(error.dependencyIds ? { dependencyIds: error.dependencyIds.slice(0, 20) } : {}), ...(error.recordIds ? { affectedRecordCount: error.recordIds.length, recordPreview: error.recordIds.slice(0, 5) } : {}) }; }
export function calculateTable(input: {
    source: WidgetDataset;
    model: unknown;
    table: TableCardState;
    search: string;
    runtimeParams?: RuntimeParams;
    context?: Omit<CompilationContext, 'columns'> & {
        temporalContext?: CalculationScope['temporalContext'];
    };
}): CalculatedTable {
    const fiscal = validateFiscalContext(input.context?.fiscal ?? input.source.provenance.metadata?.fiscalContext);
    const compiled = compileAnalyticalModel(input.model, { columns: input.source.columns, fiscal: fiscal.context, execution: input.context?.execution });
    const authored = compiled.model;
    const execution = compiled.execution;
    const evaluated = evaluateSourceFormulas(input.source.rows, compiled);
    const groupResolutions:Record<string,GroupResolution>={};
    const resolvedRuntime:RuntimeParams={};
    for(const [key,entry] of Object.entries(input.runtimeParams??{})){
      if(entry.source==='viewer'){resolvedRuntime[key]=entry;continue;}
      const category=activeRuntimeKeys(authored).get(key);if(!category)throw new Error('Unknown or dormant promoted runtime key');
      const result=observedGroupResolution(entry.transportValue,authored,category,evaluated);groupResolutions[key]=result;
      if(result.status==='resolved')resolvedRuntime[key]={source:'viewer',memberKeys:result.keys};
    }
    const runtime=effectiveRuntimeModel(authored,resolvedRuntime);
    const effective=runtime.model;
    const enabled = authored.enabled;
    // Effective report controls are dormant off; retained compiled definitions
    // remain the authority for inspection and source formula evaluation.
    const model = enabled ? effective : { ...effective, layout: { ...effective.layout, rows: [], columns: [], page: undefined }, resultFilters: [], subtotals: { grandTotal: false, groups: false } };
    const memberDescriptor = (id: string) => { const category = model.categories.find(c => c.id === id); return category ? { sourceBindingId: category.sourceFieldId, transform: category.transform, ...(category.legacyBucket ? { bucket: category.legacyBucket } : {}) } : {}; };
    const constraintColumns = [...evaluated.columns, ...model.categories.filter(c => enabled || input.table.columnFilters?.some(filter => filter.id === c.id)).map(c => ({ id: c.id, label: c.name }))];
    const constraints = { columns: constraintColumns, table: input.table, search: input.search, checklists: model.checklists };
    const pool = eligiblePool(evaluated, constraints);
    const page = activePage(pool, model.layout.page);
    const paramDiagnostics: ParamDiagnostic[] = Object.entries(groupResolutions).flatMap<ParamDiagnostic>(([key,result])=>result.status==='refused'||!result.classificationComplete?[{code:'PIVOT_PARAM_REFUSED' as const,key,memberKeys:[],unmatchedCount:0,truncated:false,severity:'warning' as const,message:result.status==='refused'?`Group filter refused: ${result.reason}. Authored selection retained.`:'Group domain is incomplete; unobserved values are unknown.'}]:result.unmatched.length?[{code:'PIVOT_PARAM_UNMATCHED' as const,key,memberKeys:result.unmatched.slice(0,8).map(v=>v.slice(0,256)),unmatchedCount:result.unmatched.length,truncated:result.unmatched.length>8||result.unmatched.some(v=>v.length>256),severity:'warning' as const,message:`${result.unmatched.length} group values are absent from acquired input.`}]:[]);
    const selections = [...model.checklists.map(c => ({ categoryId:c.categoryId, keys:c.memberKeys, key:`pivot:filter:${c.categoryId}` })), ...(model.layout.page ? [{categoryId:model.layout.page.categoryId,keys:model.layout.page.memberKeys,key:'pivot:page'}] : [])];
    for (const selection of selections.slice(0,64)) {
      const observed=pool.observedMembers.get(selection.categoryId); const eligible=pool.eligibleMembers.get(selection.categoryId);
      if(!observed || !pool.classificationComplete)continue;
      const membershipComplete=pool.universe.rows.every(row=>pool.universe.members.get(row.id)?.get(selection.categoryId)?.ok===true);
      const absent=membershipComplete?selection.keys.filter(key=>!observed.has(key)):[];
      const excluded=selection.keys.filter(key=>observed.has(key)&&!eligible?.has(key));
      const missing=absent.length?absent:excluded;
      const code=absent.length?'PIVOT_PARAM_UNMATCHED':selection.keys.length===0?'PIVOT_PARAM_EMPTY':excluded.length===selection.keys.length?'PIVOT_PARAM_EXCLUDED':undefined;
      if(!code)continue;
      const label=(authored.params.filters.find(p=>p.categoryId===selection.categoryId)?.label ?? model.categories.find(c=>c.id===selection.categoryId)?.name ?? selection.categoryId).slice(0,128);
      const values=missing.slice(0,3).map(key=>memberLabel(key).slice(0,128)).join(', ');
      paramDiagnostics.push({code,key:selection.key.slice(0,512),memberKeys:missing.slice(0,8).map(key=>key.slice(0,256)),unmatchedCount:missing.length,truncated:selection.key.length>512||missing.length>8||missing.some(key=>key.length>256),severity:'warning',message:code==='PIVOT_PARAM_EMPTY'?`No rows: ${label} has no selected values.`:code==='PIVOT_PARAM_EXCLUDED'?`No rows: ${label} = ${values} is excluded by source constraints.`:`${label} = ${values}${missing.length>3?'…':''} is not in this data.`});
    }

    const errors: ModelError[] = [...(fiscal.error ? [fiscal.error] : []), ...page.errors, ...compiled.validation.diagnostics.filter(d => d.severity === 'error').map(d => ({ code: 'missing-reference' as const, message: d.message, definitionId: d.definitionId }))];
    const warnings = [...pool.warnings];
    const temporal = input.context?.temporalContext ?? temporalContext(compiled);
    // Source qualification is required even when no records survive. This diagnostic
    // scope retains the explicit page/company constraints, never survivor slices.
    const sourceQualificationErrors = scopeErrors(pool, {sourceRecordIds: new Set(), categoryConstraints: new Map(), page: model.layout.page, temporalContext: temporal});
    errors.push(...sourceQualificationErrors);
    const contextIds = [...new Set([...model.layout.rows, ...model.layout.columns, ...model.resultFilters.map(f => f.categoryId)])];
    const contextFor = (rows: DatasetRow[], categoryConstraints: ReadonlyMap<string, string> = new Map()): Partial<Omit<CalculationScope, 'sourceRecordIds'>> => {
        const slices = new Map<string, ContextSlice>();
        for (const row of rows)
            for (const categories of partitions([row], pool, contextIds)) {
                const company = temporal.companyFieldId ? row.values[temporal.companyFieldId] as string | number | boolean | null : undefined;
                slices.set(JSON.stringify([[...categories], company]), { categories, ...(temporal.companyFieldId ? { companyIds: new Set([company!]) } : {}) });
            }
        return { categoryConstraints, contextSlices: [...slices.values()], page: model.layout.page, temporalContext: { ...temporal, ...(temporal.companyFieldId ? { companyIds: new Set(rows.map(row => row.values[temporal.companyFieldId!] as string | number | boolean | null)) } : {}) } };
    };
    const scopeCache = new Map<string, CalculatedTotals>();
    const calculateScope = (rows: DatasetRow[], categoryConstraints = new Map<string, string>()) => { const key = JSON.stringify([[...categoryConstraints], rows.map(row => row.id)]); let value = scopeCache.get(key); if (!value) {
        const context=contextFor(rows, categoryConstraints);
        if(execution) context.contextSlices=context.contextSlices?.map(slice=>({categories:new Map([...sliceCategories(slice),...categoryConstraints]),...('categories' in slice?{companyIds:slice.companyIds}:{})}));
        value = calculateTotals(new Set(rows.map(row => row.id)), pool, compiled, context);
        scopeCache.set(key, value);
    } return value; };
    const filters = model.resultFilters;
    const originalGroups: CalculatedGroup[] = [];
    for (const categoryId of new Set(filters.map(f => f.categoryId))) {
        const axis = model.layout.rows.includes(categoryId) ? model.layout.rows : model.layout.columns.includes(categoryId) ? model.layout.columns : [categoryId];
        const ids = axis.slice(0, axis.indexOf(categoryId) + 1);
        for (const categoryConstraints of partitions(page.rows, pool, ids)) {
            const rows = scopeRows(page.rows, pool, categoryConstraints);
            const value = calculateScope(rows, categoryConstraints);
            originalGroups.push({ categoryId, sourceRecordIds: value.scope.sourceRecordIds, cells: value.formulas.cells, measureCells: value.measures.cells });
        }
    }
    // A declared row participates in the same pre-qualification results as observed groups.
    if(execution) for(const categoryId of new Set(filters.map(f=>f.categoryId))) for(const output of execution.outputMembers) {
        if(output.requireObserved || !output.selectors.some(s=>s.categoryId===categoryId))continue;
        const categoryConstraints=new Map(output.selectors.map(s=>[s.categoryId,s.memberKey]));
        if(scopeRows(page.rows,pool,categoryConstraints).length)continue;
        const anchorConstraints=new Map([...categoryConstraints].filter(([id])=>!output.selectors.some(s=>s.categoryId===id)));
        const anchors=scopeRows(page.rows,pool,anchorConstraints);
        const value=calculateScope(anchors,categoryConstraints);
        originalGroups.push({categoryId,sourceRecordIds:value.scope.sourceRecordIds,cells:value.formulas.cells,measureCells:value.measures.cells});
    }
    const requiredErrors: ModelError[] = [];
    const required = new Set([...model.layout.rows, ...model.layout.columns, ...filters.map(f => f.categoryId)]);
    for (const categoryId of required) {
        if (!pool.categories.has(categoryId))
            errors.push({ code: 'missing-reference', message: `Required category ${categoryId} is unavailable.`, definitionId: categoryId });
        for (const row of page.rows) {
            const member = pool.members.get(row.id)?.get(categoryId);
            if (member && !member.ok) {
                errors.push(member.error); requiredErrors.push(member.error);
            }
        }
    }
    // Valid empty data does not imply the configured category disappeared.
    const qualification = filters.length && page.rows.length ? qualifyGroups(originalGroups, filters) : { recordIds: new Set(page.rows.map(row => row.id)), complete: true, errors: [] };
    errors.push(...qualification.errors);
    const requiredValid = [...required].every(id => pool.categories.has(id));
    const surviving = requiredValid ? page.rows.filter(row => qualification.recordIds.has(row.id) && [...required].every(id => pool.members.get(row.id)?.get(id)?.ok)) : [];
    const recordIds = new Set(surviving.map(row => row.id));
    // Display order is applied after qualification; it never changes calculation inputs.
    const sourceById = new Map(surviving.map(row => [row.id, row]));
    const sourceBindings = new Map(model.measures.map(measure => [measure.id, measure.sourceFieldId]));
    const structuralCategories = new Set([...model.layout.rows, ...model.layout.columns]);
    const sortForDisplay = <T>(items: T[], valueOf: (item: T, id: string) => unknown): void => {
        if (!input.table.sorting?.length) return;
        items.sort((a, b) => {
            for (const sort of input.table.sorting!) {
                const comparison = compareSorted(valueOf(a, sort.id), valueOf(b, sort.id), sort.desc);
                if (comparison) return comparison;
            }
            return 0;
        });
    };
    const sourceSortValue = (row: DatasetRow, id: string, useMeasureBindings: boolean): unknown => {
        const original = sourceById.get(row.id)!;
        // A structural category ID wins over a same-ID Data measure, as in pivotTable.
        const field = useMeasureBindings && !structuralCategories.has(id) ? sourceBindings.get(id) ?? id : id;
        return Object.hasOwn(original.values, field) ? original.values[field] : undefined;
    };
    const totals: CalculatedTotals = enabled && (!execution || model.subtotals.grandTotal) ? calculateTotals(recordIds, pool, compiled, contextFor(surviving)) : {
        empty: true, scope: { sourceRecordIds: recordIds, categoryConstraints: new Map(), temporalContext: {} },
        formulas: { cells: new Map(), metadata: new Map(), measureCells: new Map(), measureMetadata: new Map(), scopeErrors: [], warnings: [], formats: new Map(), empty: true },
        measures: { cells: new Map(), metadata: new Map() },
    };
    const facets = Object.fromEntries(model.categories.map(c => [c.id, categoryFacets(evaluated, constraints, c.id)]));
    const groups: LogicalGroup[] = [];
    const rows: DatasetRow[] = [];
    const eligibleRows: DatasetRow[] = [];
    let columns = evaluated.columns;
    const totalCells = new Map<string, CellResult>([...totals.measures.cells, ...totals.formulas.cells]);
    let renderComplete = true;
    const grouped = model.layout.rows.length + model.layout.columns.length > 0;
    const selectionNamespace = grouped ? JSON.stringify([...model.layout.rows, ...model.layout.columns].map(id => [id, pool.categories.get(id)?.recipe])) : undefined;
    if (!grouped) {
        for (const row of surviving) {
            const values = { ...row.values };
            const cellErrors = { ...row.cellErrors, ...Object.fromEntries([...(pool.formulaCells.get(row.id) ?? [])].flatMap(([id, cell]) => cell.ok ? [] : [[id, compactCellError(cell.error)]])) };
            for (const [id, cell] of pool.formulaCells.get(row.id) ?? [])
                if (!cell.ok)
                    Object.defineProperty(values, id, { value: '#ERROR', enumerable: true });
            rows.push({ ...row, values, ...(Object.keys(cellErrors).length ? { cellErrors } : {}) });
        }
        sortForDisplay(rows, (row, id) => sourceSortValue(row, id, false));
        eligibleRows.push(...rows);
    }
    else {
        // Pivot owns maintained ordering, bucket labels, completeness and column limits.
        // Its provisional aggregate values are replaced by the shared scoped evaluator.
        const aggregateHeaders = compiled.symbols.formulas.filter(f => f.scope === 'aggregate');
        const pivotColumns = [...evaluated.columns, ...aggregateHeaders.map(f => ({ id: f.id, label: f.name }))];
        for (const measure of model.measures)
            if (!pivotColumns.some(c => c.id === measure.sourceFieldId))
                pivotColumns.push({ id: measure.sourceFieldId, label: measure.sourceFieldId });
        const orderedMeasures = dataIds(authored).flatMap(id => {
            const measure = model.measures.find(m => m.id === id);
            if (measure) {
                const label = evaluated.columns.find(c => c.id === measure.sourceFieldId)?.label ?? compiled.symbols.formulas.find(f => f.id === measure.sourceFieldId)?.name ?? measure.sourceFieldId;
                return [{ ...measure, customLabel: measureLabel(measure, label, model.measures) }];
            }
            const formula = aggregateHeaders.find(f => f.id === id);
            return formula ? [{ id, sourceFieldId: id, customLabel: formula.name }] : [];
        });
        const pivotModel = { ...model, measures: orderedMeasures };
        const prepared = prepareCategoryPivot({ columns: pivotColumns.map(c => ({ field: c.id, header: c.label, renderFn: [], colorRules: [], hiddenByDefault: false })), kinds: new Map(), order: pivotColumns.map(c => c.id), sorting: [] }, { ...evaluated, rows: surviving, errors: new Map() }, pivotModel);
        const pivot = prepared.ok ? pivotTable({ ...prepared.input, config: { ...prepared.input.config, expanded: true } }) : undefined;
        if (!prepared.ok) {
            errors.push(...prepared.errors); renderComplete=false;
        }
        if (pivot && !pivot.ok) {
            errors.push({ code: 'scope', message: pivot.reason }); renderComplete=false;
        }
        if (pivot?.ok) {
            columns = pivot.columns.map(c => {
                const source = evaluated.columns.find(s => s.id === c.source);
                const formula = aggregateHeaders.find(f => f.id === c.measureId);
                return { ...source, id: c.field, label: c.header, sourceBindingId: c.source, measureId: formula ? undefined : c.measureId, aggregation: c.aggregation, ...(formula ? { metadata: { ...source?.metadata, formulaId: formula.id } } : {}),
                    ...(c.splitKeys?.length ? { splitPath: c.splitKeys.map((key, i) => ({ field: model.layout.columns[i], categoryId: model.layout.columns[i], ...memberDescriptor(model.layout.columns[i]), memberKey: key, value: JSON.parse(key)[1] as CloneSafeValue })) } : {}) };
            });
            totalCells.clear();
            for (const column of pivot.columns.filter(c => c.field !== LABEL_FIELD && (!execution || model.subtotals.grandTotal))) {
                const full = new Map((column.splitKeys ?? []).map((key, i) => [model.layout.columns[i], key]));
                const value = calculateScope(scopeRows(surviving, pool, full), full);
                const cell = aggregateHeaders.some(f => f.id === column.measureId) ? value.formulas.cells.get(column.measureId!) : value.measures.cells.get(column.measureId!);
                if (cell)
                    totalCells.set(column.field, cell);
            }
            // Declared output members extend the pivot hierarchy without creating source facts.
            if(execution && surviving.length) {
                const entries=new Map(pivot.meta.flatMap((meta,index)=>meta.kind==='group'?[[meta.path,{meta,row:pivot.rows[index]}] as const]:[]));
                for(const output of execution.outputMembers.filter(output=>!output.requireObserved || scopeRows(surviving,pool,new Map(output.selectors.map(s=>[s.categoryId,s.memberKey]))).length)) for(let depth=0;depth<model.layout.rows.length;depth++) {
                    const keys=model.layout.rows.slice(0,depth+1).map(id=>output.selectors.find(s=>s.categoryId===id)?.memberKey);
                    if(keys.some(key=>key===undefined))continue;
                    const path=keys.join(KEY_SEP);if(entries.has(path))continue;
                    const label=execution.memberLabels[model.layout.rows[depth]]?.[keys[depth]!]??String(JSON.parse(keys[depth]!)[1]);
                    entries.set(path,{meta:{kind:'group',depth,path,label,count:0,expandable:depth+1<model.layout.rows.length,open:true},row:{[LABEL_FIELD]:label}});
                }
                const visible=[...entries.values()].filter(entry=>{
                    const keys=entry.meta.path.split(KEY_SEP);
                    return execution.outputMembers.some(output=>keys.every((key,i)=>output.selectors.some(s=>s.categoryId===model.layout.rows[i]&&s.memberKey===key)));
                });
                const ordered=visible.sort((a,b)=>{
                    const aa=a.meta.path.split(KEY_SEP),bb=b.meta.path.split(KEY_SEP);
                    for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i]){const order=execution.memberOrders[model.layout.rows[i]]??[];return order.indexOf(aa[i])-order.indexOf(bb[i]);}
                    return aa.length-bb.length;
                });
                pivot.meta=ordered.map(e=>e.meta);pivot.rows=ordered.map(e=>e.row);
            }
            const byPath = new Map<string, LogicalGroup>();
            const groupSortKeys = new Map<string, {categoryId: string; value: unknown}>();
            for (let index = 0; index < pivot.rows.length; index++) {
                const meta = pivot.meta[index];
                if (meta.kind === 'leaf') {
                    const original = surviving[meta.sourceIndex!];
                    if (original) {
                        const values = {...pivot.rows[index]};
                        const cellErrors: Record<string,DatasetCellError> = {...original.cellErrors};
                        for(const measure of model.measures){const error=pool.errors.get(original.id)?.get(measure.sourceFieldId);if(error){Object.defineProperty(values,measure.id,{value:'#ERROR',enumerable:true});Object.defineProperty(cellErrors,measure.id,{value:compactCellError(error),enumerable:true});}}
                        const row = { ...original, values, ...(Object.keys(cellErrors).length?{cellErrors}:{}) };
                        rows.push(row);
                        const parentKeys = model.layout.rows.map(id => pool.members.get(original.id)?.get(id)).map(m => m?.ok ? m.value.key : '').join(KEY_SEP);
                        byPath.get(parentKeys)?.rows.push(row);
                    }
                    continue;
                }
                // Grand totals already have their own totalCells delivery above.
                if (!surviving.length || meta.kind === 'total')
                    continue;
                const keys = meta.kind === 'group' ? meta.path.split(KEY_SEP) : [];
                const categoryConstraints = new Map(keys.map((key, i) => [model.layout.rows[i], key]));
                const scopedRows = scopeRows(surviving, pool, categoryConstraints);
                const memberFilters=execution ? filters.filter(f=>f.categoryId===model.layout.rows[keys.length-1]) : [];
                if(memberFilters.length) {
                    let original=scopeRows(page.rows,pool,categoryConstraints);
                    if(!original.length) original=page.rows;
                    const value=calculateScope(original,categoryConstraints);
                    const qualification=qualifyGroups([{categoryId:model.layout.rows[keys.length-1],sourceRecordIds:value.scope.sourceRecordIds,cells:value.formulas.cells,measureCells:value.measures.cells}],memberFilters);
                    if(!qualification.recordIds.size)continue;
                }
                const values: DatasetRow['values'] = { [LABEL_FIELD]: execution?.memberLabels[model.layout.rows[keys.length-1]]?.[keys.at(-1)!] ?? pivot.rows[index][LABEL_FIELD] };
                const cellErrors: Record<string, DatasetCellError> = {};
                const cellFormats: NonNullable<DatasetRow['cellFormats']> = {};
                const output = execution?.outputMembers.find(output=>output.selectors.every(s=>categoryConstraints.get(s.categoryId)===s.memberKey));
                for (const column of pivot.columns.filter(c => c.field !== LABEL_FIELD && (!execution || model.subtotals.groups || keys.length===model.layout.rows.length))) {
                    const full = new Map([...categoryConstraints, ...(column.splitKeys ?? []).map((key, i) => [model.layout.columns[i], key] as const)]);
                    let inputs=scopeRows(scopedRows,pool,full);
                    if(!inputs.length && output) {
                        const retained=new Map([...full].filter(([id])=>!output.selectors.some(s=>s.categoryId===id)));
                        inputs=scopeRows(surviving,pool,retained);
                    }
                    const result = calculateScope(inputs, full);
                    if (result.empty) continue;
                    const cell = aggregateHeaders.some(f => f.id === column.measureId) ? result.formulas.cells.get(column.measureId!) : result.measures.cells.get(column.measureId!);
                    // A blank Statement line (#19) stays absent like an empty cell: the grid shows "", exports write nothing.
                    if (output && cell?.ok && cell.value === null) continue;
                    if (cell?.ok) {
                        Object.defineProperty(values, column.field, { value: cell.value, enumerable: true });
                        if (output && execution && column.measureId === execution.policy.measureId) {
                            // A derived line cannot inherit a dependency's units/format.
                            const hints = output.formulaId ? [] : inputs.map(row => row.cellFormats?.[execution.policy.valueFieldId]
                                ?? execution.sourceColumnsByRowId?.get(row.id)?.format
                                ?? compiled.columns.find(c => c.id === execution.policy.valueFieldId)?.format);
                            const sourceFormat = hints.length && hints.every(h => JSON.stringify(h) === JSON.stringify(hints[0])) ? hints[0] : undefined;
                            const format = output.format ?? sourceFormat;
                            if (format) Object.defineProperty(cellFormats, column.field, { value: structuredClone(format), enumerable: true });
                        }
                    }
                    else if (cell) {
                        Object.defineProperty(values, column.field, { value: '#ERROR', enumerable: true });
                        errors.push(cell.error);
                        Object.defineProperty(cellErrors, column.field, { value: compactCellError(cell.error), enumerable: true });
                    }
                }
                const path = keys.map((_, i) => groupIdentity(keys.slice(0, i + 1).join(KEY_SEP), selectionNamespace!));
                const row: DatasetRow = { id: path.at(-1) ?? groupIdentity('', selectionNamespace!), values, ...(Object.keys(cellErrors).length ? { cellErrors } : {}), ...(Object.keys(cellFormats).length ? { cellFormats } : {}), groupPath: keys.map((key, i) => { const label = execution?.memberLabels[model.layout.rows[i]]?.[key]; return { field: model.layout.rows[i], categoryId: model.layout.rows[i], ...memberDescriptor(model.layout.rows[i]), memberKey: key, value: JSON.parse(key)[1] as CloneSafeValue, ...(label !== undefined ? { label } : {}) }; }) };
                rows.push(row);
                {
                    const node: LogicalGroup = { id: row.id, path, rows: [row], children: [] };
                    byPath.set(meta.path, node);
                    const categoryId = model.layout.rows[meta.depth];
                    const member = pool.members.get(scopedRows[0]?.id)?.get(categoryId);
                    groupSortKeys.set(node.id, {categoryId, value: member?.ok ? member.value.value : undefined});
                    const parent = keys.length > 1 ? byPath.get(keys.slice(0, -1).join(KEY_SEP)) : undefined;
                    if (parent)
                        parent.children.push(node);
                    else
                        groups.push(node);
                    if (meta.incomplete)
                        warnings.push({ code: 'incomplete-period', message: `${meta.label}: ${meta.incomplete.have} of ${meta.incomplete.expected} observations.`, categoryId: model.layout.rows[meta.depth] });
                }
            }
            const visit = (nodes: LogicalGroup[]) => {
                if(execution)nodes.sort((a,b)=>{const aa=a.rows[0].groupPath!.at(-1)!,bb=b.rows[0].groupPath!.at(-1)!;const order=execution.memberOrders[aa.categoryId!]??[];return order.indexOf(aa.memberKey!)-order.indexOf(bb.memberKey!);});
                sortForDisplay(nodes, (node, id) => {
                    const key = groupSortKeys.get(node.id)!;
                    if (id === LABEL_FIELD) return key.value;
                    // Deeper, ancestor and split category sorts cannot read aggregate cells.
                    if (structuralCategories.has(id)) return id === key.categoryId ? key.value : undefined;
                    const values = node.rows[0].values;
                    return Object.hasOwn(values, id) ? values[id] : undefined;
                });
                if(execution && filters.length) for(let i=nodes.length-1;i>=0;i--) if(nodes[i].rows[0].groupPath!.length<model.layout.rows.length && !nodes[i].children.length)nodes.splice(i,1);
                for (const node of nodes) {
                    rows.push(node.rows[0]);
                    if (node.children.length) visit(node.children);
                    else {
                        const leaves = node.rows.slice(1);
                        sortForDisplay(leaves, (row, id) => sourceSortValue(row, id, true));
                        node.rows = [node.rows[0], ...leaves];
                        for (const row of leaves) rows.push(row);
                        eligibleRows.push(node.rows[0]);
                    }
                }
            };
            rows.length = 0;
            visit(groups);
        }
    }
    columns = columns.map(column => {
        const id = column.measureId ?? (typeof column.metadata?.formulaId === 'string' ? column.metadata.formulaId : column.id);
        const definition = compiled.symbols.formulas.find(f => f.id === id);
        const meta = definition ? totals.formulas.metadata.get(id) : totals.measures.metadata.get(id);
        const format = compiled.model.formulas.find(f => f.id === id)?.format;
        const formatterFn = format === 'decimal' || format === 'number' ? 'none' : format === 'integer' ? 'int' : format;
        return { ...column, ...(definition ? { analytical: { kind: 'formula' as const, definitionId: definition.id, name: definition.name, scope: definition.scope, ...(meta?.valueKind ? { valueKind: meta.valueKind } : {}) } } : {}), ...(meta?.valueKind === 'number' ? { dtype: 'number' as const, format: { formatterFn: 'none' as const } } : {}), ...(formatterFn && ['int', 'none', 'percent', 'normalized', 'normalizedPercent', 'dateToYear'].includes(formatterFn) ? { format: { formatterFn: formatterFn as NonNullable<DatasetColumn['format']>['formatterFn'] } } : {}), ...(definition ? { metadata: { ...column.metadata, formulaId: id, ...(format ? { formulaFormat: format } : {}) } } : {}) };
    });
    // Presentation never removes calculation inputs, bindings, or record identities.
    const hidden = new Set(input.table?.hidden ?? []);
    const order = input.table?.columnOrder ?? [];
    columns = columns.filter(column => !hidden.has(column.id));
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
    columns.sort((a, b) => rank(a.id) - rank(b.id));
    return { paramDiagnostics, groupResolutions, compiled, pool, recordIds, groups, rows, columns, totals, totalCells, facets, errors, warnings, complete: (!execution || errors.length===0) && sourceQualificationErrors.length === 0 && renderComplete && requiredErrors.length === 0 && page.errors.length === 0 && scopeErrors(pool, totals.scope).length === 0 && qualification.complete && requiredValid && !errors.some(e => e.code === 'missing-reference' || e.code === 'invalid-date' || e.code === 'fiscal-context'), selectionNamespace, eligibleRows, provenance: { ...input.source.provenance, ...(grouped ? { inputMayContainAggregates: true } : {}) } };
}
