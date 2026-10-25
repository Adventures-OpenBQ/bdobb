import { compileStatement } from '../lib/statementModel/compile';
import { cardSourceIdentity } from '../lib/cardSourceIdentity';
import type { StatementIntent } from '../lib/statementModel/types';
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { validatePivotGroupPlan, type PivotGroupPlan } from '../lib/pivotGroupChange';
import type { PivotGroupProofContext } from '../lib/tableExecution/pivotGroupProof';
import type { PivotGroupUndo, PivotGroupCommitResult, PivotGroupUndoResult } from './dashboardStore';
import type { TableModelV1 } from '../lib/tableModel/types';
import type { Dashboard, DashboardCard, TableCardState } from '../lib/types';
import type { DatasetColumn } from '../lib/widgetData/types';
import type { SelectionAction, SelectionSpec, TableDefinition } from '../lib/tableExecution/types';
import { checkAuthoringModel } from '../components/renderers/table-model/authoringValidation';
import { tableExecutionStore as runtime, type ViewState } from './tableExecutionStore';
import { useDashboardStore as dashboards } from './dashboardStore';
import { logError } from '../lib/logger';

export type CommitOutcome = { status: 'saved' | 'superseded' } | { status: 'refused'; reason: 'viewer' | 'busy' | 'stale' | 'unavailable' | 'invalid'; message: string } | { status: 'failed'; message: string };
export type AuthoringBase = { readonly token: unknown };
export type ModelEdit = { apply(current: Readonly<TableModelV1>): TableModelV1; replaceKey?: string };
export type RepairContext = { view: ViewState; columns: DatasetColumn[] };
export type CommitSnapshot = { authoringEpoch: number; pending: boolean; selectionPending: boolean; error?: string; canReplace: boolean; canEnqueue: boolean; canRepair: boolean };
export type PivotGroupOutcome = Exclude<CommitOutcome, { status: 'saved' | 'superseded' }> | PivotGroupCommitResult;
export type PivotUndoOutcome = Exclude<CommitOutcome, { status: 'saved' | 'superseded' }> | PivotGroupUndoResult;
type Base = { view: ViewState; generation: number; chain: object };
type Command = { edit: ModelEdit; resolve: (outcome: CommitOutcome) => void };
type Operation = { controller: AbortController; view: ViewState; resolve: (outcome: CommitOutcome) => void; selection: boolean; functional: boolean; published?: ViewState; awaitingPublication?: boolean; group?: boolean };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ready = (view: ViewState) => ['ready', 'empty'].includes(view.status) && !!view.ready && !view.error && !view.stale;
const refused = (reason: Extract<CommitOutcome, { status: 'refused' }>['reason'], message: string): CommitOutcome => ({ status: 'refused', reason, message });

