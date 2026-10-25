// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ResolveContext } from "../../lib/dateExpressions";
import { filterDateContext, resolveDateFilters } from "../../lib/dateFilters";
import { StatementPanel } from './table-model/StatementPanel';
import type { StatementIntent } from '../../lib/statementModel/types';
import { categoryAuthoringRecipe } from '../../lib/tableModel/categoryAuthoringRecipe';
import {useFormulaAuthoring} from '../../hooks/useFormulaAuthoring';
import { memberLabel } from '../../lib/tableModel/pivotParams';
import {LinkedGroupsInspection} from '../LinkedGroupInspector';
import { FilterPlacement } from './table-model/FilterPlacement';
import { PivotDrawer, useDismissOnOutside, useDrawer, type SectionSpec } from './pivot-drawer/PivotDrawer';
import { ArrangePanel } from './pivot-drawer/ArrangePanel';
import { PivotSplitter } from './pivot-drawer/PivotSplitter';
import { PivotFooterStrip } from './pivot-drawer/PivotFooterStrip';
import { useDrawerGeometry } from './pivot-drawer/useDrawerGeometry';
import { clampSplitPct } from './pivot-drawer/drawerLayout';
import { dispatchDrawer, setDismissOnOutside } from '../../stores/pivotDrawerStore';
import { CategoryEditor } from './table-model/CategoryEditor';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { useTableMetadata } from '../../hooks/useTableMetadata';
import type { TableDefinition } from '../../lib/tableExecution/types';
import type { TableModelV1 } from '../../lib/tableModel/types';
import { draftModelFor } from '../../lib/tableModel/draftModel';
import { dataIds } from '../../lib/tableModel/layoutValues';
import { useTableCommit } from '../../hooks/useTableCommit';
import { SourceFilterPanel } from './TableFilterRow';
/** Stable, so a re-render cannot restart SourceFilterPanel's save pause (D-020). */
const NO_FILTERS:{id:string;value:unknown}[]=[];
import { ModelInspector } from './table-model/ModelInspector';
import { FormulaPanel } from './table-model/FormulaPanel';
import { PageSelector } from './table-model/PageSelector';
import { FacetFilterPopover } from './table-model/FacetFilterPopover';
import { ResultFilterPanel } from './table-model/ResultFilterPanel';
import { validateTableModel } from '../../lib/tableModel/validation';
import { useDashboardStore } from '../../stores/dashboardStore';

import { useEffect, useMemo, useState, useRef } from "react";
import { useTableResult, TABLE_BLOCK_SIZE } from "../../hooks/useTableResult";
import { isPivoting } from "../../lib/pivotConfig";
import { tableColumns, type Row, type TableColumn } from "../../lib/tableColumns";
import type { RowBlock, SelectionAction } from "../../lib/tableExecution/types";
import { MeasuresPanel } from "./PivotPanel";
import { tableExecutionStore } from "../../stores/tableExecutionStore";
import { readLocalFile } from "../../lib/localFiles";
import { tableRows } from "../../lib/tableColumns";
import { NOTHING_TO_TRANSPOSE, transposeRows } from "../../lib/transpose";
import type { Dashboard, TableCardState, TableSpec } from "../../lib/types";
import { cardSourceIdentity } from "../../lib/cardSourceIdentity";
import { TableRenderer, type CellClickEvent, type TableStatePatch, type ExecutionSlot, type ExecutionTableView } from "./TableRenderer";

import { dataFromBytes } from "../../lib/localTableData";
export { dataFromBytes } from "../../lib/localTableData";

type Load =
  | { status: "loading" }
  | { status: "ready"; data: unknown }
  | { status: "error"; message: string };

/**
 * A table over a file this computer holds. The card's `file` param names the
 * stored copy; `label` is the original filename, which is the only name worth
 * showing a person.
 */
