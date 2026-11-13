// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useId, useState, useSyncExternalStore } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useModalDialog } from "../hooks/useModalDialog";
import { canFeedGroup, defaultTickerColumn, tableLabel, tickerColumns } from "../lib/symbolGroupSource";
import { useDashboardStore } from "../stores/dashboardStore";
import { tableExecutionStore, type TableExecutionStore } from "../stores/tableExecutionStore";
import { DialogShell } from "./dialogs/DialogShell";

const LABEL = "Feed symbol group";

/**
 * Feed symbol group (spec 2026-11-13 §2): the source table, its ticker column, and the group --
 * an existing symbol group or a new one (value ""). Opened from a table's menu (sourceWidgetId),
 * from a group's chip menu (groupId) and from the query library. A group that already has
 * another source is replaced only after a confirmation naming it.
 */
export function FeedSymbolGroupDialog({ dashboardId, sourceWidgetId, groupId, store = tableExecutionStore, onClose }: {
  dashboardId: string;
  sourceWidgetId?: string;
  groupId?: string;
  store?: Pick<TableExecutionStore, "subscribe" | "readView">;
  onClose: () => void;
}) {
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === dashboardId));
  const fixedGroup = groupId === undefined ? undefined : dashboard?.groups?.find((g) => g.id === groupId);
  const [source, setSource] = useState(sourceWidgetId ?? fixedGroup?.source?.sourceWidgetId ?? "");
  const [picked, setPicked] = useState<string | undefined>(fixedGroup?.source?.columnId);
  /** "" is a new group: group ids are never empty. */
  const [target, setTarget] = useState(groupId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useModalDialog(onClose);
  const tableId = useId();
  const columnId = useId();
  const groupSelectId = useId();
  const view = useSyncExternalStore(store.subscribe, () => store.readView(dashboardId, source));

  const tables = dashboard?.tabs.flatMap((tab) => tab.cards
    .filter((c) => canFeedGroup(dashboard, target || undefined, c.id))
    .map((c) => ({ id: c.id, label: `${c.title ?? c.widgetId} — ${tab.name}` }))) ?? [];
  const columns = tickerColumns(view.ready?.columns ?? []);
  const column = picked !== undefined && columns.some((c) => c.id === picked) ? picked : (defaultTickerColumn(columns) ?? "");
  const symbolGroups = (dashboard?.groups ?? []).filter((g) => g.groupType === "symbol");
  const sourceValid = tables.some((t) => t.id === source);
  const valid = sourceValid && column !== "";

  async function save() {
    if (!dashboard || !valid || saving) return;
    const existing = dashboard.groups?.find((g) => g.id === target);
    setSaving(true);
    setError("");
    try {
      if (existing?.source && (existing.source.sourceWidgetId !== source || existing.source.columnId !== column)) {
        const old = tableLabel(dashboard, existing.source.sourceWidgetId) ?? "a table that is no longer on this dashboard";
        const ok = await confirm(`Replace the source of "${existing.name}"? It is fed by ${old}.`, {
          title: "Replace source", kind: "warning", okLabel: "Replace", cancelLabel: "Cancel",
        });
        if (!ok) return;
      }
      const id = await useDashboardStore.getState().setGroupSource(dashboardId, existing ? existing.id : null, { sourceWidgetId: source, columnId: column });
      if (id) onClose();
      else setError("Source unavailable. Choose a table in this dashboard.");
    } catch {
      setError("Could not save the source. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <DialogShell dialogRef={dialogRef} title={LABEL} ariaLabel={LABEL} onClose={onClose} plain
    footerActions={<><button type="button" className="bd-button" onClick={onClose}>Cancel</button><button type="button" className="bd-button bd-button--primary" disabled={!valid || saving} onClick={() => void save()}>{LABEL}</button></>}>
    <label htmlFor={tableId}>Source table</label>
    <select id={tableId} value={sourceValid ? source : ""} disabled={saving} onChange={(e) => { setSource(e.target.value); setPicked(undefined); }}>
      <option value="">Choose source</option>
      {tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
    <label htmlFor={columnId}>Ticker column</label>
    <select id={columnId} value={column} disabled={saving || columns.length === 0} onChange={(e) => setPicked(e.target.value)}>
      <option value="">Choose column</option>
      {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
    {sourceValid && !view.ready ? <p role="status">The table has not loaded yet; its columns appear when it has.</p> : null}
    {groupId === undefined ? <>
      <label htmlFor={groupSelectId}>Symbol group</label>
      <select id={groupSelectId} value={target} disabled={saving} onChange={(e) => setTarget(e.target.value)}>
        <option value="">New group</option>
        {symbolGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </> : <p>{`Group: ${fixedGroup?.name ?? ""}`}</p>}
    {!tables.length ? <p>No eligible table sources in this dashboard.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </DialogShell>;
}
