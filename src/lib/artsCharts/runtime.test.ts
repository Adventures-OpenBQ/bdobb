// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetJsonStoreForTests } from "../jsonStore";
import { __resetLoggerForTests } from "../logger";
import { DEFAULT_SETTINGS } from "../settingsFile";
import { useBackendsStore } from "../../stores/backendsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { __reset } from "../../test/memfs";

vi.mock("../artsChartsHost", () => ({ reconfigure: vi.fn() }));
vi.mock("./desktopSocket", () => ({ installChartsSocketShim: () => () => {} }));

const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const };
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  __reset(); __resetLoggerForTests(); __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  useBackendsStore.setState({ backends: [] });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("startArtsCharts MCP registration", () => {
  it("registers on a connection being added in the desktop main window", async () => {
    const { startArtsCharts } = await import("./runtime");
    const stop = startArtsCharts({ viewer: false });
    useBackendsStore.setState({ backends: [charts] });
    await settle();
    expect(useSettingsStore.getState().settings.mcpServers.map((s) => s.id)).toEqual(["arts-charts"]);
    stop();
  });
  it("browser mode skips MCP registration and sync entirely (the preview seed owns the list)", async () => {
    vi.stubEnv("MODE", "browser");
    const { startArtsCharts } = await import("./runtime");
    const stop = startArtsCharts({ viewer: false });
    useBackendsStore.setState({ backends: [charts] });
    await settle();
    expect(useSettingsStore.getState().settings.mcpServers).toEqual([]);
    stop();
  });
  it("a viewer window never writes", async () => {
    const { startArtsCharts } = await import("./runtime");
    const stop = startArtsCharts({ viewer: true });
    useBackendsStore.setState({ backends: [charts] });
    await settle();
    expect(useSettingsStore.getState().settings.mcpServers).toEqual([]);
    stop();
  });
});
