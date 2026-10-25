// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, type RefObject } from "react";
import { modalStack, type ModalEntry } from "./modalStack";

/**
 * The modal idiom every <dialog> in the app shares. Attach the returned ref
 * to the element.
 *
 * A real modal dialog: the top layer puts it over every card without a
 * z-index, the rest of the app goes inert, and focus is trapped inside.
 *
 * Focus is handed back to whatever opened the dialog. showModal() moves
 * focus inside, and the element it was on is gone by the time this
 * unmounts, so without this a keyboard user is dropped on <body> instead
 * of on the rail row they pressed.
 *
 * The native close request (Escape, and only Escape) would close the
 * element without telling React, leaving a mounted dialog nobody can see.
 * Escape is handled below instead, where `onClose` can also do extra work
 * (Settings commits its ticker draft) and stop a maximized card from
 * restoring behind the dialog.
 *
 * On `document`, not `window`, and with stopImmediatePropagation: one
 * Escape must close this dialog and nothing else. A maximized card keeps a
 * bubble-phase WINDOW listener that would otherwise ALSO restore it, and
 * that listener is registered first, so a same-node handler could not win.
 * document is one hop earlier in the bubble path than window, which is
 * exactly enough — and, unlike the capture phase, it still leaves the row
 * menu inside the Provider keys panel in front of this dialog: that menu's
 * capture-phase window listener (MenuPanel, RowContextMenu.tsx) runs before
 * anything here, whereas a capture listener registered on window when this
 * dialog MOUNTED would have preempted a menu opened later. It also keeps
 * React's own root listener ahead of this one, so Escape still reaches the
 * dialog's fields.
 *
 * Stack-awareness: this dialog pushes its own entry onto the shared
 * modalStack (same stack useChildDialog pushes onto for a dialog stacked
 * over this one, e.g. the backend editor over Connections). Every mounted
 * useModalDialog registers the keydown listener below, and on Escape the
 * first of them to run — the earliest-mounted dialog still on the stack,
 * not necessarily the top one — closes modalStack.top(), whichever dialog
 * that is, and stops the press there — see onKey.
 * This is what lets a child dialog's Escape close the child without this
 * dialog inspecting an `editorOpen`-style flag from its caller.
 */
export function useModalDialog(onClose: () => void): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Mirrored so the listener is added once and still never sees a stale closure.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Holds this dialog's own modalStack entry so the keydown effect below can
  // compare stack positions; set in the mount effect, read in the keydown
  // effect, both of which run in this order on mount.
  const selfEntryRef = useRef<ModalEntry | null>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const selfEntry: ModalEntry = { close: () => closeRef.current() };
    selfEntryRef.current = selfEntry;
    modalStack.push(selfEntry);
    const onCancel = (e: Event) => e.preventDefault();
    dialog?.addEventListener("cancel", onCancel);
    return () => {
      modalStack.remove(selfEntry);
      dialog?.removeEventListener("cancel", onCancel);
      // Closed here, not left to the unmount: under StrictMode's dev-only
      // re-run the element survives this cleanup, and an open modal would
      // keep the opener inert (so the focus below fails and the re-run
      // captures an element inside the dialog as its opener) and meet a
      // second showModal() while already open. Harmless on a real unmount,
      // where the element is already out of the document.
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An IME's own Escape (cancelling a composition) is not a close request.
      if (e.key !== "Escape" || e.isComposing) return;
      const top = modalStack.top();
      if (top === undefined) return;
      // -1 when this dialog's own entry isn't actually in the stack (a
      // defensive edge case, e.g. around unmount); topIndex is always >= a
      // present selfIndex since top() is by definition the stack's maximum
      // index, so that comparison could never be the reachable guard here.
      const selfIndex = modalStack.indexOf(selfEntryRef.current!);
      if (selfIndex === -1) return;
      e.stopImmediatePropagation();
      top.close(); // the topmost entry (self, or a child stacked over self)
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return dialogRef;
}
