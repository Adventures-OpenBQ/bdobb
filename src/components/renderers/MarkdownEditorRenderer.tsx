// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { logError } from "../../lib/logger";
import { debounced } from "../../lib/markdownNote";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { openLinkExternally } from "./openLinkExternally";

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
  const theme = useResolvedTheme();
  const [failed, setFailed] = useState(false);

  // The markdown this editor last LOADED or last EMITTED: the one string that
  // stops a parse → serialise → param → prop → parse loop. The text prop
  // round-trips through the dashboard store, so without it a serialisation
  // would come back as the prop and look like an external change.
  const lastKnown = useRef("");
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
        // Committing an unchanged note would write the dashboard for nothing.
        if (serialized === lastKnown.current) return;
        lastKnown.current = serialized;
        latestOnChange.current(serialized);
      }, SAVE_DEBOUNCE_MS),
    [editor],
  );

  // Load on mount and on an external change. Runs after render, which is
  // where a ProseMirror transaction belongs; `lastKnown` is what makes the
  // editor's own round-tripped emission a no-op here.
  useEffect(() => {
    if (text === lastKnown.current) return;
    // Marked considered unconditionally, success or failure: otherwise a
    // failed load leaves `lastKnown` at the last text that DID parse, so a
    // later revert back to that same text reads as "already loaded" and the
    // fallback never clears (the check above would stay true forever).
    lastKnown.current = text;
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
    <div className="markdown-editor" onClickCapture={openLinkExternally} onBlur={() => save.flush()}>
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
