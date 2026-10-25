// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { movedWithin } from "../lib/dragDrop";

/** How long a panel stays expanded after the pointer leaves it. */
const DELAY_MS = 300;

/**
 * Shared by every hover panel. Expand on enter, collapse after a delay.
 *
 * `enterDelayMs` defaults to 0 -- expand on the enter event itself, with no
 * timer at all, which is what every caller but the Rita rail wants and what
 * this hook has always done. The rail is the one panel that lies along an
 * edge the pointer crosses on its way somewhere else, so it alone waits.
 * The open timer shares `timer` with the close one: entering cancels a
 * pending close and leaving cancels a pending open, which is exactly right.
 */
export function useHoverPanel(enterDelayMs = 0) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    clear();
    // Not setTimeout(..., 0): that still defers to a later task, and a panel
    // with no configured delay should be open by the time the event handler
    // returns, as it always has been.
    if (enterDelayMs <= 0) {
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => setOpen(true), enterDelayMs);
  }, [clear, enterDelayMs]);

  const onMouseLeave = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(false), DELAY_MS);
  }, [clear]);

  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  // React's mouseenter/mouseleave are non-bubbling subtree events, but
  // dragenter/dragleave are ordinary bubbling events, and browsers fire
  // dragenter on the NEW element before dragleave on the OLD one — the
  // reverse of mouseover/mouseout. Aliasing this to onMouseLeave would mean
  // a dragleave that bubbles up from a child element (crossing between two
  // rows inside the panel) arms a collapse with no later dragenter to cancel
  // it, since the pointer is still dwelling on the child. Ignore any leave
  // whose relatedTarget is still inside the element the handler is bound to.
  const onDragLeave = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (movedWithin(e.relatedTarget, e.currentTarget)) return;
      clear();
      timer.current = setTimeout(() => setOpen(false), DELAY_MS);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return {
    open,
    close,
    handlers: {
      onMouseEnter,
      onMouseLeave,
      // A drag suppresses mouse events, so the rail would never expand while a
      // widget is being dragged onto it. Entering shares the open logic with
      // the mouse; leaving needs its own guarded handler (see onDragLeave).
      onDragEnter: onMouseEnter,
      onDragLeave,
    },
  };
}
