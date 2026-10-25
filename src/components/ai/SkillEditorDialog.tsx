// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useChildDialog } from "../../hooks/useChildDialog";
import { isSkillSlug } from "../../lib/skillsFiles";
import { DialogShell } from "../dialogs/DialogShell";
import type { DraftSkill } from "./skillsDraft";

/** Matches the Workspace's own limit on a skill description. */
const DESCRIPTION_MAX = 500;

type Field = "slug" | "description" | "content";

/**
 * The form's fields, checked in field order so the first problem is the one
 * reported. `editing` is the entry being edited (by reference, from the same
 * `existing` array), so its own slug is excluded from the duplicate check.
 */
function validate(
  d: { slug: string; description: string; content: string },
  existing: DraftSkill[],
  editing: DraftSkill | null,
): { error: string; field: Field } | { ok: { slug: string; description: string; content: string } } {
  const slug = d.slug.trim();
  if (!isSkillSlug(slug)) return { error: "Slug must be lowercase letters, digits and hyphens.", field: "slug" };
  if (existing.some((s) => s !== editing && s.slug === slug)) {
    return { error: `A skill named ${slug} already exists.`, field: "slug" };
  }
  const description = d.description.trim().replace(/\s+/g, " ");
  if (description === "") return { error: "Description is required.", field: "description" };
  const content = d.content.trim();
  if (content === "") return { error: "Content is required.", field: "content" };
  return { ok: { slug, description, content } };
}

type Props = {
  editing: DraftSkill | null;
  existing: DraftSkill[];
  onSave: (entry: DraftSkill) => void;
  onCancel: () => void;
};

/**
 * The create/edit surface for a skill, stacked over the AI Library the way
 * BackendEditForm stacks over Connections (see useChildDialog's doc
 * comment). Builds a DraftSkill and hands it to `onSave`; AILibrary is the
 * one that decides whether that means appending or replacing in `entries`
 * -- this component holds no opinion on the list, only the one entry.
 */
export function SkillEditorDialog({ editing, existing, onSave, onCancel }: Props) {
  // Pushes this dialog's own modalStack entry AFTER AILibrary's -- Escape
  // closes this editor first, no editorOpen bookkeeping needed in AILibrary.
  const dialogRef = useChildDialog(onCancel);
  const [form, setForm] = useState({
    slug: editing?.slug ?? "",
    description: editing?.description ?? "",
    content: editing?.content ?? "",
  });
  const [error, setError] = useState<{ message: string; field: Field } | null>(null);
  const title = editing === null ? "Create skill" : "Edit skill";
  const submitLabel = editing === null ? "Create skill" : "Save changes";
  const formId = "skill-form";

  function submit(e: FormEvent) {
    e.preventDefault();
    const result = validate(form, existing, editing);
    if ("error" in result) {
      setError({ message: result.error, field: result.field });
      return;
    }
    onSave({
      ...result.ok,
      // A new skill starts enabled with no extra frontmatter; an edit keeps
      // the switch where it was and keeps the frontmatter lines this app
      // does not interpret (a bundled skill's copyright and source).
      enabled: editing?.enabled ?? true,
      extra: editing?.extra ?? {},
      updated: new Date().toISOString(),
      originalSlug: editing?.originalSlug ?? null,
    });
  }

  const describedBy = (field: Field) => (error?.field === field ? "skill-editor-error" : undefined);

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel={title}
      title={title}
      subtitle="Reusable instructions for Rita"
      onClose={onCancel}
      modifier="bd-dialog--editor bd-dialog--skill-editor"
      plain
      note={
        <button type="button" className="bd-button" onClick={onCancel}>
          Cancel
        </button>
      }
      footerActions={
        <button type="submit" form={formId} className="bd-button bd-button--primary">
          {submitLabel}
        </button>
      }
    >
      <form id={formId} className="bd-form" onSubmit={submit}>
        <div className="bd-field">
          <label htmlFor="skill-slug">Slug</label>
          <input
            id="skill-slug"
            className="bd-input"
            value={form.slug}
            aria-describedby={describedBy("slug")}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          />
        </div>
        <div className="bd-field">
          <label htmlFor="skill-description">Description</label>
          <input
            id="skill-description"
            className="bd-input"
            maxLength={DESCRIPTION_MAX}
            value={form.description}
            aria-describedby={describedBy("description")}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="bd-field">
          <label htmlFor="skill-content">Instructions</label>
          <textarea
            id="skill-content"
            className="bd-input"
            value={form.content}
            aria-describedby={describedBy("content")}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
        </div>
        {error !== null ? (
          <p id="skill-editor-error" className="bd-notice bd-notice--error" role="alert">
            {error.message}
          </p>
        ) : null}
      </form>
    </DialogShell>
  );
}
