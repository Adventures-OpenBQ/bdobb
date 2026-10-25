// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { railMenuItems, type MenuTarget } from "./railMenu";
import { RowContextMenu } from "./RowContextMenu";

/** Every action as a spy, with only what a case cares about overridden. */
const actions = () => ({
  create: vi.fn(),
  createFolder: vi.fn(),
  importApps: vi.fn(),
  openWindow: vi.fn(),
  save: vi.fn(),
  rename: vi.fn(),
  duplicate: vi.fn(),
  moveTo: vi.fn(),
  toggleGrouping: vi.fn(),
  remove: vi.fn(),
  removeFolder: vi.fn(),
});

const FOLDERS = [
  { id: "f1", name: "Macro", depth: 0 },
  { id: "f2", name: "Rates", depth: 1 },
];

/**
 * The rail menu is item data now, rendered by the shared RowContextMenu; the
 * chrome it used to own (position, Escape at capture, outside-press
 * dismissal) is tested once, in RowContextMenu.test.tsx.
 */
function show(target: MenuTarget, over: Partial<ReturnType<typeof actions>> = {}) {
  const on = { ...actions(), ...over };
  render(
    <RowContextMenu x={0} y={0} items={railMenuItems(target, FOLDERS, on)} onClose={vi.fn()} />,
  );
  return on;
}

const DASHBOARD: MenuTarget = { kind: "dashboard", id: "d1", name: "Main", groupsDisabled: false };
const FOLDER: MenuTarget = { kind: "folder", id: "f1", name: "Macro" };

