// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useChildDialog } from "../../hooks/useChildDialog";
import type { BackendConfig } from "../../lib/types";
import type { SettingsConnection } from "../../lib/workspaceAccount";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { DialogShell } from "./DialogShell";

export type WorkspaceFormValues = { name: string; serverUrl: string; askOnStartup: boolean };

const WARNING = "Signing in can replace another OpenBB Workspace session. Passwords and session tokens are not saved by this app.";

/**
 * Submits through onSubmit with an AbortSignal and shows its refusal. Every
 * way out aborts a request in flight, so a sign-in the user walked away from
 * cannot land a session afterwards -- one that would skip the sign-in sync
 * and let the next save overwrite the server unasked.
 */
function useSubmission(onCancel: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const cancel = () => {
    request.current?.abort();
    onCancel();
  };
  async function run(submit: (signal: AbortSignal) => Promise<string | null>, after: () => void) {
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    let message: string | null;
    try {
      message = await submit(controller.signal);
    } catch (err) {
      // A rejection is shown like a refusal; pending must not stay true.
      message = err instanceof Error ? err.message : String(err);
    }
    // A setState after a successful submit unmounted the form is a silent
    // no-op in React 19, so there is nothing to guard here.
    after();
    setPending(false);
    setError(message);
  }
  return { pending, error, cancel, run };
}

/** Add/Edit Workspace: what workspace.json stores, and nothing secret. Adding then opens the sign-in dialog. */
export function WorkspaceConnectionForm({ title, initial, onSubmit, onCancel }: { title: string; initial: WorkspaceFormValues; onSubmit: (values: WorkspaceFormValues) => Promise<string | null>; onCancel: () => void }) {
  const [values, setValues] = useState(initial);
  const { pending, error, cancel, run } = useSubmission(onCancel);
  const dialogRef = useChildDialog(cancel);
  const formId = "workspace-connection-form";
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle="OpenBB Workspace" modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>Cancel</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending}>Save</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run(() => onSubmit(values), () => {}); }}>
        <div className="bd-field">
          <label htmlFor="workspace-name">Name</label>
          <input id="workspace-name" className="bd-input" value={values.name} disabled={pending} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </div>
        <div className="bd-field">
          <label htmlFor="workspace-server">Server address</label>
          <input id="workspace-server" className="bd-input" type="url" value={values.serverUrl} disabled={pending} onChange={(e) => setValues({ ...values, serverUrl: e.target.value })} placeholder="https://workspace.example" />
        </div>
        <label className="bd-inline">
          <input type="checkbox" checked={values.askOnStartup} disabled={pending} onChange={(e) => setValues({ ...values, askOnStartup: e.target.checked })} />
          Ask for credentials on startup
        </label>
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/** The sign-in dialog's username, password and Remember me fields, with the warning. */
function AccountFields({ username, setUsername, password, setPassword, remember, setRemember, pending }: {
  username: string; setUsername: (v: string) => void; password: string; setPassword: (v: string) => void;
  remember: boolean; setRemember: (v: boolean) => void; pending: boolean;
}) {
  return (
    <>
      <div className="bd-field">
        <label htmlFor="workspace-username">Username or email</label>
        <input id="workspace-username" className="bd-input" type="text" autoComplete="username" value={username} disabled={pending} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="bd-field">
        <label htmlFor="workspace-password">Password</label>
        <input id="workspace-password" className="bd-input" type="password" autoComplete="current-password" value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="bd-inline">
        <input type="checkbox" checked={remember} disabled={pending} onChange={(e) => setRemember(e.target.checked)} />
        Remember me
      </label>
      <p className="bd-muted">{WARNING}</p>
    </>
  );
}

/**
 * The sign-in dialog: username, password, Remember me. Remember me decides
 * whether the username is stored (workspaceStore.signIn); it starts ticked
 * when one is remembered. The password lives in this component's state and
 * in onSubmit's argument, nowhere else, and is cleared after every attempt.
 */
