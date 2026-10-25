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
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
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

  it("clamps an out-of-range widgetGap before it reaches the disk", async () => {
    // Not reachable from the slider (a range input sanitizes itself), but
    // save() is a plain store action -- so a programmatic writer must not be
    // able to persist a gap the loader would clamp away on the next boot.
    await useSettingsStore.getState().save({ widgetGap: 99 });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(25);
    expect(JSON.parse(__read("settings.json") ?? "").widgetGap).toBe(25);

    await useSettingsStore.getState().save({ widgetGap: 0 });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(1);
    expect(JSON.parse(__read("settings.json") ?? "").widgetGap).toBe(1);
  });

  it("normalizes ritaMaxFunctionRounds before it reaches the disk", async () => {
    await useSettingsStore.getState().save({ ritaMaxFunctionRounds: 99 });
    expect(JSON.parse(__read("settings.json") ?? "").ritaMaxFunctionRounds).toBe(40);
    await useSettingsStore.getState().save({ ritaMaxFunctionRounds: 0 });
    expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(1);
  });

  it("rounds a fractional widgetGap before it reaches the disk", async () => {
    await useSettingsStore.getState().save({ widgetGap: 10.5 });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(11);
    expect(JSON.parse(__read("settings.json") ?? "").widgetGap).toBe(11);
  });

  it("falls back to 10 for a non-finite widgetGap rather than persisting it", async () => {
    await useSettingsStore.getState().save({ widgetGap: NaN });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(10);
    expect(JSON.parse(__read("settings.json") ?? "").widgetGap).toBe(10);
  });

  it("leaves an in-range widgetGap alone, and other patches untouched", async () => {
    await useSettingsStore.getState().save({ widgetGap: 18 });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(18);

    await useSettingsStore.getState().save({ theme: "light" });
    expect(useSettingsStore.getState().settings.widgetGap).toBe(18);
    expect(useSettingsStore.getState().settings.theme).toBe("light");
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

describe("draft transactions", () => {
  it("beginDraft snapshots the current settings with an empty patch", () => {
    useSettingsStore.getState().beginDraft();
    expect(useSettingsStore.getState().draft).toEqual({
      snapshot: DEFAULT_SETTINGS,
      patch: {},
    });
  });

  it("stageDraft merges into the patch without calling save or touching disk", () => {
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });
    useSettingsStore.getState().stageDraft({ fontSize: "large" });
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light", fontSize: "large" });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(__read("settings.json")).toBeUndefined();
    // The committed settings are untouched while the draft is only staged.
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("selectEffective merges the draft patch over settings", () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light", widgetGap: 30 });
    const effective = selectEffective(useSettingsStore.getState());
    expect(effective.theme).toBe("light");
    expect(effective.widgetGap).toBe(30);
    // Fields not staged fall through to the real settings.
    expect(effective.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it("selectEffective returns settings unchanged when there is no draft", () => {
    expect(selectEffective(useSettingsStore.getState())).toEqual(DEFAULT_SETTINGS);
  });

  it("commitDraft writes exactly one save call with only the dirty fields", async () => {
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    useSettingsStore.getState().beginDraft();
    // fontSize is staged back to its own snapshot value, so it is clean and
    // must not appear in the write -- only theme actually changed.
    useSettingsStore.getState().stageDraft({ theme: "light", fontSize: DEFAULT_SETTINGS.fontSize });
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: true });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ theme: "light" });
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("returns ok without calling save when nothing staged is actually dirty", async () => {
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: DEFAULT_SETTINGS.theme });
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: true });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("returns ok immediately when there is no draft open", async () => {
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: true });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("reports a conflict, and does not save, when the live settings diverged since beginDraft", async () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });
    // Someone else committed a change to the same field after this draft
    // was opened -- e.g. another dialog instance.
    await useSettingsStore.getState().save({ theme: "dark" });
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: false, conflicts: ["theme"] });
    expect(saveSpy).not.toHaveBeenCalled();
    // The draft survives a conflict so the caller can resolve and retry.
    expect(useSettingsStore.getState().draft).not.toBeNull();
  });

  it("{ replace: true } skips the conflict check and writes anyway", async () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });
    await useSettingsStore.getState().save({ theme: "dark" });
    const result = await useSettingsStore.getState().commitDraft({ replace: true });
    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().settings.theme).toBe("light");
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("keeps the draft and reports the message when save throws", async () => {
    vi.spyOn(useSettingsStore.getState(), "save").mockRejectedValue(new Error("disk full"));
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });
    const result = await useSettingsStore.getState().commitDraft();
    expect(result).toEqual({ ok: false, error: "disk full" });
    // Kept, not nulled, so the caller can retry the same draft.
    expect(useSettingsStore.getState().draft).not.toBeNull();
  });

  it("discardDraft clears the draft without ever calling save", () => {
    const saveSpy = vi.spyOn(useSettingsStore.getState(), "save");
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ theme: "light" });
    useSettingsStore.getState().discardDraft();
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("previews a staged widgetGap through selectEffective before it is committed", () => {
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ widgetGap: 30 });
    expect(selectEffective(useSettingsStore.getState()).widgetGap).toBe(30);
    // The real settings -- what DashboardGrid would read without going
    // through selectEffective -- are untouched until commit.
    expect(useSettingsStore.getState().settings.widgetGap).toBe(DEFAULT_SETTINGS.widgetGap);
  });
});
