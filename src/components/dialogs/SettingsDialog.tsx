// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { decimalPlacesExample } from "../../lib/format";
import type { FoldersFile } from "../../lib/foldersFile";
import { logError } from "../../lib/logger";
import { readLogTail } from "../../lib/logViewer";
import { saveTextFile } from "../../lib/saveTextFile";
import {
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  VALID_AUTO_REFRESH,
  WIDGET_GAP_MAX,
  WIDGET_GAP_MIN,
} from "../../lib/settingsFile";
import {
  BUNDLE_FILENAME,
  exportBundle,
  planSettingsImport,
  type SettingsImportPlan,
} from "../../lib/settingsBundle";
import { serviceSettingsEntries } from "../../lib/settingsSections";
import type { Settings } from "../../lib/types";
import { useBackendsStore } from "../../stores/backendsStore";
import { useFoldersStore } from "../../stores/foldersStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "../../stores/workspaceStore";
import type { SettingsApi } from "../../lib/workspaceAccount";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { useModalDialog } from "../../hooks/useModalDialog";
import { connectServer, promptSignIn } from "../runWorkspaceSync";
import { DialogShell } from "./DialogShell";
import { DialogTabs } from "./DialogTabs";
import { RangeRow } from "./RangeRow";
import { ServiceSection } from "./settings/ServiceSection";

type SettingsTab = "general" | "widget" | "layout" | "logs";

// The app's own sections. Since v3.0.3 the Provider keys tab is not one of
// them: it is a service section (below), there only when a backend runs
// key-maint, and labelled with that backend's widget name.
const TABS: Array<[SettingsTab, string]> = [
  ["general", "General"],
  ["widget", "Widget"],
  ["layout", "Layout"],
  ["logs", "Logs"],
];

const PANEL_ID = "settings-panel";

function Row({
  label,
  htmlFor,
  description,
  control,
}: {
  label: string;
  htmlFor?: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="bd-row">
      <div className="bd-row-copy">
        {htmlFor !== undefined ? <label htmlFor={htmlFor}>{label}</label> : <div className="bd-row-title">{label}</div>}
        <p className="bd-muted">{description}</p>
      </div>
      {control}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return <Row label={label} description={description} control={<Switch label={label} checked={checked} onChange={onChange} />} />;
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div className="bd-section-heading">
      <h3>{title}</h3>
      <p className="bd-muted">{description}</p>
    </div>
  );
}

