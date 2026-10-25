// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";

/** How long a fingertip must hold still before the press counts as a right-click. */
export const LONG_PRESS_MS = 500;
/** Movement beyond this is a scroll or a drag, not a press. */
const SLOP_PX = 10;

/**
 * Long-press as right-click, for the touch dialect.
 *
 * Every context menu in the app is opened by an onContextMenu handler, and
 * WKWebView on iPadOS dispatches no `contextmenu` for a long press — so on
 * an iPad with no trackpad, none of those menus (rename, delete, export,
 * import, the folder actions) could be reached at all. Rather than a second
 * trigger on each site, a held press dispatches a real `contextmenu` event
 * at the pressed element: it bubbles through React exactly as a right-click
 * does, so each site's preventDefault/stopPropagation choices hold.
 *
 * Mounted once, at the app root, and bound only on a touch-capable device: a
 * Mac session adds no document listener at all. Which presses count is read
 * off each press's pointerType, not off useTouch(): on an iPad Pro 11-inch
 * (M5) with nothing docked, `(any-pointer: fine)` reports true (seen on
 * device, 2026-10-18), so a hook gated on the media query never bound and no
 * long-press menu opened anywhere. A mouse or trackpad press is never armed;
 * its right-click is the menu.
 */
export function useLongPressContextMenu(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !(navigator.maxTouchPoints > 0)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let press: { x: number; y: number; target: Element } | null = null;
    // The lift that ends a fired press still produces iOS's compatibility
    // mouse events -- mousedown, mouseup, click -- at the touch point. The
    // mousedown is what RowContextMenu closes on (it just opened), and the
    // click would activate the row under it. Both are swallowed, up to that
    // click or the next press, whichever comes first.
    let fired = false;

    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      press = null;
    };
    const onPointerDown = (event: PointerEvent) => {
      fired = false;
      cancel();
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (!(event.target instanceof Element)) return;
      press = { x: event.clientX, y: event.clientY, target: event.target };
      timer = setTimeout(() => {
        if (press === null) return;
        const { x, y, target } = press;
        cancel();
        // Swallow the lift only when a handler took the press (opened a menu);
        // otherwise a slow tap on a plain button would lose its click.
        fired = !target.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
        );
      }, LONG_PRESS_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) cancel();
    };
    const swallow = (event: Event) => {
      if (!fired) return;
      event.preventDefault();
      event.stopPropagation();
      // The click ends the lift. Left set, it went on swallowing the
      // keyboard's clicks too -- Enter or Space on the menu just opened sends
      // a click with no pointerdown before it to reset this.
      if (event.type === "click") fired = false;
    };

    const ac = new AbortController();
    const opts = { capture: true, signal: ac.signal };
    document.addEventListener("pointerdown", onPointerDown, opts);
    document.addEventListener("pointermove", onPointerMove, opts);
    document.addEventListener("pointerup", cancel, opts);
    document.addEventListener("pointercancel", cancel, opts);
    // iPadOS lifts a held draggable row into a native drag about 650 ms in,
    // with no movement at all (seen on device). Before the menu, that is a
    // drag and the press is over; after it, the hold was the menu's, and the
    // lift would drag the row out from under it.
    document.addEventListener("dragstart", (event) => (fired ? event.preventDefault() : cancel()), opts);
    document.addEventListener("mousedown", swallow, opts);
    document.addEventListener("click", swallow, opts);
    return () => {
      cancel();
      ac.abort();
    };
  }, []);
}
