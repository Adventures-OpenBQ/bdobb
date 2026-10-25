// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isCardAgentOffLimits, keyMaintBackendIds } from "../../providerKeys";
import { isBackendTable, isManagedTable, isWorkerTableProducer } from "../../tableExecution/eligibility";
import { LINKED_TABLE_ID, LOCAL_TABLE_ID, SSRM_TYPES } from "../../builtins";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { tableExecutionStore, type ViewState } from "../../../stores/tableExecutionStore";
import { tableCommitCoordinators, type TableCommitCoordinator } from "../../../stores/tableCommitCoordinator";
import type { LocalWorkerExecutor } from "../../tableExecution/types";
import type { DatasetColumn } from "../../widgetData/types";
import type { DashboardCard, WidgetDef } from "../../types";

export type TableTarget =
  | { kind: "worker"; dashboardId: string; card: DashboardCard; def: WidgetDef }
  | { kind: "refusal"; status: "unknown" | "not-a-table" | "server-execution-pending" | "view-not-tabular"; message: string; alternatives: string[] };

const refusal = (status: Extract<TableTarget, { kind: "refusal" }>["status"], message: string, alternatives: string[] = []): TableTarget =>
  ({ kind: "refusal", status, message, alternatives });

/** Active dashboard only, read fresh: Undo calls back into this long after the tool call. */
export function resolveTableTarget(cardId: string): TableTarget {
  const dashboard = useDashboardStore.getState().activeDashboard();
  const cards = dashboard?.tabs.flatMap(t => t.cards) ?? [];
  const card = cards.find(c => c.id === cardId);
  const registry = useWidgetRegistryStore.getState();
  const def = card && registry.find(card.backendId, card.widgetId);
  // Same wording as get_widget_data: key-maint and foreign cards read as
  // unknown, and so does a linked table built on one (it carries its rows).
  if (!dashboard || !card || !def || isCardAgentOffLimits(card, cards, registry.find, keyMaintBackendIds(registry.widgets))) return refusal("unknown", `unknown card ${cardId}`);
  // A backend table runs on the same client worker as a CSV/XLS one (an
  // oversized payload has no executor and answers openRuntime's not-ready).
  const workerType = isManagedTable(card) || isBackendTable(card) || def.id === LOCAL_TABLE_ID || def.id === LINKED_TABLE_ID || !!card.linkedSource;
  if (workerType && !card.linkedChart) {
    return isWorkerTableProducer(card)
      ? { kind: "worker", dashboardId: dashboard.id, card, def }
      : refusal("view-not-tabular", `card ${cardId} is showing its ${card.view} view; the table model is edited in Table or Statement view`, ["Ask the user to switch the card to Table or Statement view"]);
  }
  if (SSRM_TYPES.has(def.type))
    return refusal("server-execution-pending", `card ${cardId} uses standard LIVE paging; whole-result analytical formulas, selection, charts, exports and linked derivation are unavailable.`, ["Use a managed-native table source for full analytical scope"]);
  return refusal("not-a-table", `card ${cardId} is a ${def.type} widget, not a table`);
}

export type TableRuntime = { dashboardId: string; card: DashboardCard; view: ViewState; executor: LocalWorkerExecutor; coordinator?: TableCommitCoordinator; mode: "authoring" | "viewer"; columns: DatasetColumn[] };
const notReady = (message: string) => ({ status: "runtime-not-ready" as const, message, alternatives: ["navigate to the dashboard tab that holds this card so its table opens, then call describe_table again"] });

/** A card on an unopened tab has no mounted coordinator/executor: answer not-ready, never throw or create one. */
export function openRuntime(target: Extract<TableTarget, { kind: "worker" }>): TableRuntime | ReturnType<typeof notReady> {
  const { dashboardId, card } = target;
  const view = tableExecutionStore.readView(dashboardId, card.id);
  const executor = tableExecutionStore.readExecutor(dashboardId, card.id);
  const coordinator = tableCommitCoordinators.peek(dashboardId, card.id);
  if (!coordinator || !executor || !view.ready || !["ready", "empty"].includes(view.status) || view.stale || view.error)
    // The view's error says why, e.g. a backend table past the worker's ceiling.
    return notReady(`card ${card.id}'s table is not open and ready (status ${view.status}${view.error ? `: ${view.error}` : ""})`);
  return { dashboardId, card, view, executor, coordinator, mode: useDashboardStore.getState().viewer ? "viewer" : "authoring", columns: view.ready.inspection.inputColumns };
}

/** Opaque: covers saved intent, accepted input/model revisions, source association and the immediate upstream revision. */
export function revisionWitness(card: DashboardCard, view: ViewState): string {
  const material = JSON.stringify([card.widgetId, card.backendId, card.params, card.linkedSource ?? null, card.view ?? null, card.tableDefinition ?? null, card.tableSelection ?? null, view.active ?? null, view.sourceRevision ?? null, ...(card.managedSource ? [card.managedSource] : [])]);
  // ponytail: 32-bit FNV-1a; a collision only weakens the stale check, the coordinator's own guard still applies.
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) h = Math.imul(h ^ material.charCodeAt(i), 0x01000193);
  return `tm1-${(h >>> 0).toString(36)}`;
}
