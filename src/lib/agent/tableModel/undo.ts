// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { analyticalErrors } from "./describe";
import { openRuntime, resolveTableTarget } from "./target";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import type { CardView } from "../../types";
import type { TableDefinition } from "../../tableExecution/types";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * "table" is the default view, stored as no view at all. The view is part of the table runtime's source,
 * so the runtime is synced at once, as the coordinator does after its own writes: the next arrange or Undo
 * must not race the dashboard's sync effect.
 */
export async function setView(cardId: string, view: string) {
  await useDashboardStore.getState().patchCardField(cardId, "view", view === "table" ? null : view as CardView);
  const dashboard = useDashboardStore.getState().dashboards.find(d => d.tabs.some(t => t.cards.some(c => c.id === cardId)));
  if (dashboard) tableExecutionStore.syncDashboard(dashboard);
}

/**
 * One Undo per applied arrangement. It restores the previous configuration through the same validators and guarded commit,
 * against the current input. It refuses (throwing a message the edit bar shows) over a later edit, an unavailable card,
 * a read-only dashboard or a previous model that no longer fits; it never restores partially.
 */
export function registerArrangeUndo(entry: { dashboardId: string; cardId: string; title: string; applied: TableDefinition; previous: TableDefinition; view?: { applied: string; previous: string } }) {
  useAgentEditsStore.getState().push({
    summary: `Rita arranged ${entry.title}`,
    undo: async () => {
      const target = resolveTableTarget(entry.cardId);
      if (target.kind !== "worker" || target.dashboardId !== entry.dashboardId) throw new Error(`Undo needs "${entry.title}" on the active dashboard; nothing was restored.`);
      const rt = openRuntime(target);
      if ("status" in rt) throw new Error(`Open the tab that holds "${entry.title}" and try Undo again; nothing was restored.`);
      if (rt.mode === "viewer") throw new Error("This dashboard is read-only; nothing was restored.");
      if (!same(rt.view.definition, entry.applied) || (entry.view && (rt.card.view ?? "table") !== entry.view.applied)) throw new Error(`"${entry.title}" changed after Rita's edit, so Undo would overwrite that change; nothing was restored.`);
      const base = rt.coordinator!.authoringBase();
      const previous = structuredClone(entry.previous);
      const { errors } = analyticalErrors(previous.analytical, rt.columns);
      if (errors.length) throw new Error(`The previous configuration no longer fits the current data (${errors.join(" ")}); nothing was restored.`);
      if (!same(entry.applied, previous)) {
        const outcome = await rt.coordinator!.replaceDefinition(base, previous);
        if (outcome.status !== "saved") throw new Error(`Undo could not be saved (${"message" in outcome ? outcome.message : outcome.status}); nothing was restored.`);
      }
      if (entry.view) await setView(entry.cardId, entry.view.previous);
    },
  });
}
