// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { type FormEvent, useId, useState } from "react";
import {
  formatHeaderLines,
  isJsonObjectText,
  isShareTargetUrl,
  parseHeaderLines,
  SHARE_TARGET_KINDS,
  type ShareTarget,
  type ShareTargetKind,
} from "../../lib/shareTargets";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";

/** The form's fields as text. Only Save turns it into a ShareTarget. */
type Draft = {
  name: string;
  kind: ShareTargetKind;
  url: string;
  tool: string;
  template: string;
  headers: string;
};

const DEFAULT_TEMPLATE = '{\n  "title": "{{title}}",\n  "markdown": "{{markdown}}"\n}';

const EMPTY: Draft = { name: "", kind: "http", url: "", tool: "", template: DEFAULT_TEMPLATE, headers: "" };

const KIND_LABELS: Record<ShareTargetKind, string> = { mcp: "MCP tool", http: "HTTP POST", file: "Folder" };

function toDraft(t: ShareTarget): Draft {
  return {
    name: t.name,
    kind: t.kind,
    url: t.url,
    tool: t.tool ?? "",
    template: t.template,
    headers: formatHeaderLines(t.headers),
  };
}

/**
 * The whole draft, checked in field order so the first problem is the one
 * reported. Returns the target minus its id, or the message to show.
 */
function validate(d: Draft): { target: Omit<ShareTarget, "id"> } | { error: string } {
  const name = d.name.trim();
  if (name === "") return { error: "Name is required." };
  const url = d.url.trim();
  if (!isShareTargetUrl(d.kind, url)) {
    return { error: d.kind === "file" ? "Folder path is required." : "Enter an http(s) URL." };
  }
  const tool = d.tool.trim();
  if (d.kind === "mcp" && tool === "") return { error: "Tool name is required for an MCP target." };
  if (!isJsonObjectText(d.template)) return { error: "Template must be a JSON object." };
  const headers = d.kind === "http" ? parseHeaderLines(d.headers) : {};
  if (headers === null) return { error: "Headers must be one Key: value per line." };
  return {
    target: {
      name,
      kind: d.kind,
      url,
      template: d.template,
      ...(d.kind === "mcp" ? { tool } : {}),
      ...(d.kind === "http" && Object.keys(headers).length > 0 ? { headers } : {}),
    },
  };
}

export function ShareTargetsTab() {
  // Read the settings this dialog session would apply -- the committed
  // settings with any staged patch laid over them -- so an edit staged
  // earlier in the same Done/Cancel transaction is reflected immediately.
  const targets = useSettingsStore((s) => selectEffective(s).shareTargets);
  const stage = useSettingsStore((s) => s.stageDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // Submit-time validation gets its own slot; the two textareas' blur
  // handlers get one each, so blurring a valid Headers field can't wipe an
  // already-shown Template error (or vice versa).
  const [error, setError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const id = useId();
  const editing = editingId === null ? null : targets.find((t) => t.id === editingId) ?? null;
  const shownError = error ?? templateError ?? headersError;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function reset() {
    setEditingId(null);
    setDraft(EMPTY);
    setError(null);
    setTemplateError(null);
    setHeadersError(null);
  }

  function edit(t: ShareTarget) {
    reset();
    setEditingId(t.id);
    setDraft(toDraft(t));
  }

  function remove(t: ShareTarget) {
    if (t.id === editingId) reset();
    // Read fresh rather than closing over the `targets` render snapshot: see
    // the comment on submit() below.
    stage({
      shareTargets: selectEffective(useSettingsStore.getState()).shareTargets.filter((x) => x.id !== t.id),
    });
  }

  // The two textareas report their own problem as soon as focus leaves them.
  function blurTemplate() {
    setTemplateError(isJsonObjectText(draft.template) ? null : "Template must be a JSON object.");
  }
  function blurHeaders() {
    setHeadersError(parseHeaderLines(draft.headers) === null ? "Headers must be one Key: value per line." : null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const result = validate(draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const next: ShareTarget = { id: editingId ?? crypto.randomUUID(), ...result.target };
    // Read fresh rather than closing over the `targets` render snapshot: a
    // second edit fired before the first one's stage has landed in the store
    // (and re-rendered this component) must still see the first edit, the
    // same reason DropZone.tsx and LeftRail.tsx read getState() at call time.
    const current = selectEffective(useSettingsStore.getState()).shareTargets;
    stage({
      shareTargets: editingId === null ? [...current, next] : current.map((t) => (t.id === editingId ? next : t)),
    });
    reset();
  }

  const heading = editing === null ? "Add target" : `Edit ${editing.name}`;

  return (
    <>
      <div className="bd-section-heading">
        <h3>Send chat to…</h3>
        <p className="bd-muted">Reusable destinations for exported conversations.</p>
      </div>

      {targets.length === 0 ? (
        <p className="bd-muted">No targets yet.</p>
      ) : (
        <div className="bd-list">
          {targets.map((t) => (
            <div key={t.id} className="bd-list-row">
              <div className="bd-row-copy">
                <div className="bd-row-title">{t.name}</div>
                <p className="bd-muted">
                  {t.kind} · {t.url}
                </p>
              </div>
              <button type="button" className="bd-button bd-button--ghost" aria-label={`Edit ${t.name}`} onClick={() => edit(t)}>
                Edit
              </button>
              <button
                type="button"
                className="bd-button bd-button--danger"
                aria-label={`Remove ${t.name}`}
                onClick={() => remove(t)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 id={`${id}-heading`}>{heading}</h3>
      <form className="bd-form" aria-labelledby={`${id}-heading`} onSubmit={submit}>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              id={`${id}-name`}
              className="bd-input"
              type="text"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          <div className="bd-field">
            <label htmlFor={`${id}-kind`}>Kind</label>
            <select
              id={`${id}-kind`}
              className="bd-input"
              value={draft.kind}
              onChange={(e) => set("kind", e.target.value as ShareTargetKind)}
            >
              {SHARE_TARGET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bd-field">
          <label htmlFor={`${id}-url`}>{draft.kind === "file" ? "Folder" : "URL"}</label>
          <input
            id={`${id}-url`}
            className="bd-input"
            type="text"
            value={draft.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </div>

        {draft.kind === "mcp" ? (
          <div className="bd-field">
            <label htmlFor={`${id}-tool`}>Tool</label>
            <input
              id={`${id}-tool`}
              className="bd-input"
              type="text"
              value={draft.tool}
              onChange={(e) => set("tool", e.target.value)}
            />
          </div>
        ) : null}

        <div className="bd-field">
          <label htmlFor={`${id}-template`}>Template</label>
          <textarea
            id={`${id}-template`}
            value={draft.template}
            onChange={(e) => set("template", e.target.value)}
            onBlur={blurTemplate}
          />
        </div>

        {draft.kind === "http" ? (
          <div className="bd-field">
            <label htmlFor={`${id}-headers`}>Headers</label>
            <textarea
              id={`${id}-headers`}
              value={draft.headers}
              placeholder="Authorization: Bearer …"
              onChange={(e) => set("headers", e.target.value)}
              onBlur={blurHeaders}
            />
          </div>
        ) : null}

        <div className="bd-actions">
          <button type="submit" className="bd-button bd-button--primary">
            Save target
          </button>
          {editing !== null ? (
            <button type="button" className="bd-button" onClick={reset}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
      {shownError !== null ? (
        <p className="bd-notice bd-notice--error" role="alert">
          {shownError}
        </p>
      ) : null}
    </>
  );
}
