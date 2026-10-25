// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fresh-install seeded backend (localhost:6900) makes the fire-and-forget
// discovery attempt a fetch. Rejecting it deterministically keeps this file
// hermetic, exactly as App.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
}));

// The launch screen (spec 2026-10-12 §5): what the monitor read returns is
// the test's to set; pickLaunchWorkspace stays real.
const launch = vi.hoisted(() => ({ screen: null as unknown }));
vi.mock("./screenFit", async (orig) => ({
  ...(await orig<object>()),
  readLaunchScreen: vi.fn(() => (typeof launch.screen === "function" ? (launch.screen as () => unknown)() : Promise.resolve(launch.screen))),
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
import { useProviderKeysStore } from "../stores/providerKeysStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { startDashboardAutoUpload } from "../components/runDashboardSync";
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { bootstrap } from "./bootstrap";
import { widget } from "../test/fixtures";

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
  useWorkspacesStore.setState({ workspaces: [], activeWorkspaceId: null, previousWorkspaceId: null });
  launch.screen = null;
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

  it("refreshes the provider keys once, after discovery, without waiting for it", async () => {
    // The store needs discovery to have run: it reads the widget registry to
    // decide whether a key-maint backend can answer instead of the vendors.
    const order: string[] = [];
    vi.spyOn(useBackendsStore.getState(), "refresh").mockImplementation(async () => {
      order.push("discovery");
    });
    let probesDone = false;
    let releaseProbes = () => {};
    const keysRefresh = vi
      .spyOn(useProviderKeysStore.getState(), "refresh")
      .mockImplementation(() => {
        order.push("keys");
        return new Promise<void>((resolve) => {
          releaseProbes = () => {
            probesDone = true;
            resolve();
          };
        });
      });

    await bootstrap();
    // Let the chain hanging off discovery run.
    await Promise.resolve();
    await Promise.resolve();

    expect(keysRefresh).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["discovery", "keys"]);
    // The point of not awaiting it: bootstrap is done while the vendor
    // probes — which are slow, real, rate-limited calls — are still running.
    expect(probesDone).toBe(false);
    releaseProbes();
  });

  it("refreshes provider keys again when a key-maint backend is discovered after startup", async () => {
    // A backend flagged Ask for credentials on startup, or one added in
    // Connections, is discovered after bootstrap's own refresh has run; its
    // key-maint widget must still colour the Library. key-maint answers for
    // every vendor server-side, so this is one request, not a fan-out.
    useWidgetRegistryStore.setState({ widgets: [] });
    vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue(undefined);
    const keysRefresh = vi.spyOn(useProviderKeysStore.getState(), "refresh").mockResolvedValue(undefined);

    await bootstrap();
    await Promise.resolve();
    await Promise.resolve();
    expect(keysRefresh).toHaveBeenCalledTimes(1);

    // Another backend's widgets: no key-maint, no new refresh.
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "w1", backendId: "b1" })] });
    expect(keysRefresh).toHaveBeenCalledTimes(1);

    const keys = widget({ id: "keys", backendId: "km", type: "keys" });
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "w1", backendId: "b1" }), keys] });
    expect(keysRefresh).toHaveBeenCalledTimes(2);
    // The same key-maint still present on a later registry change: no repeat.
    useWidgetRegistryStore.setState({ widgets: [keys] });
    expect(keysRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not watch for key-maint in a viewer window", async () => {
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    useWidgetRegistryStore.setState({ widgets: [] });
    vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue(undefined);
    const keysRefresh = vi.spyOn(useProviderKeysStore.getState(), "refresh").mockResolvedValue(undefined);

    await bootstrap();
    await Promise.resolve();
    await Promise.resolve();
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "keys", backendId: "km", type: "keys" })] });
    expect(keysRefresh).not.toHaveBeenCalled();
  });

  it("does not fan out to the vendors in a viewer window", async () => {
    // The viewer is a second window running the same bundle: without this it
    // would repeat the main window's whole vendor probe fan-out, doubling
    // every rate-limited call, and it shows no Library to colour anyway.
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    const discovery = vi
      .spyOn(useBackendsStore.getState(), "refresh")
      .mockResolvedValue(undefined);
    const keysRefresh = vi
      .spyOn(useProviderKeysStore.getState(), "refresh")
      .mockResolvedValue(undefined);

    await bootstrap();
    await Promise.resolve();
    await Promise.resolve();

    expect(keysRefresh).not.toHaveBeenCalled();
    // Discovery still runs: the viewer renders cards, and a card cannot be
    // rendered without the widget registry discovery populates.
    expect(discovery).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing provider-key refresh instead of leaving it unhandled", async () => {
    // Asserts the .catch itself: bootstrap resolves either way (the caller
    // voids the chain), so the only observable difference between having the
    // catch and not having it is the unhandled rejection.
    vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue(undefined);
    vi.spyOn(useProviderKeysStore.getState(), "refresh").mockRejectedValue(
      new Error("every vendor is down"),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(bootstrap()).resolves.toEqual([]);
      // A macrotask: node decides a rejection is unhandled only once the
      // microtask queue that could still attach a handler has drained.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });

  it("resolves with no labels when every loader succeeded", async () => {
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));

    await expect(bootstrap()).resolves.toEqual([]);
  });

  it("names the loader that failed, and loads the rest anyway", async () => {
    __failPath("settings.json");
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));

    // The label is what the startup banner prints; the log line is unchanged
    // and additive to it.
    await expect(bootstrap()).resolves.toEqual(["settings"]);
    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load settings");
    expect(useDashboardStore.getState().dashboards).toHaveLength(1);
  });

  it("does not call a quarantined file a startup failure, because the load succeeded", async () => {
    // A CORRUPT settings.json is not an unreadable one: loadJson parses it,
    // fails, renames it to .corrupt and reseeds the defaults, so the loader
    // resolves and there is nothing for a banner to report. The lost settings
    // are reported by the quarantine's own log line. (This is why the e2e
    // seeds an unreadable file rather than a bare "[".)
    __seed("settings.json", "[");
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));

    await expect(bootstrap()).resolves.toEqual([]);
    expect(__read("logs/bdobb.log") ?? "").toContain("quarantined settings.json");
  });

  it("names every loader that failed, in load order rather than in the order they settle", async () => {
    // Backends is declared first and settles LAST here, so an implementation
    // that pushed labels as the rejections arrived would return them the
    // other way round.
    vi.spyOn(useBackendsStore.getState(), "load").mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error("backends.json is unreadable")), 0);
        }),
    );
    vi.spyOn(useFoldersStore.getState(), "load").mockRejectedValue(
      new Error("folders.json is unreadable"),
    );

    await expect(bootstrap()).resolves.toEqual(["backends", "folders"]);
  });

  it("does not name the provider-key refresh, which is fired and never awaited", async () => {
    // It is `void`-ed on purpose (the vendor probes are slow, rate-limited
    // calls), so its failure is not a startup failure and must not reach the
    // banner -- the Library's own grey badges are what report it.
    vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue(undefined);
    vi.spyOn(useProviderKeysStore.getState(), "refresh").mockRejectedValue(
      new Error("every vendor is down"),
    );

    await expect(bootstrap()).resolves.toEqual([]);
  });

  it("names the app itself when the failure is outside every loader", async () => {
    // The outer catch's own case. It has always written a log line; without a
    // label it wrote nothing to the SCREEN, and an empty list is exactly what
    // a clean boot returns -- so the worst startup this function has would
    // have rendered as "everything loaded".
    vi.spyOn(useWidgetRegistryStore.getState(), "seedBuiltins").mockImplementation(() => {
      throw new Error("the widget registry is unusable");
    });

    await expect(bootstrap()).resolves.toEqual(["the app itself"]);
    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load app state");
  });

  it("keeps the labels it already had when it dies after the loaders", async () => {
    // `failed` is filled before the first step that can throw past the
    // loaders, so a later collapse names both the loader that failed and the
    // step that took the rest down -- not one or the other.
    window.history.replaceState({}, "", "/?viewer=nope");
    __failPath("settings.json");
    vi.spyOn(useDashboardStore.getState(), "setActive").mockImplementation(() => {
      throw new Error("no such dashboard");
    });

    await expect(bootstrap()).resolves.toEqual(["settings", "the app itself"]);
  });

  it("logs a failed load instead of rejecting", async () => {
    __failPath("dashboards");

    // The dashboards loader's own catch, not the outer one -- so the line
    // names that loader, and a label comes back as well.
    await expect(bootstrap()).resolves.toEqual(["dashboards"]);

    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load dashboards");
  });

  it("names chat when chat.json is unreadable", async () => {
    __failPath("chat.json");
    await expect(bootstrap()).resolves.toEqual(["chat"]);
    expect(__read("logs/bdobb.log") ?? "").toContain("failed to load chat");
  });

  it("names the loader that failed in its own log line, not the three together", async () => {
    // The log is what a user sends in, and the three parallel loaders used to
    // share the outer catch's wording verbatim -- so a line could not say
    // WHICH of backends/dashboards/folders was unreadable, only that one was.
    // The banner already names them on screen; this is the same fact in the
    // one place a user can hand over.
    vi.spyOn(useBackendsStore.getState(), "load").mockRejectedValue(
      new Error("backends.json is unreadable"),
    );
    vi.spyOn(useFoldersStore.getState(), "load").mockRejectedValue(
      new Error("folders.json is unreadable"),
    );

    await expect(bootstrap()).resolves.toEqual(["backends", "folders"]);

    const log = __read("logs/bdobb.log") ?? "";
    expect(log).toContain("failed to load backends: Error: backends.json is unreadable");
    expect(log).toContain("failed to load folders: Error: folders.json is unreadable");
    // ...and the loaders no longer borrow the outer catch's wording, which
    // now belongs to that catch alone.
    expect(log).not.toContain("failed to load app state");
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

describe("the launch workspace (spec 2026-10-12 §5)", () => {
  const workspaceFile = (id: string, name: string, min?: [number, number], launchMark = true) =>
    JSON.stringify({
      id,
      name,
      preset: "full-screen",
      slots: [],
      ...(min ? { minResolution: { width: min[0], height: min[1] } } : {}),
      ...(launchMark ? { openAtLaunch: true } : {}),
    });

  beforeEach(() => {
    __seed("workspaces/big.json", workspaceFile("big", "Big", [3840, 2160]));
    __seed("workspaces/small.json", workspaceFile("small", "Small", [1920, 1080]));
  });

  it("opens the 4K workspace on a 4K screen at 100%", async () => {
    launch.screen = { width: 3840, height: 2160, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("big");
  });

  it("opens the 1080p workspace on a 4K panel at 200%, which is 1920×1080 logical", async () => {
    launch.screen = { width: 1920, height: 1080, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("small");
    expect(__read("logs/bdobb.log") ?? "").toContain('launch screen 1920×1080 logical (monitor) → workspace "Small"');
  });

  it("opens the largest that fits on a screen between them", async () => {
    launch.screen = { width: 2560, height: 1440, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("small");
  });

  it("stays in single-dashboard mode when nothing marked fits", async () => {
    launch.screen = { width: 1366, height: 768, source: "screen" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
    expect(__read("logs/bdobb.log") ?? "").toContain("launch screen 1366×768 logical (screen) → no workspace fits");
  });

  it("ignores workspaces not marked to open at launch", async () => {
    __seed("workspaces/big.json", workspaceFile("big", "Big", [3840, 2160], false));
    launch.screen = { width: 3840, height: 2160, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("small");
  });

  it("stays in single-dashboard mode when the screen cannot be read", async () => {
    launch.screen = null;
    expect(await bootstrap()).toEqual([]);
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
  });

  it("never opens one in a viewer window", async () => {
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    launch.screen = { width: 3840, height: 2160, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
  });

  it("logs a failed read and boots without a banner label", async () => {
    launch.screen = () => Promise.reject(new Error("boom"));
    expect(await bootstrap()).toEqual([]);
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
    expect(__read("logs/bdobb.log") ?? "").toContain("failed to choose the launch workspace");
  });

  it("gives a full tie to the first in rail order", async () => {
    __seed("workspaces/small.json", workspaceFile("small", "Small", [3840, 2160]));
    __seed("settings.json", JSON.stringify({ workspaceOrder: ["small", "big"] }));
    launch.screen = { width: 3840, height: 2160, source: "monitor" };
    await bootstrap();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("small");
  });
});
