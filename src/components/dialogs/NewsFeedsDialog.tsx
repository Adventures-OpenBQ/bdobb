// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { splitKeywords } from "../../lib/news";
import { safeUrl } from "../../lib/safeUrl";
import type { NewsCardState, NewsFeed } from "../../lib/types";

type Props = {
  state: NewsCardState | undefined;
  /** The edited list, or null when it ends up empty. Called once, on Done. */
  onDone: (next: NewsCardState | null) => void;
  onClose: () => void;
};

/** A row under edit. `key` is for React only and never leaves this file. */
type Row = NewsFeed & { key: string };

const blank = (): Row => ({ key: crypto.randomUUID(), url: "", name: "", tab: "" });

/** Blank URLs are dropped on Done; anything else must be http(s). */
const invalid = (row: Row) => row.url.trim() !== "" && safeUrl(row.url.trim()) === null;

/**
 * The feed manager. Edits a local copy; nothing reaches the card until Done.
 * Row order is what orders the widget's tabs (first use), so moving rows is
 * how the user orders tabs. Same modal idiom as every dialog (useModalDialog).
 */
export function NewsFeedsDialog({ state, onDone, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(() => (state?.feeds ?? []).map((f) => ({ ...f, key: crypto.randomUUID() })));
  const [keywords, setKeywords] = useState(() => (state?.highlights ?? []).join(", "));
  /** The row to focus after Add feed, by key; cleared once focused. */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // The app's modal idiom (useModalDialog): top layer, focus handed back to
  // the opener, and one Escape closes this dialog and nothing else.
  const dialogRef = useModalDialog(onClose);

  useEffect(() => {
    if (focusKey === null) return;
    dialogRef.current?.querySelector<HTMLInputElement>(`input[data-key="${focusKey}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey, dialogRef]);

  const patch = (key: string, field: keyof NewsFeed, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const move = (index: number, delta: -1 | 1) =>
    setRows((rs) => {
      const target = index + delta;
      if (target < 0 || target >= rs.length) return rs;
      const next = [...rs];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  function add() {
    const row = blank();
    setRows((rs) => [...rs, row]);
    setFocusKey(row.key);
  }

  function done() {
    const feeds: NewsFeed[] = rows
      .filter((r) => r.url.trim() !== "")
      .map((r) => ({ url: r.url.trim(), name: r.name.trim(), tab: r.tab.trim() }));
    if (feeds.length === 0) {
      onDone(null);
      return;
    }
    const highlights = splitKeywords(keywords);
    const next: NewsCardState = { feeds };
    if (highlights.length > 0) next.highlights = highlights;
    // The dragged tab order is not this dialog's to edit; it rides through.
    if (state?.tabOrder !== undefined) next.tabOrder = state.tabOrder;
    onDone(next);
  }

  const anyInvalid = rows.some(invalid);

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-label="Configure feeds"
    >
      <div className="modal modal-news-feeds">
        <header className="modal-header">
          <h2>Configure feeds</h2>
        </header>
        <table className="news-feeds-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Name</th>
              <th>Tab</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const n = i + 1;
              const bad = invalid(row);
              return (
                <tr key={row.key}>
                  <td>
                    <input
                      type="text"
                      data-key={row.key}
                      aria-label={`Feed ${n} source`}
                      aria-invalid={bad || undefined}
                      placeholder="https://…/feed"
                      value={row.url}
                      onChange={(e) => patch(row.key, "url", e.target.value)}
                    />
                    {bad ? <span className="news-feed-error">Not an http or https URL</span> : null}
                  </td>
                  <td>
                    <input type="text" aria-label={`Feed ${n} name`} value={row.name} onChange={(e) => patch(row.key, "name", e.target.value)} />
                  </td>
                  <td>
                    <input type="text" aria-label={`Feed ${n} tab`} value={row.tab} onChange={(e) => patch(row.key, "tab", e.target.value)} />
                  </td>
                  <td className="actions">
                    <button type="button" aria-label={`Move feed ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Move feed ${n} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" aria-label={`Remove feed ${n}`} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={add}>
          Add feed
        </button>
        <label className="news-keywords">
          Highlight keywords
          <input
            type="text"
            aria-label="Highlight keywords"
            placeholder="comma-separated"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={anyInvalid} onClick={done}>
            Done
          </button>
        </footer>
      </div>
    </dialog>
  );
}
