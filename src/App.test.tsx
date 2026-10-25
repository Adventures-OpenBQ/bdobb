// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fresh-install seeded backend (localhost:6900) makes mount-time
// discovery attempt a fetch. Rejecting it deterministically keeps this test
// hermetic — it must never depend on anything actually listening on that
// port — while still exercising the same catch/offline path a real
// unreachable backend would take.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
}));

// The native window's appearance, which the theme effect sets alongside the
// document's data-theme so the title bar matches. jsdom has no Tauri
// runtime, so the real getCurrentWindow() would throw reading
// __TAURI_INTERNALS__; vi.hoisted is required because vi.mock factories are
// hoisted above this file's top-level code. `host.missing` stands in for a
// plain browser, where getCurrentWindow() itself throws synchronously.
const { setTheme, host } = vi.hoisted(() => ({ setTheme: vi.fn(), host: { missing: false } }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (host.missing) throw new TypeError("__TAURI_INTERNALS__ is undefined");
    return { setTheme };
  },
}));

// App starts agents.json discovery for the Rita URL itself (final review I1).
// Never answering keeps a test that sets a Rita URL off the real network.
const { fetchAgentsJson } = vi.hoisted(() => ({ fetchAgentsJson: vi.fn() }));
vi.mock("./lib/agent/agents-json", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/agent/agents-json")>()),
  fetchAgentsJson: (...a: unknown[]) => fetchAgentsJson(...a),
}));

// vi.hoisted is required: vi.mock factories are hoisted above normal
// top-level code, so a plain const here would be referenced before
// initialization. The spy proves the lazily-loaded HelpDialog's module graph
// -- 47 eager `import.meta.glob` loads of topics and screenshots -- is not
// evaluated at App's initial render, only once the dialog actually opens.
const { helpIndexLoaded } = vi.hoisted(() => ({ helpIndexLoaded: vi.fn() }));
vi.mock("./help/index", async (importOriginal) => {
  helpIndexLoaded();
  return importOriginal();
});

// A pass-through spy, not a stub (donor 5a99e719): the real library still
// renders, and the wrapper records the `target` App handed it -- the only
// place ⌘K's choice of dashboard/tab is observable from outside App.
const { libraryTarget } = vi.hoisted(() => ({
  libraryTarget: { current: null as { dashboardId: string | null; tabId: string | null } | null },
}));
vi.mock("./components/WidgetLibrary", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./components/WidgetLibrary")>();
  const Real = mod.WidgetLibrary;
  return {
    ...mod,
    WidgetLibrary: (props: Parameters<typeof Real>[0]) => {
      libraryTarget.current = props.target;
      return <Real {...props} />;
    },
  };
});

