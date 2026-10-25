// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useChildDialog } from "../../hooks/useChildDialog";
import { discoverBackend } from "../../lib/discovery";
import { DialogShell } from "./DialogShell";
import type { AuthLocation, BackendConfig } from "../../lib/types";

export type Draft = {
  name: string;
  baseUrl: string;
  headerName: string;
  headerValue: string;
  authLocation: AuthLocation;
  validateWidgets: boolean;
  /** Key stays stored; the value is asked for at launch (Value is hidden). */
  askOnStartup: boolean;
};

export const EMPTY_DRAFT: Draft = {
  name: "",
  baseUrl: "",
  headerName: "",
  headerValue: "",
  authLocation: "header",
  validateWidgets: true,
  askOnStartup: false,
};

export function toInput(draft: Draft): Omit<BackendConfig, "id"> {
  // authLocation/validateWidgets come from the draft, which ConnectionsDialog
  // seeds from the stored backend on edit (see startEdit) and from
  // EMPTY_DRAFT on add. Carrying them through here — rather than hardcoding
  // defaults — is what stops `{ ...b, ...patch }` in updateBackend from
  // silently resetting a backend's stored auth location and validate-widgets
  // flag on every save.
  const base = {
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    authLocation: draft.authLocation,
    validateWidgets: draft.validateWidgets,
    // Explicit undefined, so unticking clears the flag through `{ ...b, ...patch }`.
    askOnStartup: draft.askOnStartup ? true : undefined,
  };
  if (draft.askOnStartup) {
    // The key stays stored; the value is asked for at every launch. Explicit
    // undefined so updateBackend drops a stored value (backendsStore keeps it
    // in memory for the rest of this run).
    return { ...base, headerName: draft.headerName.trim() || undefined, headerValue: undefined };
  }
  if (!draft.headerName.trim() || !draft.headerValue.trim())
    // Explicit `undefined` (not an omitted key) so `{ ...b, ...patch }` in
    // updateBackend overwrites a previously stored header pair instead of
    // leaving it untouched.
    return { ...base, headerName: undefined, headerValue: undefined };
  return { ...base, headerName: draft.headerName.trim(), headerValue: draft.headerValue.trim() };
}

type Props = {
  draft: Draft;
  /** True when the draft came from a stored backend: titles the dialog
   * "Edit backend" and the submit "Update" instead of "Connect backend"/"Add". */
  editing?: boolean;
  /** A save is in flight: the submit is disabled so it cannot run twice. */
  saving?: boolean;
  /** Shown under the form when the last save failed. */
  saveError?: string | null;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "done"; ok: boolean; message: string };

