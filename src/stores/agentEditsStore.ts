// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";

export const MAX_AGENT_EDITS = 20;

export type AgentEdit = { summary: string; undo: () => Promise<void> };

type AgentEditsState = {
  entries: AgentEdit[];
  /** Message from the last failed undo; shown by the edit bar until the next successful action or dismiss. */
  undoError: string | null;
  push: (edit: AgentEdit) => void;
  undoLast: () => Promise<void>;
  clear: () => void;
};

let undoChain: Promise<void> = Promise.resolve();

/** Rita's dashboard edits, newest last, so the edit bar can offer one-step undo. */
export const useAgentEditsStore = create<AgentEditsState>((set, get) => ({
  entries: [],
  undoError: null,
  push: (edit) => set({ entries: [...get().entries, edit].slice(-MAX_AGENT_EDITS), undoError: null }),
  undoLast: () => {
    // Undos run one at a time and each takes the newest entry off the list
    // before it awaits, so a second quick Undo reaches the edit before it
    // rather than undoing the same one twice.
    const run = undoChain.then(async () => {
      const last = get().entries.at(-1);
      if (!last) return;
      // A failed undo is stale (e.g. superseded); dropped all the same so it
      // cannot block older edits, its message kept for the bar. The error
      // still propagates.
      set({ entries: get().entries.filter((e) => e !== last) });
      try {
        await last.undo();
        set({ undoError: null });
      } catch (err) {
        set({ undoError: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    });
    undoChain = run.catch(() => {});
    return run;
  },
  clear: () => set({ entries: [], undoError: null }),
}));
