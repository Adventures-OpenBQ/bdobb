// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { decimalPlacesExample } from "../../lib/format";
import type { FoldersFile } from "../../lib/foldersFile";
import { logError } from "../../lib/logger";
import { readLogTail } from "../../lib/logViewer";
import { saveTextFile } from "../../lib/saveTextFile";
import { BUNDLE_FILENAME, exportBundle, planSettingsImport, type SettingsImportPlan } from "../../lib/settingsBundle";
import { RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from "../../lib/settingsFile";
import { serviceSettingsEntries } from "../../lib/settingsSections";
import type { Settings } from "../../lib/types";
import { useBackendsStore } from "../../stores/backendsStore";
import { useFoldersStore } from "../../stores/foldersStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "../../stores/workspaceStore";
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

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
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

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.draft?.patch);
  const beginDraft = useSettingsStore((s) => s.beginDraft);
  const stageDraft = useSettingsStore((s) => s.stageDraft);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const commitDraft = useSettingsStore((s) => s.commitDraft);

  // Open the transaction on first mount only, guarded so a stray draft left
  // behind by an earlier unclean unmount (e.g. a test, or a future dialog
  // that stacks over this one) is kept rather than clobbered.
  useEffect(() => {
    if (useSettingsStore.getState().draft === null) beginDraft();
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
  // Local until Done: the ticker no longer persists on blur or on tab-leave.
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
  const [logLoading, setLogLoading] = useState(false);
  // Bookkeeping only -- never rendered -- so a ref keeps it out of the mount-only
  // effect's exhaustive-deps requirement below (a `loadLog` closing over reactive
  // *state* would need to be re-created and re-listed as a dependency; closing
  // over a ref is exempt, since ref reads are not a React-tracked value).
  // Since v3.0.3 the log loads on each visit to the Logs tab (selectTab), not
  // from a mount effect.
  const logLoadedOnce = useRef(false);
  const [logsExporting, setLogsExporting] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The parsed-but-not-yet-applied import: shown as a review, and only
  // staged into the draft (settings) / dialog state (folders) on Apply.
  const [importPlan, setImportPlan] = useState<Extract<SettingsImportPlan, { ok: true }> | null>(null);
  const [stagedFolders, setStagedFolders] = useState<FoldersFile | null>(null);

  // Escape is the same as Cancel, guard included.
  const dialogRef = useModalDialog(() => cancel());

  async function loadLog() {
    setLogLoading(true);
    try {
      const tail = await readLogTail();
      setLogPath(tail.path);
      setLogLines(tail.lines);
      logLoadedOnce.current = true;
      setLogsError(null);
    } catch (err) {
      await logError(`failed to read log file: ${err}`);
      // Only "stale" after a load that actually succeeded once -- the first,
      // ever load failing has no prior lines to call stale.
      if (logLoadedOnce.current) setLogsError("Showing the last loaded log; refresh failed.");
    } finally {
      setLogLoading(false);
    }
  }
  async function exportLogs() {
    setLogsError(null);
    setLogsExporting(true);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `bdobb-logs-${stamp}.txt`;
    try {
      // A cancelled save dialog (written === false) reports nothing -- the
      // user asked to back out, not a failure to surface.
      await saveTextFile(name, name, `${logLines.join("\n")}\n`, "txt");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogsError(`Export failed: ${message}`);
      await logError(`failed to export ${name}: ${message}`);
    } finally {
      setLogsExporting(false);
    }
  }

  function stage(p: Partial<Settings>) {
    // Any staged change invalidates a pending conflict/error notice; the user
    // is moving on.
    setConflicts(null);
    setSaveError(null);
    stageDraft(p);
  }

  async function exportSettings() {
    setNotice(null);
    const trimmed = tickerDraft.trim();
    // The effective draft after ticker validation, without saving.
    const eff: Settings = {
      ...selectEffective(useSettingsStore.getState()),
      defaultTicker: trimmed === "" ? undefined : trimmed,
    };
    try {
      const written = await saveTextFile(BUNDLE_FILENAME, BUNDLE_FILENAME, exportBundle(eff, foldersSnapshot()));
      if (written) setNotice("Exported settings.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Export failed: ${message}`);
      await logError(`failed to export ${BUNDLE_FILENAME}: ${message}`);
    }
  }

  async function importSettings() {
    setNotice(null);
    setImportPlan(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: BUNDLE_FILENAME, extensions: ["json"] }],
      });
      if (path === null) return;
      // Sized before it is read, as every other import here is.
      const bytes = (await stat(path)).size;
      const plan = planSettingsImport(
        await readTextFile(path),
        bytes,
        selectEffective(useSettingsStore.getState()),
      );
      if (!plan.ok) {
        setNotice(plan.refusal);
        return;
      }
      // Shown as a review rather than staged immediately: the user sees
      // exactly which fields would change (and the folder tree, and any
      // warnings) before anything touches the draft.
      setImportPlan(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Import failed: ${message}`);
      await logError(`failed to import ${BUNDLE_FILENAME}: ${message}`);
    }
  }

  /** An option's label suffix: its mode when usable, otherwise why it is disabled. */
  function serverLabel(id: string): { suffix: string; usable: boolean } {
    switch (settingsApis[id]) {
      case "key":
        return { suffix: "key", usable: true };
      case "login":
        return { suffix: "login", usable: true };
      case "no":
        return { suffix: "No settings API", usable: false };
      case "needs-https":
        return { suffix: "Needs HTTPS", usable: false };
      case "authorization-header":
        return { suffix: "Credential uses the Authorization header", usable: false };
      case "key-refused":
        return { suffix: "key refused", usable: false };
      default:
        return { suffix: "Checking…", usable: false };
    }
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
        if (connection === undefined || !(await connectServer(connection, { settingsStorage: id }))) return;
        // Use <name> may have saved a new ticker under the open draft; the
        // ticker field is local state, so it follows unless the user has
        // typed in it.
        const draft = useSettingsStore.getState().draft;
        if (draft !== null && !Object.hasOwn(draft.patch, "defaultTicker")) {
          setTickerDraft(useSettingsStore.getState().settings.defaultTicker ?? "");
        }
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
   * Apply stages the reviewed patch into the draft (Cancel-able like any
   * other edit) and holds the folder tree in dialog state until Done -- a
   * folder replace is NOT staged into settingsStore's draft, since folders
   * live in their own store, but it must still be Cancel-able alongside the
   * rest of the review.
   */
  function applyImport() {
    if (importPlan === null) return;
    stage(importPlan.patch);
    setStagedFolders(importPlan.folders);
    setImportPlan(null);
  }

  async function done() {
    // Only a ticker the draft holds (typed or imported) is trimmed and staged.
    // Staging an untouched field would turn a ticker a server connect saved
    // meanwhile into a false "changed elsewhere" conflict.
    if (Object.hasOwn(useSettingsStore.getState().draft?.patch ?? {}, "defaultTicker")) {
      const trimmed = tickerDraft.trim();
      stageDraft({ defaultTicker: trimmed === "" ? undefined : trimmed });
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
      subtitle="Make the workspace your own"
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
          label="Preferences"
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
      {notice !== null ? (
        <div className="bd-notice" role="status">
          {notice}
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
                  // "" is Off, staged as undefined so the committed patch
                  // ultimately drops the key entirely rather than persisting
                  // a null.
                  stage({
                    autoRefreshMinutes:
                      value === "" ? undefined : (Number(value) as Settings["autoRefreshMinutes"]),
                  });
                }}
              >
                <option value="">Off</option>
                <option value="1">Every minute</option>
                <option value="5">Every 5 minutes</option>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option>
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
                onChange={(e) => {
                  const text = e.target.value;
                  setTickerDraft(text);
                  // Staged on every keystroke, raw and untrimmed, so the
                  // draft's patch always reflects what's currently typed.
                  // Done is the only place that trims and clears an empty
                  // value.
                  stage({ defaultTicker: text });
                }}
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
          <Heading title="Logs" description="Review diagnostic information without leaving the workspace." />
          <p className="bd-muted">{logPath ?? "Resolving log file path…"}</p>
          <div className="bd-inline" style={{ justifyContent: "space-between" }}>
            <span className="bd-muted">Log output</span>
            <div className="bd-inline">
              <button
                type="button"
                className="bd-button"
                aria-label="Refresh log"
                disabled={logLoading}
                onClick={() => void loadLog()}
              >
                Refresh
              </button>
              <button
                type="button"
                className="bd-button"
                aria-label="Export logs"
                disabled={logLines.length === 0 || logLoading || logsExporting}
                onClick={() => void exportLogs()}
              >
                Export logs
              </button>
            </div>
          </div>
          <p className="bd-muted">
            Exports the displayed log text only. Review logs for sensitive information before sharing.
          </p>
          {logsError !== null ? (
            <div className="bd-notice bd-notice--error" role="status">
              {logsError}
            </div>
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
