// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchFiscalYearEnd = vi.fn();
vi.mock("../lib/dataClient", async (orig) => ({ ...(await orig<typeof import("../lib/dataClient")>()), fetchFiscalYearEnd: (...a: unknown[]) => fetchFiscalYearEnd(...a) }));

import { __resetStatementYearEndsForTests, correctStatementData } from "./useStatementYearEnds";
import { useStatementRows } from "./useStatementRows";

const backend = { id: "b1", name: "API", baseUrl: "https://api.example.com/" } as never;
const statement = { params: [{ paramName: "period", label: "Period", type: "text", value: "quarter", options: [{ label: "Annual", value: "annual" }, { label: "Quarter", value: "quarter" }] }] } as never;
const raw = [{ symbol: "AAPL", period_ending: "2025-12-27", fiscal_period: "Q4", fiscal_year: 2025 }];
const query = { symbol: "AAPL", period: "quarter" };

describe("useStatementRows", () => {
  afterEach(() => { fetchFiscalYearEnd.mockReset(); __resetStatementYearEndsForTests(); });

  it("relabels a statement's rows from the year end; raw until it is known", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "September" });
    const { result } = renderHook(() => useStatementRows(statement, backend, query, raw));
    expect(result.current).toEqual({ data: raw, asReported: false });
    await waitFor(() => expect(result.current.data).not.toBe(raw));
    expect(result.current).toEqual({ data: [{ ...raw[0], fiscal_period: "FQ1", fiscal_year: "FY2026" }], asReported: false });
  });

  it("flags rows it cannot relabel as reported", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    const { result } = renderHook(() => useStatementRows(statement, backend, query, raw));
    await waitFor(() => expect(result.current.asReported).toBe(true));
    expect(result.current.data).toEqual(raw);
  });

  it("passes a non-statement widget's rows through without a lookup", () => {
    const { result } = renderHook(() => useStatementRows({ params: [] } as never, backend, query, raw));
    expect(result.current).toEqual({ data: raw, asReported: false });
    expect(fetchFiscalYearEnd).not.toHaveBeenCalled();
  });

  it("relabels retained snapshot rows without losing acquisition evidence or mutating the response", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "September" });
    const snapshot = { rows: raw, completeness: "partial", receipt: { symbol: "AAPL" }, chart_evidence: { origin: "acquired" } };
    const before = structuredClone(snapshot);
    const { result } = renderHook(() => useStatementRows(statement, backend, query, snapshot));
    expect(result.current).toEqual({ data: snapshot, asReported: false });
    await waitFor(() => expect(result.current.data).toEqual({ ...snapshot, rows: [{ ...raw[0], fiscal_period: "FQ1", fiscal_year: "FY2026" }] }));
    expect(result.current.asReported).toBe(false);
    expect(snapshot).toEqual(before);
    expect((result.current.data as typeof snapshot).receipt).toBe(snapshot.receipt);
    expect((result.current.data as typeof snapshot).chart_evidence).toBe(snapshot.chart_evidence);
  });

  it("flags an uncorrectable retained snapshot as reported while preserving its envelope", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    const snapshot = { rows: raw, completeness: "partial", receipt: { symbol: "AAPL" } };
    const { result } = renderHook(() => useStatementRows(statement, backend, query, snapshot));
    await waitFor(() => expect(result.current.asReported).toBe(true));
    expect(result.current.data).toEqual(snapshot);
  });

  it("corrects the headless and Rita snapshot boundary with the same preserved evidence", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "September" });
    const snapshot = { rows: raw, completeness: "partial", receipt: { symbol: "AAPL" }, chart_evidence: { origin: "acquired" } };
    const before = structuredClone(snapshot);
    const corrected = await correctStatementData(backend, statement, query, snapshot);
    expect(corrected).toEqual({ ...snapshot, rows: [{ ...raw[0], fiscal_period: "FQ1", fiscal_year: "FY2026" }] });
    expect(snapshot).toEqual(before);
    expect((corrected as typeof snapshot).chart_evidence).toBe(snapshot.chart_evidence);
    expect(await correctStatementData(backend, { params: [] } as never, query, snapshot)).toBe(snapshot);
  });
});
