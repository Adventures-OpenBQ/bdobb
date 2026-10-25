// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTypingTarget } from "../hooks/useDashboardShortcuts";
import { useModalDialog } from "../hooks/useModalDialog";
import { arrangementOf } from "../lib/workspacesFile";
import { freeSlotId, hiddenEntries, hiddenNote, largestFreeRect, type TilePlacement } from "../lib/workspacePresets";
import { useDashboardStore } from "../stores/dashboardStore";
import { effectiveWorkspace, layoutNameKey, nextLayoutName, presetNamed, useWorkspacesStore } from "../stores/workspacesStore";
import { DialogShell } from "./dialogs/DialogShell";

/**
 * Save layout as… (spec 2026-10-01 §6): a name, then the draft's tiles saved
 * as a layout -- no slot ids, no dashboards -- whether or not Done follows.
 * A small modal of its own, because WKWebView has no window.prompt. Escape
 * and Cancel close only this; Arrange mode stays on (useModalDialog stops the
 * Escape before the bar's own listener sees it).
 */
function SaveLayoutDialog({ tiles, onClose }: { tiles: readonly TilePlacement[]; onClose: () => void }) {
  const saveLayout = useWorkspacesStore((s) => s.saveLayout);
  const [name, setName] = useState(() => nextLayoutName(useWorkspacesStore.getState().layouts));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const dialogRef = useModalDialog(onClose);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      // Names are unique by layoutNameKey. A taken one asks first; declining
      // returns to the name field with nothing written. A preset's name is
      // never a Replace, even when an older file on disk already has it: the
      // store refuses it, and the catch below shows why.
      const taken =
        presetNamed(trimmed) === undefined &&
        useWorkspacesStore.getState().layouts.some((l) => layoutNameKey(l.name) === layoutNameKey(trimmed));
      if (taken) {
        const replace = await confirm(`Replace the layout "${trimmed}"?`, {
          title: "Replace layout",
          kind: "warning",
          okLabel: "Replace",
          cancelLabel: "Cancel",
        });
        if (!replace) {
          field.current?.focus();
          field.current?.select();
          return;
        }
      }
      await saveLayout(trimmed, tiles);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="Save layout"
      title="Save layout"
      bodyId="save-layout-body"
      modifier="bd-dialog--editor"
      note={error === null ? undefined : `Could not save: ${error}`}
      footerActions={
        <>
          <button type="button" className="bd-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="bd-button bd-button--primary"
            disabled={pending || name.trim() === ""}
            onClick={() => void save()}
          >
            Save
          </button>
        </>
      }
      onClose={onClose}
    >
      <div className="bd-field">
        <label htmlFor="save-layout-name">Name</label>
        <input
          id="save-layout-name"
          ref={field}
          className="bd-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void save();
          }}
        />
      </div>
    </DialogShell>
  );
}

/**
 * The bar above the tiles while a workspace is arranged (spec
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §3): the
 * workspace's name, how many dashboards the arrangement hides, Add tile,
 * Save layout as…, Cancel and Done. Save layout as… asks for a name and saves
 * the tiles as a layout (spec 2026-10-01 §6). Done commits the store's draft; Cancel and Escape discard
 * it. WorkspaceGrid mounts it only for the workspace being arranged.
 */
export function WorkspaceArrangeBar({ workspaceId }: { workspaceId: string }) {
  // The name is read from the saved workspace: Arrange mode never changes it,
  // so it equals the draft's (the dialog is what widens the draft to carry a
  // name and preset -- workspacesStore's WorkspaceDraft).
  const saved = useWorkspacesStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const draft = useWorkspacesStore((s) => (s.draft?.id === workspaceId ? s.draft : null));
  const stageDraft = useWorkspacesStore((s) => s.stageDraft);
  const commitDraft = useWorkspacesStore((s) => s.commitDraft);
  const endArranging = useWorkspacesStore((s) => s.endArranging);
  // A string, not the array: a selector that allocates re-renders forever.
  const dashboardIds = useDashboardStore((s) => s.dashboards.map((d) => d.id).join(","));
  const known = useMemo(() => new Set(dashboardIds === "" ? [] : dashboardIds.split(",")), [dashboardIds]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  // A ref as well as `pending`, so two clicks that see the same render still
  // commit once (Review Focus 2).
  const busy = useRef(false);

  // A maximized card is restored on entering: its tile is about to be
  // covered, and the face must be over everything in it.
  useEffect(() => {
    useDashboardStore.getState().setMaximized(null);
  }, []);

  // Escape is Cancel. On window, so a modal over the bar -- the Save layout
  // dialog, or Help, which ⌘? still opens -- takes its own Escape first: each
  // handles it on document with stopImmediatePropagation (useModalDialog for
  // the one, HelpDialog's own listener for the other), so it never reaches
  // here. A text field keeps its own Escape, composing or not, rather than
  // discarding the draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while Done's write is in flight, like the Cancel button below.
      if (e.key === "Escape" && !e.isComposing && !isTypingTarget(e.target) && !busy.current) endArranging();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endArranging]);

  if (saved === undefined || draft === null) return null;

  const tiles = arrangementOf(effectiveWorkspace(saved, draft) ?? saved);
  // Only dashboards that exist count, and only they are worth a new tile.
  const hidden = hiddenEntries(tiles, draft.slots, (s) => "dashboardId" in s && known.has(s.dashboardId));
  const room = largestFreeRect(tiles);
  // A hidden dashboard's slot first, so the new tile shows it; otherwise a
  // fresh id, and the tile is empty.
  const nextSlot = hidden[0]?.slot ?? freeSlotId(tiles, draft.slots);

  function addTile() {
    if (room === null || nextSlot === undefined) return;
    stageDraft({ layout: [...tiles, { slot: nextSlot, ...room }] });
  }

  async function done() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof commitDraft>>;
    try {
      result = await commitDraft();
    } catch (err) {
      // Known failures answer { ok: false }; an unexpected throw is shown the
      // same way, or `busy` and `pending` would stay set and Done disabled
      // for good.
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    busy.current = false;
    setPending(false);
    // The draft is kept on a failure, so the mode stays on with it intact.
    if (result.ok) endArranging();
    else setError(result.error);
  }

  return (
    <div className="workspace-arrange-bar" role="toolbar" aria-label={`Arranging ${saved.name}`}>
      <h2 className="workspace-arrange-title">{saved.name}</h2>
      {hidden.length > 0 ? <span className="workspace-arrange-note">{hiddenNote(hidden.length)}</span> : null}
      {error === null ? null : (
        <span className="workspace-arrange-error" role="alert">
          Could not save: {error}
        </span>
      )}
      {/* Add tile and Cancel are off while Done's write is in flight: a tile
          added then is not the arrangement being written, and Done ends
          Arrange mode over it; Cancel then would not undo the write. */}
      <button
        type="button"
        disabled={pending || room === null || nextSlot === undefined}
        title={room === null ? "No room. Shrink a tile first." : undefined}
        onClick={addTile}
      >
        Add tile
      </button>
      <button type="button" onClick={() => setSaving(true)}>
        Save layout as…
      </button>
      <button type="button" disabled={pending} onClick={endArranging}>
        Cancel
      </button>
      <button type="button" disabled={pending} onClick={() => void done()}>
        Done
      </button>
      {saving ? <SaveLayoutDialog tiles={tiles} onClose={() => setSaving(false)} /> : null}
    </div>
  );
}