import App, { HelpLoadFailed } from "./App";
import type { App as AppManifest } from "./lib/appsJson";
import { UNRESOLVED_BACKEND_ID } from "./lib/appsJson";
import type { Dashboard } from "./lib/types";
import { __resetLoggerForTests } from "./lib/logger";
import { __resetJsonStoreForTests } from "./lib/jsonStore";
import { DEFAULT_SETTINGS } from "./lib/settingsFile";
import { DOCKS_ID, makeDefaultDocks } from "./lib/dashboardsFile";
import { stubMatchMedia } from "./test/matchMedia";
import { __failPath, __list, __read, __reset, __seed } from "./test/memfs";
import { __resetAgentDiscoveryForTests } from "./stores/agentDiscoveryStore";
import { useBackendsStore } from "./stores/backendsStore";
import { useDashboardStore } from "./stores/dashboardStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspacesStore } from "./stores/workspacesStore";
import { useFoldersStore } from "./stores/foldersStore";
import { useWidgetRegistryStore } from "./stores/widgetRegistryStore";
import { backend as makeBackend, widget as makeWidget } from "./test/fixtures";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useBackendsStore.setState({ backends: [], statuses: {} });
  useWidgetRegistryStore.setState({ apps: [] });
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.fontSize;
  // jsdom keeps one documentElement for the whole file, so an inline custom
  // property set by a previous test would otherwise be read as this one's.
  document.documentElement.style.removeProperty("--rail-width");
  setTheme.mockReset();
  setTheme.mockResolvedValue(undefined);
  __resetAgentDiscoveryForTests();
  fetchAgentsJson.mockReset();
  fetchAgentsJson.mockImplementation(() => new Promise(() => {}));
  host.missing = false;
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

  it("does not load the help bundle at startup, only once the dialog is opened", async () => {
    render(<App />);

    await waitFor(() => {
      const statuses = Object.values(useBackendsStore.getState().statuses);
      expect(statuses).toEqual(["offline"]);
    });
    expect(helpIndexLoaded).not.toHaveBeenCalled();

    // ⌘? (⌘⇧/) is the shortcut wired in useDashboardShortcuts; Shift is what
    // makes the "?" character, so both metaKey and shiftKey are required.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          code: "Slash",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // ⌘? opens the quick set, and each dialog is now labelled by the set it
    // shows rather than by the word "Help".
    expect(await screen.findByRole("dialog", { name: "Quick Help" }, { timeout: 10000 })).toBeInTheDocument();
    expect(helpIndexLoaded).toHaveBeenCalled();
  });

  it("shows a fallback notice instead of unmounting when the help chunk fails to load, and Close dismisses it", async () => {
    // A fresh module graph is required here: App.tsx builds `HelpDialog =
    // lazy(...)` once at module scope, and React.lazy calls that loader (and
    // permanently caches whatever it resolves to) only the first time the
    // component is rendered -- which the test above already did, successfully,
    // for the `App` this file imports at the top. Only a re-imported App,
    // built after the dynamic import is mocked to reject, exercises the
    // `.catch` fallback; reusing the top-level `App` would just show the real,
    // already-cached HelpDialog.
    vi.resetModules();
    vi.doMock("./components/dialogs/HelpDialog", () => {
      throw new Error("chunk load failed");
    });

    const { default: FreshApp } = await import("./App");

    render(<FreshApp />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          code: "Slash",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Help could not be loaded. Restart the app to try again.");
    // No error boundary unmounted the tree: the rest of the shell is still here.
    expect(screen.getByRole("main")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("logs a failed bootstrap load instead of letting it escape unhandled", async () => {
    // Every loader catches its own rejection now (see bootstrap.ts), so no
    // single unreadable file escapes to the outer catch any more -- and the
    // line it writes names the loader rather than the three of them
    // together, which is the whole point of logging it. Fail the dashboards
    // directory listing: loadJsonDir's exists() check on "dashboards"
    // rejects, and that loader's own catch is what writes the line.
    __failPath("dashboards");

    render(<App />);

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to load dashboards");
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

  it("names the loaders that failed, in a banner above the dashboard", async () => {
    __failPath("settings.json");
    __failPath("backends.json");
    __seed(
      "dashboards/z.json",
      JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }),
    );

    render(<App />);

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(
      "Failed to load on startup: settings, backends. The app is still usable, but some data may be missing until this is fixed and the app restarted.",
    );
    // Above the dashboard, not inside it: the grid is what the user came for
    // and the banner is what they have to read past to get to it.
    expect(screen.getByRole("main").firstElementChild).toBe(banner);
    // "still usable" is a claim this asserts rather than merely prints: the
    // dashboards that DID load are on screen behind it.
    expect(await screen.findByText("Zeta")).toBeInTheDocument();
  });

  it("shows no banner when every loader succeeded", async () => {
    __seed(
      "dashboards/z.json",
      JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }),
    );

    render(<App />);

    await screen.findByText("Zeta");
    expect(document.querySelector(".startup-error-banner")).toBeNull();
  });

  it("reflects the loaded theme and font size as data attributes on the document root", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light", fontSize: "large" }));

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.dataset.fontSize).toBe("large");
    });
  });

  // final review I1 / live check LC1: with the Rita pane closed (hover-only,
  // so ChatPane is not mounted) and the AI Library shut, nothing used to
  // discover agents.json, and a sendToAgent click sent workspace_options {}.
  it("discovers the Rita URL's agents.json at launch, with the chat pane closed", async () => {
    __seed("settings.json", JSON.stringify({ ritaUrl: "https://rita.example" }));

    render(<App />);

    await waitFor(() => expect(fetchAgentsJson).toHaveBeenCalledWith("https://rita.example"));
    expect(screen.queryByRole("textbox", { name: /message/i })).not.toBeInTheDocument();
  });

  it("resolves theme: system through the OS appearance, and follows it live", async () => {
    const media = stubMatchMedia(false);
    try {
      __seed("settings.json", JSON.stringify({ theme: "system" }));

      render(<App />);

      // "system" itself is never written to the DOM: the attribute carries
      // the RESOLVED value, which is what styles.css keys off.
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

      await act(async () => media.set(true));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    } finally {
      media.restore();
    }
  });

  it("sets the native window appearance from the RAW setting, so the title bar matches", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light" }));

    render(<App />);

    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("light"));
  });

  it("sets the native window appearance to dark for the dark setting", async () => {
    __seed("settings.json", JSON.stringify({ theme: "dark" }));

    render(<App />);

    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("dark"));
  });

  it("hands the window null under system, so the OS -- not the app -- drives it", async () => {
    const media = stubMatchMedia(true);
    try {
      __seed("settings.json", JSON.stringify({ theme: "system" }));

      render(<App />);

      // null, never the RESOLVED "dark": pinning the window to an explicit
      // appearance is exactly what stopped prefers-color-scheme from ever
      // changing, so "system" must leave the window unpinned.
      await waitFor(() => expect(setTheme).toHaveBeenLastCalledWith(null));
      // The RESOLVED value here is "dark" (the stub reports a dark OS), and
      // it is never what the window is left holding: `toHaveBeenCalledWith`
      // would also match the pre-load render, which legitimately sends the
      // default setting's own "dark" before settings.json has arrived.
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      media.restore();
    }
  });

  it("survives a window that refuses setTheme, without throwing or logging", async () => {
    setTheme.mockRejectedValue(new Error("window.set_theme not allowed"));
    __seed("settings.json", JSON.stringify({ theme: "dark" }));

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(setTheme).toHaveBeenCalledWith("dark");
    });
    // A viewer window without the permission is an expected case, not an
    // error worth reporting -- and an unhandled rejection would fail this
    // test outright.
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).not.toContain("set_theme");
  });

  it("mounts with no Tauri host at all, where getCurrentWindow() itself throws", async () => {
    // A plain browser -- what `pnpm smoke` runs. App's .catch covers only
    // a rejected setTheme; this is the synchronous throw before it, which
    // used to escape the effect and unmount the whole root.
    host.missing = true;
    __seed("settings.json", JSON.stringify({ theme: "dark" }));

    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.getByRole("main")).toBeInTheDocument();
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
      // Named explicitly, not just implied by "no rail": a viewer cannot
      // create a dashboard, which is the only thing opening an app does.
      expect(screen.queryByRole("button", { name: "Apps" })).not.toBeInTheDocument();
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

    it("names the loaders that failed in a banner here too", async () => {
      // The viewer is the same bundle rendering a DIFFERENT shell, so its
      // banner is a second call site with nothing but this test holding it in
      // place: a window whose settings never loaded looked identical to one
      // whose settings loaded fine.
      seedTwo();
      __failPath("settings.json");
      window.history.replaceState({}, "", "/?viewer=z");

      render(<App />);

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent(
        "Failed to load on startup: settings. The app is still usable, but some data may be missing until this is fixed and the app restarted.",
      );
      // Above the dashboard, as in the main window: the <main> the viewer's
      // DropZone renders is the same element.
      expect(screen.getByRole("main").firstElementChild).toBe(banner);
      // ...and "still usable" holds here too -- the dashboard the URL named
      // is the one on screen behind it.
      await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("z"));
    });

    it("leaves the main window untouched", async () => {
      seedTwo();

      render(<App />);

      await waitFor(() => expect(useDashboardStore.getState().viewer).toBe(false));
      expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apps" })).toBeInTheDocument();
      expect(screen.getByRole("main")).not.toHaveClass("dashboard-area-viewer");
    });
  });

  /**
   * Only reachable through a failed dynamic import, which nothing can provoke
   * from inside a render -- so it is rendered directly.
   */
  describe("HelpLoadFailed", () => {
    it("opens as a modal dialog, so it is not left behind an open Settings", async () => {
      render(<HelpLoadFailed onClose={vi.fn()} />);

      // showModal() (jsdom's stand-in, src/test/setup.ts) is what puts a
      // dialog in the UA's top layer -- above every z-index, which is the
      // whole reason this is a <dialog> and not a positioned <div>.
      const dialog = screen.getByRole("dialog", { name: "Help unavailable" });
      expect(dialog).toHaveAttribute("open");
      expect(screen.getByRole("alert")).toHaveTextContent("Help could not be loaded.");
    });

    it("closes through the caller's own handler", async () => {
      const onClose = vi.fn();
      render(<HelpLoadFailed onClose={onClose} />);

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("opening an app", () => {
    /**
     * One two-tab app whose only card names a widget nothing serves — the
     * unresolved sentinel is part of what Open has to preserve, so the
     * fixture carries it rather than a resolvable id.
     */
    function macro(over: Partial<AppManifest> = {}): AppManifest {
      return {
        name: "Macro",
        description: "",
        img: "",
        img_dark: "",
        img_light: "",
        allowCustomization: false,
        tabs: {
          t1: { id: "t1", name: "Overview", layout: [{ i: "not-served", x: 1, y: 2, w: 4, h: 3 }] },
          t2: { id: "t2", name: "Detail", layout: [] },
        },
        groups: [],
        prompts: [],
        ...over,
      };
    }

    /**
     * Mount, let the seeded backend's discovery settle (it fails — the fetch
     * mock rejects), and only THEN put the backend and its apps in the
     * stores: applyDiscovery replaces a live backend's apps, so seeding
     * before the settle would be overwritten by the very result being
     * waited for.
     */
    async function boot(app: AppManifest) {
      render(<App />);
      await waitFor(() => {
        expect(Object.values(useBackendsStore.getState().statuses)).toEqual(["offline"]);
      });
      useBackendsStore.setState({ backends: [makeBackend({ id: "b1", name: "Alpha" })] });
      useWidgetRegistryStore.setState({ apps: [{ backendId: "b1", app }] });
      await userEvent.click(screen.getByRole("button", { name: "Apps" }));
      await userEvent.click(screen.getByRole("button", { name: `Open ${app.name}` }));
    }

    /** The dashboard Open created: the one the app named, whatever it was renamed to. */
    function created(): Dashboard {
      const found = useDashboardStore.getState().dashboards.find((d) => d.name.startsWith("Macro"));
      if (!found) throw new Error("no dashboard was created");
      return found;
    }

    it("creates one dashboard from the app, makes it active, and closes the dialog", async () => {
      await boot(macro());

      await waitFor(() => expect(created().name).toBe("Macro"));
      const dashboard = created();
      // The app's tabs, in the app's order, and nothing else added.
      expect(dashboard.tabs.map((t) => t.name)).toEqual(["Overview", "Detail"]);
      expect(useDashboardStore.getState().activeId).toBe(dashboard.id);
      expect(useDashboardStore.getState().activeTabId).toBe(dashboard.tabs[0].id);
      expect(screen.queryByRole("dialog", { name: "Apps" })).not.toBeInTheDocument();
      // Written, not only held in memory.
      expect(__read(`dashboards/${dashboard.id}.json`)).toContain("Overview");
    });

    it("appends the new dashboard to the persisted order, at the root", async () => {
      await boot(macro());

      await waitFor(() => expect(created().name).toBe("Macro"));
      const ids = useDashboardStore.getState().dashboards.map((d) => d.id);
      expect(ids[ids.length - 1]).toBe(created().id);
      expect(useSettingsStore.getState().settings.dashboardOrder).toEqual(ids);
      // Root folder: Open places the dashboard nowhere, and a dashboard
      // absent from `placement` is top level.
      expect(useFoldersStore.getState().placement).toEqual({});
    });

    it("asks before keeping both dashboards when the name already exists", async () => {
      __seed(
        "dashboards/m.json",
        JSON.stringify({ id: "m", name: "Macro", tabs: [{ id: "tm", name: "Main", cards: [] }] }),
      );

      await boot(macro());
      await userEvent.click(within(await screen.findByRole("dialog", { name: 'A dashboard named "Macro" already exists' })).getByRole("button", { name: /^Keep both/ }));

      await waitFor(() => {
        expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual([
          "Macro",
          "Macro (2)",
        ]);
      });
    });

    it("keeps the unresolved sentinel on a card no connected backend serves", async () => {
      await boot(macro());

      await waitFor(() => expect(created().tabs[0].cards).toHaveLength(1));
      const card = created().tabs[0].cards[0];
      expect(card.widgetId).toBe("not-served");
      expect(card.backendId).toBe(UNRESOLVED_BACKEND_ID);
      // Size and column as the app declared them. `y` is deliberately not
      // asserted: the new dashboard is active, so react-grid-layout has
      // already mounted it and compacted the single card upwards — that is
      // the live grid's doing, not the import's.
      expect(card.layout.x).toBe(1);
      expect(card.layout.w).toBe(4);
      expect(card.layout.h).toBe(3);
    });

    // The dialog used to close before the work was attempted, so a failure
    // left nothing on screen at all: no dashboard, no message, and the one
    // surface that could have said so already gone.
    it("keeps the dialog open and reports the failure when the dashboard cannot be created", async () => {
      const importDashboards = useDashboardStore.getState().importDashboards;
      useDashboardStore.setState({
        importDashboards: vi.fn().mockRejectedValue(new Error("the disk is full")),
      });
      try {
        await boot(macro());

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Could not create the dashboard.");
        expect(alert).toHaveTextContent("the disk is full");
        expect(screen.getByRole("dialog", { name: "Apps" })).toBeInTheDocument();
        expect(
          useDashboardStore.getState().dashboards.filter((d) => d.name.startsWith("Macro")),
        ).toEqual([]);
      } finally {
        // Inside act: LeftRail selects `importDashboards` off the store, so
        // putting the real one back re-renders it.
        act(() => {
          useDashboardStore.setState({ importDashboards });
        });
      }
    });

    // The dashboard EXISTS at this point -- it is written, published and
    // active. Only its place in the flat order failed to persist, so keeping
    // the dialog up under "Could not create the dashboard" would have been a
    // lie about what happened, and would have invited a second Open that
    // created a duplicate.
    it("closes the dialog and keeps the dashboard when only the order fails to save", async () => {
      const save = useSettingsStore.getState().save;
      useSettingsStore.setState({ save: vi.fn().mockRejectedValue(new Error("the disk is full")) });
      try {
        await boot(macro());

        await waitFor(() => expect(created().name).toBe("Macro"));
        await waitFor(() => {
          expect(screen.queryByRole("dialog", { name: "Apps" })).not.toBeInTheDocument();
        });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        // The dashboard is real and on disk, whatever the order says.
        expect(__read(`dashboards/${created().id}.json`)).toContain("Overview");

        await waitFor(() => {
          const log = __read("logs/bdobb.log") ?? "";
          expect(log).toContain("The dashboard was created but its position could not be saved.");
          expect(log).toContain("the disk is full");
          // Not the creation failure's wording: the two are different
          // outcomes and must not be triaged as the same one.
          expect(log).not.toContain("Could not create the dashboard.");
        });
      } finally {
        act(() => {
          useSettingsStore.setState({ save });
        });
      }
    });

    // final review T7: the Apps-dialog wiring was verified by reading only.
    const docs = { name: "Docs", description: "OpenBB docs", url: "https://docs.example/mcp", authType: "token" };

    it("adds the app's MCP servers switched off, remembering the backend they came from", async () => {
      await boot(macro({ mcp_servers: [docs] } as Partial<AppManifest>));

      await waitFor(() => {
        expect(useSettingsStore.getState().settings.mcpServers).toEqual([
          expect.objectContaining({
            url: "https://docs.example/mcp",
            name: "Docs",
            authType: "token",
            enabled: false,
            source: { kind: "backend", backendId: "b1" },
          }),
        ]);
      });
    });

    // final review M3: the MCP-server save ran outside any try, so its
    // failure left the dialog open over a dashboard that already existed.
    it("closes the dialog and keeps the dashboard when only the MCP servers fail to save", async () => {
      const save = useSettingsStore.getState().save;
      useSettingsStore.setState({ save: vi.fn().mockRejectedValue(new Error("the disk is full")) });
      try {
        await boot(macro({ mcp_servers: [docs] } as Partial<AppManifest>));

        await waitFor(() => expect(created().name).toBe("Macro"));
        await waitFor(() => {
          expect(screen.queryByRole("dialog", { name: "Apps" })).not.toBeInTheDocument();
        });
        await waitFor(() => {
          expect(__read("logs/bdobb.log") ?? "").toContain("its MCP servers could not be saved");
        });
      } finally {
        act(() => {
          useSettingsStore.setState({ save });
        });
      }
    });

    // Open stays clickable while the dashboard is being written, so a
    // double-click used to run the import twice: two dashboards, "Macro" and
    // "Macro (2)", from one intent.
    it("ignores a second Open while the first is still creating the dashboard", async () => {
      const importDashboards = useDashboardStore.getState().importDashboards;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = vi.fn(async (dashboards: Dashboard[]) => {
        await gate;
        return importDashboards(dashboards);
      });
      useDashboardStore.setState({ importDashboards: slow });
      try {
        await boot(macro());
        await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));

        expect(slow).toHaveBeenCalledTimes(1);
        release();
        await waitFor(() => expect(created().name).toBe("Macro"));
        expect(
          useDashboardStore.getState().dashboards.filter((d) => d.name.startsWith("Macro")),
        ).toHaveLength(1);
      } finally {
        release();
        act(() => {
          useDashboardStore.setState({ importDashboards });
        });
      }
    });

    it("opens a second copy when the same app is opened again", async () => {
      await boot(macro());
      await waitFor(() => expect(created().name).toBe("Macro"));

      await userEvent.click(screen.getByRole("button", { name: "Apps" }));
      await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));
      await userEvent.click(within(await screen.findByRole("dialog", { name: 'A dashboard named "Macro" already exists' })).getByRole("button", { name: /^Keep both/ }));

      await waitFor(() => {
        const names = useDashboardStore.getState().dashboards.map((d) => d.name);
        expect(names.filter((n) => n.startsWith("Macro"))).toEqual(["Macro", "Macro (2)"]);
      });
    });
  });
});
it('restores the first workspace dashboard tab before focusing its panel', async () => {
  const files = {
    'backends.json': '[]',
    'dashboards/alpha.json': JSON.stringify({id:'alpha',name:'Alpha',tabs:[{id:'ta1',name:'One',cards:[]},{id:'ta2',name:'Two',cards:[]}]}),
    'dashboards/beta.json': JSON.stringify({id:'beta',name:'Beta',tabs:[{id:'tb',name:'One',cards:[]}]}),
    'workspaces/w.json': JSON.stringify({id:'w',name:'Saved',preset:'laptop',slots:[{slot:'a',dashboardId:'alpha'},{slot:'b',dashboardId:'beta'}],activeTabIds:{alpha:'ta2',beta:'tb'}}),
  };
  Object.entries(files).forEach(([path, content]) => __seed(path, content));
  render(<App/>);
  await waitFor(() => expect(useDashboardStore.getState().dashboards.map((dashboard) => dashboard.id).sort()).toEqual(['alpha', 'beta']));
  await useWorkspacesStore.getState().load();
  act(() => useWorkspacesStore.setState({ workspaces: [JSON.parse(files['workspaces/w.json'])], activeWorkspaceId: null, focusedSlot: null }));
  act(() => { useDashboardStore.getState().setActive('beta'); });
  act(() => { useWorkspacesStore.getState().setActiveWorkspace('w'); });
  await waitFor(() => expect(useDashboardStore.getState().activeId).toBe('alpha'));
  expect(useDashboardStore.getState().activeTabIds.alpha).toBe('ta2');
});

