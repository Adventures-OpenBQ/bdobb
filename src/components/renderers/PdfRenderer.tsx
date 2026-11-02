// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import type { BoundingBox } from "../../lib/agent/types";
import { parseDocuments, type Document } from "../../lib/documents";
import { DocumentView } from "./DocumentView";
import { ErrorState } from "./ErrorState";

/**
 * A `pdf` widget is an ordinary GET — fetchesData stays true for it — so
 * `data` is whatever useWidgetData fetched: one { content, data_format }
 * object. The required-param empty state ("Enter Commodity, Year, Month to
 * load this widget.") comes from useWidgetData unchanged and never reaches
 * here.
 *
 * `onRetry` is the card's own refetch. It is passed rather than defaulted to
 * a no-op because ErrorState always paints a Retry button, and a button that
 * does nothing is worse than no button.
 */
export function PdfRenderer({
  data,
  onRetry,
  highlight = null,
}: {
  data: unknown;
  onRetry: () => void;
  highlight?: { page: number; boxes: BoundingBox[] } | null;
}) {
  // Memoized on `data`, not recomputed every render: parseDocuments builds a
  // fresh Uint8Array per call, and PdfView compares each new array's bytes
  // against the document it has loaded (a refetch of unchanged content keeps
  // the reader's page) -- an unmemoized call here would repeat that
  // whole-file comparison on every unrelated re-render (e.g. a card resize).
  const parsed = useMemo((): { documents: Document[] } | { error: string } => {
    try {
      return { documents: parseDocuments(data) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [data]);

  if ("error" in parsed) return <ErrorState message={parsed.error} onRetry={onRetry} />;

  const doc = parsed.documents[0];
  // Not an error: an empty list is a well-formed answer with nothing in it.
  if (!doc) return <p className="empty-state">No document in this payload.</p>;
  return <DocumentView doc={doc} highlight={highlight} />;
}
