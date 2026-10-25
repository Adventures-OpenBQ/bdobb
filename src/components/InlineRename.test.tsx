// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineRename } from "./InlineRename";

function setup(value = "First") {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <InlineRename value={value} ariaLabel="Rename tab" onCommit={onCommit} onCancel={onCancel} />,
  );
  return { input: screen.getByRole("textbox", { name: "Rename tab" }), onCommit, onCancel };
}

describe("InlineRename", () => {
  it("mounts focused with its text selected, so typing replaces the old name", () => {
    const { input } = setup();
    expect(input).toHaveFocus();
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe("First".length);
  });

  it("commits the trimmed value on Enter", async () => {
    const { input, onCommit, onCancel } = setup();
    // skipClick: the field is already focused with its text selected, and a
    // click would collapse that selection to the end — typing over it is the
    // real interaction.
    await userEvent.type(input, "  Macro  {Enter}", { skipClick: true });
    expect(onCommit).toHaveBeenCalledWith("Macro");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels rather than committing when the value is unchanged", async () => {
    const { input, onCommit, onCancel } = setup();
    await userEvent.type(input, "{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("cancels rather than committing when the value is blank", async () => {
    const { input, onCommit, onCancel } = setup();
    await userEvent.type(input, "   {Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("cancels on Escape without committing what was typed", async () => {
    const { input, onCommit, onCancel } = setup();
    await userEvent.type(input, "Macro{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  // An IME's Enter picks a candidate and its Escape drops the composition;
  // neither is the user finishing or abandoning the rename. WebKit reports
  // the composing Enter as keyCode 229 with isComposing already false.
  it.each([
    ["isComposing", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 }],
  ])("ignores Enter and Escape while an IME is composing (%s)", (_label, composing) => {
    const { input, onCommit, onCancel } = setup();
    fireEvent.change(input, { target: { value: "日本" } });
    fireEvent.keyDown(input, { key: "Enter", ...composing });
    fireEvent.keyDown(input, { key: "Escape", ...composing });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("commits on blur", async () => {
    const { input, onCommit } = setup();
    await userEvent.type(input, "Macro", { skipClick: true });
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith("Macro");
  });

  it("does not let its keydown reach the row around it or the window", async () => {
    const onParentKeyDown = vi.fn();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      render(
        <div onKeyDown={onParentKeyDown}>
          <InlineRename
            value="First"
            ariaLabel="Rename tab"
            onCommit={vi.fn()}
            onCancel={vi.fn()}
          />
        </div>,
      );
      await userEvent.type(screen.getByRole("textbox", { name: "Rename tab" }), "M");
      expect(onParentKeyDown).not.toHaveBeenCalled();
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });
});
