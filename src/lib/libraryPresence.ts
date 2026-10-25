// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { UNRESOLVED_BACKEND_ID } from "./appsJson";
import type { Dashboard, WidgetDef } from "./types";

/** How a widget is identified across backends: two backends may serve the same id. */
export function widgetKey(widget: Pick<WidgetDef, "id" | "backendId">): string {
  return `${widget.backendId}:${widget.id}`;
}

/**
 * Every widget's dashboards, keyed by `widgetKey`. The Widget Library's one
 * answer to "where does this widget already sit" — read by the dashboard
 * pills on each card AND by the On-dashboard filter, so the two cannot
 * disagree about the same widget.
 */
export type PresenceIndex = ReadonlyMap<string, Dashboard[]>;

/** A widget the index has no entry for is on nothing; a shared empty, so it is a stable reference. */
const NONE: readonly Dashboard[] = [];

export function presenceOf(
  index: PresenceIndex,
  widget: Pick<WidgetDef, "id" | "backendId">,
): readonly Dashboard[] {
  return index.get(widgetKey(widget)) ?? NONE;
}

/** Is this widget on that dashboard? The filter's whole question. */
export function isOnDashboard(
  index: PresenceIndex,
  widget: Pick<WidgetDef, "id" | "backendId">,
  dashboardId: string,
): boolean {
  return presenceOf(index, widget).some((d) => d.id === dashboardId);
}

/**
 * ONE pass over the dashboards and one over the widgets, inverted: card →
 * widget, rather than asking every widget to search every dashboard. The
 * Library re-runs its visible-widgets pass on every keystroke in the search
 * box, and the old shape was O(widgets × cards) each time.
 *
 * Order is the order of `dashboards` — pass a rail-ordered list (see
 * `railDashboardsWithPath`) and the pills come out in rail order. One entry
 * per dashboard however many of its tabs a widget sits on.
 *
 * An UNRESOLVED_BACKEND_ID card matches on widget id ALONE, exactly as
 * useWidgetRegistryStore.find() resolves it: such a card comes alive under
 * whichever backend serves that id, so the widget IS on that dashboard. That
 * rule lives here and nowhere else, which is what keeps the pills and the
 * filter from ever answering it differently.
 */
export function buildPresenceIndex(
  widgets: Pick<WidgetDef, "id" | "backendId">[],
  dashboards: Dashboard[],
): PresenceIndex {
  // Which keys an unresolved card could stand for: every backend serving that id.
  const keysById = new Map<string, string[]>();
  for (const w of widgets) {
    const keys = keysById.get(w.id);
    if (keys) keys.push(widgetKey(w));
    else keysById.set(w.id, [widgetKey(w)]);
  }

  const index = new Map<string, Dashboard[]>();
  for (const dashboard of dashboards) {
    // Per dashboard, so a widget on two of its tabs still yields one entry.
    const added = new Set<string>();
    for (const tab of dashboard.tabs) {
      for (const card of tab.cards) {
        const keys =
          card.backendId === UNRESOLVED_BACKEND_ID
            ? (keysById.get(card.widgetId) ?? [])
            : [`${card.backendId}:${card.widgetId}`];
        for (const key of keys) {
          if (added.has(key)) continue;
          added.add(key);
          const on = index.get(key);
          if (on) on.push(dashboard);
          else index.set(key, [dashboard]);
        }
      }
    }
  }
  return index;
}