function LegacyLocalTableRenderer({
  file,
  label,
  refreshKey,
  state,
  onStateChange,
  filterRow = false,
  autosizeKey,
  transposed = false,
  dateContext,
}: {
  /** DashboardCard.params.file: the stored name under the app's files/ dir. */
  file: string;
  /** The card's title -- the name the file had when it was dropped. */
  label: string;
  /** Changes on Refresh and on refresh-all; nothing else re-reads the file. */
  refreshKey: number;
  state?: TableCardState;
  onStateChange?: (patch: TableStatePatch) => void;
  filterRow?: boolean;
  autosizeKey?: number;
  /** The card's view is Transposed: hand the parsed rows through transposeRows and draw them plain. */
  transposed?: boolean;
  /** How a date filter's expression is resolved: the card's exchange and calendar. */
  dateContext?: ResolveContext;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    void (async () => {
      const bytes = await readLocalFile(file).catch(() => null);
      if (cancelled) return;
      if (bytes === null) {
        setLoad({ status: "error", message: `File missing: ${label}` });
        return;
      }
      try {
        const data = await dataFromBytes(file, bytes);
        if (!cancelled) setLoad({ status: "ready", data });
      } catch {
        // The error itself is deliberately not shown or logged: it comes from
        // a parser reading the user's own file and can quote its contents.
        if (!cancelled) setLoad({ status: "error", message: `Could not read ${label}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, label, refreshKey]);

  // Above the early returns, as every hook must be, and memoised so a render
  // that changed nothing (a resize, a parent re-render) does not turn the
  // whole file over again.
  const turned = useMemo(() => {
    if (!transposed || load.status !== "ready") return null;
    const rows = tableRows(load.data);
    return rows ? transposeRows(rows) : null;
  }, [load, transposed]);

  if (load.status === "loading") return <p className="empty-state">Loading…</p>;
  if (load.status === "error") return <p className="empty-state">{load.message}</p>;
  // The card's own rows never reach WidgetCard -- this renderer read them --
  // so the transposed view is turned here, and the toolkit state is left
  // untouched for when the view goes back to Table.
  if (transposed) {
    if (turned === null) return <p className="empty-state">{NOTHING_TO_TRANSPOSE}</p>;
    return <TableRenderer data={turned.rows} columns={turned.columns} />;
  }
  return (
    <TableRenderer
      data={load.data}
      state={state}
      onStateChange={onStateChange}
      filterRow={filterRow}
      autosizeKey={autosizeKey}
      dateContext={dateContext}
    />
  );
}

export type TableExecutionIdentity = { dashboardId: string; widgetId: string };
type ExpandedGroup = { path: string[]; childCount: number; offset: number };
const pathKey = (path: string[]) => JSON.stringify(path);
/** Every card on one dashboard, or none. */
const cardsOf = (s: { dashboards: Dashboard[] }, dashboardId: string) => s.dashboards.find(d => d.id === dashboardId)?.tabs.flatMap(t => t.cards) ?? [];

/** Retains only expanded-node metadata; row values remain in the bounded hook cache. */
function executionIndex(blocks: RowBlock[], topLevelCount: number, expanded: ExpandedGroup[]) {
  const children = (path: string[]) => expanded.filter(g => pathKey(g.path.slice(0, -1)) === pathKey(path)).sort((a, b) => a.offset - b.offset);
  const size = (path: string[], count: number): number => count + children(path).reduce((n, g) => n + size(g.path, g.childCount), 0);
  const locate = (index: number, path: string[], count: number): ExecutionSlot => {
    let added = 0;
    for (const g of children(path)) {
      const position = g.offset + added; const childSize = size(g.path, g.childCount);
      if (index <= position) break;
      if (index <= position + childSize) return locate(index - position - 1, g.path, g.childCount);
      added += childSize;
    }
    const offset = Math.min(count - 1, index - added);
    const block = blocks.find(b => pathKey(b.groupPath) === pathKey(path) && offset >= b.offset && offset < b.offset + b.rows.length);
    const row = block?.rows[offset - block.offset]; const group = block?.groups.find(g => g.rowId === row?.id);
    return { rowId: row?.id, groupPath: path, offset, ...(group && group.childCount ? { group: { ...group, open: expanded.some(g => pathKey(g.path) === pathKey(group.path)) } } : {}) };
  };
  return { count: size([], topLevelCount), slot: (i: number) => locate(i, [], topLevelCount) };
}
export function schemaColumns(columns: NonNullable<ReturnType<typeof useTableResult>['view']['ready']>['columns'], spec?: TableSpec): TableColumn[] {
  // A backend table's own columns keep their widgets.json presentation (cell
  // clicks, renderFn, prefix/suffix); split and calculated columns stay plain.
  const declared = spec ? new Map(tableColumns([Object.fromEntries(columns.map(c => [c.id, null]))], spec).map(c => [c.field, c])) : undefined;
  return columns.map(c => declared?.has(c.id) && !c.splitPath && !c.analytical && !c.aggregation ? { ...declared.get(c.id)!, cellDataType: declared.get(c.id)!.cellDataType ?? c.dtype } : ({ field: c.id, header: c.label, cellDataType: c.dtype, format: c.format, renderFn: [], colorRules: [], hiddenByDefault: false, ...(c.splitPath ? { groupPath: c.splitPath.map(m => m.label ?? String(m.value)), source: c.sourceFieldId } : {}) }));
}
function RuntimeTable({ identity, refreshKey, state: _state, filterRow, autosizeKey, dateContext, spec, onCellClick, boundsRows }: { identity: TableExecutionIdentity } & RuntimeExtras & Parameters<typeof LegacyLocalTableRenderer>[0]) {
  const { dashboardId, widgetId } = identity;
  const { view, blocks, totals, requestRows } = useTableResult(dashboardId, widgetId);
  const viewer = useDashboardStore(s => s.viewer);
  const linked = useDashboardStore(s => !!cardsOf(s, dashboardId).find(c => c.id === widgetId)?.linkedSource);
  const sourceContext=useDashboardStore(s=>cardSourceIdentity(cardsOf(s, dashboardId).find(c=>c.id===widgetId)));
  const metadata=useTableMetadata(dashboardId,widgetId,view.active);
  const {requestInspection,requestFacet}=metadata;
  const drawer=useDrawer(dashboardId,widgetId);
  const dismissOnOutside=useDismissOnOutside(dashboardId,widgetId);
  const inspectionOpen=drawer.open&&drawer.active==='inspect';
  const repairOpen=drawer.open&&(drawer.active==='inspect'||drawer.active==='statement');
  const root=useRef<HTMLDivElement>(null);
  const [splitPct,setSplitPct]=useState(.4);
  const geometry=useDrawerGeometry(root,drawer.active,splitPct,view.ready);
  const pageMetadata=useTableMetadata(dashboardId,widgetId,view.active);
  const authorMetadata=useTableMetadata(dashboardId,widgetId,view.active);
  const {requestFacet:requestAuthorFacet}=authorMetadata;
  const sourceMetadata=useTableMetadata(dashboardId,widgetId,view.active);
  const {requestInspection:requestSourceInspection}=sourceMetadata;
  const [filterFormulaId,setFilterFormulaId]=useState('');
  const sourceFilterDefinition=sourceMetadata.inspection?.definitionId===filterFormulaId?sourceMetadata.inspection.rows[0]:undefined;
  useEffect(()=>{if(filterFormulaId)requestSourceInspection({collection:'definitions',definitionId:filterFormulaId,offset:0,limit:1});},[filterFormulaId,requestSourceInspection]);
  const [formulaId,setFormulaId]=useState<string>();
  const [checklistCategory,setChecklistCategory]=useState('');
  const inspectionIdentity=JSON.stringify(view.active);
  useEffect(()=>{if(inspectionOpen) requestInspection({collection:'definitions',offset:0,limit:20});},[inspectionOpen,inspectionIdentity,requestInspection]);
  const intentView = tableExecutionStore.readView(dashboardId, widgetId);
  const needsRepairContext = !view.ready || !!view.error;
  const [repairContext, setRepairContext] = useState<{ view: typeof intentView; columns?: DatasetColumn[]; error?: string }>();
  useEffect(() => {
    if (!repairOpen || !needsRepairContext) return;
    const controller = new AbortController();
    setRepairContext({ view: intentView });
    const liveCards=cardsOf(useDashboardStore.getState(), dashboardId);
    if(!tableExecutionStore.sourceMatches(dashboardId,widgetId,liveCards)) {setRepairContext({view:intentView,error:'Source changed; wait for runtime synchronization before repairing.'});return ()=>controller.abort();}
    void tableExecutionStore.repairColumns(dashboardId, widgetId, controller.signal).then(columns => {
      if (!controller.signal.aborted) {const cards=cardsOf(useDashboardStore.getState(), dashboardId);setRepairContext(tableExecutionStore.sourceMatches(dashboardId,widgetId,cards)?{view:intentView,columns}:{view:intentView,error:'Source changed; wait for runtime synchronization before repairing.'});}
    }).catch(() => {
      if (!controller.signal.aborted) setRepairContext({ view: intentView, error: 'Source schema unavailable; restore the source before saving a repair.' });
    });
    return () => controller.abort();
  }, [repairOpen, needsRepairContext, intentView, dashboardId, widgetId, sourceContext]);
  const repairColumns = needsRepairContext ? repairContext?.view === intentView ? repairContext.columns : undefined : view.ready?.inspection.inputColumns;
  const statementRecognized=!!view.definition.analytical&&typeof view.definition.analytical==='object'&&'kind' in view.definition.analytical&&view.definition.analytical.kind==='statement';
  const analytical=validateTableModel(view.definition.analytical).model;
  const page=analytical?.enabled ? analytical.layout.page : undefined;
  const pageCategory=analytical?.categories.find(c=>c.id===page?.categoryId);

  useEffect(()=>{if(page?.categoryId)requestFacet(page.categoryId);},[page?.categoryId,requestFacet]);
  const pageEntry=tableExecutionStore.readRuntimeParams(dashboardId,widgetId)['pivot:page'];
  const pageCandidate=tableExecutionStore.readGroupCandidates(dashboardId,widgetId).find(c=>c.key==='pivot:page');
  const pageMatch=view.ready?.inspection.paramMatches?.find(m=>m.key==='pivot:page'&&m.source==='group'&&m.groupId===pageCandidate?.entry.groupId);
  const effectivePageKeys=pageEntry?.source==='viewer'?pageEntry.memberKeys:page?.memberKeys;
  const pageLabel=pageEntry?.source==='viewer'&&effectivePageKeys===null?'All':pageCandidate&&pageEntry?.source!=='viewer'?view.stale?'Linked Page pending':pageMatch?`${pageMatch.matchedCount} matched · ${pageMatch.status??'resolved'}${pageMatch.matched.length?` · ${pageMatch.matched.join(', ')}${pageMatch.matchedCount>pageMatch.matched.length?' (preview)':''}`:''}`:'Linked Page status unavailable':effectivePageKeys?.length?effectivePageKeys.map(memberLabel).join(', '):'No members';

  const commits = useTableCommit(dashboardId, widgetId, true);
  const definitionPending = commits.pending;
  const selectionPending = commits.selectionPending;
  const definitionError = commits.error;

  const chooseSelection = (action: SelectionAction) => commits.coordinator.chooseSelection(commits.base, action);
  const [folds, setFolds] = useState<{ revision: string; groups: ExpandedGroup[] }>({ revision: '', groups: [] });
  const previousRefresh = useRef(refreshKey);
  useEffect(() => { if (previousRefresh.current !== refreshKey) tableExecutionStore.refresh(dashboardId, widgetId); previousRefresh.current = refreshKey; }, [dashboardId, widgetId, refreshKey]);
  // Selection changes output, but never the visible hierarchy or its fold state.
  const revision = JSON.stringify([view.active?.input, view.ready?.inspection.definition]);
  const expanded = folds.revision === revision ? folds.groups : [];
  const index = executionIndex(blocks, view.ready?.topLevelCount ?? 0, expanded);
  const saveDefinition = async (definition: TableDefinition, latest = tableExecutionStore.readView(dashboardId, widgetId)): Promise<boolean> => {
    if (tableExecutionStore.readView(dashboardId, widgetId) !== latest) return false;
    return (await commits.coordinator.replaceDefinition(commits.coordinator.authoringBase(), definition)).status === 'saved';
  };
  const patch = (change: TableStatePatch) => commits.coordinator.patchTable(change);
  const commitModel = (model: TableModelV1) => commits.commitModel(model);
  const repairWitness=needsRepairContext&&repairContext?.view===intentView&&repairContext.columns?{view:repairContext.view,columns:repairContext.columns}:undefined;
  const commitStatement=async(model:StatementIntent)=> (await commits.coordinator.replaceDefinition(commits.base,{...intentView.definition,analytical:model},repairWitness)).status==='saved';
  const commitRepair=(model:TableModelV1|StatementIntent)=>'kind' in model&&model.kind==='statement'?commitStatement(model):commits.commitModel(model as TableModelV1,repairWitness);
  const authoringExecutor=tableExecutionStore.readExecutor(dashboardId,widgetId);
  const authoringContext=JSON.stringify([sourceContext,viewer,view.requested,view.sourceRevision,view.definition,view.selection]);
  const assertStatementContext=(signal:AbortSignal)=>{
    const state=useDashboardStore.getState();const card=cardsOf(state, dashboardId).find(c=>c.id===widgetId);
    const currentSource=cardSourceIdentity(card);
    const liveCards=cardsOf(state, dashboardId);
    if(!tableExecutionStore.sourceMatches(dashboardId,widgetId,liveCards))throw new Error('Source changed; wait for runtime synchronization before authoring.');
    if(signal.aborted||state.viewer||currentSource!==sourceContext||tableExecutionStore.readView(dashboardId,widgetId)!==intentView||tableExecutionStore.readExecutor(dashboardId,widgetId)!==authoringExecutor)throw new DOMException('Statement source or view changed; calculate again.','AbortError');
  };
  const previewStatement=async(candidate:StatementIntent,signal:AbortSignal)=>{
    assertStatementContext(signal);if(!authoringExecutor?.previewDefinition)throw new Error('Current source preview unavailable. Repair the saved definition in Inspect.');
    const result=await authoringExecutor.previewDefinition(view.requested,{...view.definition,analytical:candidate,table:{...view.definition.table,columnFilters:resolveDateFilters(view.definition.table.columnFilters??[],dateContext??filterDateContext())}},signal);assertStatementContext(signal);return result;
  };
  const statementCompanies=async(field:string,offset:number,signal:AbortSignal)=>{
    assertStatementContext(signal);if(!authoringExecutor?.memberDomain)throw new Error('Company members unavailable.');
    if(!columns.some(c=>c.id===field))throw new Error('Choose a current company source field.');
    const model:TableModelV1={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[]},categories:[{id:'statement-company-draft',name:'Company',sourceFieldId:field,transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
    const result=await authoringExecutor.memberDomain(view.requested,{definition:{...view.definition,analytical:model},categoryId:model.categories[0].id,categoryRecipe:categoryAuthoringRecipe(model,model.categories[0].id),offset,limit:100},signal);assertStatementContext(signal);return result;
  };
  const showFormula=(id:string)=>{setFormulaId(id);dispatchDrawer(dashboardId,widgetId,{kind:'select',section:'formulas'});};
  const locked=viewer||definitionPending||selectionPending||view.status==='updating'||!!view.error;
  const functionalLocked=viewer||!commits.canEnqueue;
  const waitingForAggregation=analytical?.enabled ? analytical.measures.filter(m=>dataIds(analytical).includes(m.id)&&m.aggregation===undefined).length : 0;
  const aggregationWarning=`${waitingForAggregation} data column${waitingForAggregation===1?' needs':'s need'} an aggregation`;
  useEffect(()=>{if(drawer.open&&drawer.active==='checklists'&&checklistCategory)requestAuthorFacet(checklistCategory);},[drawer.open,drawer.active,checklistCategory,requestAuthorFacet]);
  // Only diagnostics from bounded, delivered blocks; no extra worker requests.
  const rowErrors = useMemo(() => new Map(blocks.flatMap(block => block.rows.flatMap(row => row.cellErrors ? [[row.id, row.cellErrors] as const] : []))), [blocks]);
  const rowFormats = useMemo(() => new Map(blocks.flatMap(block => block.rows.flatMap(row => row.cellFormats ? [[row.id, row.cellFormats] as const] : []))), [blocks]);
  const execution: ExecutionTableView = {
    rowErrors, rowFormats,
    columns: schemaColumns(view.ready?.columns ?? [], spec), ...index,
    formulaIds: new Map((view.ready?.columns??[]).flatMap(column=>{
      const measure=analytical?.measures.find(m=>m.id===column.measureId);
      const id=typeof column.metadata?.formulaId==='string'?column.metadata.formulaId:measure?.sourceFieldId??column.id;
      return analytical?.formulas.some(f=>f.id===id)?[[column.id,id] as [string,string]]:[];
    })),
    onShowFormula: showFormula,
    selection: blocks[0]?.selection ? { ...blocks[0].selection, rows: blocks.flatMap(b => b.selection?.rows ?? []) } : undefined,
    selectionPending: viewer || definitionPending || selectionPending || view.status === 'updating' || !!view.error,
    onSelection: action => { void chooseSelection(action); },
    rowIds: blocks.flatMap(b => b.rows.map(r => r.id)), totals: totals?.values ?? {},
    totalErrors: totals?.cellErrors, totalsEmpty: totals?.empty,
    // Pivot on: its grand-total setting decides. Pivot off: only a total that says something.
    showTotals: statementRecognized ? false : analytical?.enabled ? analytical.subtotals.grandTotal : Object.values(totals?.values ?? {}).some(v => v !== null && v !== undefined && v !== '') || Object.keys(totals?.cellErrors ?? {}).length > 0,
    // "N of M rows" counts source rows, so only a flat table of its own input has an M:
    // a linked table's completeness is its producer's, and a grouped count holds group rows.
    boundsRows,
    sourceCount: !linked && !analytical?.enabled && !blocks.some(b => b.groups.length) ? view.ready?.completeness.acquiredRowCount : undefined,
    totalLabel: page ? `Grand total · ${pageCategory?.name ?? page.categoryId}: ${pageLabel ?? 'Unavailable page'} · Surviving groups` : 'Grand total · Surviving groups',
    requestRange: (start, end) => {
      for (let i = start; i <= end; i++) {
        const slot = index.slot(i);
        if (!slot.rowId) requestRows({ groupPath: slot.groupPath, offset: Math.floor(slot.offset / TABLE_BLOCK_SIZE) * TABLE_BLOCK_SIZE, limit: TABLE_BLOCK_SIZE });
      }
    },
    toggle: path => {
      const active = expanded.find(g => pathKey(g.path) === pathKey(path));
      if (active) setFolds({ revision, groups: expanded.filter(g => !path.every((id, i) => g.path[i] === id)) });
      else {
        const block = blocks.find(b => b.groups.some(g => pathKey(g.path) === pathKey(path)));
        const group = block?.groups.find(g => pathKey(g.path) === pathKey(path));
        if (block && group) {
          setFolds({ revision, groups: [...expanded, { ...group, offset: block.offset + block.rows.findIndex(r => r.id === group.rowId) }] });
          requestRows({ groupPath: path, offset: 0, limit: TABLE_BLOCK_SIZE });
        }
      }
    },
  };
  const rows = blocks.flatMap(b => b.rows.map(r => r.values));
  const tableHidden=drawer.open&&geometry.mode==='fill';
  const columns=repairColumns??[];
  const formulaAuthoring=useFormulaAuthoring(dashboardId,widgetId,commits.editModel);
  const inspector=<ModelInspector linkedGroups={<LinkedGroupsInspection dashboardId={dashboardId} widgetId={widgetId}/>} raw={view.definition.analytical} columns={repairColumns??[]} readonly={viewer||definitionPending||selectionPending||view.status==='updating'||!repairColumns} pending={needsRepairContext?!repairColumns&&!repairContext?.error:metadata.pending} error={needsRepairContext?repairContext?.error:metadata.error} page={needsRepairContext?undefined:metadata.inspection} counts={needsRepairContext?undefined:view.ready?.inspection.counts} onRequestInspection={requestInspection} onCommitModel={commitRepair} onShowFormula={showFormula}/>;
  const notReady=<p>{statementRecognized?'Statement settings are available in Statement; use Inspect for advanced repair.':view.definition.analytical===undefined?'Enable report model to use this section.':'The report model needs repair. Open Inspect to review its definitions.'}</p>;
  // A table without a report model still opens on the four-list chooser. The draft is what
  // "Enable report model" would save; the first arrangement edit saves it with that edit.
  const draftModel=view.ready&&view.definition.analytical===undefined?draftModelFor(view.definition,view.ready.inspection.inputColumns):undefined;
  const commitDraft=async(next:TableModelV1)=>{const latest=tableExecutionStore.readView(dashboardId,widgetId);if(locked||!view.ready||JSON.stringify(latest.definition)!==JSON.stringify(view.ready.inspection.definition))return false;return saveDefinition({...latest.definition,analytical:next},latest);};
  const sections:SectionSpec[]=[
   {id:'arrange',label:'Arrange',hint:'Drag fields between lists · click a pill for actions',badge:{text:String((analytical?.layout.rows.length??0)+(analytical?.layout.columns.length??0)),tone:'count'},render:()=>analytical?<><div className="pivot-drawer-arrange-actions"><button type="button" disabled={functionalLocked||analytical.layout.rows.length+analytical.layout.columns.length===0} title="Turn the pivot off and empty Row Groups and Column Groups; data columns stay" onClick={()=>void commits.editModel({apply:current=>({...current,enabled:false,layout:{...current.layout,rows:[],columns:[]}})})}>Clear groups</button></div><ArrangePanel model={analytical} columns={columns} readonly={functionalLocked} onCommitModel={commitModel} onEditModel={commits.editModel} sourceInspection={authorMetadata.inspection} onRequestSourceInspection={authorMetadata.requestInspection}/></>:draftModel?<ArrangePanel model={draftModel} columns={columns} readonly={locked} onCommitModel={commitDraft}/>:notReady,foot:()=> <>{draftModel?<button type="button" disabled={locked} onClick={()=>void commitDraft(draftModel)}>Enable report model</button>:null}{analytical?<label><input type="checkbox" role="switch" checked={analytical.enabled} disabled={functionalLocked} onChange={event=>{const enabled=event.target.checked;void commits.editModel({apply:current=>({...current,enabled}),replaceKey:'pivot-enabled'});}}/>Pivot on</label>:null}<label><input type="checkbox" checked={dismissOnOutside} onChange={event=>setDismissOnOutside(dashboardId,widgetId,event.target.checked)}/>Dismiss on table click</label>{waitingForAggregation?<span className="pivot-drawer-foot-warn" title={aggregationWarning}>{aggregationWarning}</span>:null}</>},
   {id:'categories',label:'Categories',hint:'Define report categories and their transformations',badge:{text:String(analytical?.categories.length??0),tone:'count'},render:()=>analytical?<div className="table-model-authoring"><CategoryEditor model={analytical} columns={columns} readonly={locked} pending={definitionPending} onCommitModel={commitModel}/></div>:notReady},
   {id:'measures',label:'Measures',hint:'Choose aggregation for every data column',badge:{text:String(analytical?.measures.length??0),tone:'count'},render:()=>analytical?<MeasuresPanel model={analytical} columns={columns} readonly={locked} pending={definitionPending} onCommitModel={commitModel} sourceInspection={authorMetadata.inspection} onRequestSourceInspection={authorMetadata.requestInspection} periodicity={view.ready?.inspection.inputPeriodicity}/>:notReady},
   {id:'pages',label:'Pages',hint:'Select the current report page',render:()=>analytical?<div className="table-model-authoring"><PageSelector effectiveSummary={pageCandidate||pageEntry?.source==='viewer'?pageLabel:undefined} contextKey={JSON.stringify([sourceContext,viewer])} model={analytical} facet={pageMetadata.facet} readonly={functionalLocked} pending={pageMetadata.pending||view.stale} error={pageMetadata.error} onRequestFacet={pageMetadata.requestFacet} onCommitModel={commitModel} onEditModel={commits.editModel}/></div>:notReady},
   {id:'formulas',label:'Formulas',hint:'Source and aggregate expressions',badge:{text:String(analytical?.formulas.length??0),tone:'count'},render:()=>analytical?<div className="table-model-authoring"><FormulaPanel authoring={formulaAuthoring} key={formulaId??'formulas'} model={analytical} columns={columns} readonly={viewer} selectedId={formulaId} inspection={metadata.inspection} onRequestInspection={requestInspection} pending={selectionPending}/></div>:notReady},
   {id:'checklists',label:'Category filters',hint:'Keep selected category members',badge:{text:String(analytical?.checklists.length??0),tone:'count'},render:()=>analytical?<div className="pivot-category-panel pivot-filter-layout"><fieldset className="pivot-category-list"><legend>Checklist category</legend><select aria-label="Checklist category" value={checklistCategory} onChange={event=>setChecklistCategory(event.target.value)}><option value="">Choose category</option>{analytical.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><ul>{analytical.categories.map(c=><li key={c.id} data-selected={checklistCategory===c.id?'':undefined}><button type="button" onClick={()=>setChecklistCategory(c.id)}>{c.name}</button>{analytical.params.filters.some(p=>p.categoryId===c.id)?<span className="pivot-filter-tag">Param</span>:null}<span>{analytical.checklists.some(p=>p.categoryId===c.id)?`${analytical.checklists.find(p=>p.categoryId===c.id)!.memberKeys.length} selected`:'All'}</span></li>)}</ul></fieldset><div>{checklistCategory?<><FacetFilterPopover key={checklistCategory} model={analytical} categoryId={checklistCategory} facet={authorMetadata.facet} readonly={functionalLocked} pending={authorMetadata.pending} error={authorMetadata.error} onCommitModel={commitModel} onEditModel={commits.editModel}/><FilterPlacement key={`placement:${checklistCategory}`} model={analytical} categoryId={checklistCategory} readonly={functionalLocked} onEditModel={commits.editModel}/></>:<p className="pivot-panel-note">Choose a category to filter its members.</p>}</div></div>:notReady},
   {id:'resultFilters',label:'Result filters',hint:'Filter report groups by their results',badge:{text:String(analytical?.resultFilters.length??0),tone:'count'},render:()=>analytical?<div className="table-model-authoring"><ResultFilterPanel model={analytical} columns={columns} readonly={locked} pending={definitionPending} onCommitModel={commitModel}/></div>:notReady},
   {id:'inspect',label:'Saved',subLabel:'Model',hint:'Saved definitions, warnings and repair',render:()=>inspector},
   {id:'statement',label:'Statement template',tabOf:'inspect',subLabel:'Statement template',hint:'Map source facts · preview · apply a pinned financial statement',render:()=>view.definition.analytical===undefined||statementRecognized?<StatementPanel raw={view.definition.analytical} columns={columns} readonly={viewer||definitionPending||selectionPending||view.status==='updating'||!repairColumns} contextKey={authoringContext} onPreview={previewStatement} onCompanies={statementCompanies} onCommit={commitStatement}/>:<p className="pivot-panel-note">This table already uses a report model. Statement templates apply to tables without one; review or repair the saved model under Model.</p>},
  ];
  const summary=statementRecognized?'Statement model':analytical?.enabled?[analytical.layout.rows.map(id=>analytical.categories.find(c=>c.id===id)?.name??id).join(' › '),analytical.layout.columns.map(id=>analytical.categories.find(c=>c.id===id)?.name??id).join(' › ')].filter(Boolean).join(' × ')||'Report model · no groups':isPivoting(view.definition.table.pivot,new Set((view.ready?.inspection.inputColumns??[]).map(c=>c.id)))?'Report model off':'Pivot off';
  return <div ref={root} className="table-with-pivot" style={{'--pivot-split':`${clampSplitPct(splitPct)*100}%`} as import('react').CSSProperties}>
   {view.error?<p role="alert" className="pivot-note">{view.error}</p>:view.status==='updating'?<p role="status" className="pivot-note">Updating…</p>:null}
   {definitionPending?<p role="status" className="pivot-note">Saving table…</p>:null}
   {definitionError?<p role="alert" className="pivot-note">{definitionError}</p>:null}
   {view.ready?.diagnostics.filter(d=>d.code==='SELECTION_RECONCILED').map((d,i)=><p role="status" className="pivot-note" key={i}>{d.message}</p>)}
   {view.ready?.completeness.warnings.map((warning,i)=><p className="pivot-note" key={i}>{warning}</p>)}
   {!view.ready&&!view.error?<p className="empty-state">Loading…</p>:null}
   {analytical&&filterRow&&view.ready?<SourceFilterPanel columns={columns} formulas={analytical.formulas.filter(f=>f.scope==='source')} onRequestFormula={setFilterFormulaId} formulaKind={sourceFilterDefinition?.kind==='formula'?sourceFilterDefinition.sourceFilterKind:undefined} pending={sourceMetadata.pending} error={sourceMetadata.error} dateContext={dateContext} filters={view.definition.table.columnFilters??NO_FILTERS} readonly={viewer||!!view.error} busy={locked} onChange={(id,value)=>patch({columnFilters:[...(view.definition.table.columnFilters??[]).filter(f=>f.id!==id),...(value===undefined||value===''?[]:[{id,value}])]})}/>:null}
   {analytical?.enabled&&analytical.measures.some(m=>m.aggregation==='first'||m.aggregation==='last')&&new Set(analytical.categories.filter(c=>c.transform!=='native'||c.legacyBucket).map(c=>c.sourceFieldId)).size!==1?<p role="status">First/Last needs a date category in report mode.</p>:null}
   {view.ready&&index.count===0?<p className="empty-state" hidden={tableHidden}>{view.ready.diagnostics.find(d=>d.code.startsWith('PIVOT_PARAM_'))?.message??view.ready.diagnostics.find(d=>d.severity==='error')?.message??'No rows.'}</p>:null}
   <PivotDrawer dashboardId={dashboardId} widgetId={widgetId} sections={sections} layout={geometry} splitPct={clampSplitPct(splitPct)}/>
   {drawer.open&&geometry.mode==='split'?<PivotSplitter bodyH={geometry.bodyH} splitPct={splitPct} onChange={setSplitPct}/>:null}
   {view.ready?<TableRenderer data={rows} autosizeKey={autosizeKey} execution={execution} executionHidden={tableHidden&&geometry.measured} executionIdentity={identity} onExecutionOutside={()=>dispatchDrawer(dashboardId,widgetId,{kind:'outside'})} onCellClick={onCellClick} state={view.definition.table} onStateChange={patch} filterRow={filterRow&&!analytical} dateContext={dateContext}/>:null}
   <PivotFooterStrip dashboardId={dashboardId} widgetId={widgetId} summary={summary} tableHidden={tableHidden}/>
  </div>;
}
/** What a backend table brings to the runtime table that a local file has not. */
type RuntimeExtras = { spec?: TableSpec; onCellClick?: (click: CellClickEvent) => void; boundsRows?: Row[] };
export function LocalTableRenderer(props: Parameters<typeof LegacyLocalTableRenderer>[0] & RuntimeExtras & { executionIdentity?: TableExecutionIdentity }) {
  return props.executionIdentity && !props.transposed
    ? <RuntimeTable key={JSON.stringify(props.executionIdentity)} {...props} identity={props.executionIdentity} />
    : <LegacyLocalTableRenderer {...props} />;
}