function Segments<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="bd-segments" aria-label={name} disabled={disabled}>
      {options.map(([v, t]) => (
        <label key={v}>
          <input type="radio" name={name} value={v} checked={v === value} onChange={() => onChange(v)} />
          <span>{t}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <button
      type="button"
      className="bd-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

/** The four persisted folders fields, without the store's actions. */
function foldersSnapshot(): FoldersFile {
  const { folders, folderOrder, placement, collapsed } = useFoldersStore.getState();
  return { folders, folderOrder, placement, collapsed };
}

/** A server's User Settings label once its settings API probe has answered. */
const SERVER_LABELS: Record<SettingsApi, { suffix: string; usable: boolean }> = {
  key: { suffix: "key", usable: true },
  login: { suffix: "login", usable: true },
  no: { suffix: "No settings API", usable: false },
  "needs-https": { suffix: "Needs HTTPS", usable: false },
  "authorization-header": { suffix: "Credential uses the Authorization header", usable: false },
  "key-refused": { suffix: "key refused", usable: false },
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.draft?.patch);
  const beginDraft = useSettingsStore((s) => s.beginDraft);
  const stageDraft = useSettingsStore((s) => s.stageDraft);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const commitDraft = useSettingsStore((s) => s.commitDraft);

  // Opens the draft transaction for the lifetime of this dialog: every
  // staged control below previews through `effective`, and nothing reaches
  // disk until Done calls commitDraft. Unlike v8.1's Locked Widgets round
  // trip (which reopens Settings onto an existing draft), v4 has no flow
  // that reopens this dialog mid-edit, so it always starts a fresh draft.
  useEffect(() => {
    beginDraft();
  }, [beginDraft]);

  const effective: Settings = { ...settings, ...(patch ?? {}) };

  const widgets = useWidgetRegistryStore((s) => s.widgets);
  const backends = useBackendsStore((s) => s.backends);
  // Service sections are whatever the connected backends advertise right now
  // (docs/settings-widgets.md), already sorted by backend name then label, so
  // they are rebuilt when discovery changes either. They sit between Layout
  // and Logs; Logs stays last.
  const services = useMemo(() => serviceSettingsEntries(widgets, backends), [widgets, backends]);
  const items = useMemo<Array<[string, string]>>(
    () => [...TABS.slice(0, -1), ...services.map((e): [string, string] => [e.id, e.label]), TABS[TABS.length - 1]],
    [services],
  );

  const [tab, setTab] = useState<string>("general");
  // A service section can vanish while it is selected (its backend removed,
  // or rediscovered without it); the dialog then shows General rather than
  // no panel at all, and syncs the tab to it so the section's return doesn't
  // pull the user back.
  const active = items.some(([id]) => id === tab) ? tab : "general";
  if (active !== tab) setTab(active);
  const activeService = services.find((e) => e.id === active);
  // Local only: trimmed and staged solely by Done (see done() below), so a
  // typo left mid-edit is never written just because focus moved, the tab
  // changed, or Escape closed the dialog -- unlike v4's old commitTickerRef,
  // which persisted the field on blur/tab-leave/Escape.
  const [tickerDraft, setTickerDraft] = useState(effective.defaultTicker ?? "");
  // Once true, KeysPanel stays mounted (hidden via the `hidden` attribute
  // rather than unmounted) so leaving and returning to the tab doesn't
  // re-fetch /keys, discard a just-shown "restart required" notice, or lose
  // an open edit row. The other four panels stay mount-on-select.
  // Since v3.0.3 this holds for every service section, by id -- the Keys
  // panel and a form, whose unsaved edits then survive a tab switch.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  // A server connect in flight (probe, sign-in, sync, conflict question).
  // Done waits for it, as it waits for its own commit.
  const [storagePending, setStoragePending] = useState(false);
  // Server picked but no connection chosen yet: the dropdown shows, nothing
  // is saved. Saved storage alone decides once a connection is chosen.
  const [serverPicked, setServerPicked] = useState(false);
  // The connection the user last tried to choose; its notice (a refused key,
  // a refused sync) is shown in the row (ruling R1).
  const [triedId, setTriedId] = useState<string | null>(null);
  const workspaceConnections = useWorkspaceStore((s) => s.connections);
  const settingsApis = useWorkspaceStore((s) => s.apis);
  const sessions = useWorkspaceStore((s) => s.sessions);
  const notices = useWorkspaceStore((s) => s.notices);
  const storageList = useMemo(() => toSettingsConnections(workspaceConnections, backends), [workspaceConnections, backends]);
  const holder = storageConnection(effective, storageList);
  const serverChosen = holder !== null || serverPicked;
  const holderLive = holder !== null && sessions[holder.id] !== undefined && sessions[holder.id].state !== "expired";
  // The attempted connection's notice, else the holder's (left by launch or by Sign in).
  const storageNotice = notices[triedId ?? ""] ?? notices[holder?.id ?? ""];
  // Every connection is probed when the dialog opens (5 s each, in
  // parallel), so each option can show its mode. Fired, never awaited.
  useEffect(() => {
    void useWorkspaceStore.getState().probeAll().catch(() => {});
  }, []);
  const [conflicts, setConflicts] = useState<(keyof Settings)[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  // True only when the MOST RECENT loadLog() failed after a prior successful
  // one -- so the last-good lines stay on screen (see loadLog's catch below)
  // while the UI still says the displayed snapshot is out of date.
  const [logStale, setLogStale] = useState(false);
  // Shared by Refresh and Export logs: both disable Export logs (see the
  // button below) so a user can't kick off an export mid-refresh against
  // lines that are about to change under them.
  const [logLoading, setLogLoading] = useState(false);
  const [logExporting, setLogExporting] = useState(false);
  const [logExportError, setLogExportError] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<Extract<SettingsImportPlan, { ok: true }> | null>(null);
  const [stagedFolders, setStagedFolders] = useState<FoldersFile | null>(null);
  const [ioNotice, setIoNotice] = useState<string | null>(null);

  // Escape is the same as Cancel, guard included.
  const dialogRef = useModalDialog(() => cancel());

  async function loadLog() {
    setLogLoading(true);
    try {
      const tail = await readLogTail();
      setLogPath(tail.path);
      setLogLines(tail.lines);
      setLogStale(false);
    } catch (err) {
      await logError(`failed to read log file: ${err}`);
      // Keep the last good snapshot on screen rather than blanking it; only
      // mark it stale if there was a snapshot to begin with.
      if (logLines.length > 0) setLogStale(true);
    } finally {
      setLogLoading(false);
    }
  }
  async function exportLogs() {
    setLogExportError(null);
    setLogExporting(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      // Ships exactly the snapshot on screen, including a stale one -- a
      // cancelled save dialog produces no notice, so `written` is unused.
      await saveTextFile(`bdobb-logs-${stamp}.txt`, "Log files", `${logLines.join("\n")}\n`, "txt");
    } catch (err) {
      setLogExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogExporting(false);
    }
  }

  function stage(p: Partial<Settings>) {
    // Any staged change invalidates a pending conflict/error notice; the
    // user is moving on.
    setConflicts(null);
    setSaveError(null);
    stageDraft(p);
  }

  async function exportSettings() {
    setIoNotice(null);
    const trimmed = tickerDraft.trim();
    // The effective draft after ticker validation, without saving.
    const eff: Settings = {
      ...selectEffective(useSettingsStore.getState()),
      defaultTicker: trimmed === "" ? undefined : trimmed,
    };
    try {
      const written = await saveTextFile(BUNDLE_FILENAME, BUNDLE_FILENAME, exportBundle(eff, foldersSnapshot()));
      if (!written) return;
      setIoNotice("Exported settings.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIoNotice(`Export failed: ${message}`);
      await logError(`failed to export ${BUNDLE_FILENAME}: ${message}`);
    }
  }

  async function importSettings() {
    setIoNotice(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: BUNDLE_FILENAME, extensions: ["json"] }],
      });
      if (path === null) return;
      // Sized before it is read, as every other import here is.
      const bytes = (await stat(path)).size;
      // Validated against the CURRENT effective draft, so the review lines
      // below read "what would actually change from here" rather than from
      // whatever was on disk before this dialog opened.
      const plan = planSettingsImport(
        await readTextFile(path),
        bytes,
        selectEffective(useSettingsStore.getState()),
      );
      if (!plan.ok) {
        setIoNotice(plan.refusal);
        return;
      }
      // Held for review rather than staged immediately: the user sees what
      // would change (and any warnings) and has to say Apply before it
      // touches the draft at all.
      setImportPlan(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIoNotice(`Import failed: ${message}`);
      await logError(`failed to import ${BUNDLE_FILENAME}: ${message}`);
    }
  }

  /** An option's label suffix: its mode when usable, otherwise why it is disabled. */
  function serverLabel(id: string): { suffix: string; usable: boolean } {
    const api = settingsApis[id];
    return api === undefined ? { suffix: "Checking…", usable: false } : SERVER_LABELS[api];
  }

  /**
   * User Settings saves at once rather than through the draft: choosing a
   * server is a connection and a sync, not a preference Cancel could take
   * back. A server is saved only after connectServer resolves true -- it
   * connected by key or by login, AND the sign-in sync completed. After a
   * refused key, a cancelled sign-in or refused display settings nothing was
   * compared, and switching anyway would let the next save overwrite server
   * values nobody was asked about. Not saving IS the revert: the controls
   * read the saved value. Local saves the field as absent and only stops
   * uploads; sessions stay until Sign out or quit.
   */
  async function chooseStorage(id: string) {
    setStoragePending(true);
    setTriedId(id === "" ? null : id);
    try {
      if (id !== "") {
        const connection = storageList.find((c) => c.id === id);
        // This line stages the ticker only at Done, so "typed in" is the field
        // differing from the saved ticker before the connect.
        const tickerTyped = tickerDraft !== (useSettingsStore.getState().settings.defaultTicker ?? "");
        if (connection === undefined || !(await connectServer(connection, { settingsStorage: id }))) return;
        // Use <name> may have saved a new ticker under the open draft; the
        // ticker field is local state, and Done stages it, so it follows
        // unless the user has typed in it.
        if (!tickerTyped) setTickerDraft(useSettingsStore.getState().settings.defaultTicker ?? "");
      } else {
        setServerPicked(false);
      }
      await useSettingsStore.getState().save({ settingsStorage: id === "" ? undefined : id });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoragePending(false);
    }
  }

  /**
   * The user confirmed the review. Staged, not saved directly: a draft is
   * always open for the lifetime of this dialog, so writing straight to disk
   * here would leave the draft's snapshot stale and make Done misreport
   * these very fields as "changed elsewhere" the moment it runs. Folders
   * have no draft of their own, so they wait in local state and land via
   * replaceAll only once Done actually commits.
   */
  function applyImport() {
    if (importPlan === null) return;
    stage(importPlan.patch);
    // The ticker field is staged again at Done, so it must show the import.
    if (Object.hasOwn(importPlan.patch, "defaultTicker")) setTickerDraft(importPlan.patch.defaultTicker ?? "");
    setStagedFolders(importPlan.folders);
    setImportPlan(null);
  }

  async function done() {
    const trimmed = tickerDraft.trim();
    const ticker = trimmed === "" ? undefined : trimmed;
    // This line stages a typed ticker only here, so the field is staged when
    // it differs from the saved ticker or replaces one the draft holds (an
    // import): an untouched field after a server connect saved another
    // ticker would otherwise be a false conflict.
    const { settings, draft } = useSettingsStore.getState();
    if (ticker !== settings.defaultTicker || Object.hasOwn(draft?.patch ?? {}, "defaultTicker")) {
      stageDraft({ defaultTicker: ticker });
    }
    setPending(true);
    const result = await commitDraft(conflicts !== null ? { replace: true } : undefined);
    // The folder tree commits only alongside a successful settings commit --
    // an imported bundle's folders and prefs land together, or neither does.
    // ponytail: commitDraft above has already written prefs, so a failing folder
    // write leaves prefs committed but folders not -- full atomicity would need a
    // two-phase commit across the two stores. Here we at least surface the failure
    // and keep the dialog usable, rather than swallowing the rejection and leaving
    // Done permanently disabled with onClose never called (the pre-fix wedge).
    if (result.ok && stagedFolders !== null) {
      try {
        await useFoldersStore.getState().replaceAll(stagedFolders);
      } catch (err) {
        // The prefs commit cleared the draft, and stageDraft needs one: open a
        // fresh draft over the just-committed settings so further edits still
        // stage, and the next Done retries the still-staged folders.
        beginDraft();
        setPending(false);
        setSaveError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setPending(false);
    if (result.ok) {
      onClose();
      return;
    }
    if ("conflicts" in result) {
      setConflicts(result.conflicts);
      return;
    }
    setSaveError(result.error);
  }

  function cancel() {
    // Done's write is already on its way and cannot be called back: closing
    // now would discard a draft that still lands on disk, and done() would
    // then call onClose a second time. Done itself closes when it settles.
    // A server connect cannot be called back either: it saves on its own.
    if (pending || storagePending) return;
    discardDraft();
    setStagedFolders(null);
    setImportPlan(null);
    onClose();
  }

  function selectTab(id: string) {
    // Each visit to Logs re-reads the file, so it shows what was logged
    // since the dialog opened.
    if (id === "logs" && id !== active) void loadLog();
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    setTab(id);
  }

  const note =
    activeService?.kind === "keys"
      ? "Key edits use their own permission-gated submit action. Done applies pending preferences; Cancel discards them."
      : activeService?.kind === "form"
        ? "This service's settings save with their own Save button. Done applies pending preferences; Cancel discards them."
        : "Import and Export include preferences only, never provider keys. Done applies pending preferences; Cancel discards them.";

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="Settings"
      title="Settings"
      headerActions={
        <>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void importSettings()}>
            Import…
          </button>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void exportSettings()}>
            Export…
          </button>
        </>
      }
      nav={
        <DialogTabs
          items={items}
          selected={active}
          onSelect={selectTab}
          label="Settings sections"
          panelId={PANEL_ID}
          idPrefix="settings-tab"
        />
      }
      bodyId={PANEL_ID}
      bodyLabelledBy={`settings-tab-${active.replace(/\s/g, "_")}`}
      note={note}
      footerActions={
        <>
          <button type="button" className="bd-button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="bd-button bd-button--primary" disabled={pending || storagePending} onClick={() => void done()}>
            Done
          </button>
        </>
      }
      onClose={cancel}
    >
      {ioNotice !== null ? (
        <div className="bd-notice" role="status">
          {ioNotice}
        </div>
      ) : null}
      {importPlan !== null ? (
        <div className="bd-notice" role="status">
          {importPlan.notice !== "" ? <p>{importPlan.notice}</p> : null}
          {importPlan.review.length === 0 ? (
            <p>No preference changes.</p>
          ) : (
            importPlan.review.map((line) => <p key={line}>{line}</p>)
          )}
          {importPlan.folderReview !== null ? <p>{importPlan.folderReview}</p> : null}
          {importPlan.warnings.map((w) => (
            <p key={w} className="bd-muted">
              {w}
            </p>
          ))}
          <div className="bd-actions">
            <button type="button" className="bd-button bd-button--primary" onClick={applyImport}>
              Apply
            </button>
            <button type="button" className="bd-button" onClick={() => setImportPlan(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
      {conflicts !== null ? (
        <div className="bd-notice bd-notice--warning" role="status">
          {`${conflicts.join(", ")} changed elsewhere while this dialog was open. Done again to replace the newer values.`}
        </div>
      ) : null}
      {saveError !== null ? (
        <div className="bd-notice bd-notice--error" role="status">
          {`Could not save: ${saveError}`}
        </div>
      ) : null}

      {active === "general" ? (
        <>
          <Heading title="General" description="Appearance and default behavior for your workspace." />
          <Row
            label="User Settings"
            description={
              // Every connection has answered and none offers a usable mode --
              // true for an empty list too. While any probe is pending the
              // ordinary description shows, so the hint never flickers.
              storageList.every((c) => settingsApis[c.id] !== undefined && !serverLabel(c.id).usable)
                ? "Add a Workspace connection in Connections, or a backend that serves the Workspace settings API."
                : "Local keeps settings on this computer. Server also syncs them with the server you choose."
            }
            control={
              <div className="bd-inline">
                <Segments
                  name="userSettings"
                  disabled={storagePending}
                  value={serverChosen ? "server" : "local"}
                  options={[
                    ["local", "Local"],
                    ["server", "Server"],
                  ]}
                  onChange={(v) => (v === "local" ? void chooseStorage("") : setServerPicked(true))}
                />
                {serverChosen ? (
                  <select
                    id="settings-server"
                    aria-label="Server"
                    className="bd-input"
                    value={holder?.id ?? ""}
                    disabled={storagePending}
                    onChange={(e) => void chooseStorage(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose a server…
                    </option>
                    {storageList.map((c) => {
                      const { suffix, usable } = serverLabel(c.id);
                      return (
                        <option key={c.id} value={c.id} disabled={!usable}>
                          {`${c.name} — ${suffix}`}
                        </option>
                      );
                    })}
                  </select>
                ) : null}
                {holder !== null && !holderLive ? (
                  <button
                    type="button"
                    className="bd-button"
                    disabled={storagePending}
                    onClick={() => {
                      setStoragePending(true);
                      setTriedId(holder.id);
                      void promptSignIn(holder)
                        .catch((err: unknown) => logError(`sign-in failed: ${err}`))
                        .finally(() => setStoragePending(false));
                    }}
                  >
                    Sign in
                  </button>
                ) : null}
                {storageNotice !== undefined ? <div className="bd-notice" role="status">{storageNotice}</div> : null}
              </div>
            }
          />
          <Row
            label="Theme"
            description="Choose an appearance for the entire application."
            control={
              <Segments
                name="theme"
                value={effective.theme}
                options={[
                  ["light", "Light"],
                  ["dark", "Dark"],
                  ["system", "System"],
                ]}
                onChange={(v) => stage({ theme: v })}
              />
            }
          />
          <Row
            label="Font size"
            description="Applies to dialogs, controls, and widget text."
            control={
              <Segments
                name="fontSize"
                value={effective.fontSize}
                options={[
                  ["medium", "Medium"],
                  ["large", "Large"],
                ]}
                onChange={(v) => stage({ fontSize: v })}
              />
            }
          />
          <Row
            label="Auto-refresh"
            htmlFor="auto-refresh"
            description="Refresh dashboard data at a regular interval."
            control={
              <select
                id="auto-refresh"
                className="bd-input"
                value={effective.autoRefreshMinutes ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  // "" is Off, staged as undefined so a commit drops the key
                  // entirely rather than persisting a null.
                  stage({
                    autoRefreshMinutes:
                      value === "" ? undefined : (Number(value) as Settings["autoRefreshMinutes"]),
                  });
                }}
              >
                <option value="">Off</option>
                {VALID_AUTO_REFRESH.map((m) => (
                  <option key={m} value={m}>{`${m} ${m === 1 ? "minute" : "minutes"}`}</option>
                ))}
              </select>
            }
          />
          <Row
            label="Default widget ticker"
            htmlFor="default-ticker"
            description="Used when a widget needs an initial symbol."
            control={
              <input
                id="default-ticker"
                className="bd-input"
                type="text"
                value={tickerDraft}
                onChange={(e) => setTickerDraft(e.target.value)}
              />
            }
          />
          <SwitchRow
            label="Match dashboard symbol"
            description="Use the dashboard's symbol when adding a widget."
            checked={effective.matchDashboardSymbol}
            onChange={(c) => stage({ matchDashboardSymbol: c })}
          />
        </>
      ) : null}

      {active === "widget" ? (
        <>
          <Heading title="Widget" description="Consistent formatting and controls across your widgets." />
          <Row
            label="Maximum decimal places"
            htmlFor="max-decimals"
            description="Control the precision of numeric values."
            control={
              <select
                id="max-decimals"
                className="bd-input"
                value={effective.maxDecimalPlaces}
                onChange={(e) => stage({ maxDecimalPlaces: Number(e.target.value) as Settings["maxDecimalPlaces"] })}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {decimalPlacesExample(n)}
                  </option>
                ))}
              </select>
            }
          />
          <SwitchRow
            label="Minimize button on header"
            description="Show the minimize action on each widget."
            checked={effective.minimizeButton}
            onChange={(c) => stage({ minimizeButton: c })}
          />
          <SwitchRow
            label="Collapse widget controls"
            description="Keep parameters behind an expandable chevron."
            checked={effective.collapseWidgetControls}
            onChange={(c) => stage({ collapseWidgetControls: c })}
          />
        </>
      ) : null}

      {active === "layout" ? (
        <>
          <Heading title="Layout" description="Adjust the space around your dashboard." />
          <SwitchRow
            label="Corner drag handles"
            description="Resize widgets from their corners."
            checked={effective.cornerDragHandles}
            onChange={(c) => stage({ cornerDragHandles: c })}
          />
          <SwitchRow
            label="Quick add toolbar"
            description="Keep the quick add action visible."
            checked={effective.quickAddToolbar}
            onChange={(c) => stage({ quickAddToolbar: c })}
          />
          <RangeRow
            label="Collapsed rail width"
            description="Width of the collapsed navigation rail."
            min={RAIL_WIDTH_MIN}
            max={RAIL_WIDTH_MAX}
            value={effective.railWidth}
            onCommit={(px) => stage({ railWidth: px })}
          />
          <RangeRow
            label="Dashboard widget spacing"
            description="Space between cards."
            min={WIDGET_GAP_MIN}
            max={WIDGET_GAP_MAX}
            value={effective.widgetGap}
            onCommit={(px) => stage({ widgetGap: px })}
          />
          <Row
            label="Option-number shortcuts"
            description="⌥1–⌥9 select dashboards or workspaces, never both."
            control={
              <Segments
                name="numberShortcutTarget"
                value={effective.numberShortcutTarget}
                options={[
                  ["dashboards", "Dashboards"],
                  ["workspaces", "Workspaces"],
                ]}
                onChange={(v) => stage({ numberShortcutTarget: v })}
              />
            }
          />
        </>
      ) : null}

      {services.map((e) =>
        visited.has(e.id) ? (
          <div key={e.id} hidden={e.id !== active}>
            <ServiceSection entry={e} />
          </div>
        ) : null,
      )}

      {active === "logs" ? (
        <>
          <p className="bd-muted">{logPath ?? "Resolving log file path…"}</p>
          <div className="bd-inline">
            <button type="button" className="bd-button" aria-label="Refresh log" disabled={logLoading || logExporting} onClick={() => void loadLog()}>
              Refresh
            </button>
            <button
              type="button"
              className="bd-button"
              disabled={logLines.length === 0 || logLoading || logExporting}
              onClick={() => void exportLogs()}
            >
              Export logs
            </button>
          </div>
          <p className="bd-muted">
            Exports the displayed log text only. Review logs for sensitive information before sharing.
          </p>
          {logStale ? (
            <p className="bd-muted" role="status">
              Showing the last loaded log; refresh failed.
            </p>
          ) : null}
          {logExportError !== null ? (
            <div className="bd-notice bd-notice--error" role="status">{`Log export failed: ${logExportError}`}</div>
          ) : null}
          {logLines.length === 0 ? (
            <p className="bd-muted">No log entries yet.</p>
          ) : (
            <pre className="bd-log">{logLines.join("\n")}</pre>
          )}
        </>
      ) : null}
    </DialogShell>
  );
}
