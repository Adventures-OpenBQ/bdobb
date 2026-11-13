// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, type RefObject } from "react";
import type { PinEdge } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";

/**
 * A see-through locked band's effects on the dashboard area it floats in
 * (spec 2026-11-12-see-through-locked-bands). Its height, published on the
 * area as --dock-room-top / --dock-room-bottom: styles.css reads it as the
 * band's negative margin, which takes the band out of the column, and as the
 * scroll region's extra room at that end. And for the top band, the region
 * opened scrolled past that room, so at rest the dashboard's first rows sit
 * under the band and scrolling up brings them clear of it.
 *
 * Nothing saves or restores a dashboard's scroll today: the one
 * .dashboard-scroll element is reused across dashboard and tab switches and
 * keeps its scrollTop. So "opening" is exactly when the band starts floating
 * and when the dashboard or tab on screen changes -- the deps below -- and
 * never another render, which would undo the user's own scrolling. `px` is
 * null while the band does not float, and then nothing is published or
 * scrolled. Layout effects, so the first painted frame is already right.
 */
export function useFloatingBand(ref: RefObject<HTMLElement | null>, edge: PinEdge, px: number | null): void {
  const activeId = useDashboardStore((s) => s.activeId);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const activeTabIds = useDashboardStore((s) => s.activeTabIds);

  useLayoutEffect(() => {
    const area = ref.current?.closest<HTMLElement>(".dashboard-area");
    if (!area || px === null) return;
    const name = `--dock-room-${edge}`;
    area.style.setProperty(name, `${px}px`);
    return () => void area.style.removeProperty(name);
  }, [ref, edge, px]);

  useLayoutEffect(() => {
    if (edge !== "top" || px === null) return;
    const scroll = ref.current?.closest(".dashboard-area")?.querySelector<HTMLElement>(":scope > .dashboard-scroll");
    if (scroll) scroll.scrollTop = px;
  }, [ref, edge, px, activeId, activeTabId, activeTabIds]);
}
