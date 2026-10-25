// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";

type Props = {
  /** The current name; shown pre-selected so typing replaces it. */
  value: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
};

/**
 * The name field that replaces a tab's or dashboard row's label while it is
 * being renamed. This is the app's only naming input: WKWebView implements no
 * window.prompt, so the modal one the v3.0.0 text called for cannot exist (see
 * docs/superpowers/specs/2026-08-27-inline-naming-native-confirm-design.md).
 *
 * Enter and blur commit the trimmed value; Escape cancels. A commit that is
 * blank or unchanged is reported as a cancel, so callers have exactly one
 * "nothing happened" path to close the field on.
 */
export function InlineRename({ value, ariaLabel, onCommit, onCancel }: Props) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    // select(), not just focus(): the field opens on a name the user means to
    // replace, so the first keystroke should overwrite it.
    ref.current?.select();
  }, []);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === value) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  }

  return (
    <input
      ref={ref}
      type="text"
      className="inline-rename"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        // The field sits inside the rail's/tab strip's own rows: stop here so
        // nothing above reacts to typing. useDashboardShortcuts already
        // ignores input targets (isTypingTarget), so ⌥digits are safe either
        // way; this also covers any handler that does not check.
        e.stopPropagation();
        // Mid-composition, Enter picks an IME candidate and Escape drops the
        // composition: neither is meant for the rename. WebKit reports that
        // Enter with isComposing already false, but keyCode 229.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />
  );
}
