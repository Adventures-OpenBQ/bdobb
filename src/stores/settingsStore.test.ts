// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __read, __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { selectEffective, useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

const realQueueUpload = useWorkspaceStore.getState().queueUpload;
const entry = { mode: "login" as const, connection: { id: "ws1", name: "Work", baseUrl: "https://workspace.example" }, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state: "signed-in" as const };

beforeEach(() => {
  useWorkspaceStore.setState({ queueUpload: realQueueUpload, sessions: {} });
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe("useSettingsStore", () => {

  it("hands every save to the upload queue of the connection holding settings", async () => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions: { ws1: entry } });
    await useSettingsStore.getState().save({ settingsStorage: "ws1" });
    await useSettingsStore.getState().save({ theme: "light" });
    expect(queueUpload).toHaveBeenLastCalledWith("ws1", expect.objectContaining({ theme: "light", settingsStorage: "ws1" }));
  });

  it.each([
    ["storage is Local", {}, { ws1: entry }],
    ["storage names a connection without a session", { settingsStorage: "ws2" }, { ws1: entry }],
    ["the holding connection's session expired", { settingsStorage: "ws1" }, { ws1: { ...entry, state: "expired" as const } }],
  ])("does not upload when %s", async (_label, patch, sessions) => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions });
    await useSettingsStore.getState().save({ ...patch, theme: "light" });
    expect(queueUpload).not.toHaveBeenCalled();
  });

  it("uploads what commitDraft commits", async () => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions: { ws1: entry } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ fontSize: "large" });
    expect(await useSettingsStore.getState().commitDraft()).toEqual({ ok: true });
    expect(queueUpload).toHaveBeenCalledWith("ws1", expect.objectContaining({ fontSize: "large" }));
  });

  it("keeps the local save when the upload rejects", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry }, queueUpload: vi.fn(async () => { throw new Error("boom"); }) });
    await useSettingsStore.getState().save({ settingsStorage: "ws1", theme: "light" });
    expect(JSON.parse(__read("settings.json") ?? "").theme).toBe("light");
  });
  it("loads settings from disk", async () => {
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("save persists the patch to disk before updating in-memory state", async () => {
    await useSettingsStore.getState().save({ theme: "light" });
    expect(useSettingsStore.getState().settings.theme).toBe("light");
    expect(JSON.parse(__read("settings.json") ?? "").theme).toBe("light");
  });

  it("save merges the patch over the existing settings, not replacing them", async () => {
    await useSettingsStore.getState().save({ theme: "light" });
    await useSettingsStore.getState().save({ fontSize: "large" });
    const { settings } = useSettingsStore.getState();
    expect(settings.theme).toBe("light");
    expect(settings.fontSize).toBe("large");
  });

  it("does not drop an earlier patch when two saves overlap without awaiting the first", async () => {
    const p1 = useSettingsStore.getState().save({ defaultTicker: "AAPL" });
    const p2 = useSettingsStore.getState().save({ theme: "light" });
    await Promise.all([p1, p2]);

    const { settings } = useSettingsStore.getState();
    expect(settings.defaultTicker).toBe("AAPL");
    expect(settings.theme).toBe("light");

    const onDisk = JSON.parse(__read("settings.json") ?? "");
    expect(onDisk.defaultTicker).toBe("AAPL");
    expect(onDisk.theme).toBe("light");
  });
});

describe("draft transaction", () => {
  it("stageDraft does not write settings or disk; selectEffective layers the pending patch over settings", () => {
    // No draft yet: selectEffective is just the committed settings.
    expect(selectEffective(useSettingsStore.getState())).toEqual(DEFAULT_SETTINGS);

    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });

    // Staging never touches committed settings or disk.
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(__read("settings.json")).toBeUndefined();

    // But the effective (preview) value reflects the staged patch.
    expect(selectEffective(useSettingsStore.getState())).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
    });
  });

  it("commitDraft writes a single save with only the fields that actually changed", async () => {
    const store = useSettingsStore.getState();
    const saveSpy = vi.spyOn(store, "save");

    store.beginDraft();
    // theme is staged back to its own snapshot value (not dirty); fontSize
    // actually changes (dirty). Only fontSize should reach save().
    store.stageDraft({ theme: DEFAULT_SETTINGS.theme, fontSize: "large" });

    const result = await useSettingsStore.getState().commitDraft();

    expect(result).toEqual({ ok: true });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ fontSize: "large" });
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(useSettingsStore.getState().settings.fontSize).toBe("large");
  });

  it("commitDraft reports a conflict when settings changed underneath the draft", async () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });

    // Simulate a concurrent writer (another dialog, another tab) landing a
    // change to the same field the draft is touching, after the snapshot was
    // taken.
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, theme: "light" },
    });

    const result = await useSettingsStore.getState().commitDraft();

    expect(result).toEqual({ ok: false, conflicts: ["theme"] });
    // The draft survives a conflict so the caller can decide what to do.
    expect(useSettingsStore.getState().draft).not.toBeNull();
  });

  it("commitDraft({ replace: true }) skips the conflict check and overwrites", async () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });

    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, theme: "light" },
    });

    const result = await useSettingsStore.getState().commitDraft({ replace: true });

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().settings.theme).toBe("light");
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("commitDraft returns { ok: false, error } and keeps the draft when save throws", async () => {
    const store = useSettingsStore.getState();
    vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));

    store.beginDraft();
    store.stageDraft({ theme: "light" });

    const result = await useSettingsStore.getState().commitDraft();

    expect(result).toEqual({ ok: false, error: "disk full" });
    expect(useSettingsStore.getState().draft).not.toBeNull();
  });

  it("discardDraft clears the draft without writing", () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });

    useSettingsStore.getState().discardDraft();

    expect(useSettingsStore.getState().draft).toBeNull();
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(__read("settings.json")).toBeUndefined();
  });

  it("commitDraft with no dirty fields is a no-op that still clears the draft", async () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: DEFAULT_SETTINGS.theme });

    const result = await useSettingsStore.getState().commitDraft();

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("commitDraft with no active draft is a no-op that returns ok", async () => {
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: true });
  });
});
