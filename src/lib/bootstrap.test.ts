// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fresh-install seeded backend (localhost:6900) makes the fire-and-forget
// discovery attempt a fetch. Rejecting it deterministically keeps this file
// hermetic, exactly as App.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
}));

vi.mock("../components/runWorkspaceSync", () => ({ runStartupPrompt: vi.fn(() => new Promise<void>(() => {})) }));

vi.mock("../components/runDashboardSync", async (orig) => ({ ...(await orig<object>()), startDashboardAutoUpload: vi.fn(() => () => {}) }));

import { fetch } from "@tauri-apps/plugin-http";
import { __failPath, __read, __reset, __seed } from "../test/memfs";
import { makeEmptyFolders } from "./foldersFile";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { startDashboardAutoUpload } from "../components/runDashboardSync";
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { bootstrap } from "./bootstrap";

/** A minimal dashboard file, as loadDashboards expects to find it. */
function dashboardFile(id: string, name: string): string {
  return JSON.stringify({ id, name, tabs: [{ id: `${id}-t1`, name: "Main", cards: [] }] });
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useBackendsStore.setState({ backends: [], statuses: {}, issues: {} });
  useDashboardStore.setState({
    dashboards: [],
    activeId: null,
    previousId: null,
    activeTabId: null,
    viewer: false,
  });
  useFoldersStore.setState(makeEmptyFolders());
  vi.mocked(runStartupPrompt).mockClear();
  vi.mocked(startDashboardAutoUpload).mockClear();
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
  useWorkspaceStore.setState({ connections: [], usernames: {}, sessions: {}, notices: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom keeps one document for the whole file, so a ?viewer= query left
  // behind would make every later test boot as a viewer.
  window.history.replaceState({}, "", "/");
  useDashboardStore.setState({ viewer: false });
});

describe("bootstrap", () => {
  it("loads settings before the dashboards whose order depends on it", async () => {
    const order: string[] = [];
    let releaseSettings = () => {};
    vi.spyOn(useSettingsStore.getState(), "load").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSettings = () => {
            order.push("settings");
            resolve();
          };
        }),
    );
    const dashboardsLoad = vi
      .spyOn(useDashboardStore.getState(), "load")
      .mockImplementation(async () => {
        order.push("dashboards");
      });
    vi.spyOn(useBackendsStore.getState(), "load").mockImplementation(async () => {});
    vi.spyOn(useFoldersStore.getState(), "load").mockImplementation(async () => {});

    const done = bootstrap();
    // Every microtask that could run without settings resolving has now run.
    await Promise.resolve();
    await Promise.resolve();
    expect(dashboardsLoad).not.toHaveBeenCalled();

    releaseSettings();
    await done;
    expect(order).toEqual(["settings", "dashboards"]);
  });

  it("leaves backends, dashboards and folders all loaded from disk", async () => {
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    __seed("folders.json", JSON.stringify({ ...makeEmptyFolders(), placement: { z: "f1" } }));

    await bootstrap();

    // The fresh-install seed writes one backend; the dashboard and the
    // placement come off the seeded files.
    expect(useBackendsStore.getState().backends).toHaveLength(1);
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Zeta"]);
    expect(useFoldersStore.getState().placement).toEqual({ z: "f1" });
  });

  it("sets the viewer flag and activates the dashboard the query names", async () => {
    __seed("dashboards/a.json", dashboardFile("a", "Alpha"));
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");

    await bootstrap();

    expect(useDashboardStore.getState().viewer).toBe(true);
    expect(useDashboardStore.getState().activeId).toBe("z");
  });

  it("logs a settings failure and still loads the dashboards", async () => {
    __failPath("settings.json");
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));

    await bootstrap();

    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load settings");
    expect(useDashboardStore.getState().dashboards).toHaveLength(1);
  });

  it("logs a failed load instead of rejecting", async () => {
    __failPath("dashboards");

    await expect(bootstrap()).resolves.toBeUndefined();

    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load app state");
  });

  const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: true };

  it("loads workspace.json and runs the startup prompt without waiting for it", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: {} }));
    // runStartupPrompt never settles here; bootstrap must still resolve.
    await bootstrap();
    expect(useWorkspaceStore.getState().connections).toEqual([ws]);
    expect(runStartupPrompt).toHaveBeenCalledTimes(1);
  });

  it("loads workspaceSync.json and starts the dashboard auto-upload in the main window only", async () => {
    const l = { dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "aaaaaaaa-0000-4000-8000-000000000002", serverUpdatedDate: "2026-10-11T00:00:00Z", localRevisionAtSync: 1, shared: false };
    __seed("workspaceSync.json", JSON.stringify({ links: [l], tombstones: [] }));
    await bootstrap();
    expect(useWorkspaceSyncStore.getState().links).toEqual([l]);
    expect(startDashboardAutoUpload).toHaveBeenCalledTimes(1);
    vi.mocked(startDashboardAutoUpload).mockClear();
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    await bootstrap();
    expect(startDashboardAutoUpload).not.toHaveBeenCalled();
  });

  it("starts discovery with flagged backends still waiting for their values", async () => {
    const refresh = vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue();
    await bootstrap();
    // No ids: refresh() itself leaves flagged backends without a value alone (Task 4).
    expect(refresh).toHaveBeenCalledWith(undefined);
  });

  it("never prompts in a viewer window and discovers every backend", async () => {
    __seed("backends.json", JSON.stringify([{ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true }]));
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    const refresh = vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue();
    await bootstrap();
    expect(runStartupPrompt).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(["g"]);
  });

  it("still loads everything else when workspace.json is unusable", async () => {
    __seed("workspace.json", "not json");
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    await bootstrap();
    expect(useWorkspaceStore.getState().connections).toEqual([]);
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Zeta"]);
  });

  it("a settings server whose key is refused at launch leaves the notice, keeps settings local and uploads nothing (ruling R3)", async () => {
    const real = await vi.importActual<typeof import("../components/runWorkspaceSync")>("../components/runWorkspaceSync");
    vi.mocked(runStartupPrompt).mockImplementationOnce(real.runStartupPrompt);
    __seed("workspace.json", JSON.stringify({ connections: [{ ...ws, askOnStartup: false }], usernames: {} }));
    __seed("settings.json", JSON.stringify({ settingsStorage: "ws1" }));
    // The probe is the network seam: the server answers a refused key.
    useWorkspaceStore.setState({ probe: vi.fn(async () => "key-refused" as const) });
    vi.mocked(fetch).mockClear();
    await bootstrap();
    await vi.waitFor(() => expect(useWorkspaceStore.getState().notices.ws1).toBe("Key refused by Work; fix the key in Connections."));
    expect(useWorkspaceStore.getState().sessions).toEqual({});
    expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1");
    expect(JSON.parse(__read("settings.json") ?? "{}").settingsStorage).toBe("ws1");
    expect(vi.mocked(fetch).mock.calls.filter(([, o]) => o?.method === "POST")).toEqual([]);
  });
});
