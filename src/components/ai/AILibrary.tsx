// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { AI_LIBRARY_FILE_NAME, exportAiLibrary, parseAiLibrary } from "../../lib/aiLibraryFile";
import { pickImportFile } from "../../lib/pickImportFile";
import { logError } from "../../lib/logger";
import { saveTextFile } from "../../lib/saveTextFile";
import type { Settings } from "../../lib/types";
import { useModalDialog } from "../../hooks/useModalDialog";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { normalizeMcpUrl } from "../../lib/agent/mcp";
import { useMcpTokensStore } from "../../stores/mcpTokensStore";
import { useSkillsStore } from "../../stores/skillsStore";
import { DialogShell } from "../dialogs/DialogShell";
import { DialogTabs } from "../dialogs/DialogTabs";
import { AgentsTab } from "./AgentsTab";
import { AppearanceTab } from "./AppearanceTab";
import { McpServersTab } from "./McpServersTab";
import { ShareTargetsTab } from "./ShareTargetsTab";
import { SkillEditorDialog } from "./SkillEditorDialog";
import type { DraftSkill } from "./skillsDraft";
import { SkillsTab } from "./SkillsTab";

export type { DraftSkill };

type AITab = "agents" | "mcp" | "share" | "skills" | "appearance";

const TABS: Array<[AITab, string]> = [
  ["agents", "Agents"],
  ["mcp", "MCP Servers"],
  ["share", "Send chat to…"],
  ["skills", "Skills"],
  ["appearance", "Appearance"],
];

const PANEL_ID = "ai-library-panel";

/**
 * The skills half of Done, exported for direct test. Sequential through the
 * store's own serialized queue (skillsStore's `enqueue`), so two Dones in a
 * row never race each other's writes.
 *
 * Diff against what's ACTUALLY stored, not the snapshot the draft started
 * from: removes first, then only the entries that actually changed, then
 * each rename's old slug once nothing uses it. A throw re-seeds
 * `entries` from the store's post-failure state, so a retried Done only
 * repeats the work that didn't land.
 */
