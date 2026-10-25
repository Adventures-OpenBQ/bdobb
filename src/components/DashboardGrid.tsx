// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, type ReactNode } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import { useCardRequest } from "../hooks/useCardRequest";
import { useStatementRows } from "../hooks/useStatementRows";
import { useWidgetData } from "../hooks/useWidgetData";
import { logError } from "../lib/logger";
import { isBackendTable } from "../lib/tableExecution/eligibility";
import type { Dashboard, DashboardCard } from "../lib/types";
import { useBackendsStore } from "../stores/backendsStore";
import { tableExecutionStore } from "../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import {
  GRID_COLS,
  GRID_ROW_HEIGHT,
  useDashboardStore,
  type GridLayoutItem,
} from "../stores/dashboardStore";
import { selectEffective, useSettingsStore } from "../stores/settingsStore";
import { ErrorBoundary } from "./ErrorBoundary";
import { TabBar } from "./TabBar";
import { TableExecutionRuntime } from "./TableExecutionRuntime";
import { WidgetCard } from "./WidgetCard";

const GridLayout = WidthProvider(RGL);

export function DashboardGrid({
  dashboardId: explicitDashboardId,
  onOpenLibrary,
  viewer = false,
  trailing,
}: {
  /** Which dashboard this grid shows. A tile passes its own; null is "none". */
  dashboardId?: string | null;
  onOpenLibrary: () => void;
  /** The "Open in new window" window: read-only, and nothing here may write. */
  viewer?: boolean;
  /** Handed straight to the tab bar's `trailing`, from BOTH places it is rendered below. */
  trailing?: ReactNode;
}) {
  // By id from the prop, never from the store's focused id: with more than
  // one grid mounted, the focused dashboard is not necessarily this one's.
  const focusedId = useDashboardStore(s => s.activeId);
  const dashboardId = explicitDashboardId === undefined ? focusedId : explicitDashboardId;
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === dashboardId));
  const activeTabId = useDashboardStore((s) =>
    dashboardId === null ? null : explicitDashboardId === undefined ? s.activeTabId : (s.activeTabIds[dashboardId] ?? null),
  );
  const maximizedCardId = useDashboardStore((s) => s.maximizedCardId);
  const updateLayouts = useDashboardStore((s) => s.updateLayouts);
  const removeCard = useDashboardStore((s) => s.removeCard);
  const cornerDragHandles = useSettingsStore((s) => s.settings.cornerDragHandles);
  const widgetGap = useSettingsStore((s) => selectEffective(s).widgetGap);

  // A card maximized on this dashboard is unmounted with its grid: leaving a
  // workspace, or a tile cleared with its ✕. maximizedCardId would then name a
  // card nobody can see, and bring it back maximized the next time this
  // dashboard mounts without a dashboard switch to clear it. The store is read
  // when the cleanup RUNS (unmount, or dashboardId changing), not captured at
  // render, so an ordinary re-render never clears it.
  useEffect(
    () => () => {
      const s = useDashboardStore.getState();
      const id = s.maximizedCardId;
      if (id === null) return;
      const own = s.dashboards.find((d) => d.id === dashboardId);
      if (own?.tabs.some((t) => t.cards.some((c) => c.id === id))) s.setMaximized(null);
    },
    [dashboardId],
  );

  if (!dashboard) {
    return <p className="empty-state">No dashboard selected.</p>;
  }

  const tab = dashboard.tabs.find((t) => t.id === activeTabId) ?? dashboard.tabs[0];

  if (!tab) {
    return (
      <>
        <TableExecutionRuntime dashboard={dashboard} />
        <TabBar dashboardId={dashboard.id} onOpenLibrary={onOpenLibrary} viewer={viewer} trailing={trailing} />
        <p className="empty-state">No tab selected. Add one to start.</p>
      </>
    );
  }

  /**
   * The maximized card's item is frozen: react-grid-layout reads
   * isDraggable/isResizable off the LAYOUT object per item (see the props
   * below for its exact gate), and a maximized card is not where its grid
   * slot is, so a drag would move a slot the user cannot see.
   *
   * Neither flag can reach the disk: updateLayouts writes i/x/y/w/h only.
   */
  const layout: (GridLayoutItem & { isDraggable?: boolean; isResizable?: boolean })[] =
    tab.cards.map((c) => ({
      i: c.id,
      ...c.layout,
      ...(c.id === maximizedCardId ? { isDraggable: false, isResizable: false } : {}),
    }));

  return (
    <>
      <TableExecutionRuntime dashboard={dashboard} />
      <TabBar dashboardId={dashboard.id} onOpenLibrary={onOpenLibrary} viewer={viewer} trailing={trailing} />
      <OffTabSources dashboard={dashboard} tabId={tab.id} />
      <GridLayout
        className={cornerDragHandles ? "dashboard-grid dashboard-grid-corner-handles" : "dashboard-grid"}
        layout={layout}
        cols={GRID_COLS}
        rowHeight={GRID_ROW_HEIGHT}
        // The gap between cards, x and y alike (D1/D2). react-grid-layout's
        // own default is [10, 10], which is also this setting's default, so
        // an untouched install is spaced exactly as it was before. The
        // maximized card is `position: fixed` and so unaffected.
        margin={[widgetGap, widgetGap]}
        // Pinned, and NOT derived from widgetGap: react-grid-layout defaults
        // `containerPadding` to whatever `margin` is
        // (`containerPadding || margin`, ReactGridLayout.js), so leaving it
        // unset would make the slider silently move the grid's OUTER inset
        // too -- the first card would jump from 10px off the container edge
        // to 25px. [10, 10] is the effective value today (the library's
        // default margin), so this keeps the outer padding exactly as it has
        // always been while the slider changes only the gap between cards.
        containerPadding={[10, 10]}
        // No automatic compaction: an imported app's coordinates are the
        // layout (the reference apps reserve rows 0-1), and vertical
        // compaction pulled every card up on first display and then wrote
        // that back through onLayoutChange (bdobb#6). Collisions during a
        // drag still push the other card down.
        compactType={null}
        // react-grid-layout 1.5's own gates: per item it computes
        // `typeof l.isDraggable === "boolean" ? l.isDraggable : !l.static && isDraggable`,
        // so false here disables the whole grid. Belt and braces with the
        // store's write-guard — this is what stops the drag ever starting.
        isDraggable={!viewer}
        isResizable={!viewer}
        // The card title is the drag handle, so interacting with a widget's own
        // content does not move the card.
        draggableHandle=".card-title"
        resizeHandles={cornerDragHandles ? ["nw", "ne", "sw", "se"] : undefined}
        // Fires on drag-stop and resize-stop, but react-grid-layout also fires
        // it unconditionally from componentDidMount, and again whenever the
        // `layout` prop changes reference (e.g. after addCard/removeCard,
        // since tab.cards.map(...) above produces a fresh array every
        // render). Neither of those is a real move, so guard on content
        // rather than a mount flag — a mount-only flag would miss the
        // addCard/removeCard case.
        onLayoutChange={(next: GridLayoutItem[]) => {
          const unchanged = next.every((l) => {
            const card = tab.cards.find((c) => c.id === l.i);
            return (
              card !== undefined &&
              card.layout.x === l.x &&
              card.layout.y === l.y &&
              card.layout.w === l.w &&
              card.layout.h === l.h
            );
          });
          if (unchanged) return;
          void updateLayouts(next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))).catch((err) =>
            logError(`failed to persist layout change: ${err}`),
          );
        }}
      >
        {tab.cards.map((card) => (
          // The class lands on the GRID ITEM, not on the card inside it:
          // react-grid-layout clones this child and merges its className with
          // "react-grid-item" (GridItem.js), so this div IS the
          // .react-grid-item element. It has to be that element — the item is
          // positioned with `transform: translate(...)`, and a fixed or
          // absolute DESCENDANT of a transformed element is laid out against
          // that element rather than against the viewport.
          <div key={card.id} className={card.id === maximizedCardId ? "card-maximized" : undefined}>
            {/* A boundary per CARD, outside it: WidgetCard's own wraps only
                its body, so a throw in the header, WidgetTabs or
                WidgetFormPanel would otherwise reach "the dashboard" and
                blank every card. Labelled with the widget id, WidgetCard's
                own fallback label -- never the user's free-text title. */}
            <ErrorBoundary label={card.widgetId}>
              <WidgetCard
                card={card}
                dashboardId={dashboard.id}
                viewer={viewer}
                onRemove={() => void removeCard(card.id).catch((err) => logError(`failed to remove card ${card.id}: ${err}`))}
              />
            </ErrorBoundary>
          </div>
        ))}
      </GridLayout>
    </>
  );
}

