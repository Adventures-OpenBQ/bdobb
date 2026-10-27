// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { __resetJsonStoreForTests } from "../jsonStore";
import { __resetLoggerForTests } from "../logger";
import { DEFAULT_SETTINGS } from "../settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSkillsStore } from "../../stores/skillsStore";
import { __reset, __seed } from "../../test/memfs";
import { ensureArtsChartsSkill, syncArtsChartsMcp } from "./mcp";

const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const };

async function resetSettings() {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
}
async function resetSkills(skills: never[]) {
  __reset();
  __seed("skills/.keep", "");
  useSkillsStore.setState({ skills });
}

describe("B10", () => {
  beforeEach(async () => { await resetSettings(); });
  it("saving the connection registers Art's Charts at <base>/charts/mcp, token auth, bound to the connection", async () => {
    await syncArtsChartsMcp(null, charts);
    expect(useSettingsStore.getState().settings.mcpServers).toContainEqual({
      id: "arts-charts", name: "Art's Charts", url: "https://door.example.com/charts/mcp", enabled: true,
      authType: "token", source: { kind: "backend", backendId: "c1" },
    });
  });
  it("a changed base URL moves the server; removing the connection removes it", async () => {
    await syncArtsChartsMcp(null, charts);
    await syncArtsChartsMcp(charts, { ...charts, baseUrl: "https://door2.example.com" });
    expect(useSettingsStore.getState().settings.mcpServers.filter((s) => s.id === "arts-charts").map((s) => s.url)).toEqual(["https://door2.example.com/charts/mcp"]);
    await syncArtsChartsMcp(charts, null);
    expect(useSettingsStore.getState().settings.mcpServers.some((s) => s.id === "arts-charts")).toBe(false);
  });
  it("leaves the user's other servers alone", async () => {
    await useSettingsStore.getState().save({ mcpServers: [{ id: "x", url: "https://mcp.example.com/mcp", enabled: true }] });
    await syncArtsChartsMcp(null, charts);
    await syncArtsChartsMcp(charts, null);
    expect(useSettingsStore.getState().settings.mcpServers).toEqual([{ id: "x", url: "https://mcp.example.com/mcp", enabled: true }]);
  });
  it("the start-time call (same connection) never recreates a deleted server, but updates a stale one and keeps the toggle", async () => {
    await syncArtsChartsMcp(charts, charts);
    expect(useSettingsStore.getState().settings.mcpServers).toEqual([]);
    await syncArtsChartsMcp(null, charts);
    await useSettingsStore.getState().save({ mcpServers: useSettingsStore.getState().settings.mcpServers.map((s) => ({ ...s, enabled: false, url: "https://old.example.com/charts/mcp" })) });
    await syncArtsChartsMcp(charts, charts);
    expect(useSettingsStore.getState().settings.mcpServers).toEqual([expect.objectContaining({ id: "arts-charts", url: "https://door.example.com/charts/mcp", enabled: false })]);
  });
});

describe("B11", () => {
  it("adds the bundled arts-charts skill if absent and never overwrites a user edit", async () => {
    await resetSkills([]);
    await ensureArtsChartsSkill();
    const added = useSkillsStore.getState().skills.find((s) => s.slug === "arts-charts")!;
    expect(added.content).toMatch(/^# Art's Charts chart documents/);
    await useSkillsStore.getState().upsert({ ...added, content: "mine" });
    await ensureArtsChartsSkill();
    expect(useSkillsStore.getState().skills.find((s) => s.slug === "arts-charts")!.content).toBe("mine");
  });
});
