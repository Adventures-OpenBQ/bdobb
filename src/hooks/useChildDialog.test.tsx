// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { modalStack } from "./modalStack";
import { useChildDialog } from "./useChildDialog";

function Child({ onClose }: { onClose: () => void }) {
  const ref = useChildDialog(onClose);
  return (
    <dialog ref={ref} aria-label="child">
      <button type="button">inside</button>
    </dialog>
  );
}
function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      {open ? <Child onClose={onClose} /> : null}
      <button type="button" onClick={() => setOpen(false)}>close</button>
    </>
  );
}

describe("useChildDialog", () => {
  it("opens modal on mount, suppresses cancel, and pushes an entry", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    vi.spyOn(HTMLDialogElement.prototype, "close");
    const onClose = vi.fn();
    render(<Child onClose={onClose} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(modalStack.top()?.close).toBeTypeOf("function");
    const dialog = screen.getByRole("dialog", { name: "child" }) as HTMLDialogElement;
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // top().close() calls the latest onClose (closeRef mirror)
    modalStack.top()!.close();
    expect(onClose).toHaveBeenCalled();
  });

  it("removes its entry and returns focus to the opener on unmount", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    vi.spyOn(HTMLDialogElement.prototype, "close");
    render(<Harness onClose={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog", { name: "child" })).toBeInTheDocument();
    const depth = () => (modalStack.top() ? 1 : 0);
    expect(depth()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(document.activeElement).toBe(opener);
    expect(depth()).toBe(0);
  });
});
