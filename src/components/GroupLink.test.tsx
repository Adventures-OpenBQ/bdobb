// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardStore } from "../stores/dashboardStore";
import type { DashboardCard, ParamGroup } from "../lib/types";
import { card as makeCard } from "../test/fixtures";
import { GroupLink } from "./GroupLink";

const groups: ParamGroup[] = [
  { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
  { id: "g2", name: "Dates", paramName: "date", groupType: "date", value: "2026-01-01" },
];
const card: DashboardCard = makeCard({ id: "c1", widgetId: "w1", params: { ticker: "NVDA" } });

function renderLink(over: Partial<Parameters<typeof GroupLink>[0]> = {}) {
  return render(
    <GroupLink
      card={card}
      param={{ paramName: "ticker", type: "text", groupType: "symbol", label: "Ticker" }}
      groups={groups}
      groupsDisabled={false}
      value="NVDA"
      {...over}
    />,
  );
}

beforeEach(() => {
  useDashboardStore.setState({
    createGroup: vi.fn(async () => "new"),
    joinGroup: vi.fn(async () => {}),
    leaveGroup: vi.fn(async () => {}),
  });
});

describe("GroupLink", () => {
  it("is a chain-link named for the param when unbound, and opens a menu of compatible groups", async () => {
    renderLink();
    const link = screen.getByRole("button", { name: "Group Ticker" });
    await userEvent.click(link);
    const menu = screen.getByRole("menu", { name: "Groups" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New group" })).toBeInTheDocument();
    // g1 is a symbol group; g2 is a date group and must not be offered.
    expect(screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("menuitemcheckbox", { name: /Dates/ })).not.toBeInTheDocument();
  });

  it("creates a group from the control's current value", async () => {
    renderLink();
    await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New group" }));
    expect(useDashboardStore.getState().createGroup).toHaveBeenCalledWith("c1", "ticker", "symbol", "NVDA");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is a numbered badge when bound, and unchecking the checked row leaves", async () => {
    renderLink({ card: { ...card, bindings: [{ groupId: "g1", paramName: "ticker" }] } });
    const badge = screen.getByRole("button", { name: "Group 1: Ticker — shared across grouped cards" });
    expect(badge).toHaveTextContent("1");
    await userEvent.click(badge);
    const row = screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" });
    expect(row).toHaveAttribute("aria-checked", "true");
    await userEvent.click(row);
    expect(useDashboardStore.getState().leaveGroup).toHaveBeenCalledWith("c1", "ticker");
  });

  it("checking an unchecked row joins", async () => {
    renderLink();
    await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" }));
    expect(useDashboardStore.getState().joinGroup).toHaveBeenCalledWith("g1", "c1", "ticker");
  });

  it("does not offer a group this card already holds through another control", async () => {
    // "symbol" is in g1 on this same card. A group carries one value, so
    // putting "ticker" in it too would only show that value twice.
    renderLink({ card: { ...card, bindings: [{ groupId: "g1", paramName: "symbol" }] } });
    await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
    expect(screen.getByRole("menuitem", { name: "New group" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: /Ticker · AAPL/ })).not.toBeInTheDocument();
  });

  it("is disabled, with a title, when the dashboard has grouping off", () => {
    renderLink({ groupsDisabled: true });
    const link = screen.getByRole("button", { name: "Group Ticker" });
    expect(link).toBeDisabled();
    expect(link).toHaveAttribute("title", "Grouping is off for this dashboard");
  });

  it("closes on Escape", async () => {
    renderLink();
    await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is keyboard-operable: focus lands in the menu, arrows move it, Escape hands it back", async () => {
    renderLink();
    const link = screen.getByRole("button", { name: "Group Ticker" });
    await userEvent.click(link);
    expect(screen.getByRole("menuitem", { name: "New group" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" })).toHaveFocus();
    // Wraps, as RowContextMenu does.
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "New group" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(link).toHaveFocus();
  });

  // The card's `overflow: hidden` clipped an in-tree menu at the card's edge.
  // In <body>, fixed under its trigger, nothing clips it — and a press on an
  // item, now outside the wrapper, must still count as inside the menu.
  it("portals into <body> under its trigger, and an item press still lands", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const anchor = this.classList.contains("param-link");
        return { left: anchor ? 40 : 0, top: 0, bottom: anchor ? 100 : 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      });
    try {
      const { container } = renderLink();
      await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
      const menu = screen.getByRole("menu", { name: "Groups" });
      expect(container.contains(menu)).toBe(false);
      expect(menu).toHaveStyle({ left: "40px", top: "100px" });
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" }));
      expect(useDashboardStore.getState().joinGroup).toHaveBeenCalledWith("g1", "c1", "ticker");
    } finally {
      rectSpy.mockRestore();
    }
  });

  // A maximized card restores on a window keydown Escape registered before the
  // menu opened; the press that closes the menu must not reach it as well.
  it("keeps the Escape that closes it from reaching a window listener", async () => {
    const restore = vi.fn((e: KeyboardEvent) => e.key === "Escape");
    window.addEventListener("keydown", restore);
    try {
      renderLink();
      await userEvent.click(screen.getByRole("button", { name: "Group Ticker" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(restore).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", restore);
    }
  });
});
