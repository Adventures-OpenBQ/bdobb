// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchEndpoint } from "../lib/dataClient";
import { useDayCharts } from "./useDayCharts";
import type { BackendConfig } from "../lib/types";
vi.mock("../lib/dataClient", () => ({ fetchEndpoint: vi.fn() }));
const backend = { id: "b", baseUrl: "https://h/backend", name: "b" } as BackendConfig;
const answer = (symbol: string) => ({ schema_version: 1, tiles: [{ symbol, status: "empty", session: {date:"2026-11-20", timezone:"America/New_York",label:"Regular",status:"closed"}, points: [] }] });
beforeEach(() => { vi.mocked(fetchEndpoint).mockReset().mockResolvedValue(answer("AAPL")); });
afterEach(() => { vi.useRealTimers(); });
it("deduplicates only acquisition and replaces group membership/blank while late work is pending", async () => {
  let finish!: (x: unknown) => void;
  vi.mocked(fetchEndpoint).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ symbols }) => useDayCharts(backend, symbols, symbols), {initialProps:{symbols:["AAPL", "AAPL"]}});
  await waitFor(() => expect(fetchEndpoint).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fetchEndpoint).mock.calls[0][2]).toEqual({symbol:"AAPL"});
  const signal = vi.mocked(fetchEndpoint).mock.calls[0][3];
  rerender({symbols:["MSFT"]});
  await waitFor(() => expect(result.current.tiles.MSFT?.status).toBe("error")); // missing tile is explicit
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(answer("AAPL")));
  expect(result.current.tiles.AAPL).toBeUndefined();
  rerender({symbols:[]});
  expect(result.current.tiles).toEqual({});
  expect(fetchEndpoint).toHaveBeenCalledTimes(2);
});
it("polls only nearby symbols, in serial batches of 20, without overlapping slow polls", async () => {
  vi.useFakeTimers();
  let finish!: (x: unknown) => void;
  vi.mocked(fetchEndpoint).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const symbols = Array.from({length:50}, (_,i) => `S${i}`);
  const { rerender } = renderHook(({ nearby }) => useDayCharts(backend, symbols, nearby), { initialProps: {nearby: symbols.slice(0,25)} });
  await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
  expect(fetchEndpoint).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchEndpoint).mock.calls[0][2].symbol.split(",")).toHaveLength(20);
  await act(async () => finish({schema_version:1,tiles:[]}));
  expect(fetchEndpoint).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchEndpoint).mock.calls[1][2].symbol).toBe(symbols.slice(20,25).join(","));
  rerender({nearby:["S49"]});
  await act(async () => {});
  expect(vi.mocked(fetchEndpoint).mock.lastCall?.[2]).toEqual({symbol:"S49"});
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(vi.mocked(fetchEndpoint).mock.lastCall?.[2]).toEqual({symbol:"S49"});
});
it("drops cached prices immediately on credential changes", async () => {
  const {result, rerender} = renderHook(({connection}) => useDayCharts(connection, ["AAPL"], ["AAPL"]), {initialProps:{connection:backend}});
  await waitFor(() => expect(result.current.tiles.AAPL).toBeDefined());
  vi.mocked(fetchEndpoint).mockReturnValueOnce(new Promise(() => {}));
  rerender({connection:{...backend, headerValue:"changed"}});
  expect(result.current.tiles).toEqual({});
});
