// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modalStack } from "../../hooks/modalStack";
import type { DraftSkill } from "./skillsDraft";
import { SkillEditorDialog } from "./SkillEditorDialog";

const table: DraftSkill = {
  slug: "openbb-html-table",
  description: "Tables.",
  content: "# T",
  enabled: false,
  updated: "2026-09-19T00:00:00.000Z",
  extra: { copyright: "OpenBB Inc." },
  originalSlug: "openbb-html-table",
};

beforeEach(() => {
  // Spy without replacing behaviour -- jsdom implements showModal/close
  // itself (setting/clearing the `open` attribute, which is what gives the
  // element its accessible "dialog" role); these tests only need to observe
  // the calls, as useChildDialog.test.tsx does.
  vi.spyOn(HTMLDialogElement.prototype, "showModal");
  vi.spyOn(HTMLDialogElement.prototype, "close");
});

describe("SkillEditorDialog", () => {
  it("titles Create skill with a Create skill submit when adding", () => {
    render(<SkillEditorDialog editing={null} existing={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Create skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeInTheDocument();
  });

  it("titles Edit skill with a Save changes submit when editing, prefilled from the entry", () => {
    render(<SkillEditorDialog editing={table} existing={[table]} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Slug")).toHaveValue("openbb-html-table");
    expect(screen.getByLabelText("Description")).toHaveValue("Tables.");
    expect(screen.getByLabelText("Instructions")).toHaveValue("# T");
  });

  it("validates slug pattern, then duplicate-against-existing excluding self, then description, then content, in that order", async () => {
    const other = { ...table, slug: "other-skill" };
    render(<SkillEditorDialog editing={table} existing={[table, other]} onSave={vi.fn()} onCancel={vi.fn()} />);

    // Editing `table` itself: its own slug is not a duplicate against itself.
    await userEvent.clear(screen.getByLabelText("Slug"));
    await userEvent.type(screen.getByLabelText("Slug"), "Bad Slug");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Slug must be lowercase letters, digits and hyphens.");
    expect(screen.getByLabelText("Slug")).toHaveAttribute("aria-describedby", "skill-editor-error");

    await userEvent.clear(screen.getByLabelText("Slug"));
    await userEvent.type(screen.getByLabelText("Slug"), "other-skill");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A skill named other-skill already exists.");
    expect(screen.getByLabelText("Slug")).toHaveAttribute("aria-describedby", "skill-editor-error");

    await userEvent.clear(screen.getByLabelText("Slug"));
    await userEvent.type(screen.getByLabelText("Slug"), "openbb-html-table");
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Description is required.");
    expect(screen.getByLabelText("Description")).toHaveAttribute("aria-describedby", "skill-editor-error");

    await userEvent.type(screen.getByLabelText("Description"), "d");
    await userEvent.clear(screen.getByLabelText("Instructions"));
    await userEvent.type(screen.getByLabelText("Instructions"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Content is required.");
    expect(screen.getByLabelText("Instructions")).toHaveAttribute("aria-describedby", "skill-editor-error");
  });

  it("Save builds a new entry with enabled true, empty extra, a fresh updated, and no originalSlug", async () => {
    const onSave = vi.fn();
    render(<SkillEditorDialog editing={null} existing={[]} onSave={onSave} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Slug"), "new-skill");
    await userEvent.type(screen.getByLabelText("Description"), "New one.");
    await userEvent.type(screen.getByLabelText("Instructions"), "# New");
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as DraftSkill;
    expect(saved).toMatchObject({
      slug: "new-skill",
      description: "New one.",
      content: "# New",
      enabled: true,
      extra: {},
      originalSlug: null,
    });
    expect(new Date(saved.updated).toString()).not.toBe("Invalid Date");
  });

  it("Save on an edit keeps enabled, extra and originalSlug from the original, with a whitespace-normalized description", async () => {
    const onSave = vi.fn();
    render(<SkillEditorDialog editing={table} existing={[table]} onSave={onSave} onCancel={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Wide   spaced.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "openbb-html-table",
        description: "Wide spaced.",
        enabled: false,
        extra: { copyright: "OpenBB Inc." },
        originalSlug: "openbb-html-table",
      }),
    );
  });

  it("Cancel calls onCancel without saving", async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(<SkillEditorDialog editing={null} existing={[]} onSave={onSave} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the header Close button calls onCancel", async () => {
    const onCancel = vi.fn();
    render(<SkillEditorDialog editing={null} existing={[]} onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener on unmount, via useChildDialog", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<SkillEditorDialog editing={null} existing={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("suppresses its native cancel event and closes only itself via the modal stack", () => {
    const onCancel = vi.fn();
    render(<SkillEditorDialog editing={null} existing={[]} onSave={vi.fn()} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog", { name: "Create skill" });
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    // Escape's native behaviour (closing the <dialog> unmanaged) is
    // suppressed; only the modal stack's own entry is allowed to close it.
    expect(event.defaultPrevented).toBe(true);
    expect(modalStack.top()?.close).toBeTypeOf("function");
    modalStack.top()!.close();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
