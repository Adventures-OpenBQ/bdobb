// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import RGL, { WidthProvider } from "react-grid-layout";
import { logError } from "../lib/logger";
import {
  GRID_COLS,
  GRID_ROW_HEIGHT,
  useDashboardStore,
  type GridLayoutItem,
} from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { TabBar } from "./TabBar";
import { WidgetCard } from "./WidgetCard";

const GridLayout = WidthProvider(RGL);

export function DashboardGrid({
  onOpenLibrary,
  viewer = false,
}: {
  onOpenLibrary: () => void;
  /** The "Open in new window" window: read-only, and nothing here may write. */
  viewer?: boolean;
}) {
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === s.activeId));
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const maximizedCardId = useDashboardStore((s) => s.maximizedCardId);
  const updateLayouts = useDashboardStore((s) => s.updateLayouts);
  const removeCard = useDashboardStore((s) => s.removeCard);
  const cornerDragHandles = useSettingsStore((s) => s.settings.cornerDragHandles);

  if (!dashboard) {
    return <p className="empty-state">No dashboard selected.</p>;
  }

  const tab = dashboard.tabs.find((t) => t.id === activeTabId);

  if (!tab) {
    return (
      <>
        <TabBar onOpenLibrary={onOpenLibrary} viewer={viewer} />
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

  async function persistLayout(next: GridLayoutItem[]): Promise<void> {
    try {
      await updateLayouts(next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    } catch (err) {
      await logError(`failed to persist layout change: ${err}`);
    }
  }

  async function remove(cardId: string): Promise<void> {
    try {
      await removeCard(cardId);
    } catch (err) {
      await logError(`failed to remove card ${cardId}: ${err}`);
    }
  }

  return (
    <>
      <TabBar onOpenLibrary={onOpenLibrary} viewer={viewer} />
      <GridLayout
        className={cornerDragHandles ? "dashboard-grid dashboard-grid-corner-handles" : "dashboard-grid"}
        layout={layout}
        cols={GRID_COLS}
        rowHeight={GRID_ROW_HEIGHT}
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
          void persistLayout(next);
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
            <WidgetCard card={card} viewer={viewer} onRemove={() => void remove(card.id)} />
          </div>
        ))}
      </GridLayout>
    </>
  );
}
