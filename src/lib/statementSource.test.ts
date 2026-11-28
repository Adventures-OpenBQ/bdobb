// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import type { fetchWidgetData } from "./dataClient";
import { statementFixture } from "./statementModel/fixtures/load";
import { correctStatementRows } from "./statementFiscal";
import { STATEMENT_SYMBOL_LIMIT, fetchStatementData, stampStatementRows, statementSymbolList } from "./statementSource";
import type { Row } from "./tableColumns";
import type { BackendConfig, WidgetDef } from "./types";

type FetchOne = typeof fetchWidgetData;
const backend = { id: "b", name: "Libre data", baseUrl: "http://127.0.0.1:7900" } as BackendConfig;
const statement = (symbol: object = {}): WidgetDef => ({
  id: "income", name: "Income", type: "table", endpoint: "/api/v1/equity/fundamental/income",
  params: [
    { paramName: "symbol", type: "text", ...symbol },
    { paramName: "period", type: "text", options: [{ label: "annual", value: "annual" }, { label: "quarter", value: "quarter" }] },
  ],
} as unknown as WidgetDef);
const notStatement = { ...statement(), params: [{ paramName: "symbol", type: "text" }] } as unknown as WidgetDef;

/** A backend that answers one symbol per request, as Libre Terminal's statement routes do. */
function oneSymbolBackend(rows: Record<string, Row[] | Error>) {
  const asked: string[] = [];
  const fetchOne = vi.fn(async (_b, _w, params, _ctx, _signal, onWarnings, onAcquisition) => {
    asked.push(params.symbol);
    onAcquisition?.({ endpoint: "/api/v1/equity/fundamental/income", parameters: { symbol: params.symbol }, retrievedAt: 1 });
    if (params.symbol.includes(",")) return [];
    const answer = rows[params.symbol];
    if (answer === undefined) throw new Error(`HTTP 400: no data for ${params.symbol}`);
    if (answer instanceof Error) throw answer;
    onWarnings?.([`warning for ${params.symbol}`]);
    return answer;
  }) as unknown as FetchOne;
  return { fetchOne, asked };
}
const annual = (symbol: string) => statementFixture(`libre/${symbol.toLowerCase()}-yfinance-income-annual`).rows;

describe("statementSymbolList", () => {
  it("is the card's symbols, upper-cased and distinct, for a statement widget naming several", () => {
    expect(statementSymbolList(statement(), { symbol: " aapl, WMT ,aapl", period: "annual" })).toEqual(["AAPL", "WMT"]);
  });
  it("is null for one symbol, no symbol, a widget that is not a statement, and a multi-select ticker", () => {
    expect(statementSymbolList(statement(), { symbol: "AAPL", period: "annual" })).toBeNull();
    expect(statementSymbolList(statement(), { period: "annual" })).toBeNull();
    expect(statementSymbolList(notStatement, { symbol: "AAPL,WMT" })).toBeNull();
    expect(statementSymbolList(statement({ multiSelect: true, options: [{ label: "A", value: "A" }] }), { symbol: "AAPL,WMT", period: "annual" })).toBeNull();
  });
});

describe("stampStatementRows", () => {
  it("puts the company first and records the period that was asked", () => {
    const [row] = stampStatementRows([{ period_ending: "2026-01-31", total_revenue: 1 }], "WMT", "annual");
    expect(Object.keys(row)).toEqual(["symbol", "period_ending", "total_revenue", "period_kind"]);
    expect(row).toMatchObject({ symbol: "WMT", period_kind: "FY" });
    expect(stampStatementRows([{ total_revenue: 1 }], "WMT", "quarterly")[0].period_kind).toBe("FQ");
  });
  it("keeps a symbol and a period kind the backend sent, and never edits its input", () => {
    const served = [{ symbol: "wmt", period_kind: "FY", total_revenue: 1 }];
    expect(stampStatementRows(served, "WMT", "annual")).toEqual(served);
    expect(stampStatementRows(served, "WMT", "annual")[0]).not.toBe(served[0]);
  });
});

