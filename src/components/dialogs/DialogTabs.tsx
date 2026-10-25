// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { KeyboardEvent } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";

/**
 * The shared .bd-nav tab list. Roving tabindex (one tab in the tab order, the
 * rest reached with the arrow keys) and Arrow/Home/End move BOTH focus and
 * selection, so a keyboard user lands on the panel the arrows just revealed
 * rather than tabbing through six dead buttons. Orientation flips to
 * horizontal below 740px, where .bd-nav is a scrolling row rather than a
 * column, so a screen reader announces the right axis for the arrow keys.
 *
 * The caller owns what "selected" means: onSelect(id) is all this fires, and
 * Settings turns that into a tab change plus its keysVisited bookkeeping.
 * (Since v3.0.3 that bookkeeping is a visited set covering every service
 * section.) A tab's DOM id is `${idPrefix}-${id}` with whitespace made `_`:
 * a Settings service section's id carries backend and widget ids, and a
 * space would break it as an HTML id and as an aria-labelledby token.
 */
export function DialogTabs({
  items,
  selected,
  onSelect,
  label,
  panelId,
  idPrefix,
}: {
  items: Array<[string, string]>;
  selected: string;
  onSelect: (id: string) => void;
  label: string;
  panelId: string;
  idPrefix: string;
}) {
  // Matches the stylesheet's own 740px breakpoint, where .bd-nav turns from a
  // column into a scrolling row.
  const horizontal = useMediaQuery("(max-width: 740px)") === true;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = items.findIndex(([id]) => id === selected);
    let j: number | undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (i + 1) % items.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = items.length - 1;
    if (j === undefined) return;
    e.preventDefault();
    onSelect(items[j][0]);
    // Focus follows: left on the old tab, now tabIndex -1, a screen reader
    // announces nothing and Tab leaves from the wrong place.
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus();
  }

  return (
    <div
      className="bd-nav"
      role="tablist"
      aria-label={label}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
    >
      <span className="bd-nav-label">{label}</span>
      {items.map(([id, title]) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${idPrefix}-${id.replace(/\s/g, "_")}`}
          aria-selected={selected === id}
          aria-controls={panelId}
          tabIndex={selected === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={onKeyDown}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
