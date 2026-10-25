// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { calendarName, type ExchangeCalendar } from "../calendar";
import { calendarIdsOf } from "../params";
import type { BackendConfig, WidgetDef } from "../types";
import { CalendarCache } from "./cache";
import { isOvernight } from "./catalogue";
import {
  CalendarError,
  LIMITS,
  parseBinding,
  type CalendarBinding,
  type CalendarBundle,
  type Policy,
} from "./contracts";
import { bundleCalendar } from "./resolver";
import { bundleWindow, calendarWindow, type BundleWindow } from "./window";

/** How a bundle is fetched: dataClient.fetchCalendarBundle in the app, a stub in tests. */
export type FetchBundle = (calendarId: string, window: BundleWindow) => Promise<unknown>;

/** One cache for the whole app (review I3: a new one per fetch never hit); the TemporalDB seam is handed it too. */
export const sharedBundleCache = new CalendarCache();

/**
 * Whose bundles these are: the backend and its credential, so two logins never share a private bundle. Only ever a
 * Map key, never logged or sent.
 */
export function bundleScope(backend: BackendConfig): string {
  const { id, baseUrl, authLocation, headerName = "", headerValue = "" } = backend;
  return JSON.stringify([id, baseUrl, authLocation, headerName, headerValue]);
}

/**
 * Forgets every bundle and refusal, and orphans whatever is in flight; the backends store calls it on a credential
 * change.
 */
export function clearCalendarBundles(): void {
  sharedBundleCache.clear();
}

const keyOf = (backend: BackendConfig, calendarId: string, window: BundleWindow) =>
  JSON.stringify([bundleScope(backend), calendarId, window.start, window.end]);

// Every key and fetch uses the clamped window, so a card's window and the one fetched always meet in the cache.

/** One bundle from the cache, or its standing refusal, without fetching. */
export function peekCalendarBundle(backend: BackendConfig, calendarId: string, window: BundleWindow) {
  return sharedBundleCache.peek(keyOf(backend, calendarId, calendarWindow(calendarId, window)));
}

/** Forgets one bundle's standing refusal, so a Retry asks the backend again instead of waiting out REFUSAL_MS. */
export function forgetCalendarRefusal(backend: BackendConfig, calendarId: string, window: BundleWindow): void {
  sharedBundleCache.forget(keyOf(backend, calendarId, calendarWindow(calendarId, window)));
}

/**
 * One bundle, fetched at most once per scope, calendar and window. It may cover more than the window (openbq-docker
 * answers whole years); a bundle's own coverage is what its operations check, so a thinner one fails at resolution
 * with its coverage named, never silently.
 */
export async function loadCalendarBundle(
  backend: BackendConfig,
  calendarId: string,
  window: BundleWindow,
  fetchBundle: FetchBundle,
  signal: AbortSignal,
): Promise<CalendarBundle> {
  const clamped = calendarWindow(calendarId, window);
  const bundle = await sharedBundleCache.load(
    keyOf(backend, calendarId, clamped),
    async () => {
      const payload = await fetchBundle(calendarId, clamped);
      // The contract's own ceiling (review minor: the client never enforced it).
      if (JSON.stringify(payload).length > LIMITS.bytes) {
        throw new CalendarError("RESOURCE_LIMIT", `${calendarId} bundle is larger than ${LIMITS.bytes} bytes`);
      }
      return payload;
    },
    signal,
  );
  if (bundle.calendarId !== calendarId) {
    throw new CalendarError("BUNDLE_REQUEST_MISMATCH", `Asked for ${calendarId}, served ${bundle.calendarId}`);
  }
  return bundle;
}

/** A calendar key (calendarOf's `mic`) as the binding that loads it. */
function bindingOf(id: string): CalendarBinding {
  return id.startsWith("binding:")
    ? parseBinding(JSON.parse(id.slice("binding:".length)))
    : parseBinding({ schemaVersion: 1, kind: "single", calendarId: `exchange:${id}` });
}

const membersOf = (b: CalendarBinding): string[] => (b.kind === "single" ? [b.calendarId] : b.members);

/**
 * The calendars a card resolves on openbq-docker's bundles: all of them on an opted-in card, and only the overnight
 * ones on any other (spec "Overnight calendars": the weekday table cannot describe a session crossing midnight).
 */
function bundleIdsOf(widget: WidgetDef, values: Record<string, string>, exchange: string | undefined, expressionsOnly = false): string[] {
  const ids = calendarIdsOf(widget, values, exchange, expressionsOnly);
  return widget.calendarBinding ? ids : ids.filter(isOvernight);
}