export function WorkspaceSignInForm({ title, subtitle, cancelLabel = "Cancel", initialUsername, onSubmit, onCancel }: {
  title: string; subtitle?: string; cancelLabel?: string; initialUsername: string;
  onSubmit: (username: string, password: string, remember: boolean, signal: AbortSignal) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(initialUsername !== "");
  const { pending, error, cancel, run } = useSubmission(onCancel);
  const dialogRef = useChildDialog(cancel);
  const formId = "workspace-signin-form";
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle={subtitle} modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>{cancelLabel}</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending || password === ""}>{pending ? "Signing in…" : "Sign in"}</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run((signal) => onSubmit(username, password, remember, signal), () => setPassword("")); }}>
        <AccountFields username={username} setUsername={setUsername} password={password} setPassword={setPassword} remember={remember} setRemember={setRemember} pending={pending} />
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/**
 * A data backend's credential step: Key (prefilled with the stored header
 * name), Value and Remember me -- which here decides whether the VALUE is
 * stored (backendsStore.setCredential). It never signs in: when this backend
 * holds settings, connectServer probes and connects right after it.
 */
function BackendCredentialForm({ backend, step, onContinue, onSkip }: {
  backend: BackendConfig; step: string;
  onContinue: (input: { key: string; value: string; remember: boolean }) => Promise<string | null>;
  onSkip: () => void;
}) {
  const remembered = backend.headerValue !== undefined && !useBackendsStore.getState().runtimeCredentials.includes(backend.id);
  const [key, setKey] = useState(backend.headerName ?? "");
  const [value, setValue] = useState(remembered ? backend.headerValue ?? "" : "");
  const [remember, setRemember] = useState(remembered);
  const { pending, error, cancel, run } = useSubmission(onSkip);
  const dialogRef = useChildDialog(cancel);
  const formId = "backend-credential-form";
  const title = `Credentials for ${backend.name}`;
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle={step} modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>Skip</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending || key.trim() === "" || value === ""}>Continue</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run(() => onContinue({ key: key.trim(), value, remember }), () => {}); }}>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor="credential-key">Key</label>
            <input id="credential-key" className="bd-input" value={key} disabled={pending} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="bd-field">
            <label htmlFor="credential-value">Value</label>
            <input id="credential-value" className="bd-input" type="password" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <label className="bd-inline">
          <input type="checkbox" checked={remember} disabled={pending} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/**
 * Two answers and no third, so no ✕ and no Escape: closing without choosing
 * would leave neither side authoritative. Bare markup rather than
 * DialogShell, whose header always renders a ✕. useChildDialog still puts it
 * on modalStack, so an Escape meant for a dialog underneath (Settings,
 * Connections) lands on this entry's no-op instead of closing that dialog
 * under a question still waiting for its answer.
 */