describe("fetchStatementData", () => {
  it("makes the one request, untouched, for one symbol or a widget that is not a statement", async () => {
    const fetchOne = vi.fn(async () => "the backend's answer") as unknown as FetchOne;
    const one = [backend, statement(), { symbol: "AAPL", period: "annual" }] as const;
    expect(await fetchStatementData(fetchOne, ...one)).toBe("the backend's answer");
    expect(await fetchStatementData(fetchOne, backend, notStatement, { symbol: "AAPL,WMT" })).toBe("the backend's answer");
    expect(fetchOne).toHaveBeenCalledTimes(2);
    expect(fetchOne).toHaveBeenNthCalledWith(1, ...one);
  });

  it("keeps a backend's own answer to a list: one request, nothing stamped", async () => {
    const listed = [{ symbol: "AAPL", total_revenue: 1 }, { symbol: "WMT", total_revenue: 2 }];
    const fetchOne = vi.fn(async () => listed) as unknown as FetchOne;
    expect(await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" })).toBe(listed);
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it("asks each symbol by itself when the list comes back empty, in the card's order", async () => {
    const { fetchOne, asked } = oneSymbolBackend({ AAPL: annual("AAPL"), WMT: annual("WMT") });
    const out = (await fetchStatementData(fetchOne, backend, statement(), { symbol: "WMT,AAPL", period: "annual" })) as Row[];
    expect(asked).toEqual(["WMT,AAPL", "WMT", "AAPL"]);
    expect(out).toHaveLength(annual("WMT").length + annual("AAPL").length);
    expect(out.map((r) => r.symbol)).toEqual([...annual("WMT").map(() => "WMT"), ...annual("AAPL").map(() => "AAPL")]);
    expect(out.every((r) => r.period_kind === "FY")).toBe(true);
  });

  it("asks each symbol by itself when the list is refused", async () => {
    const rows = { AAPL: annual("AAPL"), WMT: annual("WMT") };
    const fetchOne = vi.fn(async (_b, _w, params) => {
      if (params.symbol.includes(",")) throw new Error("HTTP 400: Could not find CIK for symbol: AAPL,WMT");
      return rows[params.symbol as "AAPL"];
    }) as unknown as FetchOne;
    const out = (await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" })) as Row[];
    expect(new Set(out.map((r) => r.symbol))).toEqual(new Set(["AAPL", "WMT"]));
  });

  it("names a symbol that fails in the notices and still returns the rest", async () => {
    const { fetchOne } = oneSymbolBackend({ AAPL: annual("AAPL"), WMT: annual("WMT") });
    const warnings = vi.fn();
    const out = (await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,NOPE,WMT", period: "annual" }, undefined, undefined, warnings)) as Row[];
    expect(new Set(out.map((r) => r.symbol))).toEqual(new Set(["AAPL", "WMT"]));
    const said = warnings.mock.calls.at(-1)![0] as string[];
    expect(said).toContain("warning for AAPL");
    expect(said.filter((w) => w.startsWith("No statement for NOPE: "))).toHaveLength(1);
    expect(said.some((w) => w.startsWith("No statement for AAPL"))).toBe(false);
  });

  it("throws the first failure when every symbol fails", async () => {
    const { fetchOne } = oneSymbolBackend({});
    await expect(fetchStatementData(fetchOne, backend, statement(), { symbol: "AAA,BBB", period: "annual" })).rejects.toThrow("no data for AAA");
  });

  it("asks nothing one by one past the limit, and says what the limit is", async () => {
    const { fetchOne, asked } = oneSymbolBackend({});
    const symbols = Array.from({ length: STATEMENT_SYMBOL_LIMIT + 1 }, (_, i) => `S${i}`).join(",");
    await expect(fetchStatementData(fetchOne, backend, statement(), { symbol: symbols, period: "annual" })).rejects.toThrow(`at most ${STATEMENT_SYMBOL_LIMIT}`);
    expect(asked).toEqual([symbols]);
  });

  it("stops at an abort without asking the next symbol", async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const fetchOne = vi.fn(async (_b, _w, params) => {
      asked.push(params.symbol);
      if (params.symbol.includes(",")) return [];
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as FetchOne;
    await expect(fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" }, undefined, controller.signal)).rejects.toThrow("aborted");
    expect(asked).toEqual(["AAPL,WMT", "AAPL"]);
  });

  it("reports the acquisition as the whole list, so a symbol list read from provenance is the card's", async () => {
    const { fetchOne } = oneSymbolBackend({ AAPL: annual("AAPL"), WMT: annual("WMT") });
    const acquired = vi.fn();
    await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" }, undefined, undefined, undefined, acquired);
    expect(acquired.mock.calls.at(-1)![0]).toEqual({ endpoint: "/api/v1/equity/fundamental/income", parameters: { symbol: "AAPL,WMT" }, retrievedAt: 1 });
  });

  it("identifies the card's request once, by the list it asked for", async () => {
    const urls: string[] = [];
    const fetchOne = vi.fn(async (_b, _w, params, _c, _s, _warn, _acq, onRequest) => {
      onRequest?.(`http://x/?symbol=${params.symbol}`, {});
      return params.symbol.includes(",") ? [] : annual(params.symbol);
    }) as unknown as FetchOne;
    await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" }, undefined, undefined, undefined, undefined, (url) => urls.push(url));
    expect(urls).toEqual(["http://x/?symbol=AAPL,WMT"]);
  });

  it("gives the fiscal relabelling what it needs: a January and a September filer each get their own year", async () => {
    const { fetchOne } = oneSymbolBackend({ AAPL: annual("AAPL"), WMT: annual("WMT") });
    const merged = (await fetchStatementData(fetchOne, backend, statement(), { symbol: "AAPL,WMT", period: "annual" })) as Row[];
    const out = correctStatementRows(merged, "annual", { AAPL: 9, WMT: 1 }, ["AAPL", "WMT"]);
    expect(out.asReported).toBe(false);
    const year = (symbol: string) => out.rows.find((r) => r.symbol === symbol)!;
    // WMT's year ending 2026-01-31 is its fiscal 2026; AAPL's ending 2026-09 is its fiscal 2026.
    expect([year("WMT").period_ending, year("WMT").fiscal_year, year("WMT").fiscal_period]).toEqual(["2026-01-31", "FY2026", "FY"]);
    expect(year("AAPL").fiscal_year).toBe("FY2026");
  });
});