export function BackendEditForm({
  draft,
  editing = false,
  saving = false,
  saveError = null,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  // A scheme is required: `localhost:6900` parses as a URL with the scheme
  // "localhost:", so it saved and then every request failed with an error
  // that said nothing about the missing http://.
  const badScheme = draft.baseUrl.trim() !== "" && !/^https?:\/\//i.test(draft.baseUrl.trim());
  const invalid = !draft.name.trim() || !draft.baseUrl.trim() || badScheme;

  const [test, setTest] = useState<TestState>({ phase: "idle" });
  // Bumped on every draft edit to invalidate a probe in flight: its result
  // would describe a config that no longer exists. runTest only applies a
  // response if this still matches the id it captured when it started. No
  // unmount guard: a setState on an unmounted component is a silent no-op in
  // React 19, so there is nothing left for one to prevent.
  const testRunRef = useRef(0);

  useEffect(() => {
    testRunRef.current += 1;
    setTest({ phase: "idle" });
  }, [draft]);

  // The form is its own modal over the Connections list, the way the
  // reference app does it. useChildDialog's showModal() opens it above the
  // list dialog (the top layer stacks) and traps focus in it until it
  // closes, pushes this dialog's entry onto the shared modalStack AFTER
  // ConnectionsDialog's own, so Escape closes this one first while it is
  // open, and hands focus back to the Edit or Connect Backend button that
  // opened this on unmount, for the same reason ConnectionsDialog hands
  // focus back to the rail: showModal() moved it in here, and without this a
  // keyboard user lands on the list dialog's body when the form closes.
  const dialogRef = useChildDialog(onCancel);

  async function runTest() {
    const run = ++testRunRef.current;
    setTest({ phase: "testing" });
    // A throwaway id: this config is never persisted, and discoverBackend
    // only echoes the id back on the result.
    const probe: BackendConfig = { id: "draft", ...toInput(draft) };
    const result = await discoverBackend(probe);
    if (testRunRef.current !== run) return; // superseded by a newer test, a draft edit, or unmount
    const ok = result.status === "online";
    setTest({
      phase: "done",
      ok,
      // discoverBackend's error already went through describeHttpError
      // (via dataClient's getJson), so it's rendered as-is here.
      message: ok ? `Reachable — ${result.widgets.length} widgets` : (result.error ?? "Unreachable"),
    });
  }

  const title = editing ? "Edit backend" : "Connect backend";
  const formId = "backend-form";

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel={title}
      title={title}
      subtitle="Configure a data source for your workspace."
      modifier="bd-dialog--editor"
      plain
      onClose={onCancel}
      note={
        <>
          {/* An explicit way out, the way main's editor footer has one. The
              header ✕ and ConnectionsDialog's Escape (via useChildDialog's
              modalStack entry) both still close this form -- Cancel is a
              third door, not a replacement for either.

              type="button", because a bare <button> inside a <form> submits
              it, and never disabled on `invalid`: greying out the way out of
              a form you cannot complete is backwards. Leftmost, with the
              submit last. */}
          <button type="button" className="bd-button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
      footerActions={
        <>
          <button type="button" className="bd-button" onClick={() => void runTest()} disabled={invalid}>
            Test
          </button>
          <button type="submit" form={formId} className="bd-button bd-button--primary" disabled={invalid || saving}>
            {editing ? "Update" : "Add"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="bd-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="bd-field">
          <label htmlFor="backend-name">Name</label>
          <input
            id="backend-name"
            className="bd-input"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="bd-field">
          <label htmlFor="backend-url">Endpoint URL</label>
          <input
            id="backend-url"
            className="bd-input"
            value={draft.baseUrl}
            onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
          />
        </div>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor="backend-validate">Validate widgets</label>
            <select
              id="backend-validate"
              className="bd-input"
              value={draft.validateWidgets ? "yes" : "no"}
              onChange={(e) => onChange({ ...draft, validateWidgets: e.target.value === "yes" })}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <div className="bd-field">
            <label htmlFor="backend-location">Location</label>
            <select
              id="backend-location"
              className="bd-input"
              value={draft.authLocation}
              onChange={(e) => onChange({ ...draft, authLocation: e.target.value as AuthLocation })}
            >
              <option value="header">Header</option>
              <option value="query">Query Parameter</option>
              <option value="cookie">Cookie</option>
            </select>
          </div>
        </div>
        <label className="bd-inline">
          <input
            type="checkbox"
            checked={draft.askOnStartup}
            onChange={(e) => onChange({ ...draft, askOnStartup: e.target.checked })}
          />
          Ask for credentials on startup
        </label>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor="backend-key">Key</label>
            <input
              id="backend-key"
              className="bd-input"
              value={draft.headerName}
              onChange={(e) => onChange({ ...draft, headerName: e.target.value })}
            />
          </div>
          {draft.askOnStartup ? null : (
            <div className="bd-field">
              <label htmlFor="backend-value">Value</label>
              <input
                id="backend-value"
                className="bd-input"
                type="password"
                value={draft.headerValue}
                onChange={(e) => onChange({ ...draft, headerValue: e.target.value })}
              />
            </div>
          )}
        </div>
        {badScheme ? (
          <p className="bd-notice bd-notice--warning">The endpoint URL must start with http:// or https://.</p>
        ) : null}
        {draft.authLocation === "query" ? (
          <p className="bd-notice bd-notice--warning">
            Query places the key in the request URL, where it can end up in server logs, browser
            history, proxies — and, on a failed request, this app's own log (the host and path are
            logged, but the query string is stripped first).
          </p>
        ) : null}
        {test.phase === "testing" ? <p className="bd-muted">Testing…</p> : null}
        {test.phase === "done" ? (
          <p className={test.ok ? "bd-muted" : "bd-notice bd-notice--error"}>{test.message}</p>
        ) : null}
        {saveError ? (
          <p className="bd-notice bd-notice--error" role="alert">
            {saveError}
          </p>
        ) : null}
      </form>
    </DialogShell>
  );
}
