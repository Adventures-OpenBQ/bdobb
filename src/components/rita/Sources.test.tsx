// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCall, McpServerConfig } from "../../lib/agent/types";
import { useDashboardStore } from "../../stores/dashboardStore";
import { usePdfHighlightStore } from "../../stores/pdfHighlightStore";
import { card, widget } from "../../test/fixtures";
import * as logger from "../../lib/logger";
import { Sources, citationLink, citedCardId, citedWidgets, openCitedWidget } from "./Sources";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

describe("citationLink", () => {
  it("names widget citations without a url as plain text and drops unsafe urls", () => {
    expect(citationLink({ id: "1", source_info: { type: "widget", name: "Historical Prices" } })).toEqual({
      name: "Historical Prices",
      url: null,
    });
    expect(citationLink({ id: "2", source_info: { url: "https://example.com/a" } })).toEqual({ name: "2", url: "https://example.com/a" });
    expect(citationLink({ id: "3", url: "javascript:alert(1)" })).toBeNull();
    expect(citationLink("junk")).toBeNull();
  });
});

describe("Sources", () => {
  it("opens links externally and renders url-less sources as text", async () => {
    render(
      <Sources
        citations={[
          { id: "a", source_info: { name: "Prices" } },
          { id: "b", source_info: { name: "Docs", url: "https://example.com/docs" } },
        ]}
      />,
    );
    expect(screen.getByText("Prices").tagName).not.toBe("BUTTON");
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("renders nothing without citations", () => {
    const { container } = render(<Sources citations={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

const servers: McpServerConfig[] = [{ id: "s1", name: "Financial Data", url: "https://mcp.example/mcp", enabled: true }];
const call = (tool: string, over: Partial<Extract<AgentCall, { kind: "agent_tool" }>> = {}): AgentCall => ({
  kind: "agent_tool",
  server_id: "s1",
  tool,
  narrated: `Calling ${tool}`,
  ...over,
});
const revenue = widget({ id: "rev", backendId: "b1", name: "Revenue", mcpTool: { mcpServer: "Financial Data", toolId: "get_company_revenue_data" } });

describe("citedWidgets", () => {
  it("cites a widget whose server name and tool match a call exactly, once", () => {
    const plain = widget({ id: "plain", name: "Plain" });
    expect(citedWidgets([call("get_company_revenue_data"), call("get_company_revenue_data")], servers, [plain, revenue])).toEqual([revenue]);
  });

  it("cites every widget declaring the matched tool, on any backend", () => {
    const twin = widget({ ...revenue, backendId: "b2" });
    expect(citedWidgets([call("get_company_revenue_data")], servers, [revenue, twin])).toEqual([revenue, twin]);
  });

  it("cites a proxied call by the tool it ran, never by the proxy's own name", () => {
    const viaProxy = call("call_tool", { effectiveTools: ["get_company_revenue_data"] });
    const proxyNamed = widget({ id: "proxy", name: "Proxy", mcpTool: { mcpServer: "Financial Data", toolId: "call_tool" } });
    expect(citedWidgets([viaProxy], servers, [revenue, proxyNamed])).toEqual([revenue]);
    const pipeline = call("run_pipeline", { effectiveTools: ["equity_quote", "get_company_revenue_data"] });
    expect(citedWidgets([pipeline], servers, [revenue])).toEqual([revenue]);
  });

  it("cites nothing for another tool, a near-miss name, a failed call, a widget_data call, or an unnamed or missing server", () => {
    const none = (calls: AgentCall[], s = servers) => expect(citedWidgets(calls, s, [revenue])).toEqual([]);
    none([call("get_company_price_data")]);
    none([call("get_company_revenue_data")], [{ ...servers[0], name: "financial data" }]);
    none([call("get_company_revenue_data", { ok: false, error: "x" })]);
    none([{ kind: "widget_data", url: "u", params: {}, ok: true, durationMs: 1, rows: 1 }]);
    none([call("get_company_revenue_data")], [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }]);
    none([call("get_company_revenue_data")], []);
  });
});

const REAL_ACTIONS = {
  addCard: useDashboardStore.getState().addCard,
  setActiveTab: useDashboardStore.getState().setActiveTab,
};

describe("openCitedWidget", () => {
  const addCard = vi.fn(async () => "new");
  const setActiveTab = vi.fn();
  beforeEach(() => {
    addCard.mockClear();
    setActiveTab.mockClear();
    useDashboardStore.setState({ addCard, setActiveTab });
  });
  afterEach(() => {
    useDashboardStore.setState({ ...REAL_ACTIONS, dashboards: [], activeId: null, activeTabId: null });
    document.body.innerHTML = "";
  });

  it("adds the widget to the open dashboard when no card of it is there", async () => {
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }], activeId: "d1", activeTabId: "t1" });
    await openCitedWidget(revenue);
    expect(addCard).toHaveBeenCalledWith(revenue);
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("switches to the tab holding its existing card and scrolls it into view, adding nothing", async () => {
    const existing = card({ id: "c9", widgetId: "rev", backendId: "b1" });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "One", cards: [] }, { id: "t2", name: "Two", cards: [existing] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    const el = document.createElement("div");
    el.dataset.cardId = "c9";
    const scroll = vi.fn();
    el.scrollIntoView = scroll;
    document.body.appendChild(el);
    await openCitedWidget(revenue);
    expect(setActiveTab).toHaveBeenCalledWith("d1", "t2");
    expect(addCard).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it("treats a card of the same widget id on another backend as a different widget", async () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [card({ id: "c1", widgetId: "rev", backendId: "b2" })] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    await openCitedWidget(revenue);
    expect(addCard).toHaveBeenCalledWith(revenue);
  });

  it("resolves and logs when addCard rejects", async () => {
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }], activeId: "d1", activeTabId: "t1" });
    addCard.mockRejectedValueOnce(new Error("disk full"));
    const log = vi.spyOn(logger, "logError").mockResolvedValue(undefined);
    await expect(openCitedWidget(revenue)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failed to add widget rev"));
    log.mockRestore();
  });

  it("does nothing without an open dashboard", async () => {
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await expect(openCitedWidget(revenue)).resolves.toBeUndefined();
    expect(addCard).not.toHaveBeenCalled();
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});

describe("Sources with widget citations", () => {
  it("renders cited widgets as buttons beside Rita's citations", () => {
    render(<Sources citations={[{ id: "a", source_info: { name: "Prices" } }]} widgets={[revenue]} />);
    expect(screen.getByText("Prices")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revenue" })).toBeTruthy();
  });

  it("renders with widget citations alone", () => {
    render(<Sources citations={[]} widgets={[revenue]} />);
    expect(screen.getByRole("button", { name: "Revenue" })).toBeTruthy();
  });
});

describe("quote citations", () => {
  const box = (page: number) => ({ text: "q", page, x0: 1, top: 2, x1: 3, bottom: 4 });
  const REPORT = card({ id: "11111111-1111-4111-8111-111111111111", backendId: "b1", widgetId: "report" });

  it("finds the cited card by Rita's metadata.widget_uuid, else by origin and widget_id", () => {
    expect(citedCardId({ source_info: { metadata: { widget_uuid: REPORT.id } } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { origin: "b1", widget_id: "report" } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { metadata: { widget_uuid: "gone" }, origin: "b1", widget_id: "report" } }, [REPORT])).toBeNull();
    expect(citedCardId({ source_info: { origin: "b2", widget_id: "report" } }, [REPORT])).toBeNull();
  });

  it("opens a boxed citation on its card at the first box's page", async () => {
    usePdfHighlightStore.setState({ highlight: null });
    const groups = [[box(2)], [box(3), box(2)]];
    render(<Sources cards={[REPORT]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: groups }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(usePdfHighlightStore.getState().highlight).toEqual({ cardId: REPORT.id, page: 2, boxes: [box(2), box(2)] });
  });

  it("shows a boxed citation whose card is not on the dashboard as plain text", () => {
    render(<Sources cards={[]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: [[box(1)]] }]} />);
    expect(screen.getByText("Report").tagName).not.toBe("BUTTON");
  });
});
