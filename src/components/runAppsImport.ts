// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  applyImportDecisions,
  keepBothName,
  planAppsImport,
  UNRESOLVED_BACKEND_ID,
  type AppliedImport,
} from "../lib/appsJson";
import { logError } from "../lib/logger";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";

/**
 * Plan an apps.json against the registry and every existing dashboard, ask
 * about each name conflict, and apply the answers. Writes nothing: each
 * caller (the import below, the Apps dialog's Open) writes and reports in
 * its own way. A name already taken is a conflict the user is asked about
 * -- Replace, Keep both, Skip or Cancel import -- never a silently renamed
 * copy.
 */
export async function decideAppsImport(
  text: string,
  bytes: number,
): Promise<{ refusal: string } | "cancelled" | AppliedImport> {
  const plan = planAppsImport(
    text,
    bytes,
    useWidgetRegistryStore.getState().widgets,
    useDashboardStore.getState().dashboards,
  );
  if (!plan.ok) return { refusal: plan.refusal };
  const decisions = await decideImportConflicts(plan.conflicts, (index, prior) =>
    keepBothName(plan, prior, index),
  );
  return decisions === "cancelled" ? "cancelled" : applyImportDecisions(plan, decisions);
}

/**
 * The whole apps.json import after the file is read: decide, then write.
 * The rail's Import and a dropped file both end here, so the conflict loop
 * and the notice exist once. Returns the one line to show.
 */
export async function runAppsImport(text: string, bytes: number): Promise<string> {
  const decided = await decideAppsImport(text, bytes);
  if (decided === "cancelled") return "Import cancelled; nothing changed.";
  if ("refusal" in decided) return decided.refusal;
  const { added, replaced, skipped } = decided;

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
  // Named, not just counted: "3 unresolved" leaves the reader opening cards
  // to find out which. Five is where the line stops being readable. Widgets,
  // not cards: one missing widget placed on six tabs is ONE thing to fix.
  const unresolvedIds = [
    ...new Set(cards.filter((c) => c.backendId === UNRESOLVED_BACKEND_ID).map((c) => c.widgetId)),
  ];
  const shown = unresolvedIds.slice(0, 5).join(", ");
  const ellipsis = unresolvedIds.length > 5 ? ", …" : "";
  const unresolvedPart =
    unresolvedIds.length === 0 ? "" : ` (${unresolvedIds.length} unresolved: ${shown}${ellipsis})`;
  const replacedCount = written.length - added.length;
  const extras = [
    replacedCount > 0 ? `${replacedCount} replaced` : "",
    skipped > 0 ? `${skipped} skipped` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const notice = `Imported ${plural(written.length, "dashboard")}${extras ? ` (${extras})` : ""}, ${plural(cards.length, "card")}${unresolvedPart}`;
  return [notice, ...failures].join("; ");
}