function WorkspaceConflictDialog({ name, review, notes, onDecide }: { name: string; review: string[]; notes: string[]; onDecide: (choice: "server" | "local") => void }) {
  const dialogRef = useChildDialog(() => {});
  return (
    <dialog ref={dialogRef} className="bd-dialog-backdrop" aria-label="Settings differ">
      <div className="bd-dialog bd-dialog--editor">
        <header className="bd-header">
          <div className="bd-heading">
            <h2 className="bd-title">Settings differ</h2>
            <p className="bd-subtitle">{`Each line reads setting: local → ${name}.`}</p>
          </div>
        </header>
        <div className="bd-body">
          <ul>{review.map((line) => <li key={line}>{line}</li>)}</ul>
          {notes.map((note) => <p key={note} className="bd-muted">{note}</p>)}
        </div>
        <footer className="bd-footer">
          <p />
          <div className="bd-actions">
            <button type="button" className="bd-button" onClick={() => onDecide("local")}>Keep local</button>
            <button type="button" className="bd-button bd-button--primary" onClick={() => onDecide("server")}>{`Use ${name}`}</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * A dashboard sync question with fixed answers, built like
 * WorkspaceConflictDialog: no ✕ and no Escape, since closing without an
 * answer would decide nothing. `primary` is focused once the dialog opens,
 * so Enter takes the default.
 */
function WorkspaceChoiceDialog<T extends string>({ title, lines, choices, primary, onDecide }: {
  title: string; lines: string[]; choices: { value: T; label: string }[]; primary: T; onDecide: (choice: T) => void;
}) {
  const dialogRef = useChildDialog(() => {});
  const primaryRef = useRef<HTMLButtonElement>(null);
  // After useChildDialog's own effect has opened the dialog.
  useEffect(() => primaryRef.current?.focus(), []);
  return (
    <dialog ref={dialogRef} className="bd-dialog-backdrop" aria-label={title}>
      <div className="bd-dialog bd-dialog--editor">
        <header className="bd-header">
          <div className="bd-heading">
            <h2 className="bd-title">{title}</h2>
          </div>
        </header>
        <div className="bd-body">{lines.map((line) => <p key={line}>{line}</p>)}</div>
        <footer className="bd-footer">
          <p />
          <div className="bd-actions">
            {choices.map((c) => (
              <button key={c.value} ref={c.value === primary ? primaryRef : undefined} type="button" className={c.value === primary ? "bd-button bd-button--primary" : "bd-button"} onClick={() => onDecide(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Renders one dialog into its own root until it answers -- decideImportConflicts'
 * idiom -- so bootstrap, Settings and Connections can all ask without any of
 * them holding dialog state. useChildDialog hands focus back on unmount.
 */
async function ask<T>(render: (answer: (value: T) => void) => ReactNode): Promise<T> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    return await new Promise<T>((resolve) => root.render(render(resolve)));
  } finally {
    root.unmount();
    host.remove();
  }
}

/** The sign-in dialog for one connection. True once signed in; false on Cancel (or Skip, as a startup step). */
export function askWorkspaceSignIn(connection: SettingsConnection, step?: string): Promise<boolean> {
  return ask<boolean>((answer) => (
    <WorkspaceSignInForm
      title={`Sign in to ${connection.name}`}
      subtitle={step}
      cancelLabel={step === undefined ? "Cancel" : "Skip"}
      initialUsername={useWorkspaceStore.getState().usernames[connection.id] ?? ""}
      onCancel={() => answer(false)}
      onSubmit={async (username, password, remember, signal) => {
        const message = await useWorkspaceStore.getState().signIn(connection, username, password, remember, signal);
        if (message === null) answer(true);
        return message;
      }}
    />
  ));
}

/**
 * A flagged backend's credential step. Continue gives the backend its
 * credential for this run (stored only with Remember me) and starts its
 * discovery (setCredential); Skip leaves that to the caller.
 */
export function askBackendCredential(backend: BackendConfig, step: string): Promise<"continued" | "skipped"> {
  return ask<"continued" | "skipped">((answer) => (
    <BackendCredentialForm
      backend={backend}
      step={step}
      onSkip={() => answer("skipped")}
      onContinue={async ({ key, value, remember }) => {
        await useBackendsStore.getState().setCredential(backend.id, key, value, remember);
        answer("continued");
        return null;
      }}
    />
  ));
}

export function decideWorkspaceConflict(name: string, review: string[], notes: string[]): Promise<"server" | "local"> {
  return ask((answer) => <WorkspaceConflictDialog name={name} review={review} notes={notes} onDecide={answer} />);
}

export type DashboardConflictChoice = "server" | "local" | "both";

/** A dashboard changed here and on the server since the last sync (spec: Sync rules). Keep both is the default. */
export function decideDashboardConflict(server: string, name: string, keepBothName: string): Promise<DashboardConflictChoice> {
  return ask<DashboardConflictChoice>((answer) => (
    <WorkspaceChoiceDialog
      title={`"${name}" changed here and on ${server}`}
      lines={[`Keep both adds ${server}'s copy as "${keepBothName}".`]}
      choices={[{ value: "server", label: `Use ${server}` }, { value: "local", label: "Keep local" }, { value: "both", label: "Keep both" }]}
      primary="both"
      onDecide={answer}
    />
  ));
}

/** A dashboard deleted on the server but changed here. Keep as local is the default: it loses nothing. */
export function decideDeletedDashboard(server: string, name: string): Promise<"delete" | "keep"> {
  return ask<"delete" | "keep">((answer) => (
    <WorkspaceChoiceDialog
      title={`"${name}" was deleted on ${server}`}
      lines={["It has changed here since the last sync."]}
      choices={[{ value: "delete", label: "Delete" }, { value: "keep", label: "Keep as local" }]}
      primary="keep"
      onDecide={answer}
    />
  ));
}
