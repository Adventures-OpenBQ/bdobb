// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { postForm } from "../lib/dataClient";
import { formFieldKey, formInputKind, formSubmitBody, type ControlKind, type FormContext } from "../lib/params";
import type {
  BackendConfig,
  DashboardCard,
  FormInput,
  ParamGroup,
  WidgetForm,
} from "../lib/types";
import { GroupLink } from "./GroupLink";
import { ParamInput } from "./ParamInput";

type Props = {
  /** The form param's own name — the prefix its fields are stored under. */
  formParamName: string;
  form: WidgetForm;
  /** The card's effective params. Field values live under formFieldKey(...). */
  values: Record<string, string>;
  /**
   * For the group link beside each field (the panel decides nothing about
   * groups itself), and its id disambiguates the field ids when a card
   * carries two forms.
   */
  card: DashboardCard;
  groups: ParamGroup[] | undefined;
  groupsDisabled: boolean;
  /** Rides on the submit URL, so the endpoint sees the card it came from. */
  query: Record<string, string>;
  backend: BackendConfig | undefined;
  /**
   * The widget the form belongs to, its quarter / fiscal-year params'
   * resolved year ends, the trading calendars its period params resolve on
   * and (v5.4.0) the dashboard's exchange: the submit URL's query goes
   * through wireParams like the card's GET does, and that needs them all.
   */
  wire: FormContext;
  /**
   * Commit fields, keyed by storage key. Persisted immediately; deliberately
   * no fetch. A record, not one field: each call is a separate write built
   * from this render's params, so two calls in a row would let the second
   * put the first field back -- submit commits every pending draft in one.
   */
  onEdit: (changes: Record<string, string>) => void;
  /** A 2xx landed: the card refetches. */
  onSubmitted: () => void;
};

/**
 * A control the user TYPES into, whose intermediate values are not a value
 * anyone meant. Committing one per keystroke would write the whole dashboard
 * once per character — and, for a field a ParamGroup binds, fan that write
 * out to every member card once per character too. The discrete controls
 * (select, multi-select, checkbox, date) have no intermediate states, so they
 * commit on change and hold no draft.
 */
function isTyped(kind: ControlKind): boolean {
  return kind === "text" || kind === "number";
}

/**
 * A `type: "form"` param, rendered in the card body above the renderer.
 *
 * Field edits commit into `card.params` under `${form}.${field}` and do NOT
 * refetch: a form is not a query parameter, it is a request the user
 * assembles and then sends. A typed field is held as a local draft and
 * committed on blur (and on submit, before the POST, so a value typed and
 * sent without leaving the field is not lost) — the NoteRenderer precedent.
 * Pressing a button POSTs the assembled body; on a 2xx the card refetches its
 * own GET, and on anything else the failure is shown here, on the form, next
 * to the button that caused it.
 *
 * Nothing is logged. The body is the user's own input and may hold anything
 * the endpoint accepts, credentials included, and the error line already puts
 * the failure in front of the person who can act on it.
 */
export function WidgetFormPanel({
  formParamName,
  form,
  values,
  card,
  groups,
  groupsDisabled,
  query,
  backend,
  wire,
  onEdit,
  onSubmitted,
}: Props) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** Uncommitted keystrokes, by storage key. Only typed fields ever appear. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /**
   * Persist one field's draft, if it has one and the value actually moved. A
   * bare `drafts[key]` is safe here, unlike everywhere a row from JSON is
   * read: every key is `${form}.${field}` (see formFieldKey), and no
   * Object.prototype name contains a dot.
   */
  function commit(key: string) {
    const draft = drafts[key];
    if (draft === undefined) return;
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    // An unchanged value is not written: blurring a field nobody edited would
    // otherwise save the dashboard for nothing.
    if (draft !== (values[key] ?? "")) onEdit({ [key]: draft });
  }

  async function submit(button: FormInput) {
    if (!backend) {
      setError("Backend not configured");
      return;
    }
    // Blur usually lands first — pressing the button moves focus — but not
    // when the button is reached from outside the form, so every pending
    // draft is committed here and the POST is built from the merged values
    // rather than from the props, which this render still has the old ones of.
    const merged = { ...values, ...drafts };
    const changed = Object.fromEntries(
      Object.entries(drafts).filter(([key, draft]) => draft !== (values[key] ?? "")),
    );
    if (Object.keys(changed).length > 0) onEdit(changed);
    setDrafts({});
    setBusy(true);
    setError(undefined);
    try {
      await postForm(backend, form, query, formSubmitBody(formParamName, form, merged, button, wire), wire);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const fields = form.inputs.filter((f) => f.type !== "button");
  const buttons = form.inputs.filter((f) => f.type === "button");

  return (
    // Nothing here submits the form. type="button" on every control keeps an
    // Enter press from firing the first button, and onSubmit refuses the
    // NATIVE submit that type="button" cannot prevent: under HTML's implicit
    // submission a form whose fields amount to one text or number control
    // submits ITSELF on Enter, button or no button (measured in Chromium and
    // WebKit). That submit navigates -- the SPA reloads, and a viewer window
    // loses the `?viewer=` query it is identified by. A send here is a POST to
    // a backend, and only pressing a button makes one.
    <form className="widget-form" onSubmit={(e) => e.preventDefault()}>
      <div className="widget-form-grid">
        {fields.map((f) => {
          const id = `${card.id}-${formParamName}-${f.paramName}`;
          const key = formFieldKey(formParamName, f.paramName);
          const kind = formInputKind(f);
          const typed = isTyped(kind);
          return (
            <div key={f.paramName} className="param-field">
              {/* The link and the label on one line; the control stacks under
                  them, as a form field has always laid out. */}
              <div className="param-label-row">
                <GroupLink
                  card={card}
                  param={{ paramName: f.paramName, type: f.type, label: f.label }}
                  groups={groups}
                  groupsDisabled={groupsDisabled}
                  value={values[key] ?? ""}
                />
                <label className="param-label" htmlFor={id}>
                  {f.label ?? f.paramName}
                </label>
              </div>
              <ParamInput
                id={id}
                kind={kind}
                native
                label={f.label ?? f.paramName}
                value={drafts[key] ?? values[key] ?? ""}
                options={f.options ?? []}
                disabled={busy}
                onChange={(v) => (typed ? setDrafts((d) => ({ ...d, [key]: v })) : onEdit({ [key]: v }))}
                onBlur={typed ? () => commit(key) : undefined}
              />
              {f.description ? <span className="param-hint">{f.description}</span> : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p className="widget-form-error" role="status">
          {error}
        </p>
      ) : null}
      <div className="widget-form-actions">
        {buttons.map((b) => (
          <button
            key={b.paramName}
            type="button"
            disabled={busy}
            onClick={() => void submit(b)}
          >
            {b.label ?? b.paramName}
          </button>
        ))}
      </div>
    </form>
  );
}
