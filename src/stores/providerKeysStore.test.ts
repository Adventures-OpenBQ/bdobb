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
  useProviderKeysStore.setState({ status: {}, probe: {}, source: "none" });
});

describe("key-maint source", () => {
  it("a key-maint backend that appears during a refresh is queried by a follow-up run", async () => {
    let release!: () => void;
    fetchWidgetData.mockImplementation((_b: unknown, w: WidgetDef) =>
      w.id === "provider_api_keys" ? Promise.resolve([keysRow({ test: { result: "ok" } })]) : new Promise((r) => { release = () => r([]); }));
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "fmpw", source: ["FMP"] })] });
    const first = useProviderKeysStore.getState().refresh();
    await Promise.resolve();
    useWidgetRegistryStore.setState({ widgets: [...useWidgetRegistryStore.getState().widgets, widget({ id: "provider_api_keys", endpoint: "keys" })] });
    const second = useProviderKeysStore.getState().refresh();
    release?.();
    await first; await second;
    expect(useProviderKeysStore.getState().source).toBe("key-maint");
  });

  it("is preferred when a backend serves the provider_api_keys widget", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({ tier: 1, rows: [keysRow({})] });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().source).toBe("key-maint");
    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
  });

  it("asks key-maint to run the vendor tests, on top of the widget's own defaults", async () => {
    // GET /keys only contacts the vendors with run_tests=true (key-maint's
    // handler defaults it to False), so without this the rows come back with
    // no `test` field and every badge in the Library is grey.
    useWidgetRegistryStore.setState({
      widgets: [
        widget({
          id: "provider_api_keys",
          endpoint: "keys",
          params: [{ paramName: "run_tests", value: "false" }, { paramName: "tier", value: "3" }],
        }),
      ],
    });
    fetchWidgetData.mockResolvedValue({ tier: 1, rows: [keysRow({})] });

    await useProviderKeysStore.getState().refresh();

    expect(fetchWidgetData).toHaveBeenCalledWith(
      backend,
      expect.objectContaining({ id: "provider_api_keys" }),
      { tier: "3", run_tests: "true" },
    );
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

describe("probe tones", () => {
  it("start empty, so a badge is grey until a result lands", () => {
    expect(useProviderKeysStore.getState().probe).toEqual({});
  });

  it("come off each key-maint row's test result", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "FMP", test: { result: "ok", detail: "" } }),
        keysRow({ provider: "FRED", test: { result: "auth_failed", detail: "" } }),
        keysRow({ provider: "EODHD", test: { result: "no_response", detail: "" } }),
        keysRow({ provider: "Tiingo", test: { result: "skipped", detail: "" } }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe).toEqual({
      fmp: "green", fred: "amber", eodhd: "red", tiingo: "grey",
    });
  });

  it("are grey for a key-maint row that carries no test result at all", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({ tier: 1, rows: [keysRow({})] });

    await useProviderKeysStore.getState().refresh();

    // The key is set — but nothing has asked the vendor about it.
    expect(useProviderKeysStore.getState().status.fmp).toBe("keyed");
    expect(useProviderKeysStore.getState().probe.fmp).toBe("grey");
  });

  it("take the worst of a provider's rows, so half-probed Alpaca is not green", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "Alpaca", env_var: "ALPACA_API_KEY", test: { result: "ok", detail: "" } }),
        keysRow({
          provider: "Alpaca (secret)", env_var: "ALPACA_API_SECRET",
          test: { result: "auth_failed", detail: "" },
        }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.alpaca).toBe("amber");
  });

  it("are grey when one of a provider's rows tested ok and the other was never tested", async () => {
    // The untested half is not evidence that the provider works, and grey
    // outranks green precisely so it cannot read as if it were.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    fetchWidgetData.mockResolvedValue({
      tier: 1,
      rows: [
        keysRow({ provider: "Alpaca", env_var: "ALPACA_API_KEY", test: { result: "ok", detail: "" } }),
        keysRow({ provider: "Alpaca (secret)", env_var: "ALPACA_API_SECRET" }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.alpaca).toBe("grey");
  });

  it("come off the store's own probe when it succeeds", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockResolvedValue({ results: [] });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.fmp).toBe("green");
  });

  it("are amber when the store's own probe gets an HTTP answer back", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockRejectedValue(new Error("HTTP 401: Unauthorized"));

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.fmp).toBe("amber");
  });

  it("are red when the store's own probe never got a response", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockRejectedValue(new Error("fetch failed (http://x/e)"));

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.fmp).toBe("red");
  });

  it("are grey for a provider that was never probed", async () => {
    useWidgetRegistryStore.setState({
      widgets: [
        // Keyless: keyed by definition, but no vendor was ever asked.
        widget({ id: "free", source: ["yfinance"] }),
        // Every widget needs an argument, so no probe could be chosen.
        widget({ id: "p", source: ["FMP"], params: [{ paramName: "symbol" }] }),
      ],
    });

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.yfinance).toBe("grey");
    expect(useProviderKeysStore.getState().probe.fmp).toBe("grey");
  });
});

