// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_EDITS, useAgentEditsStore } from "./agentEditsStore";

beforeEach(() => useAgentEditsStore.setState({ entries: [], undoError: null }));

describe("agentEditsStore", () => {
  it("undoes the most recent edit and drops it", async () => {
    const undo = vi.fn(async () => {});
    useAgentEditsStore.getState().push({ summary: "first", undo: async () => {} });
    useAgentEditsStore.getState().push({ summary: "second", undo });
    await useAgentEditsStore.getState().undoLast();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(useAgentEditsStore.getState().entries.map((e) => e.summary)).toEqual(["first"]);
  });

  // M1: a double-click on Undo must undo B then A, not B twice.
  it("two quick undoes reach the edit before the newest", async () => {
    const a = vi.fn(async () => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const b = vi.fn(() => gate);
    useAgentEditsStore.getState().push({ summary: "A", undo: a });
    useAgentEditsStore.getState().push({ summary: "B", undo: b });
    const first = useAgentEditsStore.getState().undoLast();
    const second = useAgentEditsStore.getState().undoLast();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(useAgentEditsStore.getState().entries).toEqual([]);
  });

  it("keeps only the last 20 edits", () => {
    for (let i = 0; i < MAX_AGENT_EDITS + 5; i++) {
      useAgentEditsStore.getState().push({ summary: `edit ${i}`, undo: async () => {} });
    }
    const { entries } = useAgentEditsStore.getState();
    expect(entries).toHaveLength(MAX_AGENT_EDITS);
    expect(entries[0].summary).toBe("edit 5");
  });

  it("drops a failing entry, records its message, and leaves older edits undoable", async () => {
    const older = vi.fn(async () => {});
    useAgentEditsStore.getState().push({ summary: "first", undo: older });
    useAgentEditsStore.getState().push({
      summary: "second",
      undo: async () => {
        throw new Error("boom");
      },
    });
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow("boom");
    expect(useAgentEditsStore.getState().entries.map((e) => e.summary)).toEqual(["first"]);
    expect(useAgentEditsStore.getState().undoError).toBe("boom");
    await useAgentEditsStore.getState().undoLast();
    expect(older).toHaveBeenCalledTimes(1);
    expect(useAgentEditsStore.getState().undoError).toBeNull();
  });

  it("undoLast is a no-op when empty; clear empties", async () => {
    await useAgentEditsStore.getState().undoLast();
    useAgentEditsStore.getState().push({ summary: "x", undo: async () => {} });
    useAgentEditsStore.getState().clear();
    expect(useAgentEditsStore.getState().entries).toEqual([]);
  });
});
