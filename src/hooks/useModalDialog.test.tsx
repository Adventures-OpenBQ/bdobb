// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modalStack } from "./modalStack";
import { useChildDialog } from "./useChildDialog";
import { useModalDialog } from "./useModalDialog";

function Parent({ onClose }: { onClose: () => void }) {
  const ref = useModalDialog(onClose);
  return (
    <dialog ref={ref} aria-label="parent">
      <button type="button">inside</button>
    </dialog>
  );
}
function ParentHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      {open ? <Parent onClose={onClose} /> : null}
      <button type="button" onClick={() => setOpen(false)}>close</button>
    </>
  );
}

function Child({ onClose }: { onClose: () => void }) {
  const ref = useChildDialog(onClose);
  return (
    <dialog ref={ref} aria-label="child">
      <button type="button">inside child</button>
    </dialog>
  );
}
// Mirrors real usage (BackendEditForm over ConnectionsDialog): the parent
// dialog is already open when the child mounts later, in response to a
// click -- not in the same initial render -- so the child's stack entry is
// pushed strictly after the parent's, in its own commit.
function Scene({
  parentClose,
  childCloseSpy,
}: {
  parentClose: () => void;
  childCloseSpy: () => void;
}) {
  const parentRef = useModalDialog(parentClose);
  const [childOpen, setChildOpen] = useState(false);
  return (
    <dialog ref={parentRef} aria-label="parent">
      <button type="button" onClick={() => setChildOpen(true)}>open child</button>
      {childOpen ? (
        <Child
          onClose={() => {
            childCloseSpy();
            setChildOpen(false);
          }}
        />
      ) : null}
    </dialog>
  );
}

afterEach(() => {
  while (modalStack.top()) modalStack.remove(modalStack.top()!);
});

describe("useModalDialog", () => {
  it("opens modal on mount and suppresses the native cancel event", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const onClose = vi.fn();
    render(<Parent onClose={onClose} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "parent" }) as HTMLDialogElement;
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes on Escape via a document keydown listener, stopping propagation", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const onClose = vi.fn();
    render(<Parent onClose={onClose} />);
    const sibling = vi.fn();
    document.addEventListener("keydown", sibling);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sibling).not.toHaveBeenCalled();
    document.removeEventListener("keydown", sibling);
  });

  // An IME uses Escape to cancel a composition; that press is the IME's, and
  // must not also close the dialog (and discard a Settings draft).
  it("ignores an Escape that belongs to an IME composition", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const onClose = vi.fn();
    render(<Parent onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the opener on unmount", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<ParentHarness onClose={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog", { name: "parent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("Escape closes the topmost child first, then the parent on the next press", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const parentClose = vi.fn();
    const childCloseSpy = vi.fn();
    render(<Scene parentClose={parentClose} childCloseSpy={childCloseSpy} />);
    fireEvent.click(screen.getByRole("button", { name: "open child" }));
    expect(await screen.findByRole("dialog", { name: "child" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(childCloseSpy).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "child" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(parentClose).toHaveBeenCalledTimes(1);
  });

  it("a parent with no child closes on Escape", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const parentClose = vi.fn();
    render(<Parent onClose={parentClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(parentClose).toHaveBeenCalledTimes(1);
  });
});
