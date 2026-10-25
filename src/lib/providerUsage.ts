// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { KeyCheck, Usage, UsageWindow } from "./providerKeys";

const WINDOWS: readonly UsageWindow[] = ["day", "hour", "minute", "period"];

const WINDOW_PHRASE: Record<UsageWindow, string> = {
  day: "today",
  hour: "this hour",
  minute: "this minute",
  period: "this period",
};

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The credential check's usage, or undefined when key-maint sent none or sent
 * one this app cannot trust. key-maint's JSON is untrusted like any other: a
 * bad `used`/`limit`/`window` drops the whole usage, a bad optional field only
 * drops that field.
 */
export function credentialUsage(checks: KeyCheck[] | undefined): Usage | undefined {
  const raw: unknown = checks?.find((c) => c?.kind === "credential")?.usage;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { used, limit, window, resets_at, extra } = raw as Record<string, unknown>;
  if (!isCount(used) || !isCount(limit) || limit === 0) return undefined;
  if (!WINDOWS.includes(window as UsageWindow)) return undefined;
  return {
    used,
    limit,
    window: window as UsageWindow,
    ...(typeof resets_at === "string" ? { resets_at } : {}),
    ...(isCount(extra) ? { extra } : {}),
  };
}

/** The dashboard card's line: "API calls: 1,234 / 100,000 today". */
export function usageCardLine(u: Usage): string {
  return `API calls: ${u.used.toLocaleString()} / ${u.limit.toLocaleString()} ${WINDOW_PHRASE[u.window]}`;
}

/** Details' headline: "1,234 of 100,000 calls today (1.2%)". */
export function usageSummary(u: Usage): string {
  const pct = ((u.used / u.limit) * 100).toFixed(1);
  return `${u.used.toLocaleString()} of ${u.limit.toLocaleString()} calls ${WINDOW_PHRASE[u.window]} (${pct}%)`;
}

/**
 * "Resets 00:00 UTC · in 9h 12m"; the date is added when the reset is a day or
 * more away, and the countdown is dropped once the time has passed. Undefined
 * without a parseable resets_at -- never "Invalid Date".
 */
export function usageResetLine(u: Usage, now: Date = new Date()): string | undefined {
  if (u.resets_at === undefined) return undefined;
  const at = new Date(u.resets_at);
  if (Number.isNaN(at.getTime())) return undefined;
  const iso = at.toISOString();
  const ms = at.getTime() - now.getTime();
  const when = ms < 86_400_000 ? `${iso.slice(11, 16)} UTC` : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return ms > 0 ? `Resets ${when} · in ${until(ms)}` : `Resets ${when}`;
}

/** The two largest units of a positive duration: "2d 15h", "9h 12m", "4m". */
function until(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under a minute";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