describe("applyKeyMaintRows", () => {
  it("takes rows the caller already has, with no fetch of its own", () => {
    useProviderKeysStore.getState().applyKeyMaintRows([
      keysRow({ provider: "FMP", test: { result: "ok" } }),
      keysRow({ provider: "EODHD", status: "empty", test: { result: "no_response" } }),
    ]);

    const { status, probe, source } = useProviderKeysStore.getState();
    expect(status).toEqual({ fmp: "keyed", eodhd: "unkeyed" });
    expect(probe).toEqual({ fmp: "green", eodhd: "red" });
    expect(source).toBe("key-maint");
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });

  it("reads the same rows the same way refresh() does", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    const rows = [
      keysRow({ provider: "Alpaca", env_var: "ALPACA_API_KEY", test: { result: "ok", detail: "" } }),
      keysRow({
        provider: "Alpaca (secret)", env_var: "ALPACA_API_SECRET", status: "empty",
        test: { result: "auth_failed", detail: "" },
      }),
    ];
    fetchWidgetData.mockResolvedValue({ tier: 1, rows });
    await useProviderKeysStore.getState().refresh();
    const fetched = { ...useProviderKeysStore.getState() };

    useProviderKeysStore.setState({ status: {}, probe: {}, source: "none" });
    useProviderKeysStore.getState().applyKeyMaintRows(rows);

    const applied = useProviderKeysStore.getState();
    expect(applied.status).toEqual(fetched.status);
    expect(applied.probe).toEqual(fetched.probe);
    expect(applied.source).toBe(fetched.source);
  });
});

describe("single flight", () => {
  it("ignores a refresh fired while one is still running", async () => {
    // React 18 StrictMode mounts App twice, so bootstrap's refresh fires
    // twice: the second must join the first rather than fan out to every
    // vendor a second time.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    let release = (_: unknown) => {};
    fetchWidgetData.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const first = useProviderKeysStore.getState().refresh();
    const second = useProviderKeysStore.getState().refresh();
    release({ results: [] });
    await Promise.all([first, second]);

    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    expect(useProviderKeysStore.getState().probe.fmp).toBe("green");
  });

  it("runs again once the one in flight has settled", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", source: ["FMP"], params: [{ paramName: "provider", value: "fmp" }] })],
    });
    fetchWidgetData.mockResolvedValue({ results: [] });

    await useProviderKeysStore.getState().refresh();
    await useProviderKeysStore.getState().refresh();

    expect(fetchWidgetData).toHaveBeenCalledTimes(2);
  });

});

/**
 * A key-maint push (KeysPanel's Refresh, which hands over the rows it just
 * fetched) is always the NEWER answer: it contacted the vendors server-side
 * for every provider at once. A probe run that started before it must not
 * overwrite it when it finally lands, and a probe run that probes nothing
 * must not publish its all-grey map over it either.
 */
describe("a key-maint push is not clobbered by a refresh", () => {
  const probeable = widget({ id: "quote", type: "table", source: ["FMP"] });

  it("survives a refresh that started before it", async () => {
    useWidgetRegistryStore.setState({ widgets: [probeable] });
    // The probe hangs until the push has landed, so the ORDER under test is
    // "push lands mid-flight, probe resolves after it".
    let release: (() => void) | undefined;
    fetchWidgetData.mockImplementation(
      () => new Promise<unknown>((resolve) => { release = () => resolve([]); }),
    );

    const run = useProviderKeysStore.getState().refresh();
    await vi.waitFor(() => expect(release).toBeDefined());

    useProviderKeysStore.getState().applyKeyMaintRows([
      keysRow({ test: { result: "auth_failed" } }),
    ]);
    expect(useProviderKeysStore.getState().probe.fmp).toBe("amber");

    release!();
    await run;

    // The probe would have said green. key-maint said amber, and said it
    // later, so amber is what the Library shows.
    expect(useProviderKeysStore.getState().probe.fmp).toBe("amber");
    expect(useProviderKeysStore.getState().source).toBe("key-maint");
  });

  it("survives a refresh whose own key-maint fetch answers after it", async () => {
    // The same race through the OTHER branch: this refresh asks key-maint
    // itself, and a push lands while that fetch is in flight. Both are
    // key-maint's answer, and the push is the later one.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys", endpoint: "keys" })],
    });
    let release: (() => void) | undefined;
    fetchWidgetData.mockImplementation(
      () => new Promise<unknown>((resolve) => { release = () => resolve([keysRow({ test: { result: "ok" } })]); }),
    );

    const run = useProviderKeysStore.getState().refresh();
    await vi.waitFor(() => expect(release).toBeDefined());

    useProviderKeysStore.getState().applyKeyMaintRows([
      keysRow({ test: { result: "auth_failed" } }),
    ]);

    release!();
    await run;

    expect(useProviderKeysStore.getState().probe.fmp).toBe("amber");
  });

  it("survives a refresh that probes nothing at all", async () => {
    // Every provider here is outside key-maint's registry, so no probe is
    // fired -- and the all-grey map the run built is not an answer about
    // anything. Publishing it used to erase what key-maint had said.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "fails", type: "table", source: ["OFR"] })],
    });
    useProviderKeysStore.getState().applyKeyMaintRows([
      keysRow({ test: { result: "auth_failed" } }),
    ]);

    await useProviderKeysStore.getState().refresh();

    expect(useProviderKeysStore.getState().probe.fmp).toBe("amber");
    expect(useProviderKeysStore.getState().source).toBe("key-maint");
    // The run's own finding still lands: a keyless provider is keyed.
    expect(useProviderKeysStore.getState().status.ofr).toBe("keyed");
  });
});
