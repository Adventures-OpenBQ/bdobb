// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { confirm } from "@tauri-apps/plugin-dialog";
import { Fragment, useEffect, useRef, useState } from "react";
import { OPENBB_PLATFORM_SERVICE, OPENBB_REFERENCE_SERVICE } from "../../lib/dataClient";
import { connectionDetailsChanged, planBackendsImport } from "../../lib/backendsJson";
import { logError } from "../../lib/logger";
import { pickImportFile } from "../../lib/pickImportFile";
import { saveTextFile } from "../../lib/saveTextFile";
import { workspaceAddress } from "../../lib/workspaceAccount";
import { persistable, useBackendsStore } from "../../stores/backendsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore, type SessionEntry, type WorkspaceConnection } from "../../stores/workspaceStore";
import { promptSignIn } from "../runWorkspaceSync";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import type { BackendConfig, BackendStatus } from "../../lib/types";
import { APPS_ISSUE_ID } from "../../lib/appsJson";
import { ROOT_ISSUE_ID } from "../../lib/widgetsJson";
import { useModalDialog } from "../../hooks/useModalDialog";
import { DialogShell } from "./DialogShell";
import { ServiceCard } from "../services/ServiceCard";
import { ServiceStatus, type ServiceState } from "../services/ServiceStatus";
import { WorkspaceConnectionForm, type WorkspaceFormValues } from "./WorkspaceDialogs";
import { BackendEditForm, EMPTY_DRAFT, toInput, type Draft } from "./BackendEditForm";


/** The OpenBB "BB" glyph, cut from the wordmark on openbb.co; marks the OpenBB Platform API, the OpenBB reference backend and every Workspace connection. */
const OPENBB_MARK = (
  <svg viewBox="51 -6.3 24 24" width="28" height="28" fill="currentColor">
    <path d="M60.707 1.416h-9.285v4.25h9.285v1.42h-7.854v4.25h9.283V1.423h-1.428l-.001-.007Zm0 7.793v.707H54.28V8.5h6.427v.709Zm0-5.668v.71h-7.854V2.831h7.855l-.001.71ZM69.99 11.333h2.852V7.087H64.99V5.671h9.285V1.42H63.562v9.913h6.428Zm-5-7.791v-.709h7.852V4.25H64.99v-.709Zm2.858 6.375H64.99V8.5h6.438v1.417h-3.58ZM63.563 0h-1.428v1.416h1.428V0Z" />
  </svg>
);

/** A Workspace card's dot and words, from that connection's own session (absent: signed out). Key mode has no username to name. */
function workspaceStatusView(session: SessionEntry | undefined): { state: ServiceState; text: string } {
  if (session === undefined) return { state: "unchecked", text: "Signed out" };
  if (session.state === "signed-in") return { state: "online", text: session.mode === "login" ? `Signed in as ${session.username}` : "Connected by key" };
  if (session.state === "expired") return { state: "offline", text: "Session expired" };
  return { state: "offline", text: `Not synced: ${session.reason ?? ""}` };
}

