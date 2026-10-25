// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { fetchWidgetData, putSettings } from "../../../lib/dataClient";
import { logError } from "../../../lib/logger";
import {
  parseSettingsDescription,
  type SettingsDescription,
  type SettingsField,
} from "../../../lib/settingsForm";
import type { BackendConfig, WidgetDef } from "../../../lib/types";
import { ErrorState } from "../../renderers/ErrorState";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "newer" }
  | { status: "ready"; section: SettingsDescription };

/**
 * A `ui: "form"` service section (docs/settings-widgets.md). Reads the
 * description with `GET {endpoint}` and writes the changed fields only with
 * `PUT {endpoint}`, both through the app's own request path and the
 * backend's credentials. The body is untrusted JSON: anything malformed is a
 * section error with a Retry, and nothing here can take the dialog down.
 *
 * `drafts` holds only what the user has touched, keyed by field id. That is
 * both "the changed fields" the PUT sends and what survives a failed save --
 * a 422 or any other failure leaves it alone, so the values stay as typed. A
 * number's draft is the input's string, parsed only at Save, so an empty or
 * half-typed number can be refused by its field instead of being sent as
 * NaN (which JSON would turn into null).
 *
 * Field values and drafts never reach a log line: only the widget id, the
 * backend name and the error do.
 */
export function SettingsForm({ backend, widget }: { backend: BackendConfig; widget: WidgetDef }) {
  // Form sections stay mounted once visited, so two backends serving the same
  // form would otherwise share DOM ids; the per-instance prefix keeps each
  // label pointing at its own control.
  const uid = useId();
  const [state, setState] = useState<State>({ status: "loading" });
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const parsed = parseSettingsDescription(await fetchWidgetData(backend, widget, {}));
      if (parsed.ok) {
        setState({ status: "ready", section: parsed.section });
        setDrafts({});
        setFieldErrors({});
      } else if (parsed.newer) {
        setState({ status: "newer" });
      } else {
        setState({ status: "error", message: parsed.error });
      }
    } catch (err) {
      await logError(`settings read failed for ${widget.id} on ${backend.name}: ${err}`);
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [backend, widget]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(section: SettingsDescription) {
    // Null-prototype, and own-property checks on read: a field id can
    // legally be "__proto__", which on a plain object would assign the
    // prototype instead of a value (and `in` finds it on every object).
    const values: Record<string, unknown> = Object.create(null);
    const errors: Record<string, string> = Object.create(null);
    for (const field of section.fields) {
      if (!Object.hasOwn(drafts, field.id)) continue;
      let value = drafts[field.id];
      if (field.type === "number") {
        const n = Number(value);
        if (value === "" || !Number.isFinite(n)) {
          errors[field.id] = "Enter a number.";
          continue;
        }
        value = n;
      }
      if (value !== field.value) values[field.id] = value;
    }
    setFieldErrors(errors);
    setSaveError(null);
    setNotice(null);
    if (Object.keys(errors).length > 0 || Object.keys(values).length === 0) return;

    setSaving(true);
    try {
      const result = await putSettings(backend, widget, values);
      if (!result.ok) {
        setFieldErrors(result.errors);
        // An id that names no field has nowhere to render beside a control;
        // without this the save would fail with nothing on screen.
        const known = new Set(section.fields.map((f) => f.id));
        const orphans = Object.entries(result.errors).filter(([id]) => !known.has(id));
        if (orphans.length > 0) setSaveError(orphans.map(([, m]) => m).join(" "));
        return;
      }
      const parsed = parseSettingsDescription(result.body);
      if (!parsed.ok) {
        setSaveError("The service answered the save with something this app cannot read.");
        return;
      }
      setState({ status: "ready", section: parsed.section });
      setDrafts({});
      if (parsed.section.notice) setNotice(parsed.section.notice);
    } catch (err) {
      await logError(`settings save failed for ${widget.id} on ${backend.name}: ${err}`);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") return <p className="empty-state">Loading…</p>;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => void load()} />;
  if (state.status === "newer") return <p className="empty-state">Needs a newer app version.</p>;

  const { section } = state;
  return (
    // noValidate: the service is the authority on its own values (its 422
    // says why), and a browser's constraint bubble on min/max would stop the
    // save before the service could say so.
    <form
      className="bd-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(section);
      }}
    >
      {section.title ? <h3>{section.title}</h3> : null}
      {section.description ? <p className="bd-muted">{section.description}</p> : null}
      {/* Locked while a save is in flight: the PUT carries a snapshot, and
          on 200 the drafts are cleared, so anything typed meanwhile would be
          silently discarded. */}
      <fieldset disabled={saving} className="settings-fields">
        {section.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            uid={uid}
            draft={Object.hasOwn(drafts, field.id) ? drafts[field.id] : undefined}
            error={Object.hasOwn(fieldErrors, field.id) ? fieldErrors[field.id] : undefined}
            onChange={(value) => setDrafts((d) => ({ ...d, [field.id]: value }))}
          />
        ))}
      </fieldset>
      {saveError ? (
        <p className="bd-notice bd-notice--error" role="alert">
          {saveError}
        </p>
      ) : null}
      {notice ? (
        <p className="bd-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="bd-actions">
        <button
          type="submit"
          className="bd-button bd-button--primary"
          disabled={Object.keys(drafts).length === 0 || saving}
        >
          Save
        </button>
      </div>
    </form>
  );
}

function FieldRow({
  field,
  uid,
  draft,
  error,
  onChange,
}: {
  field: SettingsField;
  uid: string;
  draft: unknown;
  error: string | undefined;
  onChange: (value: unknown) => void;
}) {
  const id = `${uid}-${field.id}`;
  const current = draft === undefined ? field.value : draft;
  let control: ReactNode;
  if (!field.known) {
    const text = typeof field.value === "string" ? field.value : JSON.stringify(field.value ?? null);
    control = <input id={id} className="bd-input" type="text" readOnly value={text} />;
  } else if (field.type === "boolean") {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={current === true}
        disabled={field.readOnly}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  } else if (field.type === "select") {
    // Options are addressed by index, so a numeric or boolean option value
    // goes back to the service with the type it came with, not as a string.
    const options = field.options ?? [];
    control = (
      <select
        id={id}
        className="bd-input"
        disabled={field.readOnly}
        value={String(options.findIndex((o) => o.value === current))}
        onChange={(e) => onChange(options[Number(e.target.value)].value)}
      >
        {options.map((o, i) => (
          <option key={i} value={i}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        className="bd-input"
        type={field.type === "number" ? "number" : "text"}
        min={field.min}
        max={field.max}
        step={field.step}
        readOnly={field.readOnly}
        value={String(current)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className="bd-field">
      <label htmlFor={id}>{field.label}</label>
      {control}
      {field.unit ? <span className="bd-muted"> {field.unit}</span> : null}
      {field.help ? <p className="bd-muted">{field.help}</p> : null}
      {!field.known ? (
        <p className="bd-muted">
          This field's type ({field.type}) needs a newer app version; it is shown read-only.
        </p>
      ) : null}
      {field.readOnly && field.readOnlyReason ? <p className="bd-muted">{field.readOnlyReason}</p> : null}
      {error ? <p className="bd-notice--error">{error}</p> : null}
    </div>
  );
}
