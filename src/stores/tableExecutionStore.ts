// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { filterDateContext, resolveDateFilters } from "../lib/dateFilters";
import {categoryRecipe} from '../lib/tableModel/categories';
import { resolvePivotParams,composePivotParams,type PivotGroupCandidate } from '../lib/pivotParamGroups';
import { useDashboardStore } from './dashboardStore';
import { validateTableModel as validateAnalyticalModel } from '../lib/tableModel/validation';
import { activeRuntimeKeys, validateRuntimeParams, type RuntimeParams } from '../lib/tableExecution/runtimeParams';
import { validateLinkedBindings } from '../lib/tableModel/linkedBindings';
import type { TableCommitGuard } from './dashboardStore';
import type { Dashboard, DashboardCard } from '../lib/types';
import { fitsTableWorker, isBackendTable, isManagedTable, isWorkerTableProducer } from "../lib/tableExecution/eligibility";
import { datasetFromRows } from "../lib/localTableData";
import { tableColumns, tableRows } from "../lib/tableColumns";
import { useWidgetRegistryStore } from "./widgetRegistryStore";
import { LOCAL_TABLE_ID } from '../lib/builtins';
import { readLocalFile } from '../lib/localFiles';
import { validateGraph } from '../lib/widgetData/graph';
import type { SourceAdapter } from '../lib/widgetData/source';
import type { ExecutionProvider, ProviderSession, LocalWorkerExecutor, TableDefinition, SelectionSpec, Revision, ViewReady } from '../lib/tableExecution/types';
import { ExecutionProtocolError, validateTableModel } from '../lib/tableExecution/validation';
import { createManagedTableProvider, createTableProvider, resolveTableEngine, type TableEngine } from '../lib/tableExecution/rust/providerFactory';
import { useBackendsStore } from './backendsStore';
import { statementYearEnds } from '../hooks/useStatementYearEnds';
import { tableExecutorAdapter } from '../lib/tableExecution/rust/providerContract';
import { beginSubset, appendSubset, commitSubset } from '../lib/tableExecution/subsetTransfer';
import { until } from '../lib/tableExecution/workerClient';
/** Declarative model equality ignores object key insertion order. */
function sameConfig(a: unknown, b: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameConfig(left[key], right[key], seen));
}
export type ViewState = {
  status: 'pending' | 'ready' | 'empty' | 'updating' | 'blocked' | 'failed' | 'unavailable';
  requested: Revision;
  active?: Revision;
  /** Exact producer revision used by this completed linked result (charts mirror it). */
  sourceRevision?: Revision;
  ready?: ViewReady;
  definition: TableDefinition;
  selection: SelectionSpec;
  stale: boolean;
  error?: string;
};
type Node = {
  card: DashboardCard;
  runtimeParams: RuntimeParams;
  groupCandidates: readonly PivotGroupCandidate[];
  groupDiagnostics:{key:string;message:string}[];
  view: ViewState;
  executor?: LocalWorkerExecutor;
  managed?: ProviderSession;
  managedOwners?: Map<LocalWorkerExecutor, { retire: () => void; dispose: () => void }>;
  acquired: boolean;
  incomingColumns?: import('../lib/widgetData/types').DatasetColumn[];
  sourceRevision?: Revision;
  controller?: AbortController;
  acquisition?: { controller: AbortController; promise: Promise<void> };
  version: number;
  promise?: Promise<void>;
};
type Runtime = {
  nodes: Map<string, Node>;
  seen: Set<string>;
  invalid?: string;
  groups?:Dashboard['groups'];
  groupsDisabled?:boolean;
  /** The dashboard's exchange: whose calendar a date filter's `bd` steps on. */
  exchange?: string;
  leases: number;
  jobs: Set<Promise<void>>;
};
export type ExecutionDependencies = {
  viewerAuthority?: {isViewer:()=>boolean;subscribe:(listener:()=>void)=>()=>void};
  managedProvider?: (card: DashboardCard) => ExecutionProvider;
  executor?: (id: string) => LocalWorkerExecutor;
  engine?: TableEngine;
  source: (card: DashboardCard) => SourceAdapter | undefined;
  reconcileSelection?: (dashboardId: string, widgetId: string, definition: TableDefinition, selection: SelectionSpec, guard: TableCommitGuard) => Promise<boolean>;
};
/**
 * The rows each backend table card fetched, handed over by its WidgetCard so
 * the worker never fetches a second time. `ready` settles on the first rows.
 */
const backendRows = new Map<string, { data?: unknown; ready: Promise<void>; resolve: () => void }>();
function rowsEntry(id: string) {
  let entry = backendRows.get(id);
  if (!entry) {
    let resolve!: () => void;
    const ready = new Promise<void>(r => { resolve = r; });
    entry = { ready, resolve };
    backendRows.set(id, entry);
  }
  return entry;
}
/**
 * A backend table the user never hid columns on hides its widgets.json
 * `hide: true` columns, as TableRenderer's hiddenFields does in-thread.
 */
