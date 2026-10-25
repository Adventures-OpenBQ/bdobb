// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { paramsKey, queryParams, type WireContext } from "../lib/params";
import { effectiveParams } from "../lib/paramGroups";
import { CalendarError } from "../lib/calendars/contracts";
import type { BackendConfig, Dashboard, DashboardCard, WidgetDef } from "../lib/types";
import { useBundleCalendars, withOvernight } from "./useBundleCalendars";
import { fiscalYearEndSync, useFiscalYearEnd } from "./useFiscalYearEnd";
import { tradingCalendarsSync, useTradingCalendar } from "./useTradingCalendar";
import type { ArmedRequest } from "./useWidgetData";

/**
 * What turns a card into its request: the effective params (groups, then the
 * fiscal map's relabelling), the fiscal map, the trading calendars, the hold
 * useWidgetData waits on and the query it sends. WidgetCard runs it for the
 * card on screen, and BackendSourceRunner for a backend table source a linked
 * table needs while its card is on another tab -- the same hook, so the same
 * request and the same rows.
 */
export function useCardRequest(
  card: DashboardCard,
  widget: WidgetDef | undefined,
  backend: BackendConfig | undefined,
  dashboard: Dashboard | undefined,
) {
  /**
   * Memoised because useWidgetData's effect lists this object among its
   * dependencies. Built inline it would be a new identity on every render,
   * and the card would refetch forever.
   *
   * Depends on the specific fields effectiveParams reads — card.params,
   * card.bindings, dashboard.groups, widget — not on `card` or `dashboard`
   * themselves. Two separate sources of churn make that narrowing necessary,
   * not just tidy:
   *
   * 1. mutateDashboard (src/stores/dashboardStore.ts) rebuilds a brand-new
   *    top-level Dashboard on every mutation — drag/resize, view toggle,
   *    param apply, card removal — even when nothing this card cares about
   *    changed. updateLayouts, patchCardField and removeCard all spread `...d`,
   *    so dashboard.groups keeps its identity when they run; applyCardParams
   *    rebuilds it into a new array only when a group's value is actually
   *    edited. Depending on `dashboard` here would re-run this memo —
   *    and refetch this card against the live backend — whenever ANY other
   *    card moved, toggled its view, or was removed.
   *
   * 2. updateLayouts additionally rebuilds EVERY card object on any single
   *    drag or resize, because its caller hands it react-grid-layout's full
   *    layout array — so every card takes the `{ ...c, layout: {...} }`
   *    branch, not just the one that moved. That spread preserves
   *    card.params and card.bindings by reference, but not `card` itself.
   *    Depending on `card` here would re-run this memo — and refetch every
   *    card on the dashboard — on every drag or resize of any single card.
   *
   * Do not widen this back to [card, dashboard, widget].
   */
  const groups = dashboard?.groups;
  // A primitive, so it joins the dependency list below without widening it
  // back to `dashboard` — see the comment above about what that would cost.
  const groupsDisabled = dashboard?.groupsDisabled ?? false;
  // v5.4.0 (spec §5): the dashboard's exchange, a primitive, for the same
  // reason groupsDisabled is one.
  const exchange = dashboard?.exchange;
  /**
   * Two passes, because the fiscal map and the effective params depend on
   * each other in one direction only: a `fy_end` sibling's effective value
   * feeds the map, and the map relabels the quarter params. The first pass
   * has no quarter relabelling and is what the hook reads; the second is
   * what everything else uses. Same dependency discipline as before — see
   * the comment above.
   */
  const parameterCard = useMemo(
    () => ({ params: card.params, bindings: card.bindings }),
    [card.params, card.bindings],
  );
  const baseParams = useMemo(
    () => (widget ? effectiveParams(parameterCard, groups, widget, groupsDisabled) : parameterCard.params),
    [parameterCard, groups, groupsDisabled, widget],
  );
  // v5.4.0: the card's FY ends override goes in as the chain's first rung;
  // `months` is the map every consumer below has always read.
  const fiscal = useFiscalYearEnd(widget, baseParams, backend, card.fiscalYearEnd);
  const fiscalYearEnd = fiscal.months;
  const params = useMemo(
    () => (widget ? effectiveParams(parameterCard, groups, widget, groupsDisabled, fiscalYearEnd) : parameterCard.params),
    [parameterCard, groups, groupsDisabled, widget, fiscalYearEnd],
  );
  /**
   * The trading calendars this card's period params resolve on, loaded from
   * its own backend per year and falling back to the bundled NYSE file and
   * the weekday table. Read from the EFFECTIVE params so a grouped `bd`
   * expression names the years the group's value crosses. Content-stable, so
   * it is safe in the hook's dependency list.
   */
  const legacy = useTradingCalendar(widget, params, backend, fiscalYearEnd, undefined, exchange);
  // An opted-in card resolves on openbq-docker's versioned bundles only (spec "Calendars available"); any other card
  // on the per-year loader, except its overnight calendars, which come from bundles too (2026-10-24).
  const bundled = useBundleCalendars(widget, params, backend, exchange);
  const binding = widget?.calendarBinding;
  const trading = useMemo(() => (binding ? bundled : withOvernight(legacy, bundled)), [binding, legacy, bundled]);
  /**
   * v5.4.0 (spec §1.3): a consulted fiscal lookup still in flight holds the
   * send exactly as a pending calendar year does, so it rides in the object
   * useWidgetData already waits on — its hold, its Run-button release and its
   * refetch key all apply unchanged. The key moves when the lookup lands,
   * which is the release; the answer itself arrives in `fiscalYearEnd`.
   */
  /**
   * v5.4.0 fix round 2: what the user asked, before the fiscal map relabels
   * it — the pre-relabel params that go on the wire, plus the card's FY ends
   * override. The lookup landing moves `params` (a grouped quarter or
   * fiscal_year is relabelled under the new year end) but never this, so
   * useWidgetData compares it, not the params, to tell a held send from an
   * un-run edit. It rides on the hold object, as `pending` and `key` do.
   */
  const intent = useMemo(
    () => `${paramsKey(widget ? queryParams(widget, baseParams) : baseParams)}|${card.fiscalYearEnd ?? ""}`,
    [widget, baseParams, card.fiscalYearEnd],
  );
  const hold = useMemo(
    () => ({
      ...(fiscal.pending ? { ...trading, pending: true, key: `${trading.key}|fiscal-pending` } : trading),
      intent,
    }),
    [trading, fiscal.pending, intent],
  );

  /**
   * The params that go on the widget's GET: `params` without the form
   * entries. A form field is card state, not a query parameter — leaving its
   * value in would append `<form>.<field>=…` to the request AND refetch the
   * card on every keystroke, because useWidgetData keys its fetch on
   * paramsKey of exactly this object. queryParams returns `params` itself for
   * a widget with no form, so nothing else in the app gains an identity churn.
   */
  const query = useMemo(() => (widget ? queryParams(widget, params) : params), [widget, params]);
  return { groups, groupsDisabled, exchange, fiscal, fiscalYearEnd, params, trading, hold, query };
}

