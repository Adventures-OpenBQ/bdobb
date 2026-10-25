// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import {
  bundledCalendar,
  inCalendarRange,
  isKnownCalendar,
  mergeCalendars,
  newTrace,
  normalizeCalendar,
  type CalendarTrace,
  type ExchangeCalendar,
} from "../lib/calendar";
import { isOvernight } from "../lib/calendars/catalogue";
import { fetchTradingCalendar } from "../lib/dataClient";
import { resolveValue } from "../lib/dateExpressions";
import { logOnce } from "../lib/logger";
import { calendarIdsOf, fieldContext, formDateExpressions, paramCalendarIds, paramsKey, wireParams } from "../lib/params";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { joinInFlight } from "./joinInFlight";

/** A calendar the per-year loader serves: any catalogue calendar but the overnight ones, which only bundles describe. */
const isLegacyCalendar = (mic: string): boolean => isKnownCalendar(mic) && !isOvernight(mic);

/**
 * Module-level, keyed by backend id + base URL + MIC + year — the same
 * discipline as useParamOptions' and useFiscalYearEnd's caches, for the same
 * reasons (an endpoint name is not unique across backends; a backend id can
 * be re-pointed). `null` is a REMEMBERED "no calendar": a 404, an unreadable
 * body, or a failed request. It is kept for the session so a backend that
 * serves no calendar — most of them — is asked once per year, not once per
 * card mount. An answer is merged into the MIC's calendar; a null leaves the
 * loader on the next rung (the bundled file for XNYS, the weekday table
 * otherwise).
 */
const cache = new Map<string, ExchangeCalendar | null>();
const inFlight = new Map<string, Promise<void>>();

/** Both maps outlive any one test; every test starts from empty. */
export function __resetTradingCalendarCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

export type TradingCalendars = {
  /** By MIC: the merged backend years, else the bundled file (XNYS), else no entry. */
  calendars: Record<string, ExchangeCalendar>;
  /**
   * True while a year the card's resolution CONSULTED (its trace) has neither
   * answered nor been refused. The up-front years alone never make it true.
   */
  pending: boolean;
  /**
   * What useWidgetData's fetch effect depends on, instead of fingerprinting
   * `calendars`: per MIC a resolution CONSULTED, the source of the calendar it
   * resolved on and each consulted year's cache state (answered, refused or
   * absent), plus the pending flag. A year no resolution consulted cannot
   * change the wire, so its landing moves nothing here — spec §5 lists no
   * "calendar arrived" refetch trigger, and the up-front years must not add
   * a request to a card whose values never read them.
   */
  key: string;
  /**
   * The MICs with a wanted year still being fetched (legacy loader only): a form refuses a value that would step on
   * weekdays meanwhile as "still loading" (ruling RF5).
   */
  loading?: string[];
  /**
   * The card's Retry for its calendars, where it has one: useBundleCalendars forgets the card's standing bundle
   * refusals and asks again (ruling R10a). The legacy per-year loader has none -- its misses fall back.
   */
  retry?: () => void;
};

const keyOf = (backendKey: string, mic: string, year: number) => `${backendKey}|${mic}|${year}`;

/**
 * One MIC's calendar from the cache: every backend year that answered,
 * merged; else the bundled file; else nothing (the resolver then uses the
 * weekday table). A year not yet in the cache is simply skipped — whether
 * the card waits for it is the hook's call, made on the consulted years.
 */
function assemble(backendKey: string, mic: string, years: Iterable<number>): ExchangeCalendar | undefined {
  let merged: ExchangeCalendar | undefined;
  for (const year of years) {
    if (!inCalendarRange(year)) continue;
    const hit = cache.get(keyOf(backendKey, mic, year));
    if (!hit) continue;
    merged = merged ? mergeCalendars(merged, hit) : hit;
  }
  return merged ?? bundledCalendar(mic) ?? undefined;
}

