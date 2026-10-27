// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import {
  loadChartLayouts,
  removeLayout,
  saveChartLayouts,
  upsertLayout,
  type ChartLayout,
} from "../lib/chartLayoutsFile";
import { serialize } from "../lib/serialize";

/**
 * The one saved layout library the whole app reads (spec 2026-09-24, D6): a
 * single shared store, so a save made on one chart card appears in every other
 * open card's Layout list at once. It does NOT do the three things the series
 * presets do -- it is not loaded per mounted card, it is not updated
 * optimistically, and it is not matched by a partial signature (the exact
 * match lives in chart/layouts.ts).
 *
 * Persist first, then publish (D7): a save succeeds only once it is on disk. A
 * failed write is caught here, leaves the in-memory list exactly as it was --
 * no phantom entry -- and records why in `error`, which the editor shows.
 */
type ChartLayoutsState = {
  layouts: ChartLayout[];
  /** The last write failure, or null. Cleared by the next write that succeeds. */
  error: string | null;
  load: () => Promise<void>;
  /** Upsert by name; resolves true only once the file is written (D7). */
  save: (layout: ChartLayout) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
  /** Merge a whole imported file by name in one write (spec 2026-09-25, E6); true only once on disk. */
  importLayouts: (list: ChartLayout[]) => Promise<boolean>;
};

export const useChartLayoutsStore = create<ChartLayoutsState>((set, get) => {
  // One serialized queue, mirroring foldersStore: every load/save/remove runs
  // only after the previous step both wrote to disk and published, so two
  // un-awaited saves cannot both compute from the same stale list and have the
  // second silently revert the first on disk.
  const enqueue = <T,>(step: () => Promise<T>) => serialize("store:chart-layouts", step);

  /** Persist `next`, then publish it; a write failure keeps the current list and records why (D7). */
  const persist = async (next: ChartLayout[]): Promise<boolean> => {
    try {
      await saveChartLayouts(next);
      set({ layouts: next, error: null });
      return true;
    } catch (err) {
      set({ error: `could not save the layout library: ${(err as Error).message}` });
      return false;
    }
  };

  return {
    layouts: [],
    error: null,

    load: () => enqueue(async () => { set({ layouts: await loadChartLayouts(), error: null }); }),

    save: (layout) => enqueue(() => persist(upsertLayout(get().layouts, layout))),

    remove: (name) => enqueue(() => persist(removeLayout(get().layouts, name))),

    // A whole imported file folded in at once (spec 2026-09-25, E6): each
    // incoming layout upserts by name onto the running list -- the editor has
    // already resolved Replace (same name) or Keep both (a renamed copy, E5) --
    // and the one persist reports success only after the file is on disk (D7),
    // exactly as save does.
    importLayouts: (list) =>
      enqueue(() => persist(list.reduce((acc, layout) => upsertLayout(acc, layout), get().layouts))),
  };
});
