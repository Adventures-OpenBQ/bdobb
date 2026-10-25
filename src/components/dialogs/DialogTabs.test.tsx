// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DialogTabs } from "./DialogTabs";

const ITEMS: Array<[string, string]> = [
  ["general", "General"],
  ["widget", "Widget"],
  ["logs", "Logs"],
];

function setup(selected = "general") {
  const onSelect = vi.fn();
  render(
    <DialogTabs
      items={ITEMS}
      selected={selected}
      onSelect={onSelect}
      label="Preferences"
      panelId="settings-panel"
      idPrefix="settings-tab"
    />,
  );
  return { onSelect };
}

describe("DialogTabs", () => {
  it("renders one tab per item with roving tabindex and aria wiring", () => {
    setup("widget");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveAttribute("aria-controls", "settings-panel");
    expect(tabs[1]).toHaveAttribute("id", "settings-tab-widget");
    expect(screen.getByRole("tablist", { name: "Preferences" })).toBeInTheDocument();
  });

  it("moves selection with Arrow, Home and End", async () => {
    const { onSelect } = setup("general");
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith("widget");
    await userEvent.keyboard("{End}");
    expect(onSelect).toHaveBeenLastCalledWith("logs");
    await userEvent.keyboard("{Home}");
    expect(onSelect).toHaveBeenLastCalledWith("general");
    // Wrap: ArrowLeft from the first tab lands on the last.
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith("logs");
  });

  it("moves focus with the selection, so the old tab is not left focused at tabindex -1", async () => {
    setup("general");
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(tabs[2]).toHaveFocus();
  });

  it("selects on click", async () => {
    const { onSelect } = setup("general");
    await userEvent.click(screen.getByRole("tab", { name: "Logs" }));
    expect(onSelect).toHaveBeenCalledWith("logs");
  });

  it("does not steal focus on mount", () => {
    setup("widget");
    expect(screen.getByRole("tab", { name: "Widget" })).not.toHaveFocus();
  });
});