/**
 * Every calendar a card's values name -- the field's own (calendarOf: symbol, param, widget, dashboard, XNYS) and
 * each atom's `(MIC)` -- less unknown and overnight calendars, which the legacy loader never fetches. An opted-in
 * (`calendarBinding`) card resolves on bundles only (useBundleCalendars), so it names none here.
 */
function exchangesOf(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  dashboardExchange: string | undefined,
): string[] {
  if (!widget || widget.calendarBinding) return [];
  return calendarIdsOf(widget, values, dashboardExchange).filter(isLegacyCalendar);
}

/** useTradingCalendar's resolution over the cache as it stands: never fetches. */
function resolveCalendars(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backendKey: string,
  exchanges: string[],
  now: Date,
  fiscalYearEnd: Record<string, number> | undefined,
  dashboardExchange: string | undefined,
) {
  const year = now.getFullYear();
  const wanted = new Map<string, Set<number>>();
  for (const mic of exchanges) wanted.set(mic, new Set([year - 1, year]));
  // Every year a resolution consulted, per MIC, across both passes: the
  // only years `pending` waits on.
  const consulted = new Map<string, Set<number>>();
  let calendars: Record<string, ExchangeCalendar> = {};
  // Two passes: the second resolves on the calendars the first assembled,
  // so a year a business-day step crosses into is named even when the first
  // pass had no calendar to step on.
  for (let pass = 0; pass < 2; pass += 1) {
    calendars = {};
    for (const mic of exchanges) {
      const got = assemble(backendKey, mic, wanted.get(mic) ?? []);
      if (got) calendars[mic] = got;
    }
    if (!widget || exchanges.length === 0) break;
    const trace: Record<string, CalendarTrace> = {};
    wireParams(widget, values, { now, fiscalYearEnd, calendars, trace, exchange: dashboardExchange });
    for (const p of widget.params) {
      const seen = trace[p.paramName];
      if (!seen) continue;
      // A field's consulted years are filed under every calendar it resolves on; an extra year for an atom's
      // calendar costs one cached request, a missing one would resolve on weekdays.
      for (const mic of paramCalendarIds(widget, p, values, dashboardExchange).filter(isLegacyCalendar)) {
        for (const y of seen.years) {
          if (!inCalendarRange(y)) continue;
          wanted.get(mic)?.add(y);
          if (!consulted.has(mic)) consulted.set(mic, new Set());
          consulted.get(mic)?.add(y);
        }
      }
    }
    // Ruling RF5: a form date field's years are fetched like a param's, but go into `wanted` only -- never
    // `consulted` -- so a submit-driven form never holds the card's GET.
    for (const v of formDateExpressions(widget, values)) {
      const seen = newTrace();
      resolveValue("date", v, {
        now,
        ...fieldContext(widget, undefined, { calendars, exchange: dashboardExchange }, values),
        trace: seen,
        onError: () => {},
      });
      for (const mic of paramCalendarIds(widget, undefined, values, dashboardExchange, v).filter(isLegacyCalendar)) {
        for (const y of seen.years) if (inCalendarRange(y)) wanted.get(mic)?.add(y);
      }
    }
  }
  // With no backend nothing is ever pending; otherwise a consulted year the
  // cache holds neither an answer nor a remembered refusal for is a wait.
  const pending =
    backendKey !== "" &&
    [...consulted].some(([mic, years]) => [...years].some((y) => !cache.has(keyOf(backendKey, mic, y))));
  // The refetch key (see TradingCalendars.key). The source is in it
  // because a year landing can move a MIC from the bundled file to a
  // backend calendar without a consulted year that was refused: the
  // resolver then walks that year on the weekday table, a real change to
  // the wire that no consulted year's cache state shows. ponytail: a merged
  // backend calendar takes its hours and zone from its first year, so a
  // later year landing could in principle move them unseen here; one
  // backend answers one MIC's hours alike across years.
  const stateOf = (mic: string, y: number): string => {
    const k = keyOf(backendKey, mic, y);
    return cache.has(k) ? (cache.get(k) ? "a" : "r") : "?";
  };
  const key =
    [...consulted]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([mic, years]) =>
          `${mic}:${calendars[mic]?.source ?? "weekdays"}:` +
          [...years]
            .sort((a, b) => a - b)
            .map((y) => `${y}${stateOf(mic, y)}`)
            .join(","),
      )
      .join("|") + (pending ? "|pending" : "");
  // Every wanted year the cache did not hold as this memo ran. The effect
  // checks it again: a fetch another card started can land between this
  // render and this card's effect, which then finds the year cached, has
  // nothing to join, and would leave `pending` computed on a cache that has
  // since moved — for good, since nothing else re-renders this card.
  const missing: string[] = [];
  const loading = new Set<string>();
  for (const [mic, years] of wanted) {
    for (const y of years) {
      const k = keyOf(backendKey, mic, y);
      if (inCalendarRange(y) && !cache.has(k)) {
        missing.push(k);
        if (backendKey !== "") loading.add(mic);
      }
    }
  }
  // Ruling RW6: the consulted MICs a send would walk on weekdays because a year is neither cached (answered or
  // refused) nor held by the assembled calendar (the bundled NYSE file). A refused year is not here: its weekday
  // fallback is the card's own answer, ⚠ and all.
  const unloaded =
    backendKey === ""
      ? []
      : [...consulted]
          .filter(([mic, years]) =>
            [...years].some((y) => !cache.has(keyOf(backendKey, mic, y)) && !calendars[mic]?.years.includes(y)),
          )
          .map(([mic]) => mic)
          .sort();
  return { calendars, pending, key, wanted, missing, loading: [...loading].sort(), unloaded };
}

