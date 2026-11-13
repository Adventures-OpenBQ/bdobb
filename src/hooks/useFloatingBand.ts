// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, type RefObject } from "react";
import type { PinEdge } from "../lib/types";

/**
 * A see-through locked band's effect on the dashboard area it floats in
 * (spec 2026-11-12-see-through-locked-bands): its height, published on the
 * area as --dock-room-top / --dock-room-bottom. styles.css reads it as the
 * band's negative margin, which takes the band out of the column, and as the
 * scroll region's extra room at that end. `px` is null while the band does
 * not float, and then nothing is published. A layout effect, so the first
 * painted frame already has the band floating.
 */
export function useFloatingBand(ref: RefObject<HTMLElement | null>, edge: PinEdge, px: number | null): void {
  useLayoutEffect(() => {
    const area = ref.current?.closest<HTMLElement>(".dashboard-area");
    if (!area || px === null) return;
    const name = `--dock-room-${edge}`;
    area.style.setProperty(name, `${px}px`);
    return () => void area.style.removeProperty(name);
  }, [ref, edge, px]);
}
