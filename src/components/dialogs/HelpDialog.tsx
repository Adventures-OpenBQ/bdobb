// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GUIDE_PAGES, GUIDE_PREFIX, GUIDE_SECTIONS } from "../../help/guide";
import { TOPICS, type HelpSet, type Topic } from "../../help/index";
import { searchTopics } from "../../help/search";
import { shotUrl } from "../../help/shots";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { MarkdownRenderer } from "../renderers/MarkdownRenderer";

/**
 * The two help sets, each its own dialog. **Quick Help** is the in-repo
 * reference topics -- short, one per surface, edited in the same commit as
 * the behaviour they describe. **Reference Manual** is the user guide
 * vendored from the help repository, organised by task and grouped by the
 * sections its front page lists. Same Topic shape, same search, same
 * renderer; only the list and the title differ.
 */
const SETS: Record<HelpSet, { title: string; pages: Topic[] }> = {
  quick: { title: "Quick Help", pages: TOPICS },
  manual: { title: "Reference Manual", pages: GUIDE_PAGES },
};

/**
 * A help set, in a dialog. One component, reusing the .modal-backdrop
 * shell, MarkdownRenderer, useResolvedTheme and the whole dialog idiom
 * Settings and Connections already have (D1), useModalDialog: a real <dialog> opened with
 * showModal(), Escape handled on the document bubble path with the native
 * close request refused, and focus handed back to the opener on unmount.
 * Its shell is still the .modal-backdrop one; Settings and Connections
 * moved to DialogShell's .bd-dialog-backdrop.
 */
export function HelpDialog({ set, onClose }: { set: HelpSet; onClose: () => void }) {
  const { title, pages } = SETS[set];
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState<string>(pages[0].slug);
  const resolvedTheme = useResolvedTheme();
  const contentRef = useRef<HTMLElement>(null);
  // Stable per theme: MarkdownRenderer memoises its `img` component on this
  // identity, and a fresh arrow every render would remount every screenshot on
  // every keystroke in the search field.
  const resolveShot = useCallback((src: string) => shotUrl(src, resolvedTheme), [resolvedTheme]);

  // showModal(), the refused native close request, focus handed back to the
  // opener (the rail's Help row, or nothing at all when ⌘? opened it) and
  // Escape on the document bubble path all come from useModalDialog, which
  // also puts this dialog on the modal stack. ⌘? opens Help over Settings or
  // Connections, and Escape must then close Help, the dialog on top -- with
  // its own listener off the stack, Settings' listener ran first, closed
  // Settings and discarded its draft, and left Help open.
  //
  // Escape closes even with a query typed (D7): one press does one thing, and
  // that thing does not depend on where the caret is. Clearing the query is
  // the ✕ button beside the field.
  const dialogRef = useModalDialog(onClose);

  // The search field is focused here, AFTER useModalDialog's showModal()
  // (its effect is declared first, so it runs first): the dialog's job is to
  // answer a question the reader already has, so the field takes focus rather
  // than waiting to be found. React's autoFocus ran at commit, before that
  // effect, while the dialog was still closed (display: none), so it never
  // took; showModal() then focused the header ✕ instead.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const searching = query.trim() !== "";
  const hits = searching ? searchTopics(pages, query) : null;

  const topic = pages.find((t) => t.slug === slug) ?? pages[0];

  function select(next: string) {
    setSlug(next);
    // Without this, jumping from the bottom of a long topic to a short one
    // lands the reader below its content.
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  // Stable across renders: the link component inside MarkdownRenderer is
  // memoised on this identity, same reasoning as the shot resolver above.
  // Only the manual's pages carry #guide/ links, so the quick set never
  // fires it; passing it unconditionally keeps one code path.
  const onHelpLink = useCallback((target: string) => select(GUIDE_PREFIX + target), []);

  function entry(item: { slug: string; title: string; snippet?: string | null }): ReactNode {
    return (
      <li key={item.slug}>
        <button
          type="button"
          aria-current={item.slug === slug ? "true" : undefined}
          onClick={() => select(item.slug)}
        >
          {item.title}
          {item.snippet == null ? null : <span className="help-hit-snippet">{item.snippet}</span>}
        </button>
      </li>
    );
  }

  let list: ReactNode;
  if (hits !== null) {
    list =
      hits.length === 0 ? (
        <p className="empty-state">No topics match “{query.trim()}”.</p>
      ) : (
        <ul>{hits.map(entry)}</ul>
      );
  } else if (set === "manual") {
    list = GUIDE_SECTIONS.map((section) => (
      <div key={section.title}>
        {section.title === "" ? null : <h4>{section.title}</h4>}
        <ul>{section.pages.map(entry)}</ul>
      </div>
    ));
  } else {
    list = <ul>{pages.map(entry)}</ul>;
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-label={title}
    >
      <div className="modal modal-help">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="help-body">
          <div className="help-nav">
            {/* Outside the navigation landmark on purpose: the clear button is
                not one of the topics, and inside the landmark it would read as
                one to anything enumerating the list. */}
            <div className="help-search">
              <input
                type="search"
                aria-label="Search help"
                placeholder="Search help"
                value={query}
                // Focused by the showModal() effect above, not autoFocus.
                ref={searchRef}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                  ✕
                </button>
              ) : null}
            </div>
            <nav className="help-list" aria-label="Help topics">
              {list}
            </nav>
          </div>
          <article className="help-content" ref={contentRef}>
            <MarkdownRenderer data={topic.body} resolveImage={resolveShot} onHelpLink={onHelpLink} />
          </article>
        </div>
      </div>
    </dialog>
  );
}