/**
 * The calendars useTradingCalendar hands a card, read synchronously from the
 * cache mounted cards fill: same years, same fallbacks, but it never fetches.
 * For Rita's get_widget_data (cardRequestSync), which must resolve a date
 * expression on the calendar the card resolves it on. `pending` names the MICs
 * with a consulted year nothing has loaded yet, where the card would wait and
 * this read would fall back to weekdays (ruling RW6).
 */
export function tradingCalendarsSync(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  fiscalYearEnd?: Record<string, number>,
  now: Date = new Date(),
  dashboardExchange?: string,
): { calendars: Record<string, ExchangeCalendar>; pending: string[] } {
  const backendKey = backend ? `${backend.id}\n${backend.baseUrl}` : "";
  const state = resolveCalendars(widget, values, backendKey, exchangesOf(widget, values, dashboardExchange), now, fiscalYearEnd, dashboardExchange);
  return { calendars: state.calendars, pending: state.unloaded };
}

/**
 * The calendars for the exchanges this card's period params use, loaded per
 * (backend, MIC, year) in the spec's order — cache, the card's backend, the
 * bundled NYSE file, the weekday table — and the years it needs: the current
 * and previous year up front, plus every year a resolution of the card's
 * CURRENT values consulted (a `bd` offset crossing New Year, a `T+4y-1bd`).
 * Resolution stays synchronous: this hook resolves once with what it has to
 * learn what is missing, fetches that, and re-renders when it lands. While a
 * year some param's resolution CONSULTED is in flight `pending` is true and
 * useWidgetData holds the request, so a card never sends a value resolved on
 * a calendar it is about to receive. The two up-front years are fetched
 * either way but never, by themselves, make the card wait (spec §2: only "a
 * card whose next request consulted a missing year waits") — a card whose
 * values are literal dates, or a bare `T`, consults no calendar and sends at
 * once. A consulted year that is refused (404, failure) stops the wait too.
 *
 * The returned object keeps its identity while its contents do not change —
 * the memo below is keyed on the values that can move it — so WidgetCard can
 * list it in a dependency array without refetching every card on every
 * render. A load that fails resolves with the fallback and the ⚠ flag: the
 * resolver flags any year the calendar does not hold.
 */
