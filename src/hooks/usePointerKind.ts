// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMediaQuery } from "./useMediaQuery";

/**
 * A pointing device that can hover — a trackpad or a Magic Keyboard — as
 * opposed to a fingertip, which either touches or does not. The desktop
 * interface's hover-activated panels assume the former.
 *
 * any-pointer, not pointer: iPadOS keeps the PRIMARY pointer coarse whatever
 * is docked, so `(pointer: fine)` never flips on an iPad and a trackpad
 * hovering the rail did nothing. A docked trackpad shows up only as "some
 * pointer is fine". Seen on device; the hover dialect is then right for both
 * the trackpad and a finger, since iOS sends synthetic mouseenter on a tap.
 */
const FINE_POINTER_QUERY = "(any-pointer: fine)";

/**
 * Which input paradigm the app is being driven by, RE-READ REACTIVELY.
 *
 * Reading it once at mount would be enough for a device that is only ever a
 * tablet or only ever a laptop. iPadOS is neither: docking a Magic Keyboard
 * gives the same running app a real pointer, and undocking takes it away.
 * Subscribing to the query is what lets the interaction dialect follow that
 * with no restart and no setting to change.
 */
export function useTouch(): boolean {
  // No matchMedia means no touch device to detect — jsdom, or any
  // non-browser host. Desktop is the app's home, so that is the fallback.
  return useMediaQuery(FINE_POINTER_QUERY) === false;
}
