// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { createPortal } from "react-dom";
import type { HoverCard } from "../../lib/tableColumns";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * `{key}` placeholders filled from the cell's object. A key the object does
 * not carry is left as written, so a typo in the manifest shows up as itself
 * rather than as a silent gap. Object.hasOwn: the object came from JSON.parse.
 */
function fillTemplate(markdown: string, source: unknown): string {
  const record = typeof source === "object" && source !== null ? (source as Record<string, unknown>) : {};
  return markdown.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(record, key) ? String(record[key]) : whole,
  );
}

/**
 * One hoverCard cell: the displayed text, and on hover or focus a card with
 * the column's title and its markdown filled from the cell's object.
 *
 * Portalled into <body> and `position: fixed` at the anchor's rect, like
 * RowContextMenu: a card body clips (.table-scroll's overflow) and the grid
 * transforms its items, so a card positioned inside the table would be cut
 * off or land in the wrong place.
 */
export function HoverCardCell({ text, card, source }: { text: string; card: HoverCard; source: unknown }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const open = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setAt({ left: rect.left, top: rect.bottom + 4 });
  };
  return (
    <>
      <span
        className="hover-card-anchor"
        // Focusable so a keyboard user can open the card too: a tooltip
        // trigger is the accepted exception to this rule.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onMouseEnter={(e) => open(e.currentTarget)}
        onFocus={(e) => open(e.currentTarget)}
        onMouseLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
      >
        {text}
      </span>
      {at
        ? createPortal(
            <div className="hover-card" role="tooltip" style={at}>
              {card.title ? <div className="hover-card-title">{card.title}</div> : null}
              <MarkdownRenderer data={fillTemplate(card.markdown, source)} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
