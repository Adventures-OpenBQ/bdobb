// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { PreferencePill } from "../services/PreferencePill";
import type { DraftSkill } from "./skillsDraft";

type Props = {
  entries: DraftSkill[];
  onCreate: () => void;
  onEdit: (entry: DraftSkill) => void;
  onRemove: (entry: DraftSkill) => void;
  onSetEnabled: (entry: DraftSkill, enabled: boolean) => void;
};

/**
 * A pure list over the `entries` draft AILibrary holds -- no store reads or
 * writes here. Every add/edit/remove/toggle flows back up through these
 * props instead of touching the skills store directly, which is what makes
 * it safe for `done()` to reconcile the whole draft against the store in one
 * pass afterward (see commitSkills' doc comment in AILibrary.tsx).
 * SkillEditorDialog is the create/edit surface; this component only lists,
 * invokes it, and removes.
 */
export function SkillsTab({ entries, onCreate, onEdit, onRemove, onSetEnabled }: Props) {
  const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <>
      <div className="bd-section-heading bd-section-heading--actions">
        <div>
          <h3>Skills</h3>
          <p className="bd-muted">Reusable instructions Rita can match to a question.</p>
        </div>
        <button type="button" className="bd-button bd-button--primary" onClick={onCreate}>
          Create skill
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bd-empty">
          <h4>No skills yet</h4>
        </div>
      ) : (
        <div className="bd-list">
          {sorted.map((entry) => (
            <div key={entry.slug} className="bd-list-row">
              <div className="bd-row-copy">
                <h4>{entry.slug}</h4>
                <p className="bd-muted">{entry.description}</p>
              </div>
              <PreferencePill
                label="Enabled"
                checked={entry.enabled}
                ariaLabel={`Enabled ${entry.slug}`}
                onChange={(enabled) => onSetEnabled(entry, enabled)}
              />
              <button
                type="button"
                className="bd-button bd-button--ghost"
                aria-label={`Edit ${entry.slug}`}
                onClick={() => onEdit(entry)}
              >
                Edit
              </button>
              <button
                type="button"
                className="bd-button bd-button--danger"
                aria-label={`Remove ${entry.slug}`}
                onClick={() => onRemove(entry)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
