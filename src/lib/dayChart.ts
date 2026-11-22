// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type DayPoint = { time: string; value: number | null };
export type DayTile = {
  symbol: string; name: string | null; logo_path: string | null;
  session: { date: string | null; timezone: string; label: string; status: "open" | "closed" | "unknown" };
  previous_close: number | null; price: number | null; change: number | null; change_percent: number | null;
  points: DayPoint[]; as_of: string | null; status: "ok" | "partial" | "empty" | "error";
  source: string; coverage: unknown; error_code?: string;
};

const CURRENCIES = new Set("USD EUR GBP JPY CHF AUD NZD CAD SEK NOK DKK PLN CZK HUF TRY ZAR MXN SGD HKD CNH ILS THB KRW INR BRL".split(" "));
function normalizeDaySymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  const suffix = symbol.match(/\.(US|CC|FOREX)$/);
  if (!suffix) return symbol;
  const bare = symbol.slice(0, -suffix[0].length);
  const feed = bare.endsWith("=F") ? "futures" : bare.includes("-") ? "CC"
    : bare.length === 6 && CURRENCIES.has(bare.slice(0,3)) && CURRENCIES.has(bare.slice(3)) ? "FOREX" : "US";
  return feed === suffix[1] && /^[A-Z0-9^_$-]{1,48}$/.test(bare) ? bare : symbol;
}
/** Entries are positions, not a set. Only acquisition deduplicates them. */
export function daySymbols(value: string): string[] {
  const entries = value.split(",").map(normalizeDaySymbol).filter(Boolean);
  if (entries.length > 50) throw new Error("Day Chart supports at most 50 symbol entries.");
  return entries;
}
const record = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const text = (x: unknown): string | null => typeof x === "string" ? x : null;
const number = (x: unknown): number | null => typeof x === "number" && Number.isFinite(x) ? x : null;
export function failedDayTile(symbol: string, error_code = "unavailable"): DayTile {
  return { symbol, name: null, logo_path: null, session: { date: null, timezone: "UTC", label: "Session unavailable", status: "unknown" }, previous_close: null, price: null, change: null, change_percent: null, points: [], as_of: null, status: "error", source: "eodhd", coverage: null, error_code };
}
export function parseDayCharts(value: unknown): Record<string, DayTile> {
  const root = record(value);
  if (root?.schema_version !== 1 || !Array.isArray(root.tiles)) throw new Error("Unsupported Day Chart schema.");
  const out: Record<string, DayTile> = Object.create(null) as Record<string, DayTile>;
  for (const raw of root.tiles.slice(0, 20)) {
    const tile = record(raw);
    const symbol = text(tile?.symbol)?.trim().toUpperCase();
    if (!tile || !symbol) continue;
    const session = record(tile.session);
    if (!session || !Array.isArray(tile.points) || !["ok", "partial", "empty", "error"].includes(String(tile.status))) {
      out[symbol] = failedDayTile(symbol, "invalid_response");
      continue;
    }
    const points: DayPoint[] = [];
    let last = -Infinity;
    for (const rawPoint of tile.points.slice(0, 10000)) {
      const p = record(rawPoint);
      const time = text(p?.time);
      const at = time === null ? NaN : Date.parse(time);
      if (!time || !Number.isFinite(at) || at <= last) continue;
      points.push({ time, value: number(p?.value) });
      last = at;
    }
    let timezone = text(session.timezone) ?? "UTC";
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = "UTC"; }
    out[symbol] = {
      symbol, name: text(tile.name), logo_path: text(tile.logo_path),
      session: { date: text(session.date), timezone, label: text(session.label) ?? "Session", status: session.status === "open" || session.status === "closed" ? session.status : "unknown" },
      previous_close: number(tile.previous_close), price: number(tile.price), change: number(tile.change), change_percent: number(tile.change_percent),
      points, as_of: text(tile.as_of), status: tile.status as DayTile["status"], source: text(tile.source) ?? "unknown", coverage: tile.coverage,
      ...(typeof tile.error_code === "string" ? { error_code: tile.error_code } : {}),
    };
  }
  return out;
}

/** Null bars break the line; time spacing is preserved. No quote synthesis. */
export function dayLine(points: DayPoint[], previousClose: number | null): {path:string;low:number|null;high:number|null;referenceY:number|null;lastPoint:{x:number;y:number}|null} {
  const values = points.flatMap((p) => p.value === null ? [] : [p.value]);
  if (previousClose !== null) values.push(previousClose);
  if (values.length === 0 || points.length === 0) return { path: "", low: null, high: null, referenceY: null, lastPoint: null };
  const low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max((high - low) * 0.08, Math.abs(high) * 0.0001, 0.001);
  const y = (v: number) => 104 - (v - low + pad) / (high - low + 2 * pad) * 96;
  const first = Date.parse(points[0].time), span = Math.max(1, Date.parse(points.at(-1)!.time) - first);
  let pen = false;
  let lastPoint: {x:number;y:number} | null = null;
  const path = points.map((p) => {
    if (p.value === null) { pen = false; return ""; }
    lastPoint = {x:8 + (Date.parse(p.time) - first) / span * 254,y:y(p.value)};
    const command = `${pen ? "L" : "M"}${(8 + (Date.parse(p.time) - first) / span * 254).toFixed(2)},${y(p.value).toFixed(2)}`;
    pen = true;
    return command;
  }).join(" ");
  return { path, low, high, lastPoint, referenceY: previousClose === null ? null : y(previousClose) };
}
