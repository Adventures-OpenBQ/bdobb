// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fresh-install seeded backend (localhost:6900) makes mount-time
// discovery attempt a fetch. Rejecting it deterministically keeps this test
// hermetic — it must never depend on anything actually listening on that
// port — while still exercising the same catch/offline path a real
// unreachable backend would take.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
}));

import App from "./App";
import { __resetLoggerForTests } from "./lib/logger";
import { __resetJsonStoreForTests } from "./lib/jsonStore";
import { DEFAULT_SETTINGS } from "./lib/settingsFile";
import { __failPath, __list, __read, __reset, __seed } from "./test/memfs";
import { useBackendsStore } from "./stores/backendsStore";
import { useDashboardStore } from "./stores/dashboardStore";
import { useProviderKeysStore } from "./stores/providerKeysStore";
import { useSettingsStore } from "./stores/settingsStore";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useBackendsStore.setState({ backends: [], statuses: {} });
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.fontSize;
  // jsdom keeps one documentElement for the whole file, so an inline custom
  // property set by a previous test would otherwise be read as this one's.
  document.documentElement.style.removeProperty("--rail-width");
});

describe("App", () => {
  it("renders the application shell", async () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();

    // Wait for the seeded backend's mount-time discovery (mocked fetch,
    // rejected) to settle, so the test doesn't leave a dangling async chain
    // that resolves after the next test's beforeEach has already reset state.
    await waitFor(() => {
      const statuses = Object.values(useBackendsStore.getState().statuses);
      expect(statuses).toEqual(["offline"]);
    });
  });

  it("does not fan out to vendor probes at startup, because providerKeysStore has no consumer yet", async () => {
    const refresh = vi.spyOn(useProviderKeysStore.getState(), "refresh");

    render(<App />);

    // Wait for the same settle point as the shell test above, so a call
    // fired asynchronously after discovery would have had time to land.
    await waitFor(() => {
      const statuses = Object.values(useBackendsStore.getState().statuses);
      expect(statuses).toEqual(["offline"]);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("logs a failed bootstrap load instead of letting it escape unhandled", async () => {
    // A settings-load failure is now caught locally in the bootstrap effect
    // (so backends/dashboards can still load independently of it — see
    // App.tsx), so it can no longer stand in for "some outright-catastrophic
    // bootstrap failure escapes to the outer catch". Fail the dashboards
    // directory listing instead: loadJsonDir's exists() check on "dashboards"
    // rejects, which is not locally caught, so it still reaches App's outer
    // catch/log.
    __failPath("dashboards");

    render(<App />);

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to load app state");
    });
  });

  it("logs a failed settings load but still loads backends and dashboards", async () => {
    // App.tsx catches a settings-load failure locally (`.load().catch(...)`)
    // so it no longer blocks backends/dashboards from loading — this proves
    // both halves: the failure is logged, and the dashboard still shows up.
    __failPath("settings.json");
    __seed(
      "dashboards/z.json",
      JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }),
    );

    render(<App />);

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("failed to load settings");
      expect(screen.getByText("Zeta")).toBeInTheDocument();
    });
  });

  it("reflects the loaded theme and font size as data attributes on the document root", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light", fontSize: "large" }));

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.dataset.fontSize).toBe("large");
    });
  });

  it("applies the loaded rail width as the --rail-width custom property", async () => {
    __seed("settings.json", JSON.stringify({ railWidth: 80 }));

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--rail-width")).toBe("80px");
    });
  });

  it("re-applies --rail-width when the setting is saved", async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--rail-width")).toBe("48px");
    });

    await useSettingsStore.getState().save({ railWidth: 96 });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--rail-width")).toBe("96px");
    });
  });

  it("publishes the dashboard area's content top as --dashboard-top, with no ResizeObserver", async () => {
    // jsdom implements neither layout nor ResizeObserver: every rect it can
    // report is 0, and the guard is what keeps the effect from throwing on
    // the missing constructor. This is the gate for that guard -- the real
    // measurement is e2e's (the maximized card's top edge).
    expect(globalThis.ResizeObserver).toBeUndefined();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("main").style.getPropertyValue("--dashboard-top")).toBe("0px");
    });
  });

  it("leaves the first --dashboard-top measurement to the ResizeObserver", async () => {
    // Order, not just outcome. A synchronous measure() here reads
    // getBoundingClientRect(), and that forced flush lands BETWEEN
    // react-grid-layout's pre-mount render (left/top) and its mounted one
    // (transform), turning the switch into a transition that slides every
    // card in from the grid's corner. An observer reports its first
    // observation on its own, so nothing is lost by waiting for it.
    const observed: Element[] = [];
    let notify: (() => void) | null = null;
    class RecordingResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;
    try {
      render(<App />);

      await waitFor(() => expect(observed).toHaveLength(1));
      const main = screen.getByRole("main");
      // Nothing published yet: the effect has run and observed, and has NOT
      // measured.
      expect(main.style.getPropertyValue("--dashboard-top")).toBe("");

      notify!();

      expect(main.style.getPropertyValue("--dashboard-top")).toBe("0px");
    } finally {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  it("loads dashboards in the order recorded in settings", async () => {
    __seed(
      "dashboards/z.json",
      JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }),
    );
    __seed(
      "dashboards/a.json",
      JSON.stringify({ id: "a", name: "Alpha", tabs: [{ id: "t2", name: "Main", cards: [] }] }),
    );

    __seed(
      "settings.json",
      JSON.stringify({ ...DEFAULT_SETTINGS, dashboardOrder: ["z", "a"] }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Zeta")).toBeInTheDocument();
    });
    const labels = screen.getAllByText(/Zeta|Alpha/).map((el) => el.textContent);
    expect(labels.indexOf("Zeta")).toBeLessThan(labels.indexOf("Alpha"));
  });

  describe("viewer mode", () => {
    beforeEach(() => {
      useDashboardStore.setState({ viewer: false, dashboards: [], activeId: null, activeTabId: null });
    });

    afterEach(() => {
      // jsdom keeps one document across the file, so the query string has to
      // be put back or every later test would boot as a viewer.
      window.history.replaceState({}, "", "/");
      useDashboardStore.setState({ viewer: false });
    });

    function seedTwo() {
      __seed(
        "dashboards/a.json",
        JSON.stringify({ id: "a", name: "Alpha", tabs: [{ id: "ta", name: "Main", cards: [] }] }),
      );
      __seed(
        "dashboards/z.json",
        JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "tz", name: "Main", cards: [] }] }),
      );
    }

    it("renders only the named dashboard, with no rail", async () => {
      seedTwo();
      window.history.replaceState({}, "", "/?viewer=z");

      render(<App />);

      await waitFor(() => {
        expect(useDashboardStore.getState().activeId).toBe("z");
      });
      expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveClass("dashboard-area-viewer");
    });

    it("sets the store's viewer flag, and writes nothing to the dashboard it shows", async () => {
      seedTwo();
      const before = __read("dashboards/z.json");
      window.history.replaceState({}, "", "/?viewer=z");

      render(<App />);

      // Set in the effect body, ahead of the async IIFE that loads — so the
      // guard is already in place by the time anything could write.
      await waitFor(() => expect(useDashboardStore.getState().viewer).toBe(true));
      await waitFor(() => {
        const statuses = Object.values(useBackendsStore.getState().statuses);
        expect(statuses).toEqual(["offline"]);
      });
      expect(__read("dashboards/z.json")).toBe(before);
      // Nothing new either: no second dashboard file appeared.
      expect(__list().filter((f) => f.startsWith("dashboards/")).sort()).toEqual([
        "dashboards/a.json",
        "dashboards/z.json",
      ]);
    });

    it("leaves the main window untouched", async () => {
      seedTwo();

      render(<App />);

      await waitFor(() => expect(useDashboardStore.getState().viewer).toBe(false));
      expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
      expect(screen.getByRole("main")).not.toHaveClass("dashboard-area-viewer");
    });
  });
});