/** A stand-in that says why there is no calendar; any atom that needs one shows this (dateExpressions.ts). */
function unavailable(id: string, reason: string): ExchangeCalendar {
  return {
    code: id,
    name: calendarName(id),
    timezone: "UTC",
    session: { open: "00:00:00", close: "00:00:00", workingDays: [] },
    holidays: {},
    years: [],
    source: "backend",
    unavailable: `${calendarName(id)} calendar unavailable: ${reason}`,
  };
}

/** What an opted-in card resolves on, and whether it must wait; `key` moves exactly when the calendars do. */
export type WidgetCalendars = { calendars: Record<string, ExchangeCalendar>; pending: boolean; key: string };

/**
 * A card's bundle calendars (every one on an opted-in card, the overnight ones on any other) from the cache, synchronously, for render: a bundle calendar per key, else a
 * placeholder naming why ("still loading", or the refusal). `pending` is true only when a value that is an
 * EXPRESSION needs a calendar still loading, so a card of literal dates never waits. `failed` (calendarId to message)
 * names the bundles a load just failed on that the cache does not remember (a network error, a 5xx: ruling R10a);
 * each shows as that error rather than "still loading", which would hold the card forever.
 */
export function peekWidgetCalendars(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, string>,
  exchange: string | undefined,
  now: Date,
  failed: Record<string, string> = {},
): WidgetCalendars {
  const window = bundleWindow(Object.values(values), now);
  const policy = (widget.calendarResolutionPolicy ?? "operational-v1") as Policy;
  const needed = new Set(bundleIdsOf(widget, values, exchange, true));
  const calendars: Record<string, ExchangeCalendar> = {};
  const parts: string[] = [];
  let pending = false;
  for (const id of bundleIdsOf(widget, values, exchange)) {
    try {
      if (policy !== "operational-v1" && policy !== "planning-v1") {
        throw new CalendarError(
          "INVALID_POLICY",
          `calendarResolutionPolicy ${String(policy)} is not operational-v1 or planning-v1`,
        );
      }
      const binding = bindingOf(id);
      const members = membersOf(binding);
      const states = members.map((m) => peekCalendarBundle(backend, m, window));
      const refusal =
        states.find((s) => s.refusal !== undefined)?.refusal ??
        members.map((m, i) => (states[i].bundle ? undefined : failed[m])).find((f) => f !== undefined);
      if (refusal !== undefined) throw new CalendarError("CALENDAR_UNAVAILABLE", refusal);
      if (states.some((s) => !s.bundle)) {
        if (needed.has(id)) pending = true;
        calendars[id] = unavailable(id, "still loading");
        parts.push(`${id}:?`);
        continue;
      }
      const bundles = states.map((s) => s.bundle!);
      calendars[id] = bundleCalendar(bundles, binding, policy);
      parts.push(`${id}:${bundles.map((b) => b.digest).join("+")}`);
    } catch (e) {
      calendars[id] = unavailable(id, e instanceof Error ? e.message : String(e));
      parts.push(`${id}:!${calendars[id].unavailable}`);
    }
  }
  return { calendars, pending, key: `${window.start}..${window.end}|${parts.join("|")}${pending ? "|pending" : ""}` };
}

/**
 * Loads every bundle an opted-in card names, then answers as peekWidgetCalendars does, with each failure in
 * `failed` (calendarId to message) and on its calendar. One refusal hides no other answer.
 */
export async function loadWidgetCalendars(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, string>,
  exchange: string | undefined,
  now: Date,
  fetchBundle: FetchBundle,
  signal: AbortSignal,
): Promise<WidgetCalendars & { failed: Record<string, string> }> {
  const window = bundleWindow(Object.values(values), now);
  const members = widgetMembers(widget, values, exchange);
  const results = await Promise.allSettled(members.map((m) => loadCalendarBundle(backend, m, window, fetchBundle, signal)));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const failed: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.status === "rejected") failed[members[i]] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });
  return { ...peekWidgetCalendars(backend, widget, values, exchange, now, failed), failed };
}

/**
 * Every bundle (calendarId) a card's bundle calendars are built from: all on an opted-in card, the overnight ones on
 * any other.
 */
function widgetMembers(widget: WidgetDef, values: Record<string, string>, exchange: string | undefined): string[] {
  const members = new Set<string>();
  for (const id of bundleIdsOf(widget, values, exchange)) {
    try {
      for (const m of membersOf(bindingOf(id))) members.add(m);
    } catch {
      // An invalid binding: peekWidgetCalendars puts its error on the placeholder.
    }
  }
  return [...members];
}

/** Forgets the standing refusal of every bundle a card resolves on (widgetMembers): the card's Retry (ruling R10a). */
export function forgetWidgetRefusals(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, string>,
  exchange: string | undefined,
  now: Date,
): void {
  const window = bundleWindow(Object.values(values), now);
  for (const m of widgetMembers(widget, values, exchange)) forgetCalendarRefusal(backend, m, window);
}
