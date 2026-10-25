// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowContextMenu } from "./RowContextMenu";

function open(onSelect = vi.fn(), onClose = vi.fn()) {
  render(
    <RowContextMenu x={10} y={20} onClose={onClose} items={[
      { label: "Test this service", onSelect },
      { label: "Second", onSelect: vi.fn() },
    ]} />,
  );
  return { onSelect, onClose };
}

describe("RowContextMenu", () => {
  it("renders its items as a menu", () => {
    open();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("focuses the first item so the keyboard works immediately", () => {
    open();
    expect(screen.getByRole("menuitem", { name: "Test this service" })).toHaveFocus();
  });

  it("moves with the arrow keys and wraps", async () => {
    open();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Test this service" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const { onClose } = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on an outside pointer press", async () => {
    const { onClose } = open();
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on an outside press on a focusable control, and leaves focus on that control rather than yanking it back to the trigger", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    const outsideInput = document.createElement("input");
    document.body.appendChild(outsideInput);
    try {
      const onClose = vi.fn();
      render(
        <RowContextMenu
          x={10}
          y={20}
          onClose={onClose}
          returnFocusTo={trigger}
          items={[{ label: "Test this service", onSelect: vi.fn() }]}
        />,
      );
      await userEvent.click(outsideInput);
      expect(onClose).toHaveBeenCalled();
      expect(outsideInput).toHaveFocus();
    } finally {
      trigger.remove();
      outsideInput.remove();
    }
  });

  it("renders at the given point", () => {
    render(<RowContextMenu x={12} y={34} onClose={vi.fn()} items={[{ label: "One", onSelect: vi.fn() }]} />);
    expect(screen.getByRole("menu")).toHaveStyle({ left: "12px", top: "34px" });
  });

  it("takes Escape at capture, so a bubble-phase window listener behind it never sees the press", async () => {
    // Stands in for a maximized WidgetCard's own bubble-phase window Escape
    // listener, or SettingsDialog's. Registered BEFORE this menu mounts, so
    // only the capture phase can put the menu first: one press must close the
    // menu and nothing else.
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    try {
      const { onClose } = open();
      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(behind).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", behind);
    }
  });

  it("stays open for a key that is not Escape", () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open for a mousedown inside itself", () => {
    const { onClose } = open();
    // mousedown, not click: the menu must be gone before the click lands on
    // whatever is underneath it.
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", () => {
    const { onClose } = open();
    cleanup();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a press on its own anchor, so the trigger's click can close it", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    try {
      const onClose = vi.fn();
      render(
        <RowContextMenu
          x={0}
          y={0}
          anchor={anchor}
          onClose={onClose}
          items={[{ label: "One", onSelect: vi.fn() }]}
        />,
      );
      fireEvent.mouseDown(anchor);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalled();
    } finally {
      anchor.remove();
    }
  });

  it("skips a disabled first item when it takes focus on mount", () => {
    // The table header's pin menu disables the side the column already has,
    // and that item can be the first one — mount focus must land on something
    // the keyboard can actually act on, not on an inert button.
    render(
      <RowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { label: "Pin left", disabled: true, onSelect: vi.fn() },
          { label: "Pin right", onSelect: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Pin right" })).toHaveFocus();
  });

  it("steps over a disabled item with the arrow keys", async () => {
    render(
      <RowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { label: "First", onSelect: vi.fn() },
          { label: "Middle", disabled: true, onSelect: vi.fn() },
          { label: "Last", onSelect: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Last" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
  });

  it("leaves a mousedown on a draggable target alone, so its native drag still starts", () => {
    // A table header cell is draggable AND focusable. preventDefault on its
    // mousedown cancels the drag before dragstart is ever dispatched, so the
    // draggable branch has to hold even once the cell is in the tab order.
    const th = document.createElement("div");
    th.setAttribute("draggable", "true");
    th.tabIndex = 0;
    document.body.appendChild(th);
    try {
      const { onClose } = open();
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      th.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
      expect(onClose).toHaveBeenCalled();
    } finally {
      th.remove();
    }
  });

  it("renders a disabled item as disabled, and does not report it", async () => {
    const onSelect = vi.fn();
    render(
      <RowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { label: "Pin left", onSelect, disabled: true },
          { label: "Pin right", onSelect: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Pin left" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Pin right" })).toBeEnabled();
    await userEvent.click(screen.getByRole("menuitem", { name: "Pin left" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("draws a separator above the item that asks for one, and carries a title", () => {
    render(
      <RowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { label: "Unpin", onSelect: vi.fn() },
          { label: "Hide", onSelect: vi.fn(), separatorBefore: true, title: "Search first" },
        ]}
      />,
    );
    const children = [...screen.getByRole("menu").children].map((el) => el.getAttribute("role"));
    expect(children).toEqual(["menuitem", "separator", "menuitem"]);
    expect(screen.getByRole("menuitem", { name: "Hide" })).toHaveAttribute("title", "Search first");
  });

  it("renders a checked item as a checkbox item", () => {
    render(
      <RowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[{ label: "Disable grouping", checked: true, onSelect: vi.fn() }]}
      />,
    );
    const item = screen.getByRole("menuitemcheckbox", { name: "Disable grouping" });
    expect(item).toHaveAttribute("aria-checked", "true");
    expect(item).toHaveTextContent("☑ Disable grouping");
  });

  it("portals into <body> when asked, so a scroll container cannot clip it", () => {
    const { container } = render(
      <RowContextMenu x={0} y={0} portal onClose={vi.fn()} items={[{ label: "One", onSelect: vi.fn() }]} />,
    );
    expect(container.querySelector(".row-context-menu")).toBeNull();
    expect(document.body.querySelector(".row-context-menu")).not.toBeNull();
  });

  it("reports the chosen item and closes", async () => {
    const { onSelect, onClose } = open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Test this service" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("RowContextMenu viewport clamping", () => {
  it("treats y as the menu's BOTTOM edge when openUp is set", () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 60,
      top: 0,
      left: 0,
      right: 100,
      bottom: 60,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect);
    try {
      const { container } = render(
        <RowContextMenu
          x={8}
          y={500}
          openUp
          onClose={vi.fn()}
          items={[{ label: "One", onSelect: vi.fn() }]}
        />,
      );
      const menu = container.querySelector(".row-context-menu") as HTMLElement;
      // A 60px-tall menu whose bottom edge is asked to sit at 500 starts at 440.
      expect(menu.style.top).toBe("440px");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("pulls the menu back inside the viewport when it opens near the edge", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 200, configurable: true });
    // jsdom always reports 0x0 for layout, so stub the one measurement the
    // clamp math depends on: the menu's own rendered size. With that fixed,
    // the expected output (viewport minus menu size) is independently
    // computable and differs from the raw click position, so this fails
    // against unclamped code instead of trivially matching it.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        width: 150,
        height: 80,
        top: 0,
        left: 0,
        right: 150,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect);

    try {
      const { container } = render(
        <RowContextMenu x={190} y={190} onClose={vi.fn()} items={[{ label: "One", onSelect: vi.fn() }]} />,
      );
      const menu = container.querySelector(".row-context-menu") as HTMLElement;
      // A 150x80 menu opened at (190,190) in a 200x200 viewport must be
      // pulled back to (200-150, 200-80) = (50, 120) to stay fully on-screen.
      expect(menu.style.left).toBe("50px");
      expect(menu.style.top).toBe("120px");
    } finally {
      rectSpy.mockRestore();
      Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
    }
  });
});
