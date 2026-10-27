// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { groupFor } from "../paramGroups";
import type { ChartCardState, DashboardCard, ParamGroup } from "../types";
import type { ChartRange } from "./rangeExpr";

/**
 * The two chart-state facets a group may bind (spec 2026-09-25, F2/F3). A
 * group names a facet instead of a declared parameter, so no backend changes
 * and the endpoint never sees these strings. `ParamGroup` is reused unchanged:
 * the reserved name is BOTH the group's `paramName` and its `groupType`, so
 * `compatibleGroups` -- which filters on an exact `groupType` match -- offers a
 * chart group only to a chart control of the same facet, with no change to
 * that function (F3). A dotted binding name is already precedented: a form
 * field binds as `<form>.<field>`.
 */
export const CHART_RANGE = "chart.range";
export const CHART_INTERVAL = "chart.interval";
/**
 * The third facet (user, 2026-10-01: "turn on the parameter group for interval,
 * range, session and Macro" on the DJIA tab). Same mechanism as interval: the
 * group's value is the session itself, "extended" | "regular" | "24hr".
 */
export const CHART_SESSION = "chart.session";
/**
 * The fourth (same request, "the macro is supposed to be the DJIA macro"): a
 * saved LAYOUT by name, from the app's layout library (chart-layouts.json). A
 * bound card draws that layout's panels and series in place of its own -- an
 * override like interval's, so unbinding returns the card's own untouched --
 * and picking another saved layout on any bound card moves the group, so every
 * member switches. The renderer resolves the name; a name the library does not
 * have leaves the card on its own layout, as a malformed range does.
 */
export const CHART_LAYOUT = "chart.layout";

/**
 * A chart edit as the renderer sends it: card state, plus `layout` -- a saved
 * layout's name, sent only by a card bound to a Layout group. It is never card
 * state: splitChartEdit turns it into a group edit, and drops it otherwise.
 */
export type ChartEdit = Partial<ChartCardState> & { layout?: string };

/** The saved layout a bound card shows, or null (unbound, or grouping off). */
export function boundLayoutName(card: DashboardCard, groups: ParamGroup[] | undefined, groupsDisabled = false): string | null {
  if (groupsDisabled) return null;
  return groupFor(card, groups, CHART_LAYOUT)?.value ?? null;
}
const SESSIONS: ReadonlyArray<NonNullable<ChartCardState["session"]>> = ["extended", "regular", "24hr"];

/**
 * The range value on the wire between the card and its group (spec 2026-09-25,
 * F4): `<from>..<to>`, e.g. `now-5d..now`. `..` is already this app's range
 * separator (dateExpressions.ts treats `..` and `/` as range markers), so this
 * is the house notation, not an invention. `ParamGroup.value` stays a plain
 * string, so the groups file, the group menu and apps.json all keep their
 * shape. `from`/`to` are date EXPRESSIONS or absolute datetimes; neither ever
 * contains `..`, so a single split is unambiguous.
 */
export function encodeRange(range: ChartRange): string {
  return `${range.from}..${range.to}`;
}

/**
 * The inverse of encodeRange, refusing anything that is not exactly two
 * non-empty halves around one `..` (spec 2026-09-25, F4). A malformed value --
 * hand-edited, imported, or half-written -- returns null rather than a
 * half-parsed range, so effectiveChartState can leave the card on its own
 * range instead of crashing (Review Focus 2).
 */
export function decodeRange(value: string): ChartRange | null {
  const parts = value.split("..");
  if (parts.length !== 2) return null;
  const [from, to] = parts;
  if (from === "" || to === "") return null;
  return { from, to };
}

/**
 * The state the chart should SHOW: the card's own state, with `interval` and
 * `range` overridden by the value of any group they are bound to (spec
 * 2026-09-25, F5). The group wins, exactly as effectiveParams declares for
 * parameters -- a bound card's own `state.interval`/`state.range` is stale by
 * definition. The card's own value is never deleted, only outranked, so
 * unbinding (no group found) returns it untouched.
 *
 * `groupsDisabled` returns the card's own for everything, the same early return
 * groupedParamNames makes for parameters (F8). A group whose range value is
 * malformed is treated as no override, so the chart keeps its own range.
 *
 * Reuses `groupFor`, which already skips a dangling binding (a deleted group),
 * so a dead binding reads as unbound rather than throwing.
 */
export function effectiveChartState(
  card: DashboardCard,
  state: ChartCardState,
  groups: ParamGroup[] | undefined,
  groupsDisabled = false,
): ChartCardState {
  if (groupsDisabled) return state;
  const out: ChartCardState = { ...state };
  const iv = groupFor(card, groups, CHART_INTERVAL);
  if (iv) out.interval = iv.value;
  const rg = groupFor(card, groups, CHART_RANGE);
  if (rg) {
    const decoded = decodeRange(rg.value);
    if (decoded) out.range = decoded;
  }
  // A value that is not a session (hand-edited, imported) is no override, like a bad range.
  const ss = groupFor(card, groups, CHART_SESSION);
  if (ss && (SESSIONS as readonly string[]).includes(ss.value)) out.session = ss.value as ChartCardState["session"];
  return out;
}

/**
 * Split a chart-facet edit into what lands on the card and what moves its group
 * (spec 2026-09-25, F6), mirroring splitParamEdit. A bound `interval`/`range`
 * edit becomes a GROUP edit -- so every member card moves and the control does
 * not snap back on the next render -- and is deliberately kept OUT of the card
 * patch, so the card's own value stays exactly what it was for unbinding to
 * restore (F5). Every other key (session, adjusted, railHidden, drawings,
 * series, …) is untouched card state and passes straight through.
 *
 * Only a genuine move is reported, like splitParamEdit: writing a group whose
 * value has not changed would refetch every member for nothing.
 *
 * `range` is encoded on the way to the group and passed as an object on the way
 * to the card; `interval` is a plain string either way.
 */
export function splitChartEdit(
  edits: ChartEdit,
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  groupsDisabled = false,
): { cardPatch: Partial<ChartCardState>; groupEdits: Array<{ groupId: string; value: string }> } {
  const cardPatch: Partial<ChartCardState> = {};
  const groupEdits: Array<{ groupId: string; value: string }> = [];

  for (const [key, value] of Object.entries(edits)) {
    const reserved = key === "interval" ? CHART_INTERVAL : key === "range" ? CHART_RANGE : key === "session" ? CHART_SESSION
      : key === "layout" ? CHART_LAYOUT : null;
    const group = groupsDisabled || reserved === null ? undefined : groupFor(card, groups, reserved);
    // A layout name is only ever a group's value, never the card's own state.
    if (!group && key === "layout") continue;
    if (!group) {
      // Not a groupable facet, or not bound: it is the card's own state.
      (cardPatch as Record<string, unknown>)[key] = value;
      continue;
    }
    const encoded = key === "range" ? encodeRange(value as ChartRange) : String(value);
    if (group.value !== encoded) groupEdits.push({ groupId: group.id, value: encoded });
  }

  return { cardPatch, groupEdits };
}
