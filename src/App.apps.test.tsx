// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Apps integration scenarios adapted from maintained v4.0.5, assigned to fresh v3 parity.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn().mockRejectedValue(new Error("no network in tests")) }));
import App from "./App";
import type { App as AppManifest } from "./lib/appsJson";
import { UNRESOLVED_BACKEND_ID } from "./lib/appsJson";
import type { Dashboard } from "./lib/types";
import { __resetLoggerForTests } from "./lib/logger";
import { __resetJsonStoreForTests } from "./lib/jsonStore";
import { __failPath, __list, __read, __reset, __seed } from "./test/memfs";
import { useBackendsStore } from "./stores/backendsStore";
import { useDashboardStore } from "./stores/dashboardStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useFoldersStore } from "./stores/foldersStore";
import { useWorkspacesStore } from "./stores/workspacesStore";
import { useWidgetRegistryStore } from "./stores/widgetRegistryStore";
import { backend as makeBackend } from "./test/fixtures";
beforeEach(() => { __reset(); __resetLoggerForTests(); __resetJsonStoreForTests(); useBackendsStore.setState({backends: [], statuses: {}}); useWidgetRegistryStore.setState({apps: []}); });
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

    /** An existing "Macro" (one tab, "Main"), loaded at boot like any saved dashboard. */
    function seedMacro() {
      __seed(
        "dashboards/m.json",
        JSON.stringify({ id: "m", name: "Macro", tabs: [{ id: "tm", name: "Main", cards: [] }] }),
      );
    }

    const conflictDialog = () =>
      screen.findByRole("dialog", { name: 'A dashboard named "Macro" already exists' });

    // v4.0.5: a taken name asks, through the same dialog the rail's Import
    // and a dropped file use, instead of silently opening a renamed copy.
    it("asks when the app's name is taken, and Keep both opens it as a renamed copy", async () => {
      seedMacro();

      await boot(macro());

      const dialog = await conflictDialog();
      // Nothing is written while the question is open.
      expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Macro"]);
      await userEvent.click(within(dialog).getByRole("button", { name: /^Keep both/ }));

      await waitFor(() => {
        expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual([
          "Macro",
          "Macro (2)",
        ]);
      });
      const copy = useDashboardStore.getState().dashboards[1];
      expect(useDashboardStore.getState().activeId).toBe(copy.id);
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "Apps" })).not.toBeInTheDocument();
      });
    });

    it("Replace swaps the app into the existing dashboard, keeps its id, and opens it", async () => {
      seedMacro();

      await boot(macro());
      await userEvent.click(within(await conflictDialog()).getByRole("button", { name: /^Replace/ }));

      await waitFor(() => {
        expect(useDashboardStore.getState().dashboards[0].tabs.map((t) => t.name)).toEqual([
          "Overview",
          "Detail",
        ]);
      });
      const { dashboards, activeId, activeTabId } = useDashboardStore.getState();
      expect(dashboards.map((d) => [d.id, d.name])).toEqual([["m", "Macro"]]);
      expect(activeId).toBe("m");
      expect(activeTabId).toBe(dashboards[0].tabs[0].id);
      expect(__read("dashboards/m.json")).toContain("Overview");
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "Apps" })).not.toBeInTheDocument();
      });
    });

    it("Replace in a workspace leaves the tiles as they were", async () => {
      seedMacro();
      __seed("dashboards/o.json", JSON.stringify({ id: "o", name: "Other", tabs: [{ id: "to", name: "Main", cards: [] }] }));
      render(<App />);
      await waitFor(() => expect(useDashboardStore.getState().dashboards.map((d) => d.id).sort()).toEqual(["m", "o"]));
      const ws = { id: "w", name: "T", preset: "laptop" as const, slots: [{ slot: "a", dashboardId: "m" }, { slot: "b", dashboardId: "o" }] };
      act(() => {
        useWorkspacesStore.setState({ workspaces: [ws], activeWorkspaceId: "w", focusedSlot: "b" });
        useBackendsStore.setState({ backends: [makeBackend({ id: "b1", name: "Alpha" })] });
        useWidgetRegistryStore.setState({ apps: [{ backendId: "b1", app: macro() }] });
      });
      try {
        await userEvent.click(screen.getByRole("button", { name: "Apps" }));
        await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));
        await userEvent.click(within(await conflictDialog()).getByRole("button", { name: /^Replace/ }));
        await waitFor(() => expect(useDashboardStore.getState().dashboards.find((d) => d.id === "m")?.tabs[0].name).toBe("Overview"));
        await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("m"));
        expect(useWorkspacesStore.getState().workspaces[0].slots).toEqual(ws.slots);
      } finally {
        act(() => useWorkspacesStore.setState({ workspaces: [], activeWorkspaceId: null, focusedSlot: null }));
      }
    });

    it("Skip writes nothing and leaves the Apps dialog open", async () => {
      seedMacro();

      await boot(macro());
      await userEvent.click(within(await conflictDialog()).getByRole("button", { name: /^Skip/ }));

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: 'A dashboard named "Macro" already exists' }),
        ).not.toBeInTheDocument();
      });
      expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["m"]);
      expect(__read("dashboards/m.json")).toContain("Main");
      expect(__list().filter((p) => p.startsWith("dashboards/"))).toEqual(["dashboards/m.json"]);
      expect(screen.getByRole("dialog", { name: "Apps" })).toBeInTheDocument();
    });

    // Escape over two stacked modals: the conflict dialog is the top one, so
    // Escape cancels the import and the Apps dialog under it stays open.
    it("Cancel import, or Escape, writes nothing and leaves the Apps dialog open", async () => {
      seedMacro();

      await boot(macro());
      await userEvent.click(
        within(await conflictDialog()).getByRole("button", { name: "Cancel import" }),
      );
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: 'A dashboard named "Macro" already exists' }),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByRole("dialog", { name: "Apps" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));
      await conflictDialog();
      await userEvent.keyboard("{Escape}");

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: 'A dashboard named "Macro" already exists' }),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByRole("dialog", { name: "Apps" })).toBeInTheDocument();
      expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["m"]);
      expect(__list().filter((p) => p.startsWith("dashboards/"))).toEqual(["dashboards/m.json"]);
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

    it("asks again when the same app is opened a second time", async () => {
      await boot(macro());
      await waitFor(() => expect(created().name).toBe("Macro"));

      await userEvent.click(screen.getByRole("button", { name: "Apps" }));
      await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));
      await userEvent.click(within(await conflictDialog()).getByRole("button", { name: /^Keep both/ }));

      await waitFor(() => {
        const names = useDashboardStore.getState().dashboards.map((d) => d.name);
        expect(names.filter((n) => n.startsWith("Macro"))).toEqual(["Macro", "Macro (2)"]);
      });
    });
  });