export function useTradingCalendar(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  fiscalYearEnd?: Record<string, number>,
  now: Date = new Date(),
  /** v5.4.0: the dashboard's exchange, for a param whose widget names none. */
  dashboardExchange?: string,
): TradingCalendars {
  // id + baseUrl is what a fetch is addressed by; the credential is never
  // part of any key. "" means no backend, which is never pending.
  const backendKey = backend ? `${backend.id}\n${backend.baseUrl}` : "";
  // Fingerprinted, not depended on by identity: WidgetCard rebuilds `values`
  // on renders that change nothing a resolution cares about.
  const valuesKey = paramsKey(values);
  const exchanges = useMemo(
    () => exchangesOf(widget, values, dashboardExchange),
    // `values` is read above; valuesKey is its value-derived stand-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widget, valuesKey, dashboardExchange],
  );
  // Bumped when a fetch lands, so the memo below re-reads the cache.
  const [landed, setLanded] = useState(0);
  const year = now.getFullYear();
  const fiscalKey = JSON.stringify(fiscalYearEnd ?? {});

  const state = useMemo(
    () => resolveCalendars(widget, values, backendKey, exchanges, now, fiscalYearEnd, dashboardExchange),
    // `values`, `fiscalYearEnd` and `now` are read above; valuesKey, fiscalKey
    // and year are their value-derived stand-ins (see the comments above them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widget, exchanges, backendKey, valuesKey, fiscalKey, year, landed, dashboardExchange],
  );

  useEffect(() => {
    if (!backend) return;
    // A year this card's memo saw absent has landed since (see `missing`):
    // re-read the cache now rather than wait on a fetch it can no longer join.
    if (state.missing.some((k) => cache.has(k))) setLanded((n) => n + 1);
    let cancelled = false;
    for (const [mic, years] of state.wanted) {
      for (const y of years) {
        if (!inCalendarRange(y)) continue;
        const key = keyOf(backendKey, mic, y);
        if (cache.has(key)) continue;
        const pending = joinInFlight(inFlight, key, () =>
          fetchTradingCalendar(backend, mic, y).then(
            (payload) => {
              const calendar = payload === null ? null : normalizeCalendar(payload, mic, [y], "backend");
              if (payload !== null && calendar === null) {
                void logOnce(`calendar:${key}`, `unusable trading calendar from ${backend.name} for ${mic} ${y}`);
              }
              cache.set(key, calendar);
            },
            (err: unknown) => {
              void logOnce(
                `calendar:${key}`,
                `trading calendar lookup failed for ${mic} ${y}: ${err instanceof Error ? err.message : String(err)}`,
              );
              cache.set(key, null);
            },
          ),
        );
        // `cancelled` is the stale-response guard: a key moving is a
        // dependency change, so this run's cleanup flips it before the new run
        // issues anything. The cache is written regardless — an answer is an
        // answer — only the re-render is skipped.
        void pending.then(() => {
          if (!cancelled) setLanded((n) => n + 1);
        });
      }
    }
    return () => {
      cancelled = true;
    };
    // `backend` is read above; backendKey is its dependency-safe stand-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendKey, state]);

  // Identity follows content, as useFiscalYearEnd's does: `state` is rebuilt
  // whenever the card's values move, but the calendars it assembled are the
  // same calendars unless a year landed or a MIC appeared. A consumer's memo
  // keyed on this object must see the same object then, or a keystroke in an
  // unrelated param would refetch every card that lists it.
  const fingerprint =
    Object.entries(state.calendars)
      .map(([mic, c]) => `${mic}:${c.source}:${c.years.join(",")}`)
      .join("|") + (state.pending ? "|pending" : "") + `#${state.key}#${state.loading.join(",")}`;
  return useMemo(
    () => ({ calendars: state.calendars, pending: state.pending, key: state.key, loading: state.loading }),
    // `state` is read above; the fingerprint is its content-derived stand-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fingerprint],
  );
}