describe("the section menu", () => {
  it("offers New dashboard and New folder, at the top level", async () => {
    const props = show(null);

    // No ellipsis on either label: nothing is asked after the click — both
    // are created with a generated name and renamed inline afterwards.
    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard" }));
    expect(props.create).toHaveBeenCalledWith(null);

    await userEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    expect(props.createFolder).toHaveBeenCalledWith(null);
  });

  it("shows no row items", () => {
    show(null);
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("a dashboard row's menu", () => {
  it("shows exactly the dashboard items, not the section's", () => {
    show(DASHBOARD);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Disable grouping" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "New dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete folder" })).not.toBeInTheDocument();
  });

  it("orders its items to match OpenBB, with a separator before the export/grouping group", () => {
    show(DASHBOARD);
    const items = [...screen.getByRole("menu").children].map((el) => ({
      role: el.getAttribute("role"),
      name: el.getAttribute("role") === "separator" ? null : el.textContent,
    }));

    expect(items).toEqual([
      { role: "menuitem", name: "Rename" },
      { role: "menuitem", name: "Move to ▸" },
      { role: "menuitem", name: "Duplicate" },
      { role: "menuitem", name: "Open in a new window" },
      { role: "menuitem", name: "Delete" },
      { role: "separator", name: null },
      { role: "menuitem", name: "Save…" },
      { role: "menuitemcheckbox", name: "☐ Disable grouping" },
    ]);
  });

  it("reports rename with the target's id, and delete with its id and name", async () => {
    const props = show(DASHBOARD);

    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    // The name is not passed: the rail renames in place, from its own row.
    expect(props.rename).toHaveBeenCalledWith("d1");

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(props.remove).toHaveBeenCalledWith("d1", "Main");
  });

  it("reports duplicate with the target's id", async () => {
    const props = show(DASHBOARD);
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(props.duplicate).toHaveBeenCalledWith("d1");
  });

  it("keeps Move to closed until it is clicked, then lists Top level and every folder", async () => {
    show(DASHBOARD);
    expect(screen.queryByRole("menuitem", { name: "Top level" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Move to" }));

    expect(screen.getByRole("menuitem", { name: "Move to" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Top level" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Macro" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rates" })).toBeInTheDocument();
  });

  it("owns the flyout it opens, so the nested menu is reachable from its trigger", async () => {
    show(DASHBOARD);
    const trigger = screen.getByRole("menuitem", { name: "Move to" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    // Nothing to point at while the flyout is unmounted.
    expect(trigger).not.toHaveAttribute("aria-controls");

    await userEvent.click(trigger);

    const id = trigger.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    const submenu = document.getElementById(id!);
    expect(submenu).toHaveAttribute("role", "menu");
    expect(submenu).toContainElement(screen.getByRole("menuitem", { name: "Top level" }));
  });

  it("indents a nested folder in the Move to list", async () => {
    show(DASHBOARD);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to" }));

    expect(screen.getByRole("menuitem", { name: "Macro" })).toHaveStyle({ paddingLeft: "10px" });
    expect(screen.getByRole("menuitem", { name: "Rates" })).toHaveStyle({ paddingLeft: "22px" });
  });

  it("reports a move to a folder and a move back to the top level", async () => {
    const props = show(DASHBOARD);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to" }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Rates" }));
    expect(props.moveTo).toHaveBeenCalledWith("d1", "f2");

    await userEvent.click(screen.getByRole("menuitem", { name: "Top level" }));
    expect(props.moveTo).toHaveBeenCalledWith("d1", null);
  });

  it("reports the grouping toggle as the OPPOSITE of the current state", async () => {
    const off = show(DASHBOARD);
    const item = screen.getByRole("menuitemcheckbox", { name: "Disable grouping" });
    expect(item).toHaveAttribute("aria-checked", "false");

    await userEvent.click(item);
    expect(off.toggleGrouping).toHaveBeenCalledWith("d1", true);
  });

  it("reports the grouping toggle back off when it is already set", async () => {
    const on = show({ kind: "dashboard", id: "d1", name: "Main", groupsDisabled: true });
    const item = screen.getByRole("menuitemcheckbox", { name: "Disable grouping" });
    expect(item).toHaveAttribute("aria-checked", "true");

    await userEvent.click(item);
    expect(on.toggleGrouping).toHaveBeenCalledWith("d1", false);
  });
});

describe("a folder row's menu", () => {
  it("shows exactly the folder items", () => {
    show(FOLDER);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New dashboard here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New folder here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete folder" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to" })).not.toBeInTheDocument();
  });

  it("creates inside itself, not at the top level", async () => {
    const props = show(FOLDER);

    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard here" }));
    expect(props.create).toHaveBeenCalledWith("f1");

    await userEvent.click(screen.getByRole("menuitem", { name: "New folder here" }));
    expect(props.createFolder).toHaveBeenCalledWith("f1");
  });

  it("reports the folder delete with its id and name", async () => {
    const props = show(FOLDER);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    expect(props.removeFolder).toHaveBeenCalledWith("f1", "Macro");
  });
});

describe("the three file/window items", () => {
  it("offers Import apps.json… only on the section menu", () => {
    show(null);
    expect(screen.getByRole("menuitem", { name: "Import apps.json…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Save…" })).not.toBeInTheDocument();
  });

  it("offers Open in a new window and Save… only on a dashboard row", () => {
    show(DASHBOARD);
    expect(screen.getByRole("menuitem", { name: "Open in a new window" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Save…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Import apps.json…" })).not.toBeInTheDocument();
  });

  it("offers none of the three on a folder row", () => {
    show(FOLDER);
    expect(screen.queryByRole("menuitem", { name: "Import apps.json…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Save…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open in a new window" })).not.toBeInTheDocument();
  });

  it("reports each of the three", async () => {
    const section = show(null);
    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));
    expect(section.importApps).toHaveBeenCalled();

    // Unmounted through RTL rather than removed from the DOM by hand: a
    // detached node React still believes it owns makes its own unmount throw.
    cleanup();

    const row = show(DASHBOARD);
    await userEvent.click(screen.getByRole("menuitem", { name: "Open in a new window" }));
    expect(row.openWindow).toHaveBeenCalledWith("d1", "Main");

    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    expect(row.save).toHaveBeenCalledWith("d1");
  });
});

describe("Save… without a native format pop-up", () => {
  // Browser mode has no macOS Save panel to carry the Format choice, so the
  // choice comes first, as a flyout on the same item.
  it("asks for the format in a flyout and reports it with the id", async () => {
    const on = actions();
    render(
      <RowContextMenu
        x={0}
        y={0}
        items={railMenuItems({ kind: "dashboard", id: "d1", name: "Macro", groupsDisabled: false }, FOLDERS, on, false)}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    expect(on.save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("menuitem", { name: "BDOBB Workspace" }));
    expect(on.save).toHaveBeenCalledWith("d1", "bdobb");
    cleanup();

    const again = actions();
    render(
      <RowContextMenu
        x={0}
        y={0}
        items={railMenuItems({ kind: "dashboard", id: "d1", name: "Macro", groupsDisabled: false }, FOLDERS, again, false)}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Strict OpenBB Workspace" }));
    expect(again.save).toHaveBeenCalledWith("d1", "strict");
  });
});
