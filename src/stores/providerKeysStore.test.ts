// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => import("../test/memfs"));

const fetchWidgetData = vi.fn();
vi.mock("../lib/dataClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/dataClient")>("../lib/dataClient");
  return { ...actual, fetchWidgetData: (...a: unknown[]) => fetchWidgetData(...a) };
});

import { __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { useBackendsStore } from "./backendsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";
import { useProviderKeysStore } from "./providerKeysStore";

const backend: BackendConfig = {
  id: "b1", name: "B", baseUrl: "http://x", authLocation: "header", validateWidgets: true,
};

function widget(over: Partial<WidgetDef>): WidgetDef {
  return {
    id: "w", backendId: "b1", name: "W", description: "", type: "table",
    category: "", subCategory: "", endpoint: "/e", gridData: { w: 1, h: 1 },
    params: [], source: [], ...over,
  };
}

function keysRow(over: Record<string, unknown>) {
  return { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false, ...over };
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  fetchWidgetData.mockReset();
  useBackendsStore.setState({ backends: [backend], statuses: {} });
  useProviderKeysStore.setState({ status: {}, source: "none" });
});

describe("key-maint source", () => {
  it("is preferred when a backend serves the provider_api_keys widget", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({ tier: 1, rows: [keysRow({})] });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().source).toBe("key-maint");
    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
  });

  it("accepts the bare rows array key-maint's table widget unwraps to via dataKey", async () => {
    // The real widgets.json declares data.dataKey: "rows" on provider_api_keys,
    // so fetchWidgetData hands back the array, not the { tier, rows } envelope.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys", dataKey: "rows" })],
    });
    fetchWidgetData.mockResolvedValue([keysRow({})]);

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().source).toBe("key-maint");
    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
  });

  it("counts a demo key as keyed, because it works within limits", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({ tier: 1, rows: [keysRow({ demo: true })] });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
  });

  it("maps empty to unkeyed and anything else to unknown", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "FMP", status: "empty" }),
        keysRow({ provider: "FRED", status: "missing" }),
        keysRow({ provider: "EODHD", status: "unknown" }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    const { status } = useProviderKeysStore.getState();
    expect(status.fmp).toBe("unkeyed");
    expect(status.fred).toBe("unkeyed");
    expect(status.eodhd).toBe("unknown");
  });

  it("keys alpaca only when both its rows are set", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "Alpaca", env_var: "ALPACA_API_KEY", status: "set" }),
        keysRow({ provider: "Alpaca (secret)", env_var: "ALPACA_API_SECRET", status: "empty" }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.alpaca).toBe("unkeyed");
  });

  it("keys alpaca when both are set", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "Alpaca", env_var: "ALPACA_API_KEY", status: "set" }),
        keysRow({ provider: "Alpaca (secret)", env_var: "ALPACA_API_SECRET", status: "set" }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.alpaca).toBe("keyed");
  });
});

describe("keyless providers", () => {
  it("are keyed by definition, without any probe", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["yfinance"] })],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.yfinance).toBe("keyed");
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });
});

describe("probe fallback", () => {
  it("is used when no backend serves key-maint", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockResolvedValue({ results: [] });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().source).toBe("probe");
    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
  });

  it("leaves a provider unknown when its probe fails for any other reason", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockRejectedValue(new Error("HTTP 401: Unauthorized"));

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.fmp).toBe("unknown");
  });

  it("probes with the widget's own default params, since pickProbeWidget chose it for having them", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockResolvedValue({ results: [] });

    await useProviderKeysStore.getState().refresh();

    expect(fetchWidgetData).toHaveBeenCalledWith(
      backend,
      expect.objectContaining({ id: "p" }),
      { provider: "fmp" },
    );
  });

  it("declines to probe a provider whose widgets all need arguments", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "symbol" }] })],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().status.fmp).toBe("unknown");
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });
});
