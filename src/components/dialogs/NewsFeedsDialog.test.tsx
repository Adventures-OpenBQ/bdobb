// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsCardState } from "../../lib/types";
import { NewsFeedsDialog } from "./NewsFeedsDialog";

const onDone = vi.fn();
const onClose = vi.fn();
const STATE: NewsCardState = {
  feeds: [
    { url: "https://a.example/feed", name: "A", tab: "Wires" },
    { url: "https://b.example/feed", name: "B", tab: "" },
  ],
  highlights: ["fed"],
};

beforeEach(() => {
  onDone.mockReset();
  onClose.mockReset();
});

const src = (n: number) => screen.getByRole("textbox", { name: `Feed ${n} source` });
const name = (n: number) => screen.getByRole("textbox", { name: `Feed ${n} name` });
const tab = (n: number) => screen.getByRole("textbox", { name: `Feed ${n} tab` });

describe("NewsFeedsDialog", () => {
  it("opens as a modal showing the current feeds and keywords", () => {
    render(<NewsFeedsDialog state={STATE} onDone={onDone} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Configure feeds" })).toHaveAttribute("open");
    expect(src(1)).toHaveValue("https://a.example/feed");
    expect(tab(1)).toHaveValue("Wires");
    expect(name(2)).toHaveValue("B");
    expect(screen.getByRole("textbox", { name: "Highlight keywords" })).toHaveValue("fed");
  });

  it("adds, edits, moves and removes rows, and Done writes the trimmed list", async () => {
    render(<NewsFeedsDialog state={STATE} onDone={onDone} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Add feed" }));
    expect(src(3)).toHaveFocus();
    await userEvent.type(src(3), "  https://c.example/feed ");
    await userEvent.type(tab(3), " Substack ");
    await userEvent.click(screen.getByRole("button", { name: "Move feed 3 up" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove feed 1" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Highlight keywords" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Highlight keywords" }), "rates, gold ,");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onDone).toHaveBeenCalledWith({
      feeds: [
        { url: "https://c.example/feed", name: "", tab: "Substack" },
        { url: "https://b.example/feed", name: "B", tab: "" },
      ],
      highlights: ["rates", "gold"],
    });
  });

  it("drops blank rows, omits empty highlights, and hands back null for an empty list", async () => {
    render(<NewsFeedsDialog state={undefined} onDone={onDone} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Add feed" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("marks a non-http URL invalid and disables Done until it is fixed", async () => {
    render(<NewsFeedsDialog state={STATE} onDone={onDone} onClose={onClose} />);
    await userEvent.clear(src(1));
    await userEvent.type(src(1), "javascript:alert(1)");
    expect(src(1)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Not an http or https URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    await userEvent.clear(src(1));
    await userEvent.type(src(1), "https://ok.example/feed");
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("Cancel and Escape close without writing", async () => {
    render(<NewsFeedsDialog state={STATE} onDone={onDone} onClose={onClose} />);
    await userEvent.type(name(1), "changed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("NewsFeedsDialog and the dragged tab order", () => {
  it("carries the card's tabOrder through Done untouched", async () => {
    render(<NewsFeedsDialog state={{ ...STATE, tabOrder: ["Substack", "Wires"] }} onDone={onDone} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith({ ...STATE, tabOrder: ["Substack", "Wires"] });
  });
});
