// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { create } from "zustand";
import { logError } from "../lib/logger";
import { buildSymbolList, canFeedGroup, shouldWrite, SYMBOL_GROUP_CAP } from "../lib/symbolGroupSource";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { tableExecutionStore, type TableExecutionStore } from "../stores/tableExecutionStore";

/** What each fed group's chip says about its source this session (spec 2026-11-13 §4). Never saved. */
export const useFeedNotes = create<{ notes: Record<string, string>; put: (groupId: string, text?: string) => void }>((set, get) => ({
  notes: {},
  put: (groupId, text) => {
    if (get().notes[groupId] === text) return;
    const { [groupId]: _previous, ...rest } = get().notes;
    set({ notes: text === undefined ? rest : { ...rest, [groupId]: text } });
  },
}));

export type FeedStore = Pick<TableExecutionStore, "subscribe" | "readView" | "readExecutor">;

/**
 * The feeder (spec §2). For each symbol group with a source it reads the chosen column of the
 * source table's presented output -- the chartData call a linked chart makes for its category,
 * against the source's own active revision -- once per completed revision and column, and
 * writes the list when it differs from the group's value. An answer for a revision the source
 * has moved past is dropped. Every outcome that keeps the last list says why in a note.
 */
export function createFeeder({ dashboardId, store, read, write, note }: {
  dashboardId: string;
  store: FeedStore;
  read: () => Dashboard | undefined;
  write: (groupId: string, value: string) => void;
  note: (groupId: string, text?: string) => void;
}) {
  /** The revision and column last asked for, per group: one read per completed output. */
  const asked = new Map<string, string>();
  /** The note that read ended with, re-shown when a transient "loading" passes without a new revision. */
  const settled = new Map<string, string | undefined>();
  const inflight = new Map<string, AbortController>();
  const settle = (groupId: string, text?: string) => { settled.set(groupId, text); note(groupId, text); };

  const run = () => {
    const dashboard = read();
    if (!dashboard) return;
    for (const group of dashboard.groups ?? []) {
      const source = group.groupType === "symbol" ? group.source : undefined;
      if (!source) { asked.delete(group.id); note(group.id, undefined); continue; }
      if (!canFeedGroup(dashboard, group.id, source.sourceWidgetId)) {
        asked.delete(group.id);
        note(group.id, "Source unavailable");
        continue;
      }
      const view = store.readView(dashboardId, source.sourceWidgetId);
      const revision = view.active;
      if (!revision || !view.ready || (view.status !== "ready" && view.status !== "empty")) {
        note(group.id, view.status === "failed" || view.status === "blocked" || view.status === "unavailable" ? `Source ${view.status}` : "Source loading");
        continue;
      }
      const key = JSON.stringify([revision, source.columnId]);
      if (asked.get(group.id) === key) { note(group.id, settled.get(group.id)); continue; }
      const executor = store.readExecutor(dashboardId, source.sourceWidgetId);
      if (!executor) continue;
      asked.set(group.id, key);
      inflight.get(group.id)?.abort();
      if (view.status === "empty") { settle(group.id, "Source returned no rows"); continue; }
      if (!view.ready.columns.some((c) => c.id === source.columnId)) { settle(group.id, "Column unavailable"); continue; }
      const controller = new AbortController();
      inflight.set(group.id, controller);
      const current = () => !controller.signal.aborted
        && JSON.stringify(store.readView(dashboardId, source.sourceWidgetId).active) === JSON.stringify(revision);
      executor.chartData(revision, [source.columnId], controller.signal).then((result) => {
        if (!current()) return;
        const { list, capped } = buildSymbolList(result.rows.map((row) => row.values[source.columnId]));
        if (list === "") { settle(group.id, "Source returned no rows"); return; }
        settle(group.id, capped ? `Capped at ${SYMBOL_GROUP_CAP} tickers` : undefined);
        // Re-read: the person may have typed over the group, or removed its source, meanwhile.
        const now = read()?.groups?.find((g) => g.id === group.id);
        if (now?.source?.sourceWidgetId === source.sourceWidgetId && now.source.columnId === source.columnId && shouldWrite(now.value, list)) write(group.id, list);
      }, () => { if (current()) settle(group.id, "Source failed"); });
    }
  };

  const stop = () => {
    for (const controller of inflight.values()) controller.abort();
    inflight.clear();
  };
  return { run, stop };
}

/**
 * One per open dashboard, beside TableExecutionRuntime, which keeps every source table running
 * whatever tab is shown. Runs on every table-store and dashboard-store change; renders nothing.
 */
export function SymbolGroupFeeder({ dashboardId, store = tableExecutionStore }: { dashboardId: string; store?: FeedStore }) {
  useEffect(() => {
    const feeder = createFeeder({
      dashboardId,
      store,
      read: () => useDashboardStore.getState().dashboards.find((d) => d.id === dashboardId),
      // The existing group edit, with no card (R3): one revision on and saved, applied in memory
      // only in the viewer, and never an undo entry -- no group edit is one.
      write: (groupId, value) =>
        void useDashboardStore.getState()
          .applyCardParams("", { cardParams: {}, groupEdits: [{ groupId, value }] })
          .catch((err) => logError(`failed to feed group ${groupId}: ${err}`)),
      note: (groupId, text) => useFeedNotes.getState().put(groupId, text),
    });
    feeder.run();
    const offTables = store.subscribe(feeder.run);
    const offDashboards = useDashboardStore.subscribe(feeder.run);
    return () => { offTables(); offDashboards(); feeder.stop(); };
  }, [dashboardId, store]);
  return null;
}