export async function commitSkills(
  entries: DraftSkill[],
  reseed: (s: DraftSkill[]) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stored = useSkillsStore.getState().skills;
  const keep = new Set<string>();
  for (const e of entries) {
    keep.add(e.slug);
    if (e.originalSlug !== null) keep.add(e.originalSlug);
  }
  const removes = stored.filter((s) => !keep.has(s.slug));

  const changed = (e: DraftSkill): boolean => {
    const orig = e.originalSlug === null ? undefined : stored.find((s) => s.slug === e.originalSlug);
    if (orig === undefined) return true;
    return (
      orig.slug !== e.slug ||
      orig.description !== e.description ||
      orig.content !== e.content ||
      orig.enabled !== e.enabled ||
      JSON.stringify(orig.extra) !== JSON.stringify(e.extra)
    );
  };

  // Each step returns on its first failure; `at` names the skill it was on.
  let at = "";
  try {
    for (const s of removes) {
      at = s.slug;
      await useSkillsStore.getState().remove(s.slug);
    }

    // Every write before any rename's old folder goes: renames can chain or
    // cycle (a→c, b→a, c→b), and deleting an old slug as each one lands would
    // delete a folder another entry has just been written to.
    for (const e of entries) {
      if (!changed(e)) continue;
      const { originalSlug: _originalSlug, ...skill } = e;
      at = e.slug;
      await useSkillsStore.getState().upsert(skill);
    }

    const live = new Set(entries.map((e) => e.slug));
    for (const e of entries) {
      if (e.originalSlug === null || live.has(e.originalSlug)) continue;
      at = e.originalSlug;
      await useSkillsStore.getState().remove(e.originalSlug);
    }
  } catch (err) {
    reseed(useSkillsStore.getState().skills.map((x) => ({ ...x, originalSlug: x.slug })));
    return { ok: false, error: `${at}: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true };
}

type Props = { onClose: () => void };

/**
 * Rita, MCP servers, share targets and skills, on the shared dialog shell
 * with a Cancel/Done settings draft (see SettingsDialog's identical
 * beginDraft/stageDraft/discardDraft/commitDraft consumption).
 *
 * All five tabs (Agents, MCP servers, Send chat to..., Skills, Appearance)
 * stage their edits into stageDraft. Skills additionally stages into local
 * `entries` state (a DraftSkill[] snapshot seeded once at mount); SkillsTab
 * is a pure list over `entries` with every add/edit/remove/toggle flowing
 * back up through props. This keeps the store unchanged while the dialog is
 * open, so `done()` can reconcile `entries` against the store via
 * commitSkills with an accurate diff base.
 */
export function AILibrary({ onClose }: Props) {
  const beginDraft = useSettingsStore((s) => s.beginDraft);
  const discardDraft = useSettingsStore((s) => s.discardDraft);
  const commitDraft = useSettingsStore((s) => s.commitDraft);
  const stageDraft = useSettingsStore((s) => s.stageDraft);

  // Open the transaction on first mount only -- a defensive guard against a
  // draft another dialog already left open, matching SettingsDialog.
  useEffect(() => {
    if (useSettingsStore.getState().draft === null) beginDraft();
  }, [beginDraft]);

  const [tab, setTab] = useState<AITab>("agents");
  const [pending, setPending] = useState(false);
  const [conflicts, setConflicts] = useState<(keyof Settings)[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Seeded once at mount from the committed store -- see commitSkills' own
  // doc comment above for why `done()` reconciling against this snapshot,
  // rather than re-reading the store, is the right diff base.
  const [entries, setEntries] = useState<DraftSkill[]>(() =>
    useSkillsStore.getState().skills.map((s) => ({ ...s, originalSlug: s.slug })),
  );
  // null: closed. { editing: null }: the create form. { editing: entry }:
  // editing that entry (by reference, from `entries`).
  const [editor, setEditor] = useState<{ editing: DraftSkill | null } | null>(null);

  // useChildDialog pushes SkillEditorDialog's own modalStack entry AFTER
  // this one, so the stack already orders Escapes without an editorOpen
  // check here.

  const dialogRef = useModalDialog(cancel);
  // The selected tab takes focus once on mount -- not page-load autofocus; a
  // div overlay's dialog has no other focus target, matching the old
  // AILibrary's own manual-focus effect it replaces. An effect AFTER
  // useModalDialog's, which is what opens the dialog: DialogTabs' own
  // autoFocus ran in the child's effect, before showModal(), and a browser
  // gives no focus inside a closed dialog (review m44's test setup now says
  // so too) -- the same fix as Help's search field (E3).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [dialogRef]);

  function cancel() {
    discardDraft();
    onClose();
  }

  async function done() {
    setPending(true);
    const serversBefore = useSettingsStore.getState().settings.mcpServers;
    const result = await commitDraft(conflicts !== null ? { replace: true } : undefined);
    if (!result.ok) {
      setPending(false);
      if ("conflicts" in result) setConflicts(result.conflicts);
      else setSaveError(result.error);
      return;
    }
    // A removed server's token goes only now that the removal is committed
    // (Cancel keeps it), and only when no remaining row uses its URL; a
    // later server added at that URL must not inherit it.
    const kept = new Set(useSettingsStore.getState().settings.mcpServers.map((s) => normalizeMcpUrl(s.url)));
    for (const url of new Set(serversBefore.map((s) => normalizeMcpUrl(s.url)))) {
      if (!kept.has(url)) {
        await useMcpTokensStore.getState().removeToken(url).catch((err: unknown) =>
          logError(`failed to save MCP tokens: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
    // Settings are committed above; only now does the skills half run, so a
    // failed settings save never touches the skills store. From here,
    // commitSkills is safe because SkillsTab (see the class comment above)
    // never writes to the store itself -- `entries` is still an accurate
    // diff base. A failure here leaves the dialog open with the skills
    // error shown below; the settings draft is already gone (committed just
    // above), so retrying Done only re-runs commitSkills, which -- per its
    // own doc comment -- resumes from whatever didn't land last time.
    const skillsResult = await commitSkills(entries, setEntries);
    if (!skillsResult.ok) {
      setPending(false);
      setSkillsError(skillsResult.error);
      // commitDraft above already committed/nulled the settings draft, so
      // without a fresh one any further tab edit's stageDraft call would
      // silently no-op (see settingsStore's stageDraft) while the dialog
      // stays open for the user to fix the skills error.
      beginDraft();
      return;
    }
    setPending(false);
    onClose();
  }

  async function doExport() {
    setNotice(null);
    try {
      // The file carries MCP and share-target headers in the clear, like
      // backends.json does; the notice says so once. Exports the EFFECTIVE
      // draft (staged changes included), matching Settings' own export.
      const written = await saveTextFile(
        AI_LIBRARY_FILE_NAME,
        "AI Library",
        exportAiLibrary(selectEffective(useSettingsStore.getState())),
      );
      if (written) setNotice("Exported. The file holds any server headers in the clear.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Export failed: ${message}`);
      await logError(`failed to export AI Library: ${message}`);
    }
  }

  async function doImport() {
    setNotice(null);
    try {
      // Sized before it is read, as the apps.json import does.
      const picked = await pickImportFile("AI Library");
      if (picked === null) return;
      if ("refusal" in picked) {
        setNotice(picked.refusal);
        return;
      }
      const plan = parseAiLibrary(picked.text, selectEffective(useSettingsStore.getState()));
      if (!plan.ok) {
        setNotice(plan.refusal);
        return;
      }
      // Staged, not saved: Done is what commits it, and Cancel discards it.
      stageDraft(plan.patch);
      setNotice(plan.notice);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Import failed: ${message}`);
      await logError(`failed to import AI Library: ${message}`);
    }
  }

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="AI Library"
      title="AI Library"
      subtitle="Agents, tools, and reusable instructions"
      headerActions={
        <>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void doExport()}>
            Export…
          </button>
          <button type="button" className="bd-button bd-button--ghost" onClick={() => void doImport()}>
            Import…
          </button>
        </>
      }
      nav={
        <DialogTabs
          items={TABS}
          selected={tab}
          onSelect={(id) => setTab(id as AITab)}
          label="AI workspace"
          panelId={PANEL_ID}
          idPrefix="ai-tab"
        />
      }
      bodyId={PANEL_ID}
      bodyLabelledBy={`ai-tab-${tab}`}
      note="Exports may include server headers in plain text. Done applies pending changes; Cancel discards them."
      footerActions={
        <>
          <button type="button" className="bd-button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="bd-button bd-button--primary" disabled={pending} onClick={() => void done()}>
            Done
          </button>
        </>
      }
      onClose={cancel}
    >
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
      {skillsError !== null ? (
        <div className="bd-notice bd-notice--error" role="status">
          {skillsError}
        </div>
      ) : null}
      {notice !== null ? (
        <p className="bd-muted" role="status">
          {notice}
        </p>
      ) : null}
      {tab === "agents" ? <AgentsTab /> : null}
      {tab === "mcp" ? <McpServersTab /> : null}
      {tab === "share" ? <ShareTargetsTab /> : null}
      {tab === "skills" ? (
        <SkillsTab
          entries={entries}
          onCreate={() => setEditor({ editing: null })}
          onEdit={(entry) => setEditor({ editing: entry })}
          onRemove={(entry) => setEntries((es) => es.filter((e) => e !== entry))}
          onSetEnabled={(entry, enabled) =>
            setEntries((es) => es.map((e) => (e === entry ? { ...e, enabled } : e)))
          }
        />
      ) : null}
      {tab === "appearance" ? <AppearanceTab /> : null}
      {editor !== null ? (
        <SkillEditorDialog
          editing={editor.editing}
          existing={entries}
          onSave={(entry) => {
            const editing = editor.editing;
            setEntries((es) => (editing === null ? [...es, entry] : es.map((e) => (e === editing ? entry : e))));
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : null}
    </DialogShell>
  );
}
