// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MarkdownRenderer hands every link to the OS browser; nothing here asserts
// on that, but the plugin has no runtime under jsdom.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { GUIDE_PAGES } from "../../help/guide";
import { TOPICS } from "../../help/index";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { HelpDialog } from "./HelpDialog";

/** The nav list's buttons, in DOM order. `queryAll`, not `getAll`, so the
 * empty-state case is an empty array rather than a throw. */
function listedTopics(): string[] {
  const nav = screen.getByRole("navigation", { name: "Help topics" });
  return within(nav)
    .queryAllByRole("button")
    .map((b) => b.textContent ?? "");
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe("HelpDialog: Quick Help", () => {
  it("opens on the first topic and lists every topic in reading order", () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Quick Help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: TOPICS[0].title })).toBeInTheDocument();
    expect(listedTopics()).toEqual(TOPICS.map((t) => t.title));
  });

  it("renders the clicked topic's own H1 in the content pane", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);
    const target = TOPICS[4];

    await userEvent.click(screen.getByRole("button", { name: target.title }));

    expect(screen.getByRole("heading", { level: 1, name: target.title })).toBeInTheDocument();
  });

  it("marks the selected topic with aria-current", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);
    const target = TOPICS[2];

    await userEvent.click(screen.getByRole("button", { name: target.title }));

    expect(screen.getByRole("button", { name: target.title })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  // D8: auto-selecting the top hit on each keystroke would rewrite the content
  // pane four times while the user types "tables" and throw away their scroll.
  it("narrows the list as you type but leaves the content pane alone", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search help"), "pinning");

    expect(listedTopics().length).toBeLessThan(TOPICS.length);
    expect(listedTopics().length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1, name: TOPICS[0].title })).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search help"), "zzzznothing");

    expect(screen.getByText(/no topics match/i)).toBeInTheDocument();
    expect(listedTopics()).toEqual([]);
  });

  it("clears the query with the clear button and restores the full list", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);
    const field = screen.getByLabelText("Search help");
    await userEvent.type(field, "zzzznothing");

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(field).toHaveValue("");
    expect(listedTopics()).toEqual(TOPICS.map((t) => t.title));
  });

  it("never lists a guide page", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search help"), "backend");

    // A hit's text is its title plus its snippet, so match on the prefix.
    const listed = listedTopics();
    expect(listed.some((t) => t.startsWith("Connecting a Backend"))).toBe(false);
    expect(listed.some((t) => t.startsWith("Connections"))).toBe(true);
  });

  it("focuses the search field on mount", () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Search help")).toHaveFocus();
  });

  // A real showModal() runs the dialog focusing steps, which focus the first
  // focusable element (the header ✕) when nothing carries the autofocus
  // attribute; React's autoFocus focused the field BEFORE that, while the
  // dialog was still closed, so in a browser the field never had focus. The
  // jsdom polyfill only sets `open`, which hid it; this stand-in does both.
  it("focuses the search field after showModal, not before it", () => {
    const showModal = vi
      .spyOn(HTMLDialogElement.prototype, "showModal")
      .mockImplementation(function (this: HTMLDialogElement) {
        this.open = true;
        this.querySelector<HTMLElement>("button")?.focus();
      });
    try {
      render(<HelpDialog set="quick" onClose={vi.fn()} />);
      expect(screen.getByLabelText("Search help")).toHaveFocus();
    } finally {
      showModal.mockRestore();
    }
  });

  it("closes on the close button", async () => {
    const onClose = vi.fn();
    render(<HelpDialog set="quick" onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // D7: one press does one thing, and that thing does not depend on where the
  // caret is -- so Escape closes even with text in the search field.
  it("closes on Escape, even with a query typed", async () => {
    const onClose = vi.fn();
    render(<HelpDialog set="quick" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Search help"), "tables");

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the Escape for itself, so nothing behind it also acts on the same press", async () => {
    // A bubble-phase WINDOW listener, standing in for a maximized card's own
    // Escape handler. The dialog listens on document, one hop earlier in the
    // bubble path, so it stops this one. (SettingsDialog.test.tsx makes the
    // identical assertion, for the identical reason -- D6.)
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    try {
      const onClose = vi.fn();
      render(<HelpDialog set="quick" onClose={onClose} />);

      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(behind).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", behind);
    }
  });

  it("still yields to a capture-phase window listener registered after it mounted", async () => {
    // This is why the dialog does NOT use the capture-phase menu idiom: a
    // capture listener registered on window when this dialog mounted would
    // preempt a menu opened LATER inside it.
    const onClose = vi.fn();
    render(<HelpDialog set="quick" onClose={onClose} />);

    const menu = vi.fn((e: KeyboardEvent) => e.stopImmediatePropagation());
    window.addEventListener("keydown", menu, { capture: true });
    try {
      await userEvent.keyboard("{Escape}");

      expect(menu).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", menu, { capture: true });
    }
  });

  it("resolves a topic image to the dark shot under the dark theme", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "The left rail" }));

    const img = screen.getByRole("img", { name: /left rail/i });
    expect(img.getAttribute("src")).toMatch(/the-left-rail-dark\.png$/);
  });

  it("resolves the same image to the light shot under the light theme", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } });
    render(<HelpDialog set="quick" onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "The left rail" }));

    const img = screen.getByRole("img", { name: /left rail/i });
    expect(img.getAttribute("src")).toMatch(/the-left-rail-light\.png$/);
  });

  it("shows a snippet under each hit, and no snippet in the unfiltered list", async () => {
    render(<HelpDialog set="quick" onClose={vi.fn()} />);
    expect(document.querySelectorAll(".help-hit-snippet")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("Search help"), "pinning");

    expect(document.querySelectorAll(".help-hit-snippet").length).toBeGreaterThan(0);
  });
});

describe("HelpDialog: Reference Manual", () => {
  it("opens on the guide's home page and lists every page in section order", () => {
    render(<HelpDialog set="manual" onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Reference Manual" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: GUIDE_PAGES[0].title })).toBeInTheDocument();
    expect(listedTopics()).toEqual(GUIDE_PAGES.map((t) => t.title));
  });

  it("filters its own pages by the search term, and never lists a quick topic", async () => {
    render(<HelpDialog set="manual" onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search help"), "chart");

    const listed = listedTopics();
    expect(listed.length).toBeLessThan(GUIDE_PAGES.length);
    expect(listed.some((t) => t.startsWith("Charts"))).toBe(true);
    expect(listed.some((t) => t === "The left rail")).toBe(false);
  });

  it("follows a page's internal link inside the dialog", async () => {
    render(<HelpDialog set="manual" onClose={vi.fn()} />);
    // home.md's index links every page; the first bullet is the install page.
    const link = screen.getAllByRole("link", { name: "Installing and Running BDOBB" })[0];

    await userEvent.click(link);

    expect(screen.getByRole("heading", { level: 1, name: "Installing and Running BDOBB" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installing and Running BDOBB" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("draws a page's table as a table", async () => {
    render(<HelpDialog set="manual" onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Keyboard Shortcuts" }));

    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("resolves a page image through the themed shots", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    render(<HelpDialog set="manual" onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Layout and Navigation" }));

    const img = screen.getAllByRole("img")[0];
    expect(img.getAttribute("src")).toMatch(/the-left-rail-dark\.png$/);
  });
});
