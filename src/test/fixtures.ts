// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The three shapes every test needs a throwaway instance of, in one place.
 *
 * Each factory spreads `over` last, so a caller overrides exactly the fields
 * its test is about and inherits the rest. The defaults are the ones the most
 * call sites already used; a file whose own defaults differ wraps the factory
 * with those differences rather than re-spelling the whole shape:
 *
 *   const widget = (over: Partial<WidgetDef> = {}) =>
 *     baseWidget({ category: "", gridData: { w: 1, h: 1 }, ...over });
 *
 * These are fixtures, not assertions: a value here is only ever a starting
 * point. A test that depends on a particular field says so at its own call.
 */
import type { BackendConfig, DashboardCard, WidgetDef } from "../lib/types";

export function widget(over: Partial<WidgetDef> = {}): WidgetDef {
  return {
    id: "w",
    backendId: "b1",
    name: "W",
    description: "",
    type: "table",
    category: "Equity",
    subCategory: "",
    endpoint: "e",
    gridData: { w: 20, h: 9 },
    params: [],
    source: [],
    ...over,
  };
}

export function card(over: Partial<DashboardCard> = {}): DashboardCard {
  return {
    id: "c",
    widgetId: "w",
    backendId: "b1",
    params: {},
    layout: { x: 0, y: 0, w: 20, h: 9 },
    ...over,
  };
}

export function backend(over: Partial<BackendConfig> = {}): BackendConfig {
  return {
    id: "b1",
    name: "Local",
    baseUrl: "http://x",
    authLocation: "header",
    validateWidgets: false,
    ...over,
  };
}
