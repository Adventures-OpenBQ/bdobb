// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { mcpImportNotice } from "../lib/agent/importedMcp";
import {
  applyImportDecisions,
  keepBothName,
  planAppsImport,
  UNRESOLVED_BACKEND_ID,
  type AppliedImport,
  type AppsImportReady,
} from "../lib/appsJson";
import type { V8Skipped } from "../lib/appsExtensionsV8";
import { docksNotice, resolveDocksImport } from "../lib/docksImport";
import { logError } from "../lib/logger";
import { focusDashboardInWorkspace } from "../lib/workspaceFocus";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { saveImportedMcpServers } from "../stores/importMcpServers";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";

/**
 * What the import skipped of the written dashboards' v8 data (the Q3 degrade,
 * user ruling 2026-10-12): the dashboard came in, its unreadable pin or News
 * state did not, and the notice says so by name. A dashboard the user chose
 * to skip is not mentioned; one kept as a copy is named as written.
 */
function v8SkippedPart(skipped: V8Skipped[], written: Dashboard[]): string {
  const parts = skipped.flatMap(({ dashboardId, all, cards, docks }) => {
    const dashboard = written.find((d) => d.id === dashboardId);
    if (!dashboard) return [];
    const what = all
      ? ["all of its v8 state"]
      : [
          ...(cards > 0 ? [`the pin or News state of ${cards} ${cards === 1 ? "card" : "cards"}`] : []),
          ...(docks ? ["its locked-widgets marking, so it came in as a dashboard"] : []),
        ];
    return [`"${dashboard.name}" (${what.join("; ")})`];
  });
  return parts.length === 0 ? "" : `; skipped v8 data this version cannot read: ${parts.join(", ")}`;
}

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
): Promise<{ refusal: string } | "cancelled" | (AppliedImport & Pick<AppsImportReady, "issues" | "mcpServers" | "docks" | "v8Skipped">)> {
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
  return decisions === "cancelled" ? "cancelled" : { ...applyImportDecisions(plan, decisions), issues: plan.issues, mcpServers: plan.mcpServers, docks: plan.docks, v8Skipped: plan.v8Skipped };
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
    // The store has switched to the first added; in a workspace it must also
    // go into a tile, as a click on its row would put it there (review B6).
    if (added[0]) focusDashboardInWorkspace(added[0].id);
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
  // v8 locked widgets: after the dashboards, through the one shared guard
  // (an empty docks here is replaced silently, a populated one asks first).
  // Its own catch: the dashboards are written by now.
  let docksPart = "";
  try {
    docksPart = docksNotice(await resolveDocksImport(decided.docks));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`Could not replace the locked widgets: ${message}`);
    await logError(`failed to import the locked widgets: ${message}`);
  }
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const notice = `Imported ${plural(written.length, "dashboard")}${extras ? ` (${extras})` : ""}, ${plural(cards.length, "card")}${unresolvedPart}${docksPart}${v8SkippedPart(decided.v8Skipped ?? [], written)}`;
  // The file's MCP servers, after the dashboards: a failed save is logged
  // there and the notice still reports the import (final review M3).
  const { added: mcpAdded, local } = await saveImportedMcpServers(
    decided.mcpServers,
    { kind: "file" },
    "The import succeeded but its MCP servers could not be saved.",
  );
  const head = mcpAdded === 0 ? notice : `${notice}.${mcpImportNotice(mcpAdded, "the imported file", local)}`;
  // What the import dropped rather than refused (dev Pivot state with no
  // Statement equivalent), named where it was, five at most like the ids.
  const issues = decided.issues ?? [];
  const dropped = issues.slice(0, 5).map((i) => `dropped at ${i.path}: ${i.message}`);
  if (issues.length > 5) dropped.push(`${issues.length - 5} more dropped`);
  return [head, ...dropped, ...failures].join("; ");
}
