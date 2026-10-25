// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { tableExecutionStore } from '../../stores/tableExecutionStore';
import { createWorkerExecutor } from '../../lib/tableExecution/workerClient';
import { loadStatementSnapshot, type StatementSnapshot } from '../../lib/statementExecution';
import { NOTHING_TO_STATEMENT } from '../../lib/statementRows';
import { identifyRows } from '../../lib/widgetData/identity';
import { tableColumns, tableRows } from '../../lib/tableColumns';
import type { WidgetDataset } from '../../lib/widgetData/types';
import type { TableDefinition, SelectionSpec } from '../../lib/tableExecution/types';
import type { TableSpec } from '../../lib/types';
import { StatementRenderer } from './StatementRenderer';

export function StatementWorkerView({ dashboardId, widgetId, owned, data, spec, definition, selection, sourceLoading, sourceError, collapsed, onToggle, onSnapshot }: {
  dashboardId: string; widgetId: string; owned: boolean; data: unknown; spec?: TableSpec;
  definition?: TableDefinition; selection?: SelectionSpec; sourceLoading?: boolean; sourceError?: boolean;
  onSnapshot?: (snapshot: StatementSnapshot | undefined) => void;
  collapsed: ReadonlySet<string>; onToggle: (section: string) => void;
}) {
  const current = useSyncExternalStore(tableExecutionStore.subscribe, () => tableExecutionStore.readView(dashboardId, widgetId));
  const [completed, setCompleted] = useState<{ owner: string; snapshot: StatementSnapshot }>();
  const [error, setError] = useState<string>();
  const [transferring, setTransferring] = useState(false);
  const generation = useRef(0);
  const publish = useRef(onSnapshot); publish.current = onSnapshot;
  const owner = JSON.stringify([dashboardId, widgetId]);
  useEffect(() => { if (owned) tableExecutionStore.ensureTable(dashboardId, widgetId); }, [dashboardId, widgetId, owned]);
  useEffect(() => {
    const version = ++generation.current;
    setTransferring(true);
    publish.current?.(undefined);
    const controller = new AbortController();
    const rows = owned ? null : tableRows(data);
    if (owned && (!current.active || !current.ready || !['ready', 'empty'].includes(current.status))) return;
    if (!owned && rows === null) return;
    const executor = owned ? tableExecutionStore.readExecutor(dashboardId, widgetId) : createWorkerExecutor(widgetId);
    if (!executor) return;
    void (async () => {
      const revision = owned ? current.active! : { widgetId, input: version, model: version, output: version };
      if (!owned) {
        const dataset: WidgetDataset = {
          rows: identifyRows(rows!),
          columns: tableColumns(rows!, spec).map(column => ({ id: column.field, label: column.header, format: column.format })),
          resultRevision: version, outputRevision: version, provenance: { sourceWidgetId: widgetId, sourceKind: 'backendResponse' },
          // A plain (non-paged) backend response is the provider's whole answer; provider caps travel as their own notice.
          completeness: { kind: 'complete', warnings: [] },
          freshness: { availability: 'available', stale: false },
        };
        await executor.registerInput(dataset, version, controller.signal);
        await executor.applyModel(definition ?? { table: {}, search: '' }, selection ?? { kind: 'none' }, revision, controller.signal);
      }
      const snapshot = await loadStatementSnapshot(executor, revision, controller.signal, spec);
      if (controller.signal.aborted || version !== generation.current) return;
      setError(undefined); setCompleted({ owner, snapshot }); setTransferring(false); publish.current?.(snapshot);
    })().catch(() => {
      if (!controller.signal.aborted && version === generation.current) { setError('Could not load Statement rows.'); setTransferring(false); }
    });
    return () => { controller.abort(); publish.current?.(undefined); if (!owned) executor.dispose(); };
  }, [dashboardId, widgetId, owned, owner, data, spec, definition, selection, current.active, current.ready, current.status]);
  const snapshot = completed?.owner === owner ? completed.snapshot : undefined;
  const revisionChanged = owned && snapshot && current.active && (['input', 'model', 'output'] as const).some(key => snapshot.revision[key] !== current.active![key]);
  const updating = transferring || revisionChanged || (owned ? current.status === 'updating' || current.stale : sourceLoading);
  return <div className="statement-view">
    {error || sourceError || (owned && current.error) ? <p role="alert">{error ?? (owned ? current.error : 'Statement source could not be refreshed.')}</p> : null}
    {snapshot && updating ? <p role="status">Updating Statement — showing completed data (stale).</p> : null}
    {snapshot?.completeness.warnings.map((warning, i) => <p role="status" key={i}>{warning}</p>)}
    {!snapshot && !error ? <p role="status">Loading Statement…</p> : null}
    {snapshot ? snapshot.statement ? <StatementRenderer statement={snapshot.statement} collapsed={collapsed} onToggle={onToggle}/> : <p className="empty-state">{NOTHING_TO_STATEMENT}</p> : null}
  </div>;
}
