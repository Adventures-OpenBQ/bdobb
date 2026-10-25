// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchFiscalYearEnd = vi.fn();
vi.mock("../lib/dataClient", async (orig) => ({ ...(await orig<typeof import("../lib/dataClient")>()), fetchFiscalYearEnd: (...a: unknown[]) => fetchFiscalYearEnd(...a) }));

const logOnce = vi.fn(async () => {});
vi.mock("../lib/logger", async (orig) => ({ ...(await orig<typeof import("../lib/logger")>()), logOnce: (...a: unknown[]) => logOnce(...(a as [])) }));

import { lookupFiscalYearEnd } from "./useFiscalYearEnd";
import { __resetStatementYearEndsForTests, useStatementYearEnds } from "./useStatementYearEnds";

const backend = { id: "b1", name: "API", baseUrl: "https://api.example.com/" } as never;

describe("useStatementYearEnds", () => {
  afterEach(() => { fetchFiscalYearEnd.mockReset(); logOnce.mockClear(); __resetStatementYearEndsForTests(); });

  it("asks once per symbol and maps the answer to a month; a miss is null", async () => {
    fetchFiscalYearEnd.mockImplementation(async (_b, s: string) => (s === "WMT" ? { fiscalYearEnd: "January" } : null));
    const { result } = renderHook(() => useStatementYearEnds(backend, ["WMT", "ZZZZ"]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.months).toEqual({ WMT: 1, ZZZZ: null });
    const again = renderHook(() => useStatementYearEnds(backend, ["WMT"]));
    await waitFor(() => expect(again.result.current.pending).toBe(false));
    expect(fetchFiscalYearEnd).toHaveBeenCalledTimes(2);
  });

  it("asks nothing for no symbols (never an empty symbol=)", () => {
    const { result } = renderHook(() => useStatementYearEnds(backend, []));
    expect(result.current).toEqual({ months: {}, pending: false });
    expect(fetchFiscalYearEnd).not.toHaveBeenCalled();
  });

  it("a failed request is null, not a crash", async () => {
    fetchFiscalYearEnd.mockRejectedValue(new Error("502"));
    const { result } = renderHook(() => useStatementYearEnds(backend, ["AAPL"]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.months).toEqual({ AAPL: null });
    // Logged once, under the key and wording useFiscalYearEnd's own lookup uses.
    expect(logOnce).toHaveBeenCalledWith("fiscal-lookup:b1\nhttps://api.example.com/|AAPL", "fiscal year end lookup failed for AAPL: 502");
  });

  it("shares the lookup cache with useFiscalYearEnd: a symbol it already asked is not asked again", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "January" });
    await lookupFiscalYearEnd(backend, "WMT");
    const { result } = renderHook(() => useStatementYearEnds(backend, ["wmt"]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.months).toEqual({ WMT: 1 });
    expect(fetchFiscalYearEnd).toHaveBeenCalledTimes(1);
  });

  it("an emptied symbol list drops the last answer instead of keeping it", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "January" });
    const { result, rerender } = renderHook(({ s }) => useStatementYearEnds(backend, s), { initialProps: { s: ["WMT"] } });
    await waitFor(() => expect(result.current.months).toEqual({ WMT: 1 }));
    rerender({ s: [] });
    expect(result.current).toEqual({ months: {}, pending: false });
  });
});
