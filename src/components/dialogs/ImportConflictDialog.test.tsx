// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ImportConflict } from "../../lib/appsJson";
import { decideImportConflicts, ImportConflictDialog } from "./ImportConflictDialog";

const conflict = (name: string, existingIds = ["d1"]): ImportConflict => ({
  imported: { id: `i-${name}`, name, tabs: [{ id: `t-${name}`, name: "Main", cards: [] }] },
  existingIds,
  yours: { tabs: 3, cards: 12 },
  incoming: { tabs: 2, cards: 9 },
});

function renderDialog(over: { conflict?: ImportConflict; index?: number; total?: number } = {}) {
  const onDecide = vi.fn();
  render(
    <ImportConflictDialog
      conflict={over.conflict ?? conflict("Macro")}
      index={over.index ?? 0}
      total={over.total ?? 1}
      keepBothName="Macro (2)"
      onDecide={onDecide}
    />,
  );
  return onDecide;
}

describe("ImportConflictDialog", () => {
  it("says 1 tab and 1 card in the singular", () => {
    renderDialog({ conflict: { ...conflict("Solo"), yours: { tabs: 1, cards: 1 }, incoming: { tabs: 1, cards: 0 } } });

    expect(screen.getByText("Yours: 1 tab, 1 card")).toBeInTheDocument();
    expect(screen.getByText("In the file: 1 tab, 0 cards")).toBeInTheDocument();
  });

  it("names the conflict, shows both sides, and focuses Keep both", () => {
    renderDialog();

    expect(
      screen.getByRole("dialog", { name: 'A dashboard named "Macro" already exists' }),
    ).toBeInTheDocument();
    expect(screen.getByText("Yours: 3 tabs, 12 cards")).toBeInTheDocument();
    expect(screen.getByText("In the file: 2 tabs, 9 cards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Keep both/ })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Keep both/ })).toHaveTextContent("Macro (2)");
    expect(screen.getByRole("button", { name: /^Replace/ })).toHaveTextContent(
      "Replaces yours, including anything added since",
    );
    expect(screen.queryByText(/^Conflict \d+ of \d+$/)).not.toBeInTheDocument();
  });

  it("does not make Replace the default", () => {
    renderDialog();

    const replace = screen.getByRole("button", { name: /^Replace/ });
    expect(replace).not.toHaveFocus();
    expect(replace).toHaveClass("import-conflict-replace");
  });

  it("counts the conflicts when there is more than one", () => {
    renderDialog({ index: 1, total: 3 });

    expect(screen.getByText("Conflict 2 of 3")).toBeInTheDocument();
  });

  it.each([
    [/^Replace/, "replace"],
    [/^Keep both/, "keep"],
    [/^Skip/, "skip"],
    [/^Cancel import$/, "cancel"],
  ] as const)("answers %s with %s", async (name, choice) => {
    const onDecide = renderDialog();

    await userEvent.click(screen.getByRole("button", { name }));

    expect(onDecide).toHaveBeenCalledWith(choice);
  });

  it("cancels on Escape, and nothing behind the dialog sees the same press", async () => {
    // Stands in for a maximized card's own Escape handler on window.
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    try {
      const onDecide = renderDialog();

      await userEvent.keyboard("{Escape}");

      expect(onDecide).toHaveBeenCalledWith("cancel");
      expect(behind).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", behind);
    }
  });

  it("disables Replace, with the reason, when two of yours share the name", () => {
    renderDialog({ conflict: conflict("Macro", ["d1", "d2"]) });

    const replace = screen.getByRole("button", { name: /^Replace/ });
    expect(replace).toBeDisabled();
    expect(replace).toHaveTextContent(
      'You have two dashboards named "Macro"; rename one to replace it.',
    );
    expect(screen.getByRole("button", { name: /^Keep both/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Skip/ })).toBeEnabled();
  });
});

describe("decideImportConflicts", () => {
  it("returns no decisions and opens nothing when there is no conflict", async () => {
    const hint = vi.fn();

    await expect(decideImportConflicts([], hint)).resolves.toEqual([]);

    expect(hint).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks once per conflict, in order, and hands each hint the answers so far", async () => {
    const hint = vi.fn((index: number) => `Name ${index}`);
    const pending = decideImportConflicts([conflict("A"), conflict("B")], hint);

    await userEvent.click(await screen.findByRole("button", { name: /^Replace/ }));
    await screen.findByRole("dialog", { name: 'A dashboard named "B" already exists' });
    await userEvent.click(screen.getByRole("button", { name: /^Keep both/ }));

    await expect(pending).resolves.toEqual(["replace", "keep"]);
    expect(hint).toHaveBeenNthCalledWith(1, 0, []);
    expect(hint).toHaveBeenNthCalledWith(2, 1, ["replace"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns cancelled, and leaves no dialog behind, when the second answer is Cancel import", async () => {
    const pending = decideImportConflicts([conflict("A"), conflict("B")], () => "x");

    await userEvent.click(await screen.findByRole("button", { name: /^Skip/ }));
    await screen.findByRole("dialog", { name: 'A dashboard named "B" already exists' });
    await userEvent.click(screen.getByRole("button", { name: "Cancel import" }));

    await expect(pending).resolves.toBe("cancelled");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["an answer", /^Skip/],
    ["Cancel import", /^Cancel import/],
  ])("returns focus to the element that had it before, after %s", async (_label, button) => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const pending = decideImportConflicts([conflict("A")], () => "x");

    await userEvent.click(await screen.findByRole("button", { name: button }));
    await pending;

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
