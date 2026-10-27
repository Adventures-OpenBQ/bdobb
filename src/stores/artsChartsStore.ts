// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * Art's Charts UI state the app owns (v12). No package import: WidgetCard and LeftRail read it
 * in every build. `epoch` keys every chart card and the inbox, so a changed connection remounts
 * them on the new host (spec §2). `focusItem` is the inbox item a link asked for (B12);
 * `focusNonce` counts the asks, so the rail can remount the inbox for a repeat of the same id
 * (the package opens an item once per mount), and a bump drops the link: it named the old
 * connection's inbox. `reveal` is openChart's scroll-and-flash request (B8); the card that
 * handles it clears it, so a later remount does not replay it.
 */
import { create } from "zustand";

type State = {
  epoch: number;
  focusItem: string | null;
  focusNonce: number;
  reveal: { cardId: string; nonce: number } | null;
  bump: () => void;
  focusInbox: (id: string | null) => void;
  revealCard: (cardId: string) => void;
  clearReveal: (nonce: number) => void;
};

let nonce = 0;
export const useArtsChartsStore = create<State>((set) => ({
  epoch: 0,
  focusItem: null,
  focusNonce: 0,
  reveal: null,
  bump: () => set((s) => ({ epoch: s.epoch + 1, focusItem: null })),
  focusInbox: (focusItem) => set((s) => ({ focusItem, focusNonce: focusItem === null ? s.focusNonce : s.focusNonce + 1 })),
  revealCard: (cardId) => set({ reveal: { cardId, nonce: ++nonce } }),
  clearReveal: (n) => set((s) => (s.reveal?.nonce === n ? { reveal: null } : s)),
}));
