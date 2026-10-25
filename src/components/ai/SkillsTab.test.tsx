// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DraftSkill } from "./skillsDraft";
import { SkillsTab } from "./SkillsTab";

function entry(overrides: Partial<DraftSkill> = {}): DraftSkill {
  return {
    slug: "openbb-html-table",
    description: "Tables.",
    content: "# T",
    enabled: true,
    updated: "2026-09-19T00:00:00.000Z",
    extra: { copyright: "OpenBB Inc." },
    originalSlug: "openbb-html-table",
    ...overrides,
  };
}

function renderTab(props: Partial<Parameters<typeof SkillsTab>[0]> = {}) {
  const onCreate = vi.fn();
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  const onSetEnabled = vi.fn();
  render(
    <SkillsTab
      entries={props.entries ?? []}
      onCreate={props.onCreate ?? onCreate}
      onEdit={props.onEdit ?? onEdit}
      onRemove={props.onRemove ?? onRemove}
      onSetEnabled={props.onSetEnabled ?? onSetEnabled}
    />,
  );
  return { onCreate, onEdit, onRemove, onSetEnabled };
}

describe("SkillsTab", () => {
  it("shows an empty state when there are no entries", () => {
    renderTab({ entries: [] });
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("lists entries sorted by slug, with description and enabled state", () => {
    renderTab({
      entries: [entry({ slug: "z-skill" }), entry({ slug: "off-skill", enabled: false, description: "Off." })],
    });
    const rows = document.querySelectorAll(".bd-list-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("off-skill")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("Off.")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole("switch", { name: "Enabled off-skill" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(rows[1] as HTMLElement).getByText("z-skill")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByRole("switch", { name: "Enabled z-skill" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Create skill calls onCreate", async () => {
    const { onCreate } = renderTab({ entries: [] });
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("Edit calls onEdit with the entry", async () => {
    const e = entry();
    const { onEdit } = renderTab({ entries: [e] });
    await userEvent.click(screen.getByRole("button", { name: "Edit openbb-html-table" }));
    expect(onEdit).toHaveBeenCalledWith(e);
  });

  it("Remove calls onRemove with the entry", async () => {
    const e = entry();
    const { onRemove } = renderTab({ entries: [e] });
    await userEvent.click(screen.getByRole("button", { name: "Remove openbb-html-table" }));
    expect(onRemove).toHaveBeenCalledWith(e);
  });

  it("the Enabled pill calls onSetEnabled(entry, !enabled)", async () => {
    const e = entry({ enabled: true });
    const { onSetEnabled } = renderTab({ entries: [e] });
    await userEvent.click(screen.getByRole("switch", { name: "Enabled openbb-html-table" }));
    expect(onSetEnabled).toHaveBeenCalledWith(e, false);
  });
});
