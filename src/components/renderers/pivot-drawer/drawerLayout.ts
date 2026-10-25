// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DrawerSection } from './drawerState';
/** Shared with the shell's --pivot-split value (18–92% CSS contract, default 40%). */
export function clampSplitPct(value: number): number {
  return Number.isFinite(value) ? Math.max(.18, Math.min(.92, value)) : .4;
}
const dimension = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
/** bodyH/bodyW describe available body space, excluding card chrome. */
export function drawerLayout(i: { bodyH: number; bodyW: number; headH: number; rowH: number; active: DrawerSection; splitPct: number }): { mode: 'split'|'fill'; cramped: boolean; orientation: 'vertical'|'horizontal'; short: boolean } {
  const bodyH = dimension(i.bodyH), bodyW = dimension(i.bodyW);
  const splitPct = clampSplitPct(i.splitPct);
  const unavailable = bodyH === 0 || bodyW === 0;
  const cramped = unavailable || bodyH * (1 - splitPct) < dimension(i.headH) + 3 * dimension(i.rowH);
  const mode = i.active === 'arrange' && !cramped ? 'split' : 'fill';
  const drawerH = mode === 'split' ? bodyH * splitPct : bodyH;
  return { mode, cramped, orientation: bodyW < 560 ? 'horizontal' : 'vertical', short: unavailable || drawerH < 300 };
}
