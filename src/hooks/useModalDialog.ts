// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, type RefObject } from "react";
import { modalStack } from "./modalStack";
import { useChildDialog } from "./useChildDialog";

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
  // showModal(), the refused native close request, the modalStack entry and
  // the focus hand-back are exactly a child dialog's; only the Escape
  // listener below is this hook's own.
  const dialogRef = useChildDialog(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An IME's own Escape (cancelling a composition) is not a close request.
      if (e.key !== "Escape" || e.isComposing) return;
      e.stopImmediatePropagation();
      // The topmost entry (self, or a child stacked over self). Never empty
      // while this listener is attached: this dialog's own entry is pushed
      // before it and removed in the same commit.
      modalStack.top()?.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return dialogRef;
}
