// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Takes the text, not a payload: a note has no backend and nothing is fetched
 * for it. The text lives in the card's `text` param so it persists with the
 * dashboard like any other parameter.
 */
export function NoteRenderer({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    // Only a real change is reported: committing an unchanged note would
    // write the dashboard for nothing every time the card lost focus.
    if (draft !== text) onChange(draft);
  }

  // Blur never fires on unmount in any browser (quitting the app, closing
  // the window, or the card simply being removed mid-edit does not blur the
  // textarea first), so commit() above is never reached and the draft is
  // lost. Mirrored into a ref, read only from the cleanup below, so this
  // effect can stay mount/unmount-only ([]) instead of re-running (and
  // re-registering a cleanup that would fire on every keystroke) whenever
  // editing/draft/text/onChange change.
  const latest = useRef({ editing, draft, text, onChange });
  latest.current = { editing, draft, text, onChange };
  useEffect(() => {
    return () => {
      const s = latest.current;
      // Guards against double-committing: a blur that already ran turned
      // `editing` off (via commit()'s setEditing(false)) before unmount,
      // so this sees editing === false and does nothing.
      if (s.editing && s.draft !== s.text) s.onChange(s.draft);
    };
  }, []);

  if (editing) {
    return (
      <textarea
        ref={box}
        className="note-edit"
        aria-label="Note text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Escape abandons: the draft is discarded and the stored text is
          // restored, so a mistyped note is recoverable without an undo.
          if (e.key === "Escape") {
            setDraft(text);
            setEditing(false);
          }
        }}
      />
    );
  }

  function edit() {
    setDraft(text);
    setEditing(true);
  }

  // A <div>, not a <button>: MarkdownRenderer can emit headings, lists,
  // tables and anchors, all of which are invalid content inside a <button>
  // (interactive content is disallowed there, and a browser silently
  // mangles the DOM to cope). role="button" plus explicit key handling
  // restores keyboard operability that the real element would otherwise
  // have given for free. This also drops the aria-label that used to
  // override the note's own text as the accessible name — the note's
  // content IS what names the control now, the same way a native button's
  // text content would — and, as a side effect, native <button> elements
  // commonly default to non-selectable text, which fought the click-drag
  // selection this card wants to support.
  return (
    <div
      role="button"
      tabIndex={0}
      className="note-view"
      onClick={edit}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        // Space's default action is scrolling the page; a real <button>
        // suppresses that while activated, so this must too.
        e.preventDefault();
        edit();
      }}
    >
      {text ? (
        <MarkdownRenderer data={text} />
      ) : (
        <span className="empty-state">Click to write a note.</span>
      )}
    </div>
  );
}
