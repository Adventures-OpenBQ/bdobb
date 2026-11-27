// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The open-order stack of modal dialogs. Every useModalDialog and
 * useChildDialog pushes its own entry on mount and removes it on unmount, so
 * the array holds parents and children in the order they opened. Escape
 * (handled once, in useModalDialog) closes only top(), which is why a child
 * dialog closes before its parent without either one inspecting the other.
 */
export type ModalEntry = { close: () => void };

const stack: ModalEntry[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const modalStack = {
  push(entry: ModalEntry): void {
    stack.push(entry);
    changed();
  },
  remove(entry: ModalEntry): void {
    const i = stack.indexOf(entry);
    if (i === -1) return;
    stack.splice(i, 1);
    changed();
  },
  top(): ModalEntry | undefined {
    return stack[stack.length - 1];
  },
  /** Whether any dialog is open. With `subscribe`, the pair useSyncExternalStore takes. */
  isOpen(): boolean {
    return stack.length > 0;
  },
  /** Calls `listener` after every push and every remove; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
