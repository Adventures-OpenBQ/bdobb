// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchFiscalYearEnd = vi.fn();
const fetchWidgetData = vi.fn();
vi.mock("../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../lib/dataClient")>()),
  fetchFiscalYearEnd: (...a: unknown[]) => fetchFiscalYearEnd(...a),
  fetchWidgetData: (...a: unknown[]) => fetchWidgetData(...a),
}));
vi.mock("../lib/logger", () => ({ logError: vi.fn(async () => undefined) }));

import { statementFixture } from "../lib/statementModel/fixtures/load";
import { stampStatementRows } from "../lib/statementSource";
import { __resetStatementYearEndsForTests } from "./useStatementYearEnds";
import { useStatementRows } from "./useStatementRows";

const backend = { id: "libre", name: "Libre data", baseUrl: "http://127.0.0.1:7900/" } as never;
const statement = {
  id: "income", type: "table",
  params: [
    { paramName: "symbol", type: "text" },
    { paramName: "period", type: "text", value: "annual", options: [{ label: "Annual", value: "annual" }, { label: "Quarter", value: "quarter" }] },
  ],
} as never;
const rows = (name: string) => statementFixture(name).rows;

/** A backend with no fiscal-year-end route: the lookup answers 404, which the client reads as null. */
describe("useStatementRows on a backend with no year-end lookup", () => {
  afterEach(() => { fetchFiscalYearEnd.mockReset(); fetchWidgetData.mockReset(); __resetStatementYearEndsForTests(); });

  it("labels annual rows from their own closing month, with no extra request", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    const raw = rows("libre/wmt-yfinance-income-annual");
    const { result } = renderHook(() => useStatementRows(statement, backend, { symbol: "WMT", period: "annual" }, raw));
    await waitFor(() => expect(result.current.data).not.toBe(raw));
    expect(result.current.asReported).toBe(false);
    expect((result.current.data as Record<string, unknown>[])[0]).toMatchObject({ period_ending: "2026-01-31", fiscal_year: "FY2026", fiscal_period: "FY" });
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });

  it("labels each company of a merged card by its own year", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    const raw = [
      ...stampStatementRows(rows("libre/aapl-yfinance-income-annual"), "AAPL", "annual"),
      ...stampStatementRows(rows("libre/wmt-yfinance-income-annual"), "WMT", "annual"),
    ];
    const { result } = renderHook(() => useStatementRows(statement, backend, { symbol: "AAPL,WMT", period: "annual" }, raw));
    await waitFor(() => expect(result.current.data).not.toBe(raw));
    const out = result.current.data as Record<string, unknown>[];
    const first = (symbol: string) => out.find((r) => r.symbol === symbol)!;
    expect([first("AAPL").period_ending, first("AAPL").fiscal_year]).toEqual(["2026-09-30", "FY2026"]);
    expect([first("WMT").period_ending, first("WMT").fiscal_year]).toEqual(["2026-01-31", "FY2026"]);
    expect(result.current.asReported).toBe(false);
  });

  it("asks one annual row to label a quarterly card, once per symbol", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    fetchWidgetData.mockResolvedValue(rows("libre/wmt-yfinance-income-annual").slice(0, 1));
    const raw = rows("libre/wmt-yfinance-income-quarter");
    const query = { symbol: "WMT", period: "quarter" };
    const { result, rerender } = renderHook(() => useStatementRows(statement, backend, query, raw));
    await waitFor(() => expect(result.current.data).not.toBe(raw));
    const july = (result.current.data as Record<string, unknown>[]).find((r) => r.period_ending === "2026-07-31")!;
    expect([july.fiscal_year, july.fiscal_period]).toEqual(["FY2027", "FQ2"]);
    expect(result.current.asReported).toBe(false);
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    expect(fetchWidgetData.mock.calls[0][2]).toMatchObject({ symbol: "WMT", period: "annual", limit: "1" });
    rerender();
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
  });

  it("leaves a quarterly card as reported when the annual row cannot be had", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    fetchWidgetData.mockRejectedValue(new Error("HTTP 500"));
    const raw = rows("libre/wmt-yfinance-income-quarter");
    const { result } = renderHook(() => useStatementRows(statement, backend, { symbol: "WMT", period: "quarter" }, raw));
    await waitFor(() => expect(result.current.asReported).toBe(true));
    expect(result.current.data).toEqual(raw);
  });

  it("prefers the lookup's answer to the rows' own", async () => {
    // A lookup that says March for a company whose annual rows close in January: the lookup is believed.
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "March" });
    const raw = rows("libre/wmt-yfinance-income-annual");
    const { result } = renderHook(() => useStatementRows(statement, backend, { symbol: "WMT", period: "annual" }, raw));
    await waitFor(() => expect(result.current.data).not.toBe(raw));
    // Year ending 2026-01-31 under a March year end falls in the fiscal year that ends March 2026.
    expect((result.current.data as Record<string, unknown>[])[0].fiscal_year).toBe("FY2026");
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });
});