function defaultHidden(card: DashboardCard, table: TableDefinition['table']): TableDefinition['table'] {
  if (table.hidden || !isBackendTable(card)) return table;
  const hidden = useWidgetRegistryStore.getState().find(card.backendId, card.widgetId)?.table?.columns?.filter(c => c.hide === true).map(c => c.field) ?? [];
  return hidden.length ? { ...table, hidden } : table;
}
export function backendTableSource(card: DashboardCard): SourceAdapter {
  return { async acquire() {
    const entry = rowsEntry(card.id);
    await entry.ready;
    // The card's own fetch failed: its children must not keep the previous rows.
    if (entry.data instanceof Error) throw entry.data;
    if (!fitsTableWorker(entry.data)) throw new Error('This table is too large for the table engine');
    const spec = useWidgetRegistryStore.getState().find(card.backendId, card.widgetId)?.table;
    // Copied: datasetFromRows fills absent keys, and these rows are also on screen.
    const rows = (tableRows(entry.data) ?? []).map(row => ({ ...row }));
    const columns = spec ? tableColumns(rows, spec).map(c => ({ id: c.field, label: c.header, ...(c.cellDataType ? { dtype: c.cellDataType } : {}), ...(c.format ? { format: c.format } : {}) })) : [];
    return { kind: 'dataset', dataset: datasetFromRows(rows, card.id, 0, 'backend', undefined, columns) };
  } };
}
/** Only this store owns acquisition and activation; UI caches consume exact active revisions. */
export function createTableExecutionStore(deps: ExecutionDependencies) {
  const makeExecutor = deps.executor ?? ((id: string) => createTableProvider(id, deps.engine ?? resolveTableEngine()));
  const managedProvider = deps.managedProvider ?? ((card: DashboardCard) => {
    const backend=useBackendsStore.getState().backends.find(b=>b.id===card.backendId);
    if(!backend) throw new Error('Managed connection unavailable; reconnect or rebind the source');
    return createManagedTableProvider(backend);
  });
  async function openManaged(node: Node, inputRevision: number, signal: AbortSignal) {
    const source=node.card.managedSource;
    if(!source || source.version!==1 || !source.sourceId) throw new Error('Source unavailable; re-upload or rebind a source');
    return managedProvider(node.card).open({kind:'remote',sourceId:source.sourceId,snapshotId:'',managed:{version:1,inputRevision}},
      {protocolVersion:1,widgetId:node.card.id,locale:new Intl.Collator().resolvedOptions().locale,signal});
  }
  /** A replaced derived session remains alive for already admitted consumers. */
  function adaptManaged(node: Node, session: ProviderSession): LocalWorkerExecutor {
    const adapter = tableExecutorAdapter(session);
    let leases = 0, retired = false, disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; adapter.dispose(); node.managedOwners?.delete(executor); };
    const retain = () => {
      if (disposed || retired) throw new Error('Table result session was replaced; retry with the current result');
      leases++;
      let released = false;
      return () => { if (released) return; released = true; leases--; if (retired && leases === 0) dispose(); };
    };
    const executor: LocalWorkerExecutor = {
      ...adapter,
      importFile: async () => { throw new Error('Managed sources require upload or registration'); },
      identityWitness: (...args) => adapter.identityWitness!(...args),
      async chartData(...args) { const release = retain(); try { return await adapter.chartData(...args); } finally { release(); } },
      presented(...args) {
        // Async generator bodies start on next(), but ownership begins at acquisition.
        const release = retain(), signal = args[1];
        const finish = () => { signal.removeEventListener('abort', abort); release(); };
        const iterator = (async function* () {
          try { yield* adapter.presented(...args); } finally { finish(); }
        })();
        const close = iterator.return.bind(iterator);
        iterator.return = async value => { try { return await close(value); } finally { finish(); } };
        const fail = iterator.throw.bind(iterator);
        iterator.throw = async error => { try { return await fail(error); } finally { finish(); } };
        const abort = () => { void iterator.return(undefined).catch(() => { /* caller observes read cancellation */ }); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        return iterator;
      },
      dispose,
    };
    node.managedOwners ??= new Map();
    node.managedOwners.set(executor, { dispose, retire: () => { retired = true; if (leases === 0) dispose(); } });
    return executor;
  }
  function retireExecutor(node: Node, executor: LocalWorkerExecutor | undefined) {
    if (!executor) return;
    const owner = node.managedOwners?.get(executor);
    if (owner) owner.retire(); else executor.dispose();
  }
  function disposeNode(node: Node) {
    node.executor?.dispose();
    for (const owner of node.managedOwners?.values() ?? []) owner.dispose();
  }
  const dashboards = new Map<string, Runtime>(), listeners = new Set<() => void>(), missingViews = new Map<string, ViewState>();
  const emit = () => listeners.forEach(fn => fn());
  const get = (d: string, id: string) => dashboards.get(d)?.nodes.get(id);
  const emptyCandidates=Object.freeze([]) as readonly PivotGroupCandidate[];
  const emptyRuntime=Object.freeze({}) as RuntimeParams;
  const snapshotRuntime=(value:RuntimeParams):RuntimeParams=>{const copy=structuredClone(value);for(const entry of Object.values(copy)){if(entry.source==='viewer'&&entry.memberKeys)Object.freeze(entry.memberKeys);Object.freeze(entry);}return Object.freeze(copy);};
  const snapshotCandidates=(candidates:readonly PivotGroupCandidate[])=>{const copy=structuredClone(candidates);for(const candidate of copy){Object.freeze(candidate.entry);Object.freeze(candidate);}return Object.freeze(copy);};
  const viewer=()=>deps.viewerAuthority?.isViewer()===true;
  function prune(node:Node,next:TableDefinition,sourceChanged=false):boolean {
    const previous=validateAnalyticalModel(node.view.definition.analytical).model;
    const model=validateAnalyticalModel(next.analytical).model;
    const active=model?activeRuntimeKeys(model):new Map<string,string>();
    const prior=previous?activeRuntimeKeys(previous):new Map<string,string>();
    const retained=Object.fromEntries(Object.entries(node.runtimeParams).filter(([key])=>!sourceChanged&&active.has(key)&&active.get(key)===prior.get(key)&&categoryRecipe(model!.categories.find(c=>c.id===active.get(key))!)===categoryRecipe(previous!.categories.find(c=>c.id===prior.get(key))!)));
    if(sameConfig(node.runtimeParams,retained))return false;
    node.runtimeParams=snapshotRuntime(retained);return true;
  }
  function invalidate(runtime: Runtime, id: string, acquire = false, visited = new Set<string>()) {
    if (visited.has(id))
      return;
    visited.add(id);
    const node = runtime.nodes.get(id);
    if (!node)
      return;
    node.controller?.abort();
    node.version++;
    node.promise = undefined;
    if (acquire) {
      node.acquisition?.controller.abort();
      node.acquisition = undefined;
      node.acquired = false;
      node.sourceRevision = undefined;
    }
    node.view = { ...node.view, status: node.view.active ? 'updating' : 'pending', stale: !!node.view.active, error: undefined, requested: { ...node.view.requested, model: node.view.requested.model + 1, output: node.view.requested.output + 1 } };
    for (const child of runtime.nodes.values())
      if (child.card.linkedSource?.sourceWidgetId === id)
        invalidate(runtime, child.card.id, false, visited);
  }
  function unavailable(node: Node, status: 'blocked' | 'unavailable' | 'failed', error: string) {
    node.view = { ...node.view, status, error, stale: !!node.view.active };
    emit();
  }
  function acquireInput(runtime: Runtime, node: Node, source: SourceAdapter): Promise<void> {
    if (node.acquired)
      return Promise.resolve();
    if (node.acquisition)
      return node.acquisition.promise;
    const acquisition = { controller: new AbortController(), promise: Promise.resolve() };
    node.acquisition = acquisition;
    const executor = node.executor!;
    const inputRevision = node.view.requested.input + 1;
    node.view = { ...node.view, requested: { ...node.view.requested, input: inputRevision } };
    const ownsAcquisition = () => !acquisition.controller.signal.aborted && node.acquisition === acquisition && runtime.nodes.get(node.card.id) === node && !runtime.invalid;
    acquisition.promise = (async () => {
      // Model generations may change while this shared acquisition remains valid.
      const acquired = await acquireWithCancellation(source, acquisition.controller.signal);
      if (!ownsAcquisition())
        throw new DOMException('Acquisition cancelled', 'AbortError');
      if (acquired.kind === 'file') {
        // Statement rows are relabelled in the worker: a first import names their reporters, the
        // main thread asks the card's year-end backend, and a second import relabels with the answers.
        // ponytail: the file is parsed twice when it holds statement rows; keep the parse if it shows.
        const reporters = await executor.importFile(acquired.name, acquired.bytes, inputRevision, acquisition.controller.signal, {});
        if (reporters?.length && acquired.yearEnds) {
          const yearEnds = await acquired.yearEnds(reporters);
          if (!ownsAcquisition())
            throw new DOMException('Acquisition cancelled', 'AbortError');
          await executor.importFile(acquired.name, acquired.bytes, inputRevision, acquisition.controller.signal, yearEnds);
        }
      } else
        await executor.registerInput(acquired.dataset, inputRevision, acquisition.controller.signal);
      if (!ownsAcquisition())
        throw new DOMException('Acquisition cancelled', 'AbortError');
      node.acquired = true;
    })().finally(() => {
      if (node.acquisition === acquisition)
        node.acquisition = undefined;
    });
    return acquisition.promise;
  }
  function ensure(d: string, id: string): Promise<void> {
    const runtime = dashboards.get(d), node = get(d, id);
    if (!runtime || !node)
      return Promise.resolve();
    if (runtime.invalid) {
      unavailable(node, 'blocked', runtime.invalid);
      return Promise.resolve();
    }
    try {
      // Validate the original imported intent before defaults/toolkit overlays can mask it.
      if (node.card.tableDefinition !== undefined || node.card.tableSelection !== undefined)
        validateTableModel(node.card.tableDefinition === undefined ? { table: node.card.table ?? {}, search: '' } : node.card.tableDefinition,
          node.card.tableSelection === undefined ? { kind: 'none' } : node.card.tableSelection);
      validateTableModel(node.view.definition, node.view.selection);
    }
    catch (error) {
      node.controller?.abort();
      node.acquisition?.controller.abort();
      disposeNode(node); node.executor = undefined; node.managed=undefined; node.acquired = false;
      unavailable(node, 'blocked', error instanceof Error ? error.message : 'Invalid table definition');
      return Promise.resolve();
    }
    if (!node.card.linkedChart && !isWorkerTableProducer(node.card)) {
      unavailable(node, 'unavailable', 'This presentation is unavailable as a table source; restore Table view');
      return Promise.resolve();
    }
    if (node.promise)
      return node.promise;
    if (node.view.status === 'ready' || node.view.status === 'empty')
      return Promise.resolve();
    const version = node.version, controller = new AbortController();
    node.controller = controller;
    // Noncooperative acquisition/transport must still never activate an obsolete generation.
    const current = () => !controller.signal.aborted && dashboards.get(d) === runtime && runtime.nodes.get(id) === node && node.version === version;
    const job = (async () => {
      let candidate: {session: ProviderSession; executor: LocalWorkerExecutor; upstream: Revision; columns: import('../lib/widgetData/types').DatasetColumn[]} | undefined;
      try {
        const sourceId = node.card.linkedSource?.sourceWidgetId;
        if (sourceId) {
          const parent = runtime.nodes.get(sourceId);
          if (!parent) {
            unavailable(node, 'unavailable', `Source ${sourceId} unavailable; choose a source`);
            return;
          }
          await ensure(d, sourceId);
          if (!current())
            return;
          if (!parent.view.active || !['ready', 'empty'].includes(parent.view.status)) {
            unavailable(node, parent.view.status === 'unavailable' ? 'unavailable' : 'blocked', `Source ${sourceId}: ${parent.view.error ?? parent.view.status}`);
            return;
          }
          const upstream = { ...parent.view.active };
          if (node.card.linkedChart) {
            node.view = { ...node.view, status: parent.view.status, active: upstream, requested: upstream, sourceRevision: upstream, ready: parent.view.ready, stale: false, error: undefined };
            emit();
            return;
          }
          if (!node.acquired || !node.sourceRevision || !sameRevision(node.sourceRevision, upstream)) {
            if (parent.managed) {
              if (parent.managed.consistency?.kind !== 'snapshot' || !parent.managed.capabilities.linkedDerivation || !parent.managed.deriveLinked)
                throw new Error('This server does not support linked result derivation');
              const inputRevision = node.view.requested.input + 1;
              node.view = { ...node.view, requested: { ...node.view.requested, input: inputRevision } };
              const session = await parent.managed.deriveLinked(upstream, { protocolVersion: 1, widgetId: id, inputRevision,
                locale: new Intl.Collator().resolvedOptions().locale, signal: controller.signal });
              if (!current()) { session.result.dispose(); return; }
              candidate = { session, executor: adaptManaged(node, session), upstream, columns: parent.view.ready!.columns };
            } else {
            let transaction: ReturnType<typeof beginSubset> | undefined;
            for await (const batch of parent.executor!.presented(upstream, controller.signal)) {
              if (!current() || parent.view.active !== undefined && !sameRevision(parent.view.active, upstream))
                return;
              transaction ??= beginSubset(batch.transferId, upstream);
              appendSubset(transaction, batch);
            }
            if (!current() || !transaction)
              return;
            // No child registration/calculation until the entire exact producer revision arrives.
            const data = commitSubset(transaction);
            node.executor ??= makeExecutor(id);
            node.view = { ...node.view, requested: { ...node.view.requested, input: node.view.requested.input + 1 } };
            await node.executor.registerInput(data, node.view.requested.input, controller.signal);
            if (!current()) return;
            node.acquired = true;
            node.sourceRevision = upstream;
            node.incomingColumns = data.columns;
            }
          }
        }
        else if (isManagedTable(node.card)) {
          if (!node.acquired) {
            const inputRevision=node.view.requested.input+1;
            node.view={...node.view,requested:{...node.view.requested,input:inputRevision}};
            if(!node.managed) {
              const session=await openManaged(node,inputRevision,controller.signal);
              if(!current()){session.result.dispose();return;}
              node.managed=session;
              node.executor=adaptManaged(node,session);
            }
            node.acquired=true;
          }
        }
        else {
          const source = deps.source(node.card);
          if (!source) {
            unavailable(node, 'unavailable', 'Source unavailable; choose a source');
            return;
          }
          node.executor ??= makeExecutor(id);
          await acquireInput(runtime, node, source);
        }
        if (!current())
          return;
        const incomingColumns = candidate?.columns ?? node.incomingColumns;
        if (node.card.linkedSource && incomingColumns) validateLinkedBindings(node.view.definition, incomingColumns);
        // Only the root's private full input can prove a linked identity vanished.
        const provenAbsentIds: string[] = [];
        let witnessUnavailable = false;
        if (node.card.linkedSource && node.view.selection.kind !== 'none') {
          const path: Node[] = [node];
          while (path[0].card.linkedSource) {
            const ancestor = runtime.nodes.get(path[0].card.linkedSource!.sourceWidgetId);
            if (!ancestor) break;
            path.unshift(ancestor);
          }
          const root = path[0], rootRevision = root.view.active;
          const candidates = [...new Set(node.view.selection.kind === 'explicit' ? node.view.selection.ids : node.view.selection.excludedIds)];
          const generations = path.map(ancestor => ancestor.version);
          const witnessCurrent = () => current() && path.every((ancestor, i) => runtime.nodes.get(ancestor.card.id) === ancestor && ancestor.version === generations[i])
            && !!rootRevision && !!root.view.active && sameRevision(rootRevision, root.view.active);
          witnessUnavailable = path.length > 64;
          if (path.length <= 64 && rootRevision && root.executor?.identityWitness) {
            for (let offset = 0; offset < candidates.length; offset += 1200) {
              const ids = candidates.slice(offset, offset + 1200);
              const proof = await root.executor.identityWitness(rootRevision, path.map(ancestor => ancestor.view.definition), ids, controller.signal);
              if (!witnessCurrent()) return;
              if (!sameRevision(proof.revision, rootRevision)) return;
              // Bind answers to their query: incomplete/duplicate answers prove nothing.
              for (const id of ids) {
                const answers = proof.identities.filter(witness => witness.id === id);
                if (answers.length === 1 && answers[0].state === 'absent') provenAbsentIds.push(id);
              }
            }
          }
        }
        const composed=composePivotParams(node.groupCandidates,node.runtimeParams);
        // A date filter's expression (T-1bd ...) is stored as text and resolved
        // to its day here, every time the model is applied -- so each refresh
        // moves it. The stored definition keeps the text.
        const stored = node.view.definition, filters = stored.table.columnFilters;
        const applied = filters?.length ? { ...stored, table: { ...stored.table, columnFilters: resolveDateFilters(filters, filterDateContext(runtime.exchange)) } } : stored;
        const requested = { ...node.view.requested }, ready = await (candidate?.executor ?? node.executor)!.applyModel(applied, node.view.selection, requested, controller.signal, !node.card.linkedSource, node.view.ready?.selectionNamespace, provenAbsentIds, composed.runtime);
        if (!current() || !sameRevision(ready.revision, requested))
          return;
        ready.diagnostics.push(...[...node.groupDiagnostics,...composed.diagnostics].slice(0,64).map(d=>({code:'PIVOT_GROUP_REFUSED',severity:'warning' as const,message:d.message})));
        if (witnessUnavailable) ready.diagnostics.push({ code: 'IDENTITY_WITNESS_UNAVAILABLE', severity: 'info', message: 'Selection identities retained because this source chain exceeds the identity proof limit.' });
        if (ready.selection && !sameConfig(ready.selection, node.view.selection)) {
          const selection = structuredClone(ready.selection), definition = structuredClone(node.view.definition);
          const guard: TableCommitGuard = {
            expected: structuredClone(node.card), isCurrent: current,
            beforePublish: () => {
              if (!current()) return;
              node.card = { ...node.card, table: definition.table, tableDefinition: definition, tableSelection: selection };
              node.view = { ...node.view, selection };
            },
          };
          if (deps.reconcileSelection && !viewer()) {
            const accepted = await deps.reconcileSelection(d, id, definition, selection, guard);
            if (!current()) return;
            if (!accepted) { unavailable(node, 'failed', 'Selection reconciliation could not be saved; retry the table.'); return; }
          } else if(viewer()) node.view={...node.view,selection};
          else guard.beforePublish();
        }
        if (candidate) {
          const previous = node.executor;
          node.executor = candidate.executor; node.managed = candidate.session;
          node.sourceRevision = candidate.upstream; node.incomingColumns = candidate.columns; node.acquired = true;
          candidate = undefined;
          retireExecutor(node, previous);
        }
        node.view = { ...node.view, active: requested, sourceRevision: node.sourceRevision, ready, status: ready.topLevelCount === 0 ? 'empty' : 'ready', stale: false, error: undefined };
        emit();
      }
      catch (error) {
        if (current())
          unavailable(node, error instanceof ExecutionProtocolError && error.descriptor.code === 'MISSING_FIELD' ? 'blocked' : 'failed', error instanceof Error ? error.message : 'Table execution failed');
      } finally { candidate?.executor.dispose(); }
    })().finally(() => {
      runtime.jobs.delete(job);
      if (current()) {
        node.promise = undefined;
        for (const child of runtime.nodes.values())
          if (child.card.linkedSource?.sourceWidgetId === id && ['pending', 'updating'].includes(child.view.status))
            void ensure(d, child.card.id);
      }
    });
    node.promise = job;
    runtime.jobs.add(job);
    return job;
  }
  const api = {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    syncDashboard(dashboard: Dashboard) {
      const runtime: Runtime = dashboards.get(dashboard.id) ?? { nodes: new Map(), seen: new Set(), leases: 0, jobs: new Set() };
      dashboards.set(dashboard.id, runtime);runtime.groups=dashboard.groups;runtime.groupsDisabled=dashboard.groupsDisabled;runtime.exchange=dashboard.exchange;
      const cards = dashboard.tabs.flatMap(tab => tab.cards).filter(c => c.widgetId === LOCAL_TABLE_ID || c.linkedSource || isBackendTable(c) || isManagedTable(c));
      const ids = new Set(cards.map(c => c.id));
      // A previously owned deleted source is unavailable, whereas foreign persisted references are invalid.
      const graph = cards.map(c => ({ id: c.id, source: c.linkedSource?.sourceWidgetId, producer: !c.linkedChart }));
      const missing = [...new Set(graph.flatMap(n => n.source && !ids.has(n.source) && runtime.seen.has(n.source) ? [n.source] : []))];
      try {
        for (const card of cards) {
          if (typeof card.id !== 'string' || !card.id) throw new Error('Invalid table identity');
          const source = card.linkedSource;
          if (source !== undefined && (!source || source.kind !== 'widget' || typeof source.sourceWidgetId !== 'string' || !source.sourceWidgetId))
            throw new Error(`Invalid source reference on ${card.id}; choose a source in this dashboard`);
        }
        // Only tables feed linked tables: a backend chart or metric is on the dashboard yet not a source (#21).
        const onDashboard = new Set(dashboard.tabs.flatMap(tab => tab.cards).map(c => c.id));
        for (const node of graph)
          if (node.source && !ids.has(node.source) && onDashboard.has(node.source))
            throw new Error(`Card ${node.source} cannot feed a linked table; only a table can`);
        validateGraph([...graph, ...missing.map(id => ({ id }))]);
        runtime.invalid = undefined;
      }
      catch (error) {
        runtime.invalid = (error as Error).message;
      }
      for (const [id, node] of runtime.nodes)
        if (!ids.has(id)) {
          node.controller?.abort();
          node.acquisition?.controller.abort();
          node.acquisition = undefined;
          disposeNode(node);
          runtime.nodes.delete(id);
          backendRows.delete(id);
          for (const child of runtime.nodes.values())
            if (child.card.linkedSource?.sourceWidgetId === id)
              invalidate(runtime, child.card.id);
        }
      for (const card of cards) {
        const existing = runtime.nodes.get(card.id), definition:TableDefinition = { ...(card.tableDefinition ?? { search: '' }), table: defaultHidden(card, card.table ?? card.tableDefinition?.table ?? {}) }, selection = card.tableSelection ?? { kind: 'none' };
        const baseline=resolvePivotParams(validateAnalyticalModel(definition.analytical).model,card.bindings,dashboard.groups,dashboard.groupsDisabled);
        if (!existing)
          runtime.nodes.set(card.id, { card: structuredClone(card), runtimeParams:emptyRuntime, groupCandidates:snapshotCandidates(baseline.candidates),groupDiagnostics:baseline.diagnostics, acquired: false, version: 0, view: { status: 'pending', requested: { widgetId: card.id, input: 0, model: 1, output: 1 }, definition: structuredClone(definition), selection: structuredClone(selection), stale: false } });
        else {
          const sourceChanged = JSON.stringify([existing.card.params, existing.card.linkedSource, existing.card.managedSource, existing.card.backendId, existing.card.widgetId]) !== JSON.stringify([card.params, card.linkedSource, card.managedSource, card.backendId, card.widgetId]) || isWorkerTableProducer(existing.card) !== isWorkerTableProducer(card);
          // Compare against the last persisted card, separately from live runtime edits.
          const definitionChanged = !sameConfig(existing.card.tableDefinition, card.tableDefinition);
          const tableChanged = !sameConfig(existing.card.table, card.table);
          const selectionChanged = !sameConfig(existing.card.tableSelection, card.tableSelection);
          const nextDefinition = definitionChanged ? definition : tableChanged
            ? { ...existing.view.definition, table: definition.table } : existing.view.definition;
          const nextSelection = selectionChanged ? selection : existing.view.selection;
          const modelChanged = !sameConfig(existing.view.definition, nextDefinition) || !sameConfig(existing.view.selection, nextSelection);
          const runtimeChanged=prune(existing,nextDefinition,sourceChanged);
          const liveBaseline=resolvePivotParams(validateAnalyticalModel(nextDefinition.analytical).model,card.bindings,dashboard.groups,dashboard.groupsDisabled);
          const groupsChanged=!sameConfig(existing.groupCandidates,liveBaseline.candidates)||!sameConfig(existing.groupDiagnostics,liveBaseline.diagnostics);
          existing.groupCandidates=snapshotCandidates(liveBaseline.candidates);existing.groupDiagnostics=liveBaseline.diagnostics;
          existing.card = structuredClone(card);
          if (modelChanged) {
            existing.view = { ...existing.view, definition: structuredClone(nextDefinition), selection: structuredClone(nextSelection) };
          }
          if(sourceChanged && existing.managed){disposeNode(existing);existing.executor=undefined;existing.managed=undefined;}
          if (sourceChanged || modelChanged || runtimeChanged || groupsChanged)
            invalidate(runtime, card.id, sourceChanged);
          if (!card.linkedChart && !isWorkerTableProducer(card)) {
            disposeNode(existing);
            existing.executor = undefined;
            unavailable(existing, 'unavailable', 'This presentation is unavailable as a table source; restore Table view');
          }
        }
        runtime.seen.add(card.id);
      }
      if (runtime.invalid)
        for (const node of runtime.nodes.values()) {
          node.controller?.abort();
          node.acquisition?.controller.abort();
          node.acquisition = undefined;
          disposeNode(node);
          node.executor = undefined;
          node.managed = undefined;
          node.acquired = false;
          node.promise = undefined;
          unavailable(node, 'blocked', runtime.invalid);
        }
      emit();
      for (const node of runtime.nodes.values())
        if (!runtime.invalid && node.card.linkedSource && !runtime.nodes.has(node.card.linkedSource.sourceWidgetId))
          unavailable(node, 'unavailable', `Source ${node.card.linkedSource.sourceWidgetId} unavailable; choose a source`);
      if (runtime.leases || [...runtime.nodes.values()].some(n => n.executor))
        for (const card of cards)
          void ensure(dashboard.id, card.id);
    },
    /** A backend table card's newly fetched rows; a change re-acquires the table. */
    setBackendRows(d: string, id: string, data: unknown) {
      const entry = rowsEntry(id);
      if (entry.data === data) return;
      const replaced = 'data' in entry;
      entry.data = data;
      entry.resolve();
      const runtime = dashboards.get(d), node = runtime?.nodes.get(id);
      // A node that failed on the previous rows (too large, fetch error) retries on new ones.
      if (!replaced || !runtime || !node || (!node.acquired && !node.acquisition && !node.view.error)) return;
      invalidate(runtime, id, true);
      emit();
      void ensure(d, id);
    },
    ensureTable(d: string, id: string) {
      void ensure(d, id);
    },
    readGroupCandidates(d:string,id:string):readonly PivotGroupCandidate[] {return get(d,id)?.groupCandidates??emptyCandidates;},
    readRuntimeParams(d:string,id:string):RuntimeParams {return get(d,id)?.runtimeParams??emptyRuntime;},
    setViewerParam(d:string,id:string,key:string,memberKeys:string[]|null) {
      if(!viewer())throw new Error('Viewer authority is required');
      const node=get(d,id),runtime=dashboards.get(d);if(!node||!runtime)throw new Error('Table unavailable');
      if(typeof key!=='string')throw new Error('Invalid runtime key');
      const next=validateRuntimeParams({...node.runtimeParams,[key]:{source:'viewer',memberKeys}},node.view.definition);
      if(sameConfig(node.runtimeParams,next))return;
      node.runtimeParams=snapshotRuntime(next);invalidate(runtime,id,false);emit();void ensure(d,id);
    },
    resetViewerParams(d:string,id:string,key?:string) {
      if(!viewer())throw new Error('Viewer authority is required');
      const node=get(d,id),runtime=dashboards.get(d);if(!node||!runtime)return;
      const next={...node.runtimeParams};if(key===undefined){for(const name of Object.keys(next))delete next[name];}else delete next[key];
      if(sameConfig(node.runtimeParams,next))return;
      node.runtimeParams=snapshotRuntime(next);invalidate(runtime,id,false);emit();void ensure(d,id);
    },
    /** Set durable only from a successful commit's beforePublish callback. */
    updateDefinition(d: string, id: string, definition: TableDefinition, selection: SelectionSpec, durable = false) {
      const runtime = dashboards.get(d), node = get(d, id);
      if (!node || !runtime)
        return;
      if (durable) node.card = { ...node.card, table: structuredClone(definition.table), tableDefinition: structuredClone(definition), tableSelection: structuredClone(selection) };
      const runtimeChanged=prune(node,definition);
      const baseline=resolvePivotParams(validateAnalyticalModel(definition.analytical).model,node.card.bindings,runtime.groups,runtime.groupsDisabled);
      node.groupCandidates=snapshotCandidates(baseline.candidates);node.groupDiagnostics=baseline.diagnostics;
      if (!runtimeChanged && sameConfig(node.view.definition, definition) && sameConfig(node.view.selection, selection)) {
        void ensure(d, id);
        return;
      }
      node.view = { ...node.view, definition: structuredClone(definition), selection: structuredClone(selection) };
      invalidate(runtime, id);
      emit();
      void ensure(d, id);
    },
    refresh(d: string, id: string) {
      const runtime = dashboards.get(d);
      if (!runtime)
        return;
      let node = runtime.nodes.get(id);
      const seen = new Set<string>();
      while (node?.card.linkedSource) {
        if (seen.has(node.card.id))
          return;
        seen.add(node.card.id);
        node = runtime.nodes.get(node.card.linkedSource.sourceWidgetId);
      }
      if (!node)
        return;
      invalidate(runtime, node.card.id, true);
      emit();
      void ensure(d, node.card.id);
    },
    refreshDashboard(d: string) {
      const runtime = dashboards.get(d);
      if (runtime)
        for (const node of runtime.nodes.values())
          // A backend table refreshes when its card's refetch hands over new rows.
          if (!node.card.linkedSource && !isBackendTable(node.card))
            api.refresh(d, node.card.id);
    },
    readView(d: string, id: string): ViewState {
      const node = get(d, id);
      if (node)
        return node.view;
      const key = JSON.stringify([d, id]);
      if (!missingViews.has(key))
        missingViews.set(key, unavailableView(id));
      return missingViews.get(key)!;
    },
    /** Explicit repair inspection: retained invalid intent is never applied to an executor. */
    async repairColumns(d: string, id: string, signal: AbortSignal) {
      const runtime = dashboards.get(d), node = get(d, id);
      if (!runtime || !node || runtime.invalid) throw new Error('Table source unavailable');
      const expected = node.view;
      const current = () => !signal.aborted && get(d, id) === node && node.view === expected;
      const sourceId = node.card.linkedSource?.sourceWidgetId;
      if (sourceId) {
        await ensure(d, sourceId);
        const parent = get(d, sourceId);
        if (!current() || !parent?.view.ready || !['ready', 'empty'].includes(parent.view.status)) throw new Error('Source schema unavailable; restore the source before repairing');
        return structuredClone(parent.view.ready.columns);
      }
      if(isManagedTable(node.card)) {
        const session=await openManaged(node,1,signal);
        try {
          if(!session.result.previewDefinition)throw new Error('Source schema inspection unavailable');
          const preview=await session.result.previewDefinition({widgetId:id,input:1,model:1,output:1},{table:{},search:''},signal);
          if(!current())throw new DOMException('Inspection changed','AbortError');
          return preview.columns;
        }finally{session.result.dispose();}
      }
      const source = deps.source(node.card);
      if (!source) throw new Error('Source schema unavailable');
      const executor = makeExecutor(id);
      try {
        const acquired = await acquireWithCancellation(source, signal);
        if (!current()) throw new DOMException('Inspection changed', 'AbortError');
        if (acquired.kind === 'file') await executor.importFile(acquired.name, acquired.bytes, 1, signal);
        else await executor.registerInput(acquired.dataset, 1, signal);
        if (!executor.inputSchema) throw new Error('Source schema inspection unavailable');
        const schema = await executor.inputSchema(signal);
        if (!current()) throw new DOMException('Inspection changed', 'AbortError');
        return schema.columns;
      } finally { executor.dispose(); }
    },
    /** Compare live authoring ownership with detached cards actually accepted by this runtime.
     * Metadata only: never reads source rows or reaches behind a presented linked input. */
    sourceMatches(d: string, id: string, liveCards: readonly DashboardCard[], ownActivation?: {view:ViewState;executor:LocalWorkerExecutor}): boolean {
      const runtime=dashboards.get(d); if(!runtime||runtime.invalid)return false;
      const seen=new Set<string>(); let currentId:string|undefined=id;
      const source=(card:DashboardCard)=>[card.widgetId,card.backendId,card.params,card.linkedSource,card.managedSource,card.view];
      while(currentId) {
        if(seen.has(currentId))return false;seen.add(currentId);
        const node=runtime.nodes.get(currentId),live=liveCards.find(card=>card.id===currentId);
        if(!node||!live||!sameConfig(source(node.card),source(live)))return false;
        // Only the coordinator's exact own activation may queue another functional
        // edit over already acquired input. Acquisition and every upstream stay strict.
        const ownRecalculation=currentId===id&&node.view.status==='updating'&&node.acquired&&!node.acquisition
          &&ownActivation?.view===node.view&&ownActivation.executor===node.executor
          &&node.view.active?.input===node.view.requested.input;
        if(['pending','updating'].includes(node.view.status)&&!ownRecalculation||currentId!==id&&!['ready','empty'].includes(node.view.status))return false;
        // Upstream authored changes can invalidate a child's presented input before sync.
        if(currentId!==id&&!sameConfig([node.card.tableDefinition,node.card.table,node.card.tableSelection],[live.tableDefinition,live.table,live.tableSelection]))return false;
        const parentId=node.card.linkedSource?.sourceWidgetId;
        if(parentId&&node.acquired) {
          const parent=runtime.nodes.get(parentId);
          if(!parent?.view.active||!['ready','empty'].includes(parent.view.status)||!node.sourceRevision||!sameRevision(node.sourceRevision,parent.view.active))return false;
        }
        currentId=parentId;
      }
      return true;
    },
    reopen(d: string,id: string) {
      const runtime=dashboards.get(d),node=get(d,id);if(!runtime||!node)return;
      retireExecutor(node,node.executor);node.executor=undefined;node.managed=undefined;
      invalidate(runtime,id,true);emit();void ensure(d,id);
    },
    readCapabilities(d: string,id: string) { return get(d,id)?.managed?.capabilities; },
    readExecutor(d: string, id: string) {
      return get(d, id)?.executor;
    },
    async settled(d: string) {
      const runtime = dashboards.get(d);
      while (runtime?.jobs.size)
        await Promise.all([...runtime.jobs]);
    },
    acquireDashboard(dashboard: Dashboard) {
      api.syncDashboard(dashboard);
      const runtime = dashboards.get(dashboard.id)!;
      runtime.leases++;
      for (const id of runtime.nodes.keys())
        void ensure(dashboard.id, id);
      let released = false;
      return () => {
        if (released)
          return;
        released = true;
        runtime.leases--;
        queueMicrotask(() => {
          if (runtime.leases === 0 && dashboards.get(dashboard.id) === runtime)
            api.disposeDashboard(dashboard.id);
        });
      };
    },
    disposeDashboard(d: string) {
      const runtime = dashboards.get(d);
      if (!runtime)
        return;
      dashboards.delete(d);
      for (const node of runtime.nodes.values()) {
        node.controller?.abort();
        node.acquisition?.controller.abort();
        node.acquisition = undefined;
        disposeNode(node);
        backendRows.delete(node.card.id);
      }
      runtime.nodes.clear();
      runtime.seen.clear();
      emit();
    },
  };
  let previousViewer=viewer();
  deps.viewerAuthority?.subscribe(()=>{
    const currentViewer=viewer();if(previousViewer&&!currentViewer){for(const [d,runtime]of dashboards){for(const [id,node]of runtime.nodes){if(Object.keys(node.runtimeParams).length){node.runtimeParams=emptyRuntime;invalidate(runtime,id,false);void ensure(d,id);}}}emit();}previousViewer=currentViewer;
  });
  return api;
}
function unavailableView(id: string): ViewState {
  return { status: 'unavailable', requested: { widgetId: id, input: 0, model: 0, output: 0 }, definition: { table: {}, search: '' }, selection: { kind: 'none' }, stale: false, error: 'Table unavailable' };
}
function sameRevision(a: Revision, b: Revision) {
  return a.widgetId === b.widgetId && a.input === b.input && a.model === b.model && a.output === b.output;
}
export const tableExecutionStore = createTableExecutionStore({
  viewerAuthority:{isViewer:()=>useDashboardStore.getState().viewer,subscribe:listener=>useDashboardStore.subscribe(listener)},
  reconcileSelection: async (d, id, definition, selection, guard) => {
    const { useDashboardStore } = await import('./dashboardStore');
    return useDashboardStore.getState().commitTableDefinition(d, id, definition, selection, guard);
  }, source: card => card.widgetId === LOCAL_TABLE_ID && !card.linkedSource ? { async acquire(signal) {
      const bytes = await readLocalFile(card.params.file);
      if (signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      const backendId = card.params.fiscalYearEndBackend;
      const backend = backendId ? useBackendsStore.getState().backends.find(b => b.id === backendId) : undefined;
      return { kind: 'file', name: card.params.file, bytes, ...(backend ? { yearEnds: (symbols: string[]) => statementYearEnds(backend, symbols) } : {}) };
    } } : isBackendTable(card) ? backendTableSource(card) : undefined });
export type TableExecutionStore = ReturnType<typeof createTableExecutionStore>;

/** Release store waiters immediately even when a native read ignores cancellation. */
const acquisitionCancelled = () => new DOMException('Acquisition cancelled', 'AbortError');
async function acquireWithCancellation(source: SourceAdapter, signal: AbortSignal): ReturnType<SourceAdapter['acquire']> {
  if (signal.aborted) throw acquisitionCancelled();
  return until(source.acquire(signal), signal, acquisitionCancelled);
}
