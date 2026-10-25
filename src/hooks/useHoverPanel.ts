// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { movedWithin } from "../lib/dragDrop";
import { useTouch } from "./usePointerKind";

/** How long a panel stays expanded after the pointer leaves it. */
const DELAY_MS = 300;

/**
 * True while `el` contains the focused element and that element takes typed
 * text. This is the draft guard: a tap elsewhere must not fold a panel out
 * from under a half-written sentence.
 *
 * Deliberately general. The spec words this as an exception for the chat
 * pane, which does not exist in this tree; keyed to "a focused text input"
 * instead, it protects any panel that has one today and the chat pane
 * unchanged when it lands.
 */
/** Input types a tap merely sets; there is no draft in them to lose. */
const NOT_A_DRAFT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file"]);

function holdsFocusedInput(el: HTMLElement | null): boolean {
  if (el === null) return false;
  const active = document.activeElement;
  if (active === null || !el.contains(active)) return false;
  // InlineRename ENDS on blur by contract -- "Enter and blur commit the
  // trimmed value; Escape cancels", and an unchanged or blank commit is
  // reported as a cancel. So there is no draft here for an outside tap to
  // destroy, and guarding it was a trap rather than a protection: LeftRail
  // pins the rail open with `renamingId !== null` independently of `open`,
  // so a rename left in progress kept the rail expanded AND made this guard
  // refuse every outside tap -- the rail could not be dismissed at all
  // (seen on iPad, where a stray long-press opens a rename easily). Letting
  // the tap through blurs the field, which commits or cancels, which clears
  // `renamingId` and folds the rail. Same reasoning as the checkbox above.
  if (active instanceof HTMLInputElement && active.classList.contains("inline-rename")) {
    return false;
  }
  if (active instanceof HTMLTextAreaElement) return true;
  // A ticked checkbox keeps focus, and counting it as a draft kept the
  // documents rail open against every outside tap (seen on device).
  if (active instanceof HTMLInputElement) return !NOT_A_DRAFT.has(active.type);
  return active instanceof HTMLElement && active.isContentEditable;
}

/**
 * Shared by every hover panel. Expand on enter, collapse after a delay.
 *
 * `enterDelayMs` defaults to 0 -- expand on the enter event itself, with no
 * timer at all, which is what every caller but the Rita rail wants and what
 * this hook has always done. The rail is the one panel that lies along an
 * edge the pointer crosses on its way somewhere else, so it alone waits.
 * The open timer shares `timer` with the close one, so entering cancels a
 * pending close and leaving cancels a pending open.
 *
 * It is a HOVER delay, so it applies to the pointer only: a tap is a
 * deliberate act with nothing to disambiguate, and onClick below opens at
 * once under touch.
 */
export function useHoverPanel(enterDelayMs = 0) {
  // Touch has no hover state: a fingertip either touches or it does not.
  const touch = useTouch();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  // Set by close() for the rest of the current event (see onClick).
  const closing = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const enter = useCallback(() => {
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

  const onMouseEnter = useCallback(() => {
    // iOS fires synthetic mouseenter on a tap, so honouring hover under touch
    // would re-open the panel on the very tap meant to dismiss it.
    if (touch) return;
    enter();
  }, [enter, touch]);

  const onMouseLeave = useCallback(() => {
    if (touch) return;
    clear();
    timer.current = setTimeout(() => setOpen(false), DELAY_MS);
  }, [clear, touch]);

  const close = useCallback(() => {
    clear();
    setOpen(false);
    // A row that closes the panel (Widget Library, Settings...) does so from
    // its own onClick, and under touch that click then bubbles to onClick
    // below, whose setOpen(true) lands after this setOpen(false) in the same
    // batch -- the rail stayed expanded over the dialog it had just opened.
    // So close() wins for the rest of this event. Cleared on a microtask,
    // which runs once the event's dispatch has finished, so a close() made
    // outside any click cannot swallow the next real tap.
    closing.current = true;
    queueMicrotask(() => {
      closing.current = false;
    });
  }, [clear]);

  /**
   * Touch dialect: tap to open. Inert under a pointer. Open, not toggle: a
   * tap on a row or checkbox INSIDE the panel bubbles here too, and toggling
   * closed the rail under the finger that was using it (seen on device).
   * Closing is the outside-tap listener's job.
   */
  const onClick = useCallback(() => {
    if (!touch || closing.current) return;
    clear();
    setOpen(true);
  }, [clear, touch]);

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

  // Tap anywhere else to dismiss. Capture phase, so a tap on a control that
  // stops propagation still closes the panel. Bound only while open and only
  // under touch, so a desktop session adds no document listener at all.
  useEffect(() => {
    if (!touch || !open) return;
    const onPointerDown = (event: Event) => {
      const el = ref.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
      if (holdsFocusedInput(el)) return;
      // Drop focus as the panel goes, as the mouse path does on leave: a
      // control inside still focused keeps a :focus-within panel painted
      // open whatever `open` says.
      const active = document.activeElement;
      if (el !== null && active instanceof HTMLElement && el.contains(active)) active.blur();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [touch, open]);

  useEffect(() => clear, [clear]);

  return {
    open,
    close,
    /** Attach to the panel's outermost element, or outside-tap cannot tell inside from outside. */
    ref,
    handlers: {
      onMouseEnter,
      onMouseLeave,
      onClick,
      // A drag suppresses mouse events, so the rail would never expand while a
      // widget is being dragged onto it. Entering shares the open logic with
      // the mouse, but not its touch guard: a drag is no synthetic tap, and
      // under touch onMouseEnter returns early, so a drag over the collapsed
      // rail never expanded it. Leaving needs its own guarded handler (see
      // onDragLeave).
      onDragEnter: enter,
      onDragLeave,
    },
  };
}
