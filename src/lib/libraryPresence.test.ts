// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { UNRESOLVED_BACKEND_ID } from "./appsJson";
import { buildPresenceIndex, isOnDashboard, presenceOf } from "./libraryPresence";
import { card } from "../test/fixtures";
import type { Dashboard, DashboardCard } from "./types";

/** Each argument after the name is one tab's cards. */
const dash = (id: string, name: string, ...tabs: DashboardCard[][]): Dashboard => ({
  id,
  name,
  tabs: tabs.map((cards, i) => ({ id: `${id}-t${i}`, name: `Tab ${i + 1}`, cards })),
});

const WIDGET = { id: "prices", backendId: "b1" };

/**
 * The old `dashboardsWith(widget, dashboards)` read as a per-widget scan.
 * These are the same cases against the inverted index that replaced it, so
 * the rules it encodes -- backend match, the unresolved sentinel, one entry
 * per dashboard, order -- are still the rules under test.
 */
const on = (widget: { id: string; backendId: string }, dashboards: Dashboard[]) =>
  presenceOf(buildPresenceIndex([widget], dashboards), widget);

describe("buildPresenceIndex", () => {
  it("returns nothing when no dashboard carries the widget", () => {
    const dashboards = [dash("d1", "One", []), dash("d2", "Two", [card({ widgetId: "chart" })])];
    expect(on(WIDGET, dashboards)).toEqual([]);
  });

  it("returns the dashboard whose card matches widget and backend", () => {
    const dashboards = [
      dash("d1", "One", [card({ widgetId: "prices", backendId: "b1" })]),
      dash("d2", "Two", []),
    ];
    expect(on(WIDGET, dashboards).map((d) => d.id)).toEqual(["d1"]);
  });

  it("ignores a same-id card served by a different backend", () => {
    const dashboards = [dash("d1", "One", [card({ widgetId: "prices", backendId: "b2" })])];
    expect(on(WIDGET, dashboards)).toEqual([]);
  });

  it("matches an unresolved card on widget id alone, like registry find()", () => {
    const dashboards = [
      dash("d1", "One", [card({ widgetId: "prices", backendId: UNRESOLVED_BACKEND_ID })]),
    ];
    expect(on(WIDGET, dashboards).map((d) => d.id)).toEqual(["d1"]);
  });

  it("counts a dashboard once even when the widget sits on two of its tabs", () => {
    const dashboards = [
      dash(
        "d1",
        "One",
        [card({ id: "c1", widgetId: "prices", backendId: "b1" })],
        [card({ id: "c2", widgetId: "prices", backendId: "b1" })],
      ),
    ];
    expect(on(WIDGET, dashboards)).toHaveLength(1);
  });

  it("preserves the order of the list it was given", () => {
    const hit = [card({ widgetId: "prices", backendId: "b1" })];
    const dashboards = [
      dash("d3", "Three", hit),
      dash("d1", "One", hit),
      dash("d2", "Two", hit),
    ];
    expect(on(WIDGET, dashboards).map((d) => d.id)).toEqual(["d3", "d1", "d2"]);
  });

  // The pills read `presenceOf`, the On-dashboard filter reads
  // `isOnDashboard`; both come out of the same index, so they cannot disagree
  // -- least of all about the unresolved card, which used to be the one rule
  // written out in two places.
  it("answers the pills and the filter identically for an unresolved card", () => {
    const dashboards = [
      dash("d1", "One", [card({ widgetId: "prices", backendId: UNRESOLVED_BACKEND_ID })]),
      dash("d2", "Two", []),
    ];
    const index = buildPresenceIndex([WIDGET], dashboards);

    expect(presenceOf(index, WIDGET).map((d) => d.id)).toEqual(["d1"]);
    expect(isOnDashboard(index, WIDGET, "d1")).toBe(true);
    expect(isOnDashboard(index, WIDGET, "d2")).toBe(false);
  });

  // An unresolved card names no backend, so it stands for every backend
  // serving that id -- the widget comes alive under whichever one connects.
  it("counts an unresolved card for every backend serving that widget id", () => {
    const other = { id: "prices", backendId: "b2" };
    const dashboards = [
      dash("d1", "One", [card({ widgetId: "prices", backendId: UNRESOLVED_BACKEND_ID })]),
    ];
    const index = buildPresenceIndex([WIDGET, other], dashboards);

    expect(presenceOf(index, WIDGET).map((d) => d.id)).toEqual(["d1"]);
    expect(presenceOf(index, other).map((d) => d.id)).toEqual(["d1"]);
  });

  it("gives a widget on nothing the same empty list every time", () => {
    const index = buildPresenceIndex([WIDGET], [dash("d1", "One", [])]);
    expect(presenceOf(index, WIDGET)).toBe(presenceOf(index, WIDGET));
    expect(presenceOf(index, WIDGET)).toEqual([]);
  });
});
