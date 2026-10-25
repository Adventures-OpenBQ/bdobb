// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { card, widget } from "../../test/fixtures";
import { keyMaintBackendIds } from "../providerKeys";
import { dashboardMcpUrls } from "./dashboardMcp";

describe("dashboardMcpUrls", () => {
  it("collects each card's widget mcpUrl once, normalized, skipping keys widgets and widgets without one", () => {
    const widgets = [
      widget({ id: "a", backendId: "b", mcpUrl: "http://m.example/mcp/" }),
      widget({ id: "a2", backendId: "b", mcpUrl: "http://m.example/mcp" }),
      widget({ id: "k", backendId: "b", type: "keys", mcpUrl: "http://keys.example/mcp" }),
      widget({ id: "plain", backendId: "b" }),
    ];
    const find = (backendId: string, id: string) => widgets.find((w) => w.backendId === backendId && w.id === id);
    const cards = ["a", "a2", "k", "plain", "missing"].map((id, i) => card({ id: `c${i}`, backendId: "b", widgetId: id }));
    expect(dashboardMcpUrls(cards, find, new Set())).toEqual(["http://m.example/mcp"]);
  });
});

describe("dashboardMcpUrls off-limits widgets", () => {
  // Every widget on a backend serving key-maint ("km"), and every settings
  // widget, never offers an MCP server; a normal backend's widget still does.
  const widgets = [
    widget({ id: "provider_api_keys_panel", backendId: "km", type: "keys", mcpUrl: "http://km.example/a" }),
    widget({ id: "provider_api_keys", backendId: "km", type: "table", mcpUrl: "http://km.example/b" }),
    widget({ id: "provider_api_keys_summary", backendId: "km", type: "markdown", mcpUrl: "http://km.example/c" }),
    widget({ id: "key_rotation_report", backendId: "km", type: "chart", mcpUrl: "http://km.example/d" }),
    widget({ id: "svc_settings", backendId: "svc", type: "settings", mcpUrl: "http://svc.example/mcp" }),
    widget({ id: "normal", backendId: "b", mcpUrl: "http://normal.example/mcp" }),
  ];
  const find = (backendId: string, id: string) => widgets.find((w) => w.backendId === backendId && w.id === id);

  it("offers only the normal backend's server", () => {
    const cards = widgets.map((w, i) => card({ id: `c${i}`, backendId: w.backendId, widgetId: w.id }));
    expect(dashboardMcpUrls(cards, find, keyMaintBackendIds(widgets))).toEqual(["http://normal.example/mcp"]);
  });
});