/** One durable write lane per card. Queue entries carry intent, never speculative models. */
export class TableCommitCoordinator {
  private owners = 0;
  private session: object = {};
  private wasOwner = false;
  private proofContexts = new WeakMap<object, { table: DashboardCard['table'] }>();
  private disposed = false;
  private generation = 0;
  private chain: object = {};
  private chainActive = false;
  private observed: ViewState;
  private source: string;
  private persisted: unknown[];
  private activationExecutor?: ReturnType<typeof runtime.readExecutor>;
  private bases = new WeakMap<object, Base>();
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void)[] = [];
  private queue: Command[] = [];
  private tablePatch?: Partial<TableCardState>;
  private operation?: Operation;
  private activation?: ViewState;
  private publishing = false;
  private error?: string;
  private snapshot!: CommitSnapshot;
  private snapshotBase?: Base;
  private authoringEpoch = 0;
  constructor(readonly dashboardId: string, readonly widgetId: string, private onDispose: () => void) {
    this.observed = this.view(); this.source = this.sourceIdentity(); this.persisted = this.persistedIntent(); this.updateSnapshot();
  }
  private view = () => runtime.readView(this.dashboardId, this.widgetId);
  private card = () => dashboards.getState().dashboards.find(d => d.id === this.dashboardId)?.tabs.flatMap(t => t.cards).find(c => c.id === this.widgetId);
  private persistedIntent = () => { const card = this.card(); return [card?.table, card?.tableDefinition, card?.tableSelection]; };
  // As before: JSON.stringify typed as string, though no card gives undefined.
  private sourceIdentity = () => cardSourceIdentity(this.card()) as string;
  private sourceCurrent = (functional = false) => runtime.sourceMatches(
    this.dashboardId,this.widgetId,dashboards.getState().dashboards.find(d=>d.id===this.dashboardId)?.tabs.flatMap(t=>t.cards)??[],
    functional&&this.chainActive&&this.activation&&this.activationExecutor?{view:this.activation,executor:this.activationExecutor}:undefined,
  );
  private owner = () => !this.disposed && this.owners > 0 && !dashboards.getState().viewer && !!this.card();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  retain = () => {
    if (this.disposed) throw new Error('Table coordinator has been disposed');
    if (++this.owners === 1) {
      this.unsubscribe = [runtime.subscribe(this.changed), dashboards.subscribe(this.changed)];
      this.changed();
    }
    let released = false;
    return () => {
      if (released) return; released = true;
      if (--this.owners) return;
      // Invalidate callbacks immediately; defer destruction for StrictMode's setup replay.
      this.generation++; this.session = {};
      if (this.operation || this.activation || this.queue.length) this.cancel(refused('stale', 'Table authoring session closed.'));
      else {
        // Idle effect cleanup invalidates callbacks, but no accepted save failed.
        this.chain = {}; this.chainActive = false; this.updateSnapshot();
      }
      this.unsubscribe.forEach(fn => fn()); this.unsubscribe = [];
      this.flushTable();
      queueMicrotask(() => { if (!this.owners) { this.disposed = true; this.onDispose(); } });
    };
  };
  authoringBase = (): AuthoringBase => {
    const token = {}; this.bases.set(token, { view: this.view(), generation: this.generation, chain: this.chain });
    return { token };
  };
  private updateSnapshot() {
    const view = this.view(), idle = !this.operation && !this.activation && !this.queue.length;
    const available = this.owner();
    // React consumers need a fresh rendered token whenever its validity changes,
    // even when an equal-looking external edit leaves capabilities unchanged.
    if (!this.snapshotBase || this.snapshotBase.view !== view || this.snapshotBase.generation !== this.generation || this.snapshotBase.chain !== this.chain) {
      this.snapshotBase = { view, generation: this.generation, chain: this.chain };
      this.authoringEpoch++;
    }
    const next: CommitSnapshot = {
      authoringEpoch: this.authoringEpoch,
      pending: !idle && !this.operation?.selection, selectionPending: !!this.operation?.selection,
      error: this.error,
      canReplace: available && idle && ready(view),
      canEnqueue: available && !this.operation?.selection && (this.chainActive || idle && ready(view) && !!checkAuthoringModel(view.definition.analytical, view.ready!.inspection.inputColumns).model),
      canRepair: available && idle && view.status !== 'updating',
    };
    if (!equal(next, this.snapshot)) { this.snapshot = next; this.listeners.forEach(fn => fn()); }
  }
  private cancel(outcome: CommitOutcome) {
    this.chain = {}; this.chainActive = false; this.activation = undefined;
    this.operation?.controller.abort(); if (!this.operation?.group) this.operation?.resolve(outcome);
    this.queue.splice(0).forEach(command => command.resolve(outcome));
    if ('message' in outcome) this.error = outcome.message;
    this.updateSnapshot();
  }
  private changed = () => {
    if (this.publishing) return;
    const owner = this.owner();
    if (this.wasOwner && !owner) this.session = {};
    this.wasOwner = owner;
    const view = this.view();
    const persisted = this.persistedIntent();
    if (persisted.some((value, i) => value !== this.persisted[i])) {
      this.persisted = persisted;
      if (this.operation?.awaitingPublication) this.operation.awaitingPublication = false;
      else {
        this.generation++;
        if (this.operation || this.activation || this.queue.length) this.cancel(refused('stale', 'Table intent changed outside this editor; try again.'));
        else { this.chain = {}; this.chainActive = false; }
      }
    }
    const source = this.sourceIdentity();
    if (source !== this.source) {
      this.source = source; this.generation++; this.session = {};
      if (this.operation || this.activation || this.queue.length) this.cancel(refused('stale', 'Table source changed; try again.'));
      else { this.chain = {}; this.chainActive = false; }
    }
    if (!this.owner()) {
      if (this.operation || this.activation || this.queue.length) this.cancel(refused(dashboards.getState().viewer ? 'viewer' : 'unavailable', 'Table is no longer available for editing.'));
      else if (view !== this.observed) { this.chain = {}; this.chainActive = false; }
    } else if (this.activation) {
      const expected = this.activation;
      if (runtime.readExecutor(this.dashboardId, this.widgetId) !== this.activationExecutor || !equal(view.requested, expected.requested) || !equal(view.sourceRevision, expected.sourceRevision) || !equal(view.definition, expected.definition) || !equal(view.selection, expected.selection) || view.error || !['updating', 'pending', 'ready', 'empty'].includes(view.status)) {
        this.cancel(refused('stale', 'Table changed while saving; try again.'));
      } else if (ready(view) && equal(view.active, expected.requested)) {
        this.activation = undefined;
      }
    } else if (view !== this.observed && view !== this.operation?.published) {
      if (this.operation || this.queue.length) this.cancel(refused('stale', 'Table changed while saving; try again.'));
      else { this.chain = {}; this.chainActive = false; }
    }
    this.observed = view; this.updateSnapshot();
    if (!this.operation && !this.activation && this.queue.length) this.drain();
    this.flushTable();
  };
  private admission(base: AuthoringBase, functional = false): CommitOutcome | undefined {
    this.changed();
    if (dashboards.getState().viewer) return refused('viewer', 'This dashboard is read-only.');
    if (!this.owner()) return refused('unavailable', 'Table unavailable.');
    if (!this.sourceCurrent(functional)) return refused('stale', 'Source changed; wait for runtime synchronization before authoring.');
    if (this.operation?.selection || functional && (this.operation && !this.operation.functional || this.activation && !this.chainActive)) return refused('busy', 'An exclusive table change is already being saved.');
    const token = base.token && typeof base.token === 'object' ? this.bases.get(base.token) : undefined;
    if (!token || token.generation !== this.generation || (functional ? token.chain !== this.chain : token.view !== this.view())) return refused('stale', 'Table changed since this editor rendered; try again.');
    if (this.operation?.selection || (!functional && (this.operation || this.activation || this.queue.length))) return refused('busy', 'A table change is already being saved.');
    if (functional && !this.chainActive && !ready(this.view())) return refused('unavailable', 'Current table schema unavailable.');
  }
  private reject(outcome: CommitOutcome): Promise<CommitOutcome> {
    if ('message' in outcome) this.error = outcome.message;
    this.updateSnapshot(); return Promise.resolve(outcome);
  }
  replaceModel = (base: AuthoringBase, model: TableModelV1, repair?: RepairContext): Promise<CommitOutcome> => {
    const denied = this.admission(base); if (denied) return this.reject(denied);
    const view = this.view();
    const columns = repair?.view === view ? repair.columns : ready(view) ? view.ready!.inspection.inputColumns : undefined;
    if (view.status === 'updating' || !columns || repair && repair.view !== view) return this.reject(refused('unavailable', 'Current table schema unavailable.'));
    const checked = checkAuthoringModel(model, columns);
    if (!checked.model) return this.reject(refused('invalid', checked.errors.join(' ')));
    this.chain = {}; this.chainActive = false;
    return this.save({ ...view.definition, analytical: checked.model }, view.selection, false);
  };
  /** Strict toolkit/migration adapter retains existing initialization semantics. */
  replaceDefinition = (base: AuthoringBase, definition: TableDefinition, repair?: RepairContext): Promise<CommitOutcome> => {
    const denied = this.admission(base); if (denied) return this.reject(denied);
    const analytical = definition.analytical;
    if (analytical && typeof analytical === 'object' && 'kind' in analytical && analytical.kind === 'statement') {
      const view = this.view();
      const columns=repair?.view===view?repair.columns:ready(view)?view.ready!.inspection.inputColumns:undefined;
      if (view.status==='updating'||!columns||repair&&repair.view!==view) return this.reject(refused('unavailable', 'Current table schema unavailable.'));
      try { compileStatement(analytical as StatementIntent,columns); }
      catch (error) { return this.reject(refused('invalid',error instanceof Error ? error.message : 'Invalid Statement.')); }
    }
    this.chain = {}; this.chainActive = false;
    return this.save(definition, this.view().selection, false);
  };
  /**
   * Table state (sort, filters, widths, order) is last-write-wins view state, so a patch
   * is never refused for timing: one made while a save or its recalculation runs merges
   * into the waiting one and is saved over the latest definition once the lane is free.
   * One still waiting when the last owner releases (a tab switch: RuntimeTable's release
   * runs before VirtualTable's width flush) goes straight to the card instead.
   */
  patchTable = (change: Partial<TableCardState>) => {
    if (dashboards.getState().viewer) return;
    this.tablePatch = { ...this.tablePatch, ...change };
    this.flushTable();
  };
  private flushTable() {
    const change = this.tablePatch; if (!change) return;
    if (!this.owner()) {
      this.tablePatch = undefined;
      const card = this.card();
      // This card's dashboard, not the active one: a dashboard switch unmounts it too.
      if (card && !dashboards.getState().viewer) void dashboards.getState().commitTableDefinition(this.dashboardId, this.widgetId,
        { ...(card.tableDefinition ?? { search: '' }), table: { ...(card.table ?? card.tableDefinition?.table ?? {}), ...change } }, card.tableSelection ?? { kind: 'none' })
        .catch(error => logError(`failed to save table state for card ${this.widgetId}: ${error}`));
      return;
    }
    // Retried from `changed` on every runtime and dashboard emit until these clear.
    if (this.operation || this.activation || this.queue.length || !this.sourceCurrent()) return;
    this.tablePatch = undefined; this.chain = {}; this.chainActive = false;
    const view = this.view();
    void this.save({ ...view.definition, table: { ...view.definition.table, ...change } }, view.selection, false);
  }
  editModel = (base: AuthoringBase, edit: ModelEdit): Promise<CommitOutcome> => {
    const denied = this.admission(base, true); if (denied) return this.reject(denied);
    const view = this.view();
    if (!this.chainActive && !checkAuthoringModel(view.definition.analytical, view.ready!.inspection.inputColumns).model) return this.reject(refused('invalid', 'Repair the model before editing.'));
    this.chainActive = true; this.error = undefined;
    return new Promise(resolve => {
      const tail = this.queue.at(-1);
      if (edit.replaceKey && tail?.edit.replaceKey === edit.replaceKey) { this.queue.pop(); tail.resolve({ status: 'superseded' }); }
      this.queue.push({ edit, resolve }); this.updateSnapshot();
      if (!this.operation && !this.activation) this.drain();
    });
  };
  private drain() {
    const command = this.queue.shift(); if (!command) return;
    const view = this.view();
    try {
      if (!ready(view)) throw new Error('Current table schema unavailable.');
      const current = checkAuthoringModel(view.definition.analytical, view.ready!.inspection.inputColumns);
      if (!current.model) throw new Error(current.errors.join(' '));
      // A defensive detached value prevents an accidental mutating command from publishing intent.
      const checked = checkAuthoringModel(command.edit.apply(structuredClone(current.model)), view.ready!.inspection.inputColumns);
      if (!checked.model) throw new Error(checked.errors.join(' '));
      if (equal(checked.model, view.definition.analytical)) {
        command.resolve({ status: 'saved' }); this.updateSnapshot(); this.drain(); return;
      }
      void this.save({ ...view.definition, analytical: checked.model }, view.selection, true).then(command.resolve);
    } catch (error) {
      const outcome = refused('invalid', error instanceof Error ? error.message : 'Invalid table edit.');
      command.resolve(outcome); this.cancel(outcome);
    }
  }
  private save(definition: TableDefinition, selection: SelectionSpec, functional: boolean, existing?: Operation): Promise<CommitOutcome> {
    return new Promise(resolve => {
      const operation = existing ?? { controller: new AbortController(), view: this.view(), resolve, selection: false, functional };
      if (existing) operation.resolve = resolve;
      this.operation = operation; this.error = undefined; this.updateSnapshot();
      const expected = structuredClone(this.card()!);
      const isCurrent = () => !operation.controller.signal.aborted && this.owner() && this.sourceCurrent() && this.operation === operation && this.view() === operation.view;
      void (async () => {
        let outcome: CommitOutcome;
        try {
          const saved = await dashboards.getState().commitTableDefinition(this.dashboardId, this.widgetId, definition, selection, {
            expected, isCurrent,
            beforePublish: () => {
              this.publishing = true;
              try { runtime.updateDefinition(this.dashboardId, this.widgetId, definition, selection, true); }
              finally { this.publishing = false; }
              operation.awaitingPublication = true;
              operation.published = this.view(); this.observed = this.view();
              this.activation = this.view(); this.activationExecutor = runtime.readExecutor(this.dashboardId, this.widgetId);
            },
          });
          outcome = saved ? { status: 'saved' } : refused('stale', 'Table changed while saving; try again.');
        } catch { outcome = { status: 'failed', message: operation.selection ? 'Could not save selection; try again.' : 'Could not save table; try again.' }; }
        if (outcome.status !== 'saved') this.cancel(outcome);
        operation.resolve(outcome);
        if (this.operation === operation) this.operation = undefined;
        // Strict callers do not carry a command chain across recalculation.
        // Preserve existing automatic-selection reconciliation after their save.
        if (!functional) this.activation = undefined;
        this.changed();
      })();
    });
  }
  /** Trusted owner context shares this coordinator's lifecycle authority. */
  groupProofContext = (base: AuthoringBase, paramKey: string, options: { targetGroupId?: string; selectedKeys?: readonly string[] } = {}): PivotGroupProofContext | undefined => {
    if (this.admission(base) || !ready(this.view())) return undefined;
    const generation = this.generation, session = this.session;
    const context: PivotGroupProofContext = {
      dashboardId: this.dashboardId, widgetId: this.widgetId, paramKey, ...options,
      isCurrent: () => this.owner() && this.generation === generation && this.session === session,
      read: () => {
        const d = dashboards.getState().dashboards.find(d => d.id === this.dashboardId), card = this.card(), view = this.view();
        return { dashboardId: this.dashboardId, widgetId: this.widgetId, owner: this.owner(), authorityToken: session, sourceIdentity: this.sourceIdentity(), executor: runtime.readExecutor(this.dashboardId, this.widgetId), revision: view.active, definition: view.definition, selection: view.selection, bindings: card?.bindings ?? [], groups: d?.groups ?? [], groupsDisabled: !!d?.groupsDisabled, ready: ready(view) && !!card && equal(view.definition, { ...(card.tableDefinition ?? { search: '' }), table: card.table ?? card.tableDefinition?.table ?? {} }) && equal(view.selection, card.tableSelection ?? { kind: 'none' }) };
      },
    };
    this.proofContexts.set(context, { table: structuredClone(this.card()?.table) });
    return context;
  };
  commitPivotGroupChange = (base: AuthoringBase, plan: PivotGroupPlan, context: PivotGroupProofContext): Promise<PivotGroupOutcome> => {
    const denied = this.admission(base); if (denied) return this.reject(denied) as Promise<PivotGroupOutcome>;
    const known = this.proofContexts.get(context);
    if (!known || !validatePivotGroupPlan(plan, context)) return this.reject(refused('invalid', 'A complete current owner worker plan is required.')) as Promise<PivotGroupOutcome>;
    return this.groupSave((isCurrent, beforePublish, session, subscribeSession) => dashboards.getState().applyPivotGroupChange(this.dashboardId, this.widgetId, plan, { proofContext: context, expectedTable: known.table, isCurrent, isSessionCurrent: session, subscribeSession, beforePublish }));
  };
  undoPivotGroupChange = (base: AuthoringBase, undo: PivotGroupUndo): Promise<PivotUndoOutcome> => {
    const denied = this.admission(base); if (denied) return this.reject(denied) as Promise<PivotUndoOutcome>;
    if (!ready(this.view())) return this.reject(refused('unavailable', 'Current table unavailable.')) as Promise<PivotUndoOutcome>;
    return this.groupSave((isCurrent, beforePublish) => dashboards.getState().undoPivotGroupChange(undo, { dashboardId: this.dashboardId, cardId: this.widgetId, isCurrent, beforePublish }));
  };
  private groupSave<T extends PivotGroupCommitResult | PivotGroupUndoResult>(save: (current: () => boolean, publish: (dashboard: Dashboard) => void, session: () => boolean, subscribeSession: (listener: () => void) => () => void) => Promise<T>): Promise<T> {
    this.chain = {}; this.chainActive = false;
    return new Promise(resolve => {
      const operation: Operation = { controller: new AbortController(), view: this.view(), resolve: () => undefined, selection: false, functional: false, group: true };
      const executor = runtime.readExecutor(this.dashboardId, this.widgetId), source = this.sourceIdentity(), session = this.session;
      const isSessionCurrent = () => this.owner() && this.session === session && this.sourceIdentity() === source && runtime.readExecutor(this.dashboardId, this.widgetId) === executor;
      // Completed Undo belongs to the dashboard session, not a mounted tab.
      const undoSessionCurrent = () => !dashboards.getState().viewer && !!this.card() && this.sourceIdentity() === source && runtime.readExecutor(this.dashboardId, this.widgetId) === executor && this.view().requested.input === operation.view.requested.input && equal(this.view().sourceRevision, operation.view.sourceRevision);
      const subscribeSession = (listener: () => void) => { const stop = [dashboards.subscribe(listener), runtime.subscribe(listener)]; return () => stop.forEach(fn => fn()); };
      const isCurrent = () => !operation.controller.signal.aborted && isSessionCurrent() && this.operation === operation && this.view() === operation.view;
      this.operation = operation; this.error = undefined; this.updateSnapshot();
      const publish = (dashboard: Dashboard) => {
        this.publishing = true;
        try { runtime.syncDashboard(dashboard); }
        finally { this.publishing = false; }
        operation.awaitingPublication = true; operation.published = this.view(); this.observed = this.view();
        this.activation = this.view(); this.activationExecutor = executor;
      };
      void (async () => {
        const result = await save(isCurrent, publish, undoSessionCurrent, subscribeSession);
        if (result.status !== 'saved') this.cancel(result.status === 'refused' ? refused('stale', result.message) : { status: 'failed', message: result.message });
        if (this.operation === operation) this.operation = undefined;
        this.changed(); resolve(result);
      })().catch(() => {
        this.cancel({ status: 'failed', message: 'Could not complete group durability.' });
        if (this.operation === operation) this.operation = undefined;
        this.changed(); resolve({ status: 'failed', message: 'Could not complete group durability.', writes: 0 } as T);
      });
    });
  }
  chooseSelection = (base: AuthoringBase, action: SelectionAction): Promise<CommitOutcome> => {
    const denied = this.admission(base); if (denied) return this.reject(denied);
    const view = this.view(), executor = runtime.readExecutor(this.dashboardId, this.widgetId);
    if (!ready(view) || !view.active || !executor) return this.reject(refused('unavailable', 'Current table selection unavailable.'));
    this.chain = {}; this.chainActive = false;
    return new Promise(resolve => {
      const operation: Operation = { controller: new AbortController(), view, resolve, selection: true, functional: false };
      this.operation = operation; this.error = undefined; this.updateSnapshot();
      void (async () => {
        try {
          const candidate = await executor.selection(view.active!, action, [], operation.controller.signal);
          if (operation.controller.signal.aborted || !this.owner() || this.view() !== view) {
            resolve(refused('stale', 'Selection changed while saving; try again.'));
          } else { resolve(await this.save(view.definition, candidate.selection, false, operation)); return; }
        } catch { const outcome: CommitOutcome = { status: 'failed', message: 'Could not save selection; try again.' }; this.error = outcome.message; resolve(outcome); }
        if (this.operation === operation) this.operation = undefined;
        this.changed();
      })();
    });
  };
}

const entries = new Map<string, TableCommitCoordinator>();
const registryListeners = new Set<() => void>();
export const tableCommitCoordinators = {
  /** Fires when a coordinator is disposed, so subscribers re-get the live instance. */
  subscribe(listener: () => void) { registryListeners.add(listener); return () => { registryListeners.delete(listener); }; },
  get(dashboardId: string, widgetId: string) {
    const key = JSON.stringify([dashboardId, widgetId]);
    let coordinator = entries.get(key);
    if (!coordinator) { coordinator = new TableCommitCoordinator(dashboardId, widgetId, () => { entries.delete(key); registryListeners.forEach(fn => fn()); }); entries.set(key, coordinator); }
    return coordinator;
  },
};
