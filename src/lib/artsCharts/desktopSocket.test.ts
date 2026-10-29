// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from "vitest";
const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ticket: "tk" }), { headers: { "Content-Type": "application/json" } }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: request }));
const { useBackendsStore } = await import("../../stores/backendsStore");
const { installChartsSocketShim } = await import("./desktopSocket");

const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const, headerName: "Authorization", headerValue: "Bearer test-token" };
let uninstall = () => {};
afterEach(() => { uninstall(); request.mockClear(); });

it("touches only the gateway connection's origin plus /ta_series_ws", async () => {
  const opened: string[] = [];
  globalThis.WebSocket = vi.fn((u: string) => { opened.push(u); return {}; }) as never;
  useBackendsStore.setState({ backends: [charts] });
  uninstall = installChartsSocketShim();
  new WebSocket("wss://door.example.com/grid/live_grid_ws");
  new WebSocket("wss://other.example.com/ta_series_ws");
  new WebSocket("wss://door.example.com/ta_series_ws?symbol=AAPL&interval=1d");
  await vi.waitFor(() => expect(opened).toHaveLength(3));
  expect(opened.slice(0, 2)).toEqual(["wss://door.example.com/grid/live_grid_ws", "wss://other.example.com/ta_series_ws"]);
  expect(request).toHaveBeenCalledTimes(1);
  const asked = new URL(String(request.mock.calls[0][0]));
  expect(asked.pathname).toBe("/charts/ws_ticket");
  expect(asked.searchParams.get("target")).toBe("/ta_series_ws?symbol=AAPL&interval=1d");
  expect(new Headers(request.mock.calls[0][1]!.headers).get("Authorization")).toBe("Bearer test-token");
  expect(opened[2]).toBe("wss://door.example.com/ta_series_ws?symbol=AAPL&interval=1d&ticket=tk");
});

it("does nothing on the tailnet door", () => {
  const Native = vi.fn(() => ({})); globalThis.WebSocket = Native as never;
  useBackendsStore.setState({ backends: [{ ...charts, door: "tailnet" }] });
  uninstall = installChartsSocketShim();
  new WebSocket("wss://door.example.com/ta_series_ws");
  expect(request).not.toHaveBeenCalled();
});
