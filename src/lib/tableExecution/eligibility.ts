// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { LOCAL_TABLE_ID, SSRM_TYPES } from '../builtins';
import { tableRows } from '../tableColumns';
import type { DashboardCard } from '../types';
import { useWidgetRegistryStore } from '../../stores/widgetRegistryStore';
/**
 * A backend `table` widget: its whole payload reaches the client, so the
 * worker can own it like a local file. SSRM widgets are their own types
 * (SSRM_TYPES) and never match; they wait for the server executor.
 */
export function isBackendTable(card: DashboardCard): boolean {
  if (card.widgetId === LOCAL_TABLE_ID || card.linkedSource) return false;
  // The runtime asks for every card, outside any card's error boundary: a
  // lookup that throws leaves this card off the worker, and the card's own
  // render meets the same throw inside its boundary.
  try {
    return useWidgetRegistryStore.getState().find(card.backendId, card.widgetId)?.type === 'table';
  } catch {
    return false;
  }
}
// ponytail: a cell-count ceiling, not a byte measure; above it a backend table
// keeps the in-thread pivot. Raise it, or measure bytes, if real payloads need it.
export const WORKER_MAX_CELLS = 2_000_000;
/** Whether a fetched backend payload is small enough to hand to the worker. */
export function fitsTableWorker(data: unknown): boolean {
  const rows = tableRows(data);
  return !rows || rows.length * Math.max(1, Object.keys(rows[0] ?? {}).length) <= WORKER_MAX_CELLS;
}
/** Shared runtime/picker boundary: legacy presentations do not publish ordinary table output. */
export function isManagedTable(card: DashboardCard): boolean {
 // Like ordinary backend tables, discovery runs outside the card error boundary.
 try {
  const widget=useWidgetRegistryStore.getState().find(card.backendId,card.widgetId);
  return !!widget && SSRM_TYPES.has(widget.type) && widget.provider==='managed-native' && widget.protocolVersion===1;
 } catch { return false; }
}
export function isWorkerTableProducer(card: DashboardCard): boolean {
  return !card.linkedChart && (card.widgetId === LOCAL_TABLE_ID || !!card.linkedSource || isBackendTable(card) || isManagedTable(card))
    && (isManagedTable(card) || card.view === undefined || card.view === 'table');
}