/**
 * useCardRequest without React, for Rita's get_widget_data: the same lib
 * calls on the same inputs, its hooks swapped for their synchronous reads of
 * the caches mounted cards fill (fiscalYearEndSync, tradingCalendarsSync), so
 * she sends the query and wire context useWidgetData sends: groups, the
 * fiscal relabelling, the trading calendars and the dashboard's exchange,
 * form entries dropped. `armed` is a Run-button card's last-run request
 * (armedRequestOf), which is what that card fetches and shows.
 * Throws a CalendarError when a calendar year it needs is not loaded yet
 * (ruling RW6): the card would wait for it, and a synchronous read cannot.
 * `overrides` are Rita's `input_args`: applied before the calendars are
 * chosen, because a calendar follows the card's `symbol` (calendarOf) and an
 * atom's own `(MIC)`. An opted-in (`calendarBinding`) card gets no
 * `calendars`, so fetchWidgetData loads its bundles through the shared cache
 * the card's own hook reads; the legacy loader's never apply to it.
 * ponytail: no `bounds`, so `earliest` / `latest` defer to the provider's
 * own bound as on the card's first request; pass dataBounds of the card's
 * rows if Rita's answers must match a card that has since narrowed them.
 */
export function cardRequestSync(
  card: DashboardCard,
  widget: WidgetDef,
  backend: BackendConfig | undefined,
  dashboard: Pick<Dashboard, "groups" | "groupsDisabled" | "exchange"> | undefined,
  armed?: ArmedRequest,
  now: Date = new Date(),
  overrides: Record<string, string> = {},
): { query: Record<string, string>; ctx: WireContext } {
  const groups = dashboard?.groups;
  const groupsDisabled = dashboard?.groupsDisabled ?? false;
  const exchange = dashboard?.exchange;
  const parameterCard = { params: card.params, bindings: card.bindings };
  const live = () => {
    const baseParams = effectiveParams(parameterCard, groups, widget, groupsDisabled);
    const fiscalYearEnd = fiscalYearEndSync(widget, baseParams, backend, card.fiscalYearEnd);
    return { params: effectiveParams(parameterCard, groups, widget, groupsDisabled, fiscalYearEnd), fiscalYearEnd };
  };
  // useWidgetData arms WidgetCard's `query`, so armed params need no queryParams pass.
  const chosen = armed ?? live();
  const fiscalYearEnd = chosen.fiscalYearEnd;
  const params = { ...chosen.params, ...overrides };
  const legacy = widget.calendarBinding
    ? undefined
    : tradingCalendarsSync(widget, params, backend, fiscalYearEnd, now, exchange);
  // Ruling RW6: a year no mounted card has loaded would resolve on weekdays here, where the card itself waits for it.
  // Refuse, so Rita's fetch fails and nothing is sent.
  if (legacy?.pending.length) {
    throw new CalendarError("CALENDAR_UNAVAILABLE", `${legacy.pending.join(", ")} calendar not loaded`);
  }
  const calendars = legacy?.calendars;
  return { query: armed ? params : queryParams(widget, params), ctx: { fiscalYearEnd, calendars, exchange } };
}
