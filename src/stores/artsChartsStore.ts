// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * Art's Charts UI state the app owns (v12). No package import: WidgetCard and LeftRail read it
 * in every build. `epoch` keys every chart card and the inbox, so a changed connection remounts
 * them on the new host (spec §2). `focusItem` is the inbox item a link asked for (B12).
 * `reveal` is openChart's scroll-and-flash request (B8).
 */
import { create } from "zustand";

type State = {
  epoch: number;
  focusItem: string | null;
  reveal: { cardId: string; nonce: number } | null;
  bump: () => void;
  focusInbox: (id: string | null) => void;
  revealCard: (cardId: string) => void;
};

let nonce = 0;
export const useArtsChartsStore = create<State>((set) => ({
  epoch: 0,
  focusItem: null,
  reveal: null,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
  focusInbox: (focusItem) => set({ focusItem }),
  revealCard: (cardId) => set({ reveal: { cardId, nonce: ++nonce } }),
}));
