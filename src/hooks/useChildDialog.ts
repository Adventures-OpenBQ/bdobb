// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, type RefObject } from "react";
import { modalStack } from "./modalStack";

/**
 * A modal <dialog> stacked over a parent dialog: the backend editor over
 * Connections, the skill editor over the AI Library. It opens itself with
 * showModal() (the top layer stacks, so it sits above the parent), suppresses
 * the native `cancel` event so Escape can't close the element behind React's
 * back, and hands focus back to whatever opened it on unmount.
 *
 * It registers NO keydown listener: Escape is handled once, in useModalDialog,
 * which closes only the top of modalStack. Because this child pushes its entry
 * AFTER the parent pushed its own, the child is on top and closes first — no
 * parent-side editorOpen bookkeeping. `onClose` is mirrored through a ref so
 * the pushed entry always calls the latest closure, never a stale one.
 */
export function useChildDialog(onClose: () => void): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const onCancel = (e: Event) => e.preventDefault();
    dialog?.addEventListener("cancel", onCancel);
    const entry = { close: () => closeRef.current() };
    modalStack.push(entry);
    return () => {
      modalStack.remove(entry);
      dialog?.removeEventListener("cancel", onCancel);
      // As in useModalDialog: under StrictMode's dev-only re-run the element
      // survives this cleanup, and the second showModal() on an open dialog
      // throws InvalidStateError.
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return dialogRef;
}
