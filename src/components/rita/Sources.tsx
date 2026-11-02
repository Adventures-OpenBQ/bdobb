// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import type { BoundingBox } from "../../lib/agent/types";
import { isRecord } from "../../lib/isRecord";
import { safeUrl } from "../../lib/safeUrl";
import type { DashboardCard } from "../../lib/types";
import { usePdfHighlightStore } from "../../stores/pdfHighlightStore";

/** Reduces a Rita citation to a label and an openable url (null when the source has none). */
export function citationLink(c: unknown): { name: string; url: string | null } | null {
  if (!isRecord(c)) return null;
  const info = isRecord(c.source_info) ? c.source_info : {};
  const name = typeof info.name === "string" ? info.name : typeof c.id === "string" ? c.id : "Source";
  const raw = typeof info.url === "string" ? info.url : typeof c.url === "string" ? c.url : null;
  if (raw === null) return { name, url: null };
  const url = safeUrl(raw);
  return url === null ? null : { name, url };
}

/**
 * The dashboard card a widget citation names: Rita's metadata.widget_uuid, else
 * the first card with the citation's origin and widget_id (openbb-ai's cite()
 * sends no uuid). Null when that card is not on the dashboard.
 */
export function citedCardId(c: Record<string, unknown>, cards: DashboardCard[]): string | null {
  const info = isRecord(c.source_info) ? c.source_info : {};
  const meta = isRecord(info.metadata) ? info.metadata : {};
  if (typeof meta.widget_uuid === "string") return cards.some((k) => k.id === meta.widget_uuid) ? meta.widget_uuid : null;
  return cards.find((k) => k.backendId === info.origin && k.widgetId === info.widget_id)?.id ?? null;
}

function openQuote(cardId: string, groups: BoundingBox[][]) {
  const page = groups[0][0].page;
  usePdfHighlightStore.getState().show({ cardId, page, boxes: groups.flat().filter((b) => b.page === page) });
  const el = document.querySelector(`[data-card-id="${cardId}"]`);
  // jsdom has no scrollIntoView.
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}

export function Sources({ citations, cards = [] }: { citations: Record<string, unknown>[]; cards?: DashboardCard[] }) {
  const items = citations.flatMap((c, i) => {
    const link = citationLink(c);
    // withQuoteBoxes (events.ts) left only a non-empty, validated BoundingBox[][] here.
    const groups = Array.isArray(c.quote_bounding_boxes) ? (c.quote_bounding_boxes as BoundingBox[][]) : [];
    const cardId = groups.length > 0 ? citedCardId(c, cards) : null;
    if (cardId !== null) {
      return [
        <button key={i} type="button" onClick={() => openQuote(cardId, groups)}>
          {link?.name ?? "Quote"}
        </button>,
      ];
    }
    if (link === null) return [];
    return [
      link.url === null ? (
        <span key={i}>{link.name}</span>
      ) : (
        <button key={i} type="button" onClick={() => void openUrl(link.url as string)}>
          {link.name}
        </button>
      ),
    ];
  });
  if (items.length === 0) return null;
  return <p className="chat-sources">Sources: {items}</p>;
}
