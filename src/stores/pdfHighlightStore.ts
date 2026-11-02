// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import type { BoundingBox } from "../lib/agent/types";

/** The quote a citation opened: one card, one page, that page's boxes. One at a time. */
export type PdfHighlight = { cardId: string; page: number; boxes: BoundingBox[] };

type State = { highlight: PdfHighlight | null; show: (h: PdfHighlight) => void; clear: (cardId: string) => void };

export const usePdfHighlightStore = create<State>((set, get) => ({
  highlight: null,
  show: (highlight) => set({ highlight }),
  clear: (cardId) => {
    if (get().highlight?.cardId === cardId) set({ highlight: null });
  },
}));
