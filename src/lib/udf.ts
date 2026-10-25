// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";

/**
 * TradingView's UDF ("Universal Data Feed") history route, the one UDF route
 * an `advanced_charting` widget's chart needs. The widget's `endpoint` is the
 * UDF base (`/udf` on the reference backend); `/config`, `/search`,
 * `/symbols` and `/time` exist there too and are deliberately never called --
 * this card draws one symbol at one resolution, so none of them has a
 * question to answer.
 *
 * The URL itself is NOT built here: the request goes through dataClient's
 * fetchWidgetData, exactly like every other card's, so the backend's
 * credential placement, connect timeout and error wording apply unchanged.
 * This file only says which endpoint and which query to ask it for, and what
 * the answer means.
 */

/** One daily bar. `time` is unix SECONDS, as UDF sends it and lightweight-charts takes it. */
export type UdfBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** `{endpoint}/history`, whatever trailing slashes the manifest wrote. */
export function udfHistoryEndpoint(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/history`;
}

const YEAR_S = 365 * 24 * 60 * 60;

/**
 * The fixed window: daily bars from a year ago to now. No picker -- the
 * spec draws one window, and a window nobody chose is one less control.
 */
export function udfHistoryParams(symbol: string, nowMs: number): Record<string, string> {
  const to = Math.floor(nowMs / 1000);
  return { symbol, resolution: "D", from: String(to - YEAR_S), to: String(to) };
}

const NOT_UDF = "not a UDF history payload";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * `s:"ok"` -> bars; `s:"no_data"` -> []; `s:"error"` -> throws the backend's
 * `errmsg`; anything else -> throws "not a UDF history payload", so a
 * malformed answer is an error card and never a blank chart.
 *
 * A row whose time or OHLC is not a finite number is dropped rather than
 * failing the whole series. Volume is optional in UDF, so a missing `v` (or a
 * non-numeric entry in it) reads as 0. Bars come back sorted by time with a
 * repeated time collapsed to its LAST row: lightweight-charts asserts strictly
 * ascending times and throws from setData otherwise.
 */
export function parseUdfHistory(payload: unknown): UdfBar[] {
  if (!isRecord(payload)) throw new Error(NOT_UDF);
  if (payload.s === "no_data") return [];
  if (payload.s === "error") {
    throw new Error(typeof payload.errmsg === "string" && payload.errmsg !== "" ? payload.errmsg : "UDF error");
  }
  if (payload.s !== "ok") throw new Error(NOT_UDF);

  const cols = [payload.t, payload.o, payload.h, payload.l, payload.c];
  const v = payload.v;
  if (!cols.every(Array.isArray) || (v !== undefined && !Array.isArray(v))) throw new Error(NOT_UDF);
  const [t, o, h, l, c] = cols as unknown[][];
  const n = t.length;
  if ([o, h, l, c, ...(v === undefined ? [] : [v as unknown[]])].some((a) => a.length !== n)) {
    throw new Error(`${NOT_UDF} (arrays of unequal length)`);
  }

  const byTime = new Map<number, UdfBar>();
  for (let i = 0; i < n; i++) {
    const [time, open, high, low, close] = [t[i], o[i], h[i], l[i], c[i]];
    if (!isNum(time) || !isNum(open) || !isNum(high) || !isNum(low) || !isNum(close)) continue;
    const vol = v === undefined ? undefined : (v as unknown[])[i];
    byTime.set(time, { time, open, high, low, close, volume: isNum(vol) ? vol : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
