// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import type { DiscoveryResult } from "../lib/discovery";
import type { WidgetDef } from "../lib/types";
import { type App, UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { widget as baseWidget } from "../test/fixtures";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

function widget(backendId: string, id: string): WidgetDef {
  return baseWidget({ id, backendId, name: id, gridData: { w: 1, h: 1 } });
}

/**
 * Only `name` and `tabs` are guaranteed by the apps.json shape check, which
 * is all discovery promises about an app it passes through — the rest of
 * `App` is whatever the backend sent.
 */
function app(name: string): App {
  return { name, tabs: {} } as unknown as App;
}

beforeEach(() => {
  useWidgetRegistryStore.setState({ widgets: [], apps: [] });
});

describe("applyDiscovery", () => {
  it("populates widgets from an online result", () => {
    const results: DiscoveryResult[] = [
      { backendId: "b1", widgets: [widget("b1", "w1")], status: "online", issues: [], apps: [] },
    ];
    useWidgetRegistryStore.getState().applyDiscovery(results);
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
  });

  it("replaces a backend's widgets on a subsequent online result", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "old")], status: "online", issues: [], apps: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "new")], status: "online", issues: [], apps: [] },
    ]);
    const widgets = useWidgetRegistryStore.getState().widgets;
    expect(widgets).toHaveLength(1);
    expect(widgets[0].id).toBe("new");
  });

  it("leaves an untouched backend's widgets alone", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "w1")], status: "online", issues: [], apps: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b2", widgets: [widget("b2", "w2")], status: "online", issues: [], apps: [] },
    ]);
    const widgets = useWidgetRegistryStore.getState().widgets;
    expect(widgets.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
  });

  it("preserves a backend's last-known widgets when its discovery result is offline", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "w1")], status: "online", issues: [], apps: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], status: "offline", issues: [], apps: [], error: "boom" },
    ]);
    // Cards naming this backend's widget stay resolved; the fetch itself
    // fails, which is what surfaces the retryable ErrorState.
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
  });

  it("contributes nothing for a backend with no prior widgets that comes back offline", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], status: "offline", issues: [], apps: [], error: "boom" },
    ]);
    expect(useWidgetRegistryStore.getState().widgets).toEqual([]);
  });
});

describe("applyDiscovery apps", () => {
  it("tags each app with the backend that served it", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("Macro")], status: "online", issues: [] },
    ]);
    expect(useWidgetRegistryStore.getState().apps).toEqual([
      { backendId: "b1", app: app("Macro") },
    ]);
  });

  it("replaces a backend's apps on a subsequent online result", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("Old")], status: "online", issues: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("New")], status: "online", issues: [] },
    ]);
    const apps = useWidgetRegistryStore.getState().apps;
    expect(apps.map((a) => a.app.name)).toEqual(["New"]);
  });

  it("leaves an untouched backend's apps alone", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("One")], status: "online", issues: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b2", widgets: [], apps: [app("Two")], status: "online", issues: [] },
    ]);
    expect(
      useWidgetRegistryStore.getState().apps.map((a) => a.app.name).sort(),
    ).toEqual(["One", "Two"]);
  });

  // Same rule as widgets: an offline backend keeps its last-known apps, so
  // a failed Refresh does not empty the Apps view.
  it("preserves a backend's last-known apps when its result is offline", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("Macro")], status: "online", issues: [] },
    ]);
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [], status: "offline", issues: [], error: "boom" },
    ]);
    expect(useWidgetRegistryStore.getState().apps).toHaveLength(1);
  });
});

describe("dropBackend", () => {
  it("removes only the named backend's widgets", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "w1")], status: "online", issues: [], apps: [] },
      { backendId: "b2", widgets: [widget("b2", "w2")], status: "online", issues: [], apps: [] },
    ]);
    useWidgetRegistryStore.getState().dropBackend("b1");
    const widgets = useWidgetRegistryStore.getState().widgets;
    expect(widgets).toHaveLength(1);
    expect(widgets[0].backendId).toBe("b2");
  });

  it("removes only the named backend's apps", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [], apps: [app("One")], status: "online", issues: [] },
      { backendId: "b2", widgets: [], apps: [app("Two")], status: "online", issues: [] },
    ]);
    useWidgetRegistryStore.getState().dropBackend("b1");
    expect(useWidgetRegistryStore.getState().apps).toEqual([
      { backendId: "b2", app: app("Two") },
    ]);
  });
});

describe("find", () => {
  it("returns the widget matching both backendId and widgetId", () => {
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", widgets: [widget("b1", "w1")], status: "online", issues: [], apps: [] },
    ]);
    expect(useWidgetRegistryStore.getState().find("b1", "w1")?.id).toBe("w1");
  });

  it("returns undefined when no widget matches", () => {
    expect(useWidgetRegistryStore.getState().find("b1", "w1")).toBeUndefined();
  });
});

describe("seedBuiltins", () => {
  it("adds the built-ins once, however many times it runs", () => {
    useWidgetRegistryStore.setState({ widgets: [] });
    useWidgetRegistryStore.getState().seedBuiltins();
    const after = useWidgetRegistryStore.getState().widgets.length;
    useWidgetRegistryStore.getState().seedBuiltins();
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(after);
  });

  it("survives a discovery sweep, which only replaces online backends", () => {
    useWidgetRegistryStore.setState({ widgets: [] });
    useWidgetRegistryStore.getState().seedBuiltins();
    useWidgetRegistryStore.getState().applyDiscovery([
      { backendId: "b1", status: "online", widgets: [], issues: [], apps: [] },
    ]);
    expect(
      useWidgetRegistryStore.getState().widgets.some((w) => w.backendId === "builtin"),
    ).toBe(true);
  });
});

describe("find with the unresolved sentinel", () => {
  it("searches every backend for the id", () => {
    useWidgetRegistryStore.setState({ widgets: [widget("b1", "quote"), widget("b2", "prices")] });

    expect(useWidgetRegistryStore.getState().find(UNRESOLVED_BACKEND_ID, "prices")?.backendId).toBe(
      "b2",
    );
  });

  it("returns the first match when two backends serve the same id", () => {
    useWidgetRegistryStore.setState({ widgets: [widget("bZ", "quote"), widget("bA", "quote")] });

    expect(useWidgetRegistryStore.getState().find(UNRESOLVED_BACKEND_ID, "quote")?.backendId).toBe(
      "bZ",
    );
  });

  it("still answers undefined when nothing serves the id", () => {
    useWidgetRegistryStore.setState({ widgets: [widget("b1", "quote")] });

    expect(useWidgetRegistryStore.getState().find(UNRESOLVED_BACKEND_ID, "nowhere")).toBeUndefined();
  });

  it("does not loosen a normal lookup — a real backend id still has to match", () => {
    useWidgetRegistryStore.setState({ widgets: [widget("b1", "quote")] });

    expect(useWidgetRegistryStore.getState().find("b2", "quote")).toBeUndefined();
  });
});
