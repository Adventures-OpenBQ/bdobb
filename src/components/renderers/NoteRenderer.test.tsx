// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { NoteRenderer } from "./NoteRenderer";

beforeEach(() => openUrl.mockReset());

describe("NoteRenderer", () => {
  it("renders the text as markdown", () => {
    render(<NoteRenderer text={"## Hello\n\nbody"} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("invites text when the note is empty", () => {
    render(<NoteRenderer text="" onChange={vi.fn()} />);
    expect(screen.getByText(/click to write/i)).toBeInTheDocument();
  });

  it("switches to a textarea on click, seeded with the current text", async () => {
    render(<NoteRenderer text="hello" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("commits on blur", async () => {
    const onChange = vi.fn();
    render(<NoteRenderer text="hello" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "changed");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("changed");
  });

  it("does not report a commit when the text did not change", async () => {
    const onChange = vi.fn();
    render(<NoteRenderer text="hello" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape without committing", async () => {
    const onChange = vi.fn();
    render(<NoteRenderer text="hello" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    await userEvent.type(screen.getByRole("textbox"), "xyz{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens a link inside the note externally and does not also enter edit mode", async () => {
    render(<NoteRenderer text={"see [go](https://example.com/x)"} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("link", { name: "go" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("still enters edit mode when the click is on the note body but not on a link", async () => {
    const { container } = render(
      <NoteRenderer text={"see [go](https://example.com/x)"} onChange={vi.fn()} />,
    );
    // eslint-disable-next-line testing-library/no-node-access -- deliberately
    // targeting the note body, not the anchor nested inside it.
    await userEvent.click(container.querySelector(".markdown-body")!);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("enters edit mode on Enter and on Space, since a <div role=\"button\"> gets no native key handling", async () => {
    render(<NoteRenderer text="hello" onChange={vi.fn()} />);
    const control = screen.getByRole("button", { name: "hello" });
    control.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    screen.getByRole("button", { name: "hello" }).focus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // -- Finding 5: blur never fires on unmount, so committing must not
  // depend on it -- a card removed, or the app quit, mid-edit must not
  // silently drop the draft.
  it("commits an in-progress draft on unmount, since blur never fires then", async () => {
    const onChange = vi.fn();
    const { unmount } = render(<NoteRenderer text="hello" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "changed");

    unmount();

    expect(onChange).toHaveBeenCalledWith("changed");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not double-commit on unmount after a normal blur already committed", async () => {
    const onChange = vi.fn();
    const { unmount } = render(<NoteRenderer text="hello" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "changed");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);

    unmount();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not commit on unmount when never in edit mode, or when the draft never changed", () => {
    const onChange = vi.fn();
    const { unmount } = render(<NoteRenderer text="hello" onChange={onChange} />);
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });
});
