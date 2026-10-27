// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConfig } from "./types";

const httpFetch = vi.fn(async (..._args: unknown[]) => new Response("{}"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: httpFetch }));
const configureArtsCharts = vi.fn();
vi.mock("@adventures-openbq/arts-charts", () => ({ configureArtsCharts }));
const { useBackendsStore } = await import("../stores/backendsStore");
const { useArtsChartsStore } = await import("../stores/artsChartsStore");
const { chartsFetch, chartsSocketUrl, buildHost, reconfigure } = await import("./artsChartsHost");

const gateway: BackendConfig = {
  id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header", validateWidgets: true,
  kind: "arts-charts", door: "gateway", headerName: "Authorization", headerValue: "Bearer test-token",
};
const web: BackendConfig = { id: "preview-arts", name: "Art's Charts", baseUrl: "https://preview.example.com/arts", authLocation: "header", validateWidgets: false, kind: "arts-charts" };
const set = (backends: BackendConfig[]) => useBackendsStore.setState({ backends });

describe("chartsFetch", () => {
  beforeEach(() => { httpFetch.mockClear(); set([gateway]); });
  it("is one reference that reads the connection at call time", async () => {
    const before = buildHost({ viewer: false }).chartsFetch;
    set([{ ...gateway, baseUrl: "https://other.example.com" }]);
    expect(buildHost({ viewer: false }).chartsFetch).toBe(before);
    await chartsFetch("/charts");
    expect(httpFetch.mock.calls[0][0]).toBe("https://other.example.com/charts");
  });
  it("adds the connection's credential over the caller's headers", async () => {
    await chartsFetch("/charts/events", { headers: { Accept: "text/event-stream", Authorization: "Bearer forged" } });
    const init = httpFetch.mock.calls[0][1] as RequestInit;
    const h = new Headers(init.headers);
    expect(h.get("Authorization")).toBe("Bearer test-token");
    expect(h.get("Accept")).toBe("text/event-stream");
  });
  it("sends the tailnet pair the same way", async () => {
    set([{ ...gateway, door: "tailnet", headerValue: "Basic dXNlcjpwYXNz" }]);
    await chartsFetch("/series?symbol=AAPL");
    expect(new Headers((httpFetch.mock.calls[0][1] as RequestInit).headers).get("Authorization")).toBe("Basic dXNlcjpwYXNz");
  });
  it.each(["charts", "https://evil.example.com/x", "//evil.example.com/x", "javascript:alert(1)"])("refuses %s", async (p) => {
    await expect(chartsFetch(p)).rejects.toThrow(/server-relative/);
    expect(httpFetch).not.toHaveBeenCalled();
  });
  it("refuses dot segments and paths that leave the base", async () => {
    set([web]);
    for (const p of ["/../state/settings.json", "/./charts", "/charts/%2e%2e/x", "/a/../../b"]) {
      await expect(chartsFetch(p)).rejects.toThrow(/server-relative/);
    }
    await chartsFetch("/charts");
    expect(httpFetch.mock.calls.at(-1)![0]).toBe("https://preview.example.com/arts/charts");
  });
  it("fails clearly with no connection", async () => {
    set([]);
    await expect(chartsFetch("/charts")).rejects.toThrow(/not connected/);
  });
});

describe("chartsSocketUrl", () => {
  it("is the base with ws/wss and the path, no query and no credential", () => {
    set([gateway]);
    expect(chartsSocketUrl("/ta_series_ws")).toBe("wss://door.example.com/ta_series_ws");
    expect(() => chartsSocketUrl("/ta_series_ws?symbol=AAPL")).toThrow(/no query/);
    set([web]);
    expect(chartsSocketUrl("/ta_series_ws")).toBe("wss://preview.example.com/arts/ta_series_ws");
  });
  it("is absent from the host on the tailnet door (B4)", () => {
    set([{ ...gateway, door: "tailnet" }]);
    expect(buildHost({ viewer: false }).chartsSocketUrl).toBeUndefined();
  });
});

describe("buildWidgetWsUrl adapter", () => {
  const widget = { id: "arts_chart", wsEndpoint: "ta_series_ws", params: [] };
  it("wires params, drops empty ones and carries no header credential", () => {
    set([gateway]);
    const url = buildHost({ viewer: false }).buildWidgetWsUrl(gateway, widget, { symbol: "AAPL", start: "", interval: "1d" })!;
    expect(url).toBe("wss://door.example.com/ta_series_ws?symbol=AAPL&interval=1d");
  });
  it("is null on the tailnet door: no socket a webview cannot authenticate", () => {
    const t = { ...gateway, door: "tailnet" as const };
    set([t]);
    expect(buildHost({ viewer: false }).buildWidgetWsUrl(t, widget, { symbol: "AAPL" })).toBeNull();
  });
});

describe("lifecycle", () => {
  it("removing the connection drops chartsFetch and bumps the epoch", () => {
    set([gateway]);
    reconfigure({ viewer: false });
    expect(configureArtsCharts.mock.calls.at(-1)![0].chartsFetch).toBe(chartsFetch);
    const epoch = useArtsChartsStore.getState().epoch;
    set([]);
    reconfigure({ viewer: false });
    expect(configureArtsCharts.mock.calls.at(-1)![0].chartsFetch).toBeUndefined();
    expect(useArtsChartsStore.getState().epoch).toBe(epoch + 1);
  });
  it("components.AnchorChips renders nothing (B16)", () => {
    const AnchorChips = buildHost({ viewer: false }).components.AnchorChips as unknown as (p: { onPick: () => void }) => null;
    expect(AnchorChips({ onPick: () => {} })).toBeNull();
  });
});
