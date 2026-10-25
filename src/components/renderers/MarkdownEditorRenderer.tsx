// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { logError } from "../../lib/logger";
import {
  createNoteSync,
  debounced,
  emitIfChanged,
  loaded,
  needsReload,
} from "../../lib/markdownNote";
import { safeUrl } from "../../lib/safeUrl";
import { useSettingsStore } from "../../stores/settingsStore";
import { MarkdownRenderer } from "./MarkdownRenderer";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Takes the text, not a payload, exactly as NoteRenderer does: a built-in has
 * no backend and nothing is fetched. Unlike the note there is no edit mode --
 * the editor is always live -- so "commit" is a debounce, flushed on blur and
 * on unmount, and never a write of an unchanged string.
 */
export function MarkdownEditorRenderer({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const editor = useCreateBlockNote();
  // This version's theme setting is already resolved -- "dark" or "light",
  // with no "system" value to follow the OS through a media query.
  const theme = useSettingsStore((s) => s.settings.theme);
  const [failed, setFailed] = useState(false);

  // See markdownNote.ts: the one string that stops a parse → serialise →
  // param → prop → parse loop. useState's lazy initializer runs createNoteSync
  // once; a bare useRef(createNoteSync()) would allocate a throwaway object
  // on every render.
  const [sync] = useState(createNoteSync);
  // True while replaceBlocks runs. BlockNote reports a programmatic replace
  // through onChange too, and a load must not be committed as an edit.
  const loading = useRef(false);
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  const save = useMemo(
    () =>
      debounced(() => {
        // BlockNote always appends a trailing newline; the stored param must
        // not carry it (Save as… adds the file's own newline, WidgetCard.tsx).
        const serialized = editor.blocksToMarkdownLossy(editor.document).replace(/\n+$/, "");
        const out = emitIfChanged(sync, serialized);
        if (out !== null) latestOnChange.current(out);
      }, SAVE_DEBOUNCE_MS),
    [editor],
  );

  // Load on mount and on an external change. Runs after render, which is
  // where a ProseMirror transaction belongs; `needsReload` is what makes the
  // editor's own round-tripped emission a no-op here.
  useEffect(() => {
    if (!needsReload(sync, text)) return;
    // Marked considered unconditionally, success or failure: otherwise a
    // failed load leaves `lastKnown` at the last text that DID parse, so a
    // later revert back to that same text reads as "already loaded" and the
    // fallback never clears (needsReload would stay false forever).
    loaded(sync, text);
    try {
      loading.current = true;
      const parsed = editor.tryParseMarkdownToBlocks(text);
      // A zero-block array (an empty `text`) is not a document BlockNote's
      // schema accepts; fall back to one empty paragraph.
      const blocks = parsed.length === 0 ? [{ type: "paragraph" as const }] : parsed;
      editor.replaceBlocks(editor.document, blocks);
      setFailed(false);
    } catch (err) {
      // A pending debounced save must not survive this: 500 ms later it would
      // serialise the editor's OLD (unloaded) document, which now differs
      // from `lastKnown` (set above to the failed text), and emit it --
      // overwriting the very text that failed to parse.
      save.cancel();
      setFailed(true);
      void logError(`markdown note could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loading.current = false;
    }
  }, [editor, text, save]);

  // Blur never fires on unmount, so the pending draft is flushed here.
  useEffect(() => () => save.flush(), [save]);

  function onLinkClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    // The webview has no back button: a link followed as a navigation takes
    // the whole app away. Same routing as MarkdownRenderer's MarkdownLink.
    event.preventDefault();
    const safe = safeUrl(anchor.getAttribute("href") ?? "");
    if (safe !== null) void openUrl(safe);
  }

  if (failed) {
    return (
      <div className="markdown-editor-fallback">
        <p className="card-notice" role="status">
          Could not open this note in the editor.
        </p>
        <MarkdownRenderer data={text} />
      </div>
    );
  }

  return (
    <div className="markdown-editor" onClickCapture={onLinkClick} onBlur={() => save.flush()}>
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={() => {
          if (loading.current) return;
          save.call();
        }}
      />
    </div>
  );
}
