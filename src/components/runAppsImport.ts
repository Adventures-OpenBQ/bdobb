// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  applyImportDecisions,
  keepBothName,
  planAppsImport,
  UNRESOLVED_BACKEND_ID,
} from "../lib/appsJson";
import { logError } from "../lib/logger";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";

/**
 * The whole apps.json import after the file is read: plan, ask about each
 * conflict, apply the answers, write. The rail's Import and a dropped file
 * both end here, so the conflict loop and the notice exist once. Returns
 * the one line to show.
 */
export async function runAppsImport(text: string, bytes: number): Promise<string> {
  const plan = planAppsImport(
    text,
    bytes,
    useWidgetRegistryStore.getState().widgets,
    useDashboardStore.getState().dashboards,
  );
  if (!plan.ok) return plan.refusal;

  const decisions = await decideImportConflicts(plan.conflicts, (index, prior) =>
    keepBothName(plan, prior, index),
  );
  if (decisions === "cancelled") return "Import cancelled; nothing changed.";
  const { added, replaced, skipped } = applyImportDecisions(plan, decisions);

  if (added.length > 0) {
    await useDashboardStore.getState().importDashboards(added);
    // Appended to the flat order, which stays the single source of it. A
    // failed order write is logged, not reported: the dashboards are written.
    try {
      await useSettingsStore.getState().save({
        dashboardOrder: useDashboardStore.getState().dashboards.map((d) => d.id),
      });
    } catch (err) {
      await logError(`failed to persist dashboard order: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // One failed Replace does not stop the others. A replace keeps the existing
  // id, so the rail order needs no write.
  const written: Dashboard[] = [...added];
  const failures: string[] = [];
  for (const { id, dashboard } of replaced) {
    try {
      await useDashboardStore.getState().replaceDashboardContents(id, dashboard);
      written.push(dashboard);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`Could not replace "${dashboard.name}": ${message}`);
      await logError(`failed to replace dashboard ${id}: ${message}`);
    }
  }

  const cards = written.flatMap((d) => d.tabs.flatMap((t) => t.cards));
  const unresolved = cards.filter((c) => c.backendId === UNRESOLVED_BACKEND_ID).length;
  const replacedCount = written.length - added.length;
  const extras = [
    replacedCount > 0 ? `${replacedCount} replaced` : "",
    skipped > 0 ? `${skipped} skipped` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  const notice = `Imported ${written.length} dashboards${extras ? ` (${extras})` : ""}, ${cards.length} cards (${unresolved} unresolved)`;
  return [notice, ...failures].join("; ");
}