/**
 * A backend table's rows reach the table worker only from its own card's
 * fetch, and only the active tab's cards mount. A linked table here whose
 * chain starts at a backend table on another tab would wait for that tab to
 * be visited, so its source runs headless instead -- useCardRequest, the
 * same request the card would send. Never for a source on this tab: its card
 * is mounted and fetching, so the two cannot both hand rows over. Unmounted
 * with the last linked table here that needs it.
 */
function OffTabSources({ dashboard, tabId }: { dashboard: Dashboard; tabId: string }) {
  // Discovery decides which cards are backend tables, so it re-renders this.
  useWidgetRegistryStore((s) => s.widgets);
  const cards = new Map(dashboard.tabs.flatMap((t) => t.cards).map((c) => [c.id, c]));
  const here = dashboard.tabs.find((t) => t.id === tabId)?.cards ?? [];
  const sources = new Map<string, DashboardCard>();
  for (const card of here) {
    let root = card;
    const seen = new Set<string>();
    while (root.linkedSource && !seen.has(root.id)) {
      seen.add(root.id);
      const next = cards.get(root.linkedSource.sourceWidgetId);
      if (!next) break;
      root = next;
    }
    if (root !== card && !here.includes(root) && isBackendTable(root)) sources.set(root.id, root);
  }
  return [...sources.values()].map((card) => <BackendSourceRunner key={card.id} card={card} dashboard={dashboard} />);
}

function BackendSourceRunner({ card, dashboard }: { card: DashboardCard; dashboard: Dashboard }) {
  // WidgetCard's own lookups, so useCardRequest sees what the card would.
  const widget = useWidgetRegistryStore((s) => s.find(card.backendId, card.widgetId));
  const backend = useBackendsStore((s) => s.backends.find((b) => b.id === (widget?.backendId ?? card.backendId)));
  const { fiscalYearEnd, hold, query, exchange } = useCardRequest(card, widget, backend, dashboard);
  const { status, data: rawData, error } = useWidgetData(card, query, widget?.runButton, fiscalYearEnd, hold, exchange);
  // The card's fiscal relabelling too: the rows it hands over are corrected ones.
  const { data } = useStatementRows(widget, backend, query, rawData);
  // WidgetCard's hand-over, unchanged: every outcome reaches the store.
  const failed = status === "error" || status === "incomplete";
  useEffect(() => {
    if (failed) tableExecutionStore.setBackendRows(dashboard.id, card.id, new Error(error ?? "Request failed"));
    else if (status === "ready" && data !== null) tableExecutionStore.setBackendRows(dashboard.id, card.id, data);
  }, [dashboard.id, card.id, data, status, failed, error]);
  return null;
}
