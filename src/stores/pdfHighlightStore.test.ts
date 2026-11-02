// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import { usePdfHighlightStore } from "./pdfHighlightStore";

const box = { text: "q", page: 2, x0: 1, top: 2, x1: 3, bottom: 4 };

describe("pdfHighlightStore", () => {
  beforeEach(() => usePdfHighlightStore.setState({ highlight: null }));

  it("holds one highlight; opening another replaces it", () => {
    usePdfHighlightStore.getState().show({ cardId: "a", page: 2, boxes: [box] });
    usePdfHighlightStore.getState().show({ cardId: "b", page: 1, boxes: [] });
    expect(usePdfHighlightStore.getState().highlight?.cardId).toBe("b");
  });

  it("clears only for the card that holds it", () => {
    usePdfHighlightStore.getState().show({ cardId: "a", page: 2, boxes: [box] });
    usePdfHighlightStore.getState().clear("b");
    expect(usePdfHighlightStore.getState().highlight?.cardId).toBe("a");
    usePdfHighlightStore.getState().clear("a");
    expect(usePdfHighlightStore.getState().highlight).toBeNull();
  });
});
