// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { tableExecutionStore, type ViewState } from '../stores/tableExecutionStore';
import type { Revision, RowBlock, RowRequest, TotalResult } from '../lib/tableExecution/types';
export const TABLE_BLOCK_SIZE = 100;
export const TABLE_CACHE_BLOCKS = 12;
const key = (r: Revision | undefined) => JSON.stringify(r);
const blockKey = (r: Pick<RowRequest, "groupPath" | "offset">) => JSON.stringify([r.groupPath, r.offset]);
type Snapshot = { identity: string; view: ViewState; blocks: RowBlock[]; totals: TotalResult };
/** Joins schema, rows and totals before publishing, and fences every later delivery. */
// A newer view replaced this one mid-read; its own reads follow, so this is not an error.
const superseded = (e: unknown) => (e as { descriptor?: { code?: string } } | null)?.descriptor?.code === 'REVISION_MISMATCH';

export function useTableResult(dashboardId: string, widgetId: string, store = tableExecutionStore) {
  const current = useSyncExternalStore(store.subscribe, () => store.readView(dashboardId, widgetId));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const pending = useRef(new Map<string, AbortController>());
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const currentRef = useRef(current); currentRef.current = current;
  useEffect(() => {
    store.ensureTable(dashboardId, widgetId);
  }, [store, dashboardId, widgetId]);
  useEffect(() => {
    const pendingReads = pending.current;
    const version = ++generation.current;
    for (const controller of pendingReads.values()) controller.abort();
    pendingReads.clear();
    const candidate = currentRef.current;
    const executor = store.readExecutor(dashboardId, widgetId);
    if (!executor || !candidate.active || !candidate.ready || !["ready", "empty"].includes(candidate.status)) return;
    const controller = new AbortController(); const revision = candidate.active;
    void Promise.all([
      executor.rows(revision, { groupPath: [], offset: 0, limit: TABLE_BLOCK_SIZE }, controller.signal),
      executor.totals(revision, controller.signal),
    ]).then(([block, totals]) => {
      if (version !== generation.current || controller.signal.aborted) return;
      if (key(block.revision) !== key(revision) || key(totals.revision) !== key(revision)) return;
      setError(undefined); setSnapshot({ identity: JSON.stringify([dashboardId, widgetId]), view: candidate, blocks: [block], totals });
    }).catch((e: unknown) => { if (!controller.signal.aborted && version === generation.current && !superseded(e)) setError('Could not load table rows'); });
    return () => { controller.abort(); for (const c of pendingReads.values()) c.abort(); pendingReads.clear(); };
    // Model readiness is the publication trigger; status-only changes retain delivered rows.
  }, [store, dashboardId, widgetId, current.ready, current.active]);
  const requestRows = useCallback((request: RowRequest) => {
    const old = snapshotRef.current; const executor = store.readExecutor(dashboardId, widgetId);
    if (!old?.view.active || old.identity !== JSON.stringify([dashboardId, widgetId]) || !executor || key(old.view.active) !== key(store.readView(dashboardId, widgetId).active)) return;
    const bounded = { ...request, limit: Math.min(TABLE_BLOCK_SIZE, request.limit) };
    const id = blockKey(bounded);
    if (pending.current.has(id) || old.blocks.some(b => blockKey(b) === id && b.rows.length >= Math.min(bounded.limit, b.siblingCount - b.offset))) return;
    if (pending.current.size >= TABLE_CACHE_BLOCKS) {
      const oldest = pending.current.entries().next().value;
      if (oldest) { oldest[1].abort(); pending.current.delete(oldest[0]); }
    }
    const controller = new AbortController(); pending.current.set(id, controller);
    const version = generation.current; const revision = old.view.active;
    void executor.rows(revision, bounded, controller.signal).then(block => {
      if (controller.signal.aborted || version !== generation.current || key(block.revision) !== key(revision)) return;
      setError(undefined);
      setSnapshot(s => s && key(s.view.active) === key(revision) ? { ...s, blocks: [...s.blocks.filter(b => blockKey(b) !== id), block].slice(-TABLE_CACHE_BLOCKS) } : s);
    }).catch((e: unknown) => { if (!controller.signal.aborted && version === generation.current && !superseded(e)) setError('Could not load table rows'); }).finally(() => { if (pending.current.get(id) === controller) pending.current.delete(id); });
  }, [store, dashboardId, widgetId]);
  const delivered = snapshot?.identity === JSON.stringify([dashboardId, widgetId]) ? snapshot : undefined;
  const view = delivered ? { ...delivered.view, definition: current.definition, selection: current.selection,
    status: current.error ? current.status : key(delivered.view.active) !== key(current.active) || current.status === 'updating' ? 'updating' as const : current.status,
    stale: current.stale, error: current.error ?? error } : { ...current, ready: undefined, active: undefined, error: current.error ?? error };
  return { view, blocks: delivered?.blocks ?? [], totals: delivered?.totals, requestRows };
}