it("Add widget lands on the shown tab when the active dashboard's selected-tab entry is stale", async () => {
  __seed("backends.json", "[]");
  __seed("dashboards/a.json", JSON.stringify({ id: "a", name: "A", tabs: [{ id: "a1", name: "Main", cards: [] }] }));
  render(<App />);
  await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("a"));
  act(() => {
    useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: "probe", name: "Probe" })] });
    useDashboardStore.setState({ activeTabIds: { a: "gone" } });
  });
  await userEvent.click(screen.getByRole("button", { name: "Widget Library" }));
  await userEvent.click(await screen.findByRole("button", { name: "Add Probe" }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards.map((c) => c.widgetId)).toEqual(["probe"]));
});

// v8 locked widgets (donor 5a99e719, d76d2ec6, 1fe4ecc0, df8781dc).
describe("App: locked widget bands", () => {
  // An earlier test in this file leaves a workspace active; these are about
  // single-dashboard mode, where the tab bar is the area's.
  beforeEach(() => {
    useWorkspacesStore.setState({ activeWorkspaceId: null });
  });
  afterEach(() => {
    act(() => {
      useDashboardStore.setState({ docks: makeDefaultDocks(), dockEdit: null });
    });
    libraryTarget.current = null;
  });

  const docksFile = (top: unknown[], bottom: unknown[]) =>
    JSON.stringify({
      id: DOCKS_ID,
      name: "Locked widgets",
      hidden: true,
      tabs: [
        { id: "top", name: "Locked at Top", cards: top },
        { id: "bottom", name: "Locked at Bottom", cards: bottom },
      ],
    });
  const lockedCard = (id: string) => ({ id, widgetId: "w", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 4 } });

  /** A dashboard to look at, plus a docks file with one card at the bottom. */
  function seedDocked() {
    __seed("dashboards/z.json", JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }));
    __seed("dashboards/docks.json", docksFile([], [lockedCard("d1")]));
  }

  it("mounts the bottom band below the grid's scroll region, and no empty top band; the rail never lists the docks", async () => {
    seedDocked();
    render(<App />);
    const band = await screen.findByRole("region", { name: "Locked at Bottom" });
    expect(document.querySelector(".dock-band-top")).toBeNull();
    const main = screen.getByRole("main");
    await waitFor(() => expect(main.querySelector(".dashboard-scroll")).not.toBeNull());
    const kids = [...main.children];
    const scroll = main.querySelector(".dashboard-scroll");
    expect(scroll).not.toBeNull();
    expect(kids.indexOf(band)).toBeGreaterThan(kids.indexOf(scroll as Element));
    expect(kids.at(-1)).toBe(band);
    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["z"]);
  });

  it("keeps the same band mounted across a dashboard switch", async () => {
    seedDocked();
    __seed("dashboards/y.json", JSON.stringify({ id: "y", name: "Ypsilon", tabs: [{ id: "t2", name: "Main", cards: [] }] }));
    render(<App />);
    const band = await screen.findByRole("region", { name: "Locked at Bottom" });
    const other = useDashboardStore.getState().activeId === "z" ? "y" : "z";
    act(() => useDashboardStore.getState().setActive(other));
    expect(useDashboardStore.getState().activeId).toBe(other);
    expect(screen.getByRole("region", { name: "Locked at Bottom" })).toBe(band);
  });

  it("measures --dashboard-top to the tab bar's bottom, below a mounted top band", async () => {
    // jsdom lays nothing out: stubbing the bar's rect is what makes the old
    // formula (area top + bar height, both 0 here) and the new one differ.
    __seed("dashboards/z.json", JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }));
    __seed("dashboards/docks.json", docksFile([lockedCard("d0")], []));
    render(<App />);
    const band = await screen.findByRole("region", { name: "Locked at Top" });
    const main = screen.getByRole("main");
    await waitFor(() => expect(main.querySelector(".tab-bar")).not.toBeNull());
    const bar = main.querySelector<HTMLElement>(".tab-bar");
    expect(bar).not.toBeNull();
    expect(band.compareDocumentPosition(bar as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    (bar as HTMLElement).getBoundingClientRect = () => ({ bottom: 132 }) as DOMRect;
    act(() => {
      useDashboardStore.setState((s) => ({ docks: { ...s.docks, dockRows: { top: 7, bottom: 8 } } }));
    });
    expect(main.style.getPropertyValue("--dashboard-top")).toBe("132px");
  });

  it("aims ⌘K at the dock being edited, and at the active dashboard otherwise", async () => {
    seedDocked();
    render(<App />);
    await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("z"));
    const cmdK = () =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true, cancelable: true }));
      });
    cmdK();
    expect(libraryTarget.current).toEqual({ dashboardId: "z", tabId: "t1" });
    act(() => {
      useDashboardStore.getState().beginDockEdit("bottom");
    });
    cmdK();
    expect(libraryTarget.current).toEqual({ dashboardId: DOCKS_ID, tabId: "bottom" });
  });

  it("marks the shell dock-editing while the editor is open, and Cancel reopens Settings on Locked Widgets", async () => {
    seedDocked();
    const { container } = render(<App />);
    await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("z"));
    const shell = container.querySelector(".app-shell");
    expect(shell).not.toHaveClass("dock-editing");
    act(() => {
      useDashboardStore.getState().beginDockEdit("bottom");
    });
    expect(shell).toHaveClass("dock-editing");
    expect(screen.getByRole("dialog", { name: "Editing Locked at Bottom" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument());
    expect(shell).not.toHaveClass("dock-editing");
    expect(screen.getByRole("tab", { name: "Locked Widgets" })).toHaveAttribute("aria-selected", "true");
  });
});