export function ConnectionsDialog({ onClose }: { onClose: () => void }) {
  const backends = useBackendsStore((s) => s.backends);
  const statuses = useBackendsStore((s) => s.statuses);
  const issues = useBackendsStore((s) => s.issues);
  const services = useBackendsStore((s) => s.services);
  const addBackend = useBackendsStore((s) => s.addBackend);
  const updateBackend = useBackendsStore((s) => s.updateBackend);
  const removeBackend = useBackendsStore((s) => s.removeBackend);
  const refresh = useBackendsStore((s) => s.refresh);
  const setBackends = useBackendsStore((s) => s.setBackends);
  const runtimeCredentials = useBackendsStore((s) => s.runtimeCredentials);
  /** The export/import result, as the rail's notice is for apps.json. */
  const [notice, setNotice] = useState<string | null>(null);
  const widgets = useWidgetRegistryStore((s) => s.widgets);
  const apps = useWidgetRegistryStore((s) => s.apps);

  const workspaceConnections = useWorkspaceStore((s) => s.connections);
  const sessions = useWorkspaceStore((s) => s.sessions);
  const apis = useWorkspaceStore((s) => s.apis);
  const notices = useWorkspaceStore((s) => s.notices);
  const settingsStorage = useSettingsStore((s) => s.settings.settingsStorage);
  // The add/edit form for one Workspace connection; null when closed.
  const [workspaceForm, setWorkspaceForm] = useState<{ editing: WorkspaceConnection | null } | null>(null);

  // Every connection is probed for the Workspace settings API on open, for
  // the backend cards' "Settings API" line. Fired, never awaited: each probe
  // carries its own 5 s deadline and none can fail the dialog.
  useEffect(() => {
    void useWorkspaceStore.getState().probeAll().catch(() => {});
  }, []);

  /**
   * Advisory, like the apps line: shown once this backend has been probed.
   * Only a usable mode is named, and a refused key (ruling R2) is named as
   * such; Needs HTTPS and a login server whose credential holds the
   * Authorization header read "no" here, and User Settings gives the reason.
   */
  function settingsApiFor(b: BackendConfig) {
    const answer = apis[b.id];
    if (answer === undefined) return null;
    const text = answer === "key" || answer === "login" ? answer : answer === "key-refused" ? "key refused" : "no";
    return <p className="bd-muted">{`Settings API: ${text}`}</p>;
  }

  /** After either kind of connection is removed: its username, its session, and settings storage if it held them. */
  async function forgetConnection(id: string) {
    await useWorkspaceStore.getState().removeConnection(id);
    if (useSettingsStore.getState().settings.settingsStorage === id) {
      await useSettingsStore.getState().save({ settingsStorage: undefined });
    }
  }

  /** The confirmation's extra sentence when the connection holds settings. */
  const holdsSettingsNote = (id: string) =>
    useSettingsStore.getState().settings.settingsStorage === id ? " It holds your settings; settings storage returns to Local." : "";

  /**
   * Add/Edit's Save: refuse bad input before anything is written, then write
   * the connection (name, address, Ask for credentials on startup) to
   * workspace.json. Adding opens the sign-in dialog for the new connection;
   * editing does not -- an edited address has already dropped that session
   * (workspaceStore.saveConnection), and the card offers Sign in.
   */
  async function saveWorkspace(values: WorkspaceFormValues): Promise<string | null> {
    const name = values.name.trim();
    if (name === "") return "Enter a name for this connection.";
    const address = workspaceAddress(values.serverUrl);
    if (!address.ok) return address.message;
    const adding = workspaceForm?.editing == null;
    let saved: WorkspaceConnection;
    try {
      saved = await useWorkspaceStore.getState().saveConnection({ id: workspaceForm?.editing?.id, name, serverUrl: address.value, askOnStartup: values.askOnStartup });
    } catch (err) {
      await logError(`failed to save workspace.json: ${err}`);
      return "Could not save the Workspace connection. The reason is in the log.";
    }
    setWorkspaceForm(null);
    if (adding) {
      void promptSignIn({ id: saved.id, name: saved.name, baseUrl: saved.serverUrl }).catch((err: unknown) => logError(`sign-in failed: ${err}`));
    }
    return null;
  }

  async function removeWorkspace(connection: WorkspaceConnection) {
    try {
      const ok = await confirm(`Remove Workspace "${connection.name}"?${holdsSettingsNote(connection.id)}`, {
        title: "Remove Workspace",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      await forgetConnection(connection.id);
    } catch (err) {
      await logError(`failed to remove Workspace connection ${connection.id}: ${err}`);
    }
  }

  const countFor = (id: string) => widgets.filter((w) => w.backendId === id).length;
  const appCountFor = (id: string) => apps.filter((a) => a.backendId === id).length;

  /**
   * The skipped count is opt-in per backend (`validateWidgets`), so a
   * backend that hasn't turned it on never shows "skipped" even when
   * `issues` holds entries for it.
   *
   * A `ROOT_ISSUE_ID` entry means the whole widgets.json payload was the
   * wrong shape, not that some widgets among many were dropped — "0, 1
   * skipped" would misread as one skip out of several. "Widgets rejected"
   * says plainly that nothing was usable.
   *
   * An `APPS_ISSUE_ID` entry is about the backend's apps.json and says
   * nothing about its widgets, so it is dropped before anything is counted
   * here — otherwise a backend serving every widget it declares would read
   * as "12 widgets, 1 skipped".
   */
  function widgetCell(b: BackendConfig) {
    if (statuses[b.id] !== "online") return "Widgets unavailable";
    const count = countFor(b.id);
    if (!b.validateWidgets) return `${count} widget${count === 1 ? "" : "s"}`;
    const backendIssues = (issues[b.id] ?? []).filter((issue) => issue.id !== APPS_ISSUE_ID);
    if (backendIssues.some((issue) => issue.id === ROOT_ISSUE_ID)) return "Widgets rejected";
    const skipped = backendIssues.length;
    return skipped > 0 ? `${count} widgets, ${skipped} skipped` : `${count} widget${count === 1 ? "" : "s"}`;
  }

  /** The app count mirrors widgetCell's offline/apps-issue precedence. */
  function appCell(b: BackendConfig) {
    if (statuses[b.id] !== "online") return "Apps unavailable";
    if ((issues[b.id] ?? []).some((issue) => issue.id === APPS_ISSUE_ID)) return "Apps unavailable";
    const n = appCountFor(b.id);
    return `${n} app${n === 1 ? "" : "s"}`;
  }

  /** The apps.json issue's own reason, surfaced under the card when online. */
  function appNote(b: BackendConfig) {
    if (statuses[b.id] !== "online") return null;
    const issue = (issues[b.id] ?? []).find((i) => i.id === APPS_ISSUE_ID);
    if (!issue) return null;
    return (
      <p className="bd-muted" role="note">
        {issue.reason}
      </p>
    );
  }

  /** Discovery's `GET /` probe names the OpenBB Platform API; see fetchServiceName. */
  const markFor = (b: BackendConfig) =>
    services[b.id] === OPENBB_PLATFORM_SERVICE || services[b.id] === OPENBB_REFERENCE_SERVICE ? OPENBB_MARK : "DB";

  function statusFor(b: BackendConfig): ServiceState {
    const s: BackendStatus | undefined = statuses[b.id];
    return s === "online" ? "online" : s === "offline" ? "offline" : "unchecked";
  }

  const active = backends.filter((b) => statuses[b.id] === "online");
  const inactive = backends.filter((b) => statuses[b.id] !== "online");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // A save in flight. The ref is the guard -- a second submit (double-click,
  // Enter twice) can arrive before React re-renders the disabled button --
  // and the state is what disables it. saveError is the form's one line
  // saying a save failed; the reason itself goes to the log.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useModalDialog(onClose);

  function startAdd() {
    setEditingId(null);
    setSaveError(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  function startEdit(backend: BackendConfig) {
    setEditingId(backend.id);
    setSaveError(null);
    setDraft({
      name: backend.name,
      baseUrl: backend.baseUrl,
      headerName: backend.headerName ?? "",
      headerValue: backend.headerValue ?? "",
      authLocation: backend.authLocation,
      validateWidgets: backend.validateWidgets,
      askOnStartup: backend.askOnStartup === true,
    });
  }

  async function save() {
    if (!draft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const input = toInput(draft);
    try {
      if (editingId) {
        const before = backends.find((b) => b.id === editingId);
        await updateBackend(editingId, input);
        // A session holds a copy of the credential it connected with: a changed
        // address or credential makes it a different connection, as a changed
        // Workspace address does (saveConnection).
        const after = useBackendsStore.getState().backends.find((b) => b.id === editingId);
        if (before && after && connectionDetailsChanged(before, after)) {
          useWorkspaceStore.getState().signOut(editingId);
        }
      }
      else await addBackend(input);
      // Only cleared on success — a failed save leaves the typed values in
      // place rather than dropping them.
      setDraft(null);
      setEditingId(null);
    } catch (err) {
      setSaveError("Could not save the backend. The reason is in the log.");
      await logError(`failed to save backend: ${err}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleRemove(backend: BackendConfig) {
    try {
      // Confirmed as a dashboard or tab delete is: one click otherwise took
      // the backend and its stored key with it. Inside the try, so a failed
      // native dialog is logged rather than left unhandled.
      const ok = await confirm(`Remove backend "${backend.name}"?${holdsSettingsNote(backend.id)}`, {
        title: "Remove backend",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      await removeBackend(backend.id);
      await forgetConnection(backend.id);
    } catch (err) {
      await logError(`failed to remove backend ${backend.id}: ${err}`);
    }
  }

  // The list as stored, credentials included: the file exists so a second
  // device (iOS drops the app's data with the app) can be brought up with the
  // same connections, and a connection without its credential is not one. A
  // value kept in memory only (Ask for credentials on startup, no Remember me)
  // is left out, exactly as backends.json on disk leaves it out.
  async function exportBackends() {
    setNotice(null);
    try {
      const written = await saveTextFile(
        "backends.json",
        "backends.json",
        `${JSON.stringify(persistable(backends, runtimeCredentials), null, 2)}\n`,
      );
      if (!written) return;
      const n = backends.length;
      setNotice(`Exported ${n} ${n === 1 ? "connection" : "connections"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Export failed: ${message}`);
      await logError(`failed to export backends.json: ${message}`);
    }
  }

  async function importBackends() {
    setNotice(null);
    try {
      // Sized before it is read, as the apps.json import does: pulling a
      // huge file into the webview is the freeze this refuses.
      const picked = await pickImportFile("backends.json");
      if (picked === null) return;
      if ("refusal" in picked) {
        setNotice(picked.refusal);
        return;
      }
      const plan = planBackendsImport(picked.text, backends);
      if (!plan.ok) {
        setNotice(plan.refusal);
        return;
      }
      await setBackends(plan.backends);
      // Each known connection the file changed drops its session, exactly as
      // an edit does: otherwise it went on using the old address or key.
      const after = new Map(useBackendsStore.getState().backends.map((b) => [b.id, b]));
      for (const before of backends) {
        const now = after.get(before.id);
        if (now && connectionDetailsChanged(before, now)) useWorkspaceStore.getState().signOut(before.id);
      }
      setNotice(plan.notice);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Import failed: ${message}`);
      // Neither the path nor any entry of the file: the file carries
      // credentials, and the message already says what went wrong.
      await logError(`failed to import backends.json: ${message}`);
    }
  }

  async function handleRefresh() {
    try {
      await refresh();
      void useWorkspaceStore.getState().probeAll().catch(() => {});
    } catch (err) {
      await logError(`failed to refresh backends: ${err}`);
    }
  }

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="Connections"
      title="Connections"
      subtitle="Data sources for your workspace"
      headerActions={
        <>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void exportBackends()}>
            Export…
          </button>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void importBackends()}>
            Import…
          </button>
        </>
      }
      // P1: Export… writes stored credentials as they are (4ccc297b). Said
      // in the AI Library's words for its own export.
      note="Exports may include stored credentials in plain text."
      footerActions={
        <button type="button" className="bd-button bd-button--primary" onClick={startAdd}>
          Connect backend
        </button>
      }
      onClose={onClose}
    >
      <section aria-label="Workspace connections" style={{ marginBottom: "24px" }}>
        <div className="bd-inline" style={{ justifyContent: "space-between" }}>
          <div>
            <h3>Workspace</h3>
            <p className="bd-muted">OpenBB Workspace accounts that can hold your settings.</p>
          </div>
          <button type="button" className="bd-button" onClick={() => setWorkspaceForm({ editing: null })}>
            Add Workspace
          </button>
        </div>
        {workspaceConnections.length > 0 ? (
          <div className="bd-service-list">
            {workspaceConnections.map((c) => {
              const session = sessions[c.id];
              const view = workspaceStatusView(session);
              // Signed in or Not synced: either way this connection has a live session.
              const live = session !== undefined && session.state !== "expired";
              const notice = notices[c.id];
              const holds = settingsStorage === c.id;
              return (
                <ServiceCard
                  key={c.id}
                  mark={OPENBB_MARK}
                  name={c.name}
                  kind="OpenBB Workspace"
                  ariaLabel={c.name}
                  status={<ServiceStatus live state={view.state} text={view.text} />}
                  endpoint={{ label: "Server", value: <code>{c.serverUrl}</code> }}
                  detail={
                    holds || notice !== undefined ? (
                      <>
                        {holds ? <span className="bd-badge">Holds settings</span> : null}
                        {notice !== undefined ? <p className="bd-muted" role="note">{notice}</p> : null}
                      </>
                    ) : undefined
                  }
                  actions={
                    <>
                      {live ? (
                        <button type="button" className="bd-button bd-button--ghost" onClick={() => useWorkspaceStore.getState().signOut(c.id)}>
                          Sign out
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="bd-button bd-button--ghost"
                          onClick={() => void promptSignIn({ id: c.id, name: c.name, baseUrl: c.serverUrl }).catch((err: unknown) => logError(`sign-in failed: ${err}`))}
                        >
                          Sign in
                        </button>
                      )}
                      <button type="button" className="bd-button bd-button--ghost" aria-label={`Edit ${c.name}`} onClick={() => setWorkspaceForm({ editing: c })}>
                        Edit
                      </button>
                      <button type="button" className="bd-button bd-button--danger" aria-label={`Remove ${c.name}`} onClick={() => void removeWorkspace(c)}>
                        Remove
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="bd-inline" style={{ justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h3>Your backends</h3>
          <p className="bd-muted">Manage the data sources available to your workspace.</p>
        </div>
        <button
          type="button"
          className="bd-button"
          aria-label="Refresh connections"
          onClick={() => void handleRefresh()}
        >
          Refresh
        </button>
      </div>

      {notice ? (
        <p className="rail-notice" role="status">
          {notice}
        </p>
      ) : null}

      {/* An empty group renders nothing at all — no heading, no list. */}
      {([["Active", active], ["Inactive", inactive]] as const).map(([label, rows]) =>
        rows.length === 0 ? null : (
          <Fragment key={label}>
            <div className="bd-group-label">
              {label} <span className="bd-badge">{rows.length}</span>
            </div>
            <div className="bd-service-list">
              {rows.map((b) => (
                <ServiceCard
                  key={b.id}
                  mark={markFor(b)}
                  name={b.name}
                  kind={`Data backend · ${widgetCell(b)} · ${appCell(b)}`}
                  ariaLabel={b.name}
                  status={<ServiceStatus state={statusFor(b)} />}
                  endpoint={{ label: "Endpoint", value: <code>{b.baseUrl}</code> }}
                  detail={<>{appNote(b)}{settingsApiFor(b)}</>}
                  actions={
                    <>
                      <button type="button" className="bd-button bd-button--ghost" aria-label={`Edit ${b.name}`} onClick={() => startEdit(b)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="bd-button bd-button--danger"
                        aria-label={`Remove ${b.name}`}
                        onClick={() => void handleRemove(b)}
                      >
                        Remove
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          </Fragment>
        ),
      )}

      {backends.length === 0 ? (
        <div className="bd-empty">
          <h4>No backends configured</h4>
          <p className="bd-muted">Connect a backend to populate your widget library.</p>
        </div>
      ) : null}

      {draft ? (
        <BackendEditForm
          draft={draft}
          editing={editingId !== null}
          saving={saving}
          saveError={saveError}
          onChange={setDraft}
          onSubmit={() => void save()}
          onCancel={() => setDraft(null)}
        />
      ) : null}
      {workspaceForm !== null ? (
        <WorkspaceConnectionForm
          title={workspaceForm.editing === null ? "Add Workspace" : "Edit Workspace"}
          initial={
            workspaceForm.editing === null
              ? { name: "", serverUrl: "", askOnStartup: false }
              : { name: workspaceForm.editing.name, serverUrl: workspaceForm.editing.serverUrl, askOnStartup: workspaceForm.editing.askOnStartup }
          }
          onSubmit={saveWorkspace}
          onCancel={() => setWorkspaceForm(null)}
        />
      ) : null}
    </DialogShell>
  );
}
