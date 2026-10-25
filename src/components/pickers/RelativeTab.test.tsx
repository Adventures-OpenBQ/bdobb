// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Preview } from "../../lib/dateExpressions";
import { PeriodPopover } from "./PeriodPopover";
import { RelativeTab, type RelativeContext } from "./RelativeTab";

/** A preview that echoes the expression, flagging any bd step as a fallback. */
const preview = (expr: string): Preview | null =>
  expr.startsWith("2026") ? null : { text: `<${expr}>`, fallback: expr.includes("bd"), reason: expr.includes("bd") ? "weekdays only" : undefined };

function renderTab(over: Partial<Parameters<typeof RelativeTab>[0]> = {}, saved: RelativeContext["presets"] = []) {
  const onApply = vi.fn();
  const context: RelativeContext = { preview, presets: saved, onSavePreset: vi.fn(), onDeletePreset: vi.fn() };
  render(<RelativeTab type="date" label="Date" value="2026-09-14" context={context} onApply={onApply} {...over} />);
  return { onApply, context };
}

describe("RelativeTab", () => {
  it("shows a calendar error in place of the preview and keeps Apply off", () => {
    const failing = (): Preview => ({ text: "", fallback: false, error: "Unknown calendar XNYZ" });
    render(
      <RelativeTab
        type="date"
        label="Date"
        value="T-1d"
        context={{ preview: failing, presets: [], onSavePreset: vi.fn(), onDeletePreset: vi.fn() }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("⚠ Unknown calendar XNYZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("offers the type's anchors and units, previews live, and applies the canonical expression", async () => {
    const { onApply } = renderTab();
    const anchor = screen.getByLabelText("Date anchor");
    expect(Array.from((anchor as HTMLSelectElement).options).map((o) => o.value)).toEqual(["T", "trade_date", "prev_trade_date", "W0", "M0", "Q0", "Y0", "FQ0", "FY0"]);
    expect(screen.getByText("resolves now to <$currentDate>")).toBeInTheDocument();
    await userEvent.selectOptions(anchor, "trade_date");
    await userEvent.click(screen.getByRole("button", { name: "Date add offset" }));
    await userEvent.selectOptions(screen.getByLabelText("Date offset 1 sign"), "-");
    await userEvent.clear(screen.getByLabelText("Date offset 1 amount"));
    await userEvent.type(screen.getByLabelText("Date offset 1 amount"), "5");
    const unit = screen.getByLabelText("Date offset 1 unit");
    expect(Array.from((unit as HTMLSelectElement).options).map((o) => o.value)).toEqual(["d", "bd", "w", "m", "q", "y", "fq", "fy"]);
    await userEvent.selectOptions(unit, "bd");
    const line = screen.getByText(/resolves now to <trade_date-5bd>/);
    expect(line).toHaveTextContent("⚠");
    expect(line).toHaveAttribute("title", "weekdays only");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("trade_date-5bd");
  });

  it("removes an offset row", async () => {
    renderTab({ value: "T-1d+2w" });
    expect(screen.getByLabelText("Date offset 2 unit")).toHaveValue("w");
    await userEvent.click(screen.getByRole("button", { name: "Date remove offset 1" }));
    expect(screen.queryByLabelText("Date offset 2 unit")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date offset 1 unit")).toHaveValue("w");
    expect(screen.getByText("resolves now to <$currentDate+2w>")).toBeInTheDocument();
  });

  it("lands on the stored expression's rows, shorthand expanded", () => {
    renderTab({ type: "quarter", label: "Quarter", value: "Q-4" });
    expect(screen.getByLabelText("Quarter anchor")).toHaveValue("Q0");
    expect(screen.getByLabelText("Quarter offset 1 amount")).toHaveValue(4);
    expect(screen.getByLabelText("Quarter offset 1 unit")).toHaveValue("q");
    expect(screen.getByText("resolves now to <Q-4>")).toBeInTheDocument();
  });

  it("edits both ends of a range", async () => {
    const { onApply } = renderTab({ type: "date_range", label: "Range", value: "M0/T" });
    expect(screen.getByLabelText("Range start anchor")).toHaveValue("M0");
    expect(screen.getByLabelText("Range end anchor")).toHaveValue("T");
    await userEvent.selectOptions(screen.getByLabelText("Range end anchor"), "trade_date");
    expect(screen.getByText("resolves now to <M0/trade_date>")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("M0/trade_date");
  });

  it("shows an expression its rows cannot express read-only, with Apply disabled", () => {
    renderTab({ value: "now-1h" });
    expect(screen.queryByLabelText("Date anchor")).not.toBeInTheDocument();
    expect(screen.getByText("now-1h")).toBeInTheDocument();
    expect(screen.getByText("resolves now to <now-1h>")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("lists the built-in chips for the type plus the saved ones its rows can express; a chip loads the rows", async () => {
    const { onApply, context } = renderTab({}, [{ name: "Two weeks", expr: "T-2w" }, { name: "Hour", expr: "now-1h" }]);
    const presets = screen.getByRole("group", { name: "Presets" });
    expect(presets).toHaveTextContent("Dates");
    expect(presets).toHaveTextContent("Trading");
    expect(presets).toHaveTextContent("Saved");
    expect(screen.getByRole("button", { name: "Two weeks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hour" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(screen.getByLabelText("Date offset 1 unit")).toHaveValue("d");
    expect(screen.getByText("resolves now to <$currentDate-1d>")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("$currentDate-1d");
    await userEvent.click(screen.getByRole("button", { name: "Delete preset Two weeks" }));
    expect(context.onDeletePreset).toHaveBeenCalledWith("Two weeks");
  });

  it("saves the current expression under a typed name, on Enter or Save, and never an empty one", async () => {
    const { context } = renderTab({ value: "T-2w" });
    await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
    const name = screen.getByLabelText("Preset name");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(context.onSavePreset).not.toHaveBeenCalled();
    await userEvent.type(name, "  Two weeks {Enter}");
    expect(context.onSavePreset).toHaveBeenCalledWith("Two weeks", "$currentDate-2w");
    expect(screen.queryByLabelText("Preset name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Preset name")).not.toBeInTheDocument();
    expect(context.onSavePreset).toHaveBeenCalledTimes(1);
  });

  it("caps an offset amount at six digits, so the rows never write a seven-digit one", async () => {
    const { onApply } = renderTab({ value: "T-1d" });
    const amount = screen.getByLabelText("Date offset 1 amount");
    expect(amount).toHaveAttribute("max", "999999");
    await userEvent.clear(amount);
    await userEvent.type(amount, "1234567");
    expect(amount).toHaveValue(999999);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("$currentDate-999999d");
  });

  it("caps a business-day amount at four digits, and clamps the amount when the unit switches to bd", async () => {
    const { onApply } = renderTab({ value: "T-1bd" });
    const amount = screen.getByLabelText("Date offset 1 amount");
    expect(amount).toHaveAttribute("max", "9999");
    await userEvent.clear(amount);
    await userEvent.type(amount, "99999");
    expect(amount).toHaveValue(9999);
    await userEvent.selectOptions(screen.getByLabelText("Date offset 1 unit"), "d");
    await userEvent.clear(amount);
    await userEvent.type(amount, "50000");
    expect(amount).toHaveValue(50000);
    await userEvent.selectOptions(screen.getByLabelText("Date offset 1 unit"), "bd");
    expect(amount).toHaveValue(9999);
    expect(amount).toHaveAttribute("max", "9999");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("T-9999bd");
  });

  it("gives a quarter_range a start and an end, named apart, and applies a range (v5.4.0)", async () => {
    const { onApply } = renderTab({ type: "quarter_range", label: "Span", value: "" });
    const start = screen.getByLabelText("Span start anchor") as HTMLSelectElement;
    expect(start).toHaveValue("T");
    expect(screen.getByLabelText("Span end anchor")).toHaveValue("T");
    expect([...start.options].map((o) => o.value)).toEqual(["T", "Q0", "FQ0", "Y0", "FY0"]);
    await userEvent.click(screen.getByRole("button", { name: "Last 4 fiscal quarters" }));
    expect(screen.getByText("resolves now to <FQ-4/FQ0>")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("FQ-4/FQ0");
  });
});

/**
 * The tab inside the same PeriodPopover/Dialog the pickers use, with presets
 * that really save and delete. The nested Dialog makes the Popover not
 * contain focus, and its Escape handler is on the overlay element only, so a
 * control that unmounts while focused would drop focus to <body> and leave
 * Escape dead. Each action below unmounts the element it was fired from.
 */
function InPopover() {
  const [presets, setPresets] = useState<RelativeContext["presets"]>([{ name: "Two weeks", expr: "T-2w" }]);
  const context: RelativeContext = {
    preview,
    presets,
    onSavePreset: (name, expr) => setPresets((ps) => [...ps.filter((p) => p.name !== name), { name, expr }]),
    onDeletePreset: (name) => setPresets((ps) => ps.filter((p) => p.name !== name)),
  };
  return (
    <PeriodPopover label="Date" trigger="T-1d+2w">
      {() => <RelativeTab type="date" label="Date" value="T-1d+2w" context={context} onApply={() => {}} />}
    </PeriodPopover>
  );
}

describe("RelativeTab focus inside the popover", () => {
  it.each([
    [
      "Save",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
        await userEvent.type(screen.getByLabelText("Preset name"), "Mine");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      },
    ],
    [
      "Enter",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
        await userEvent.type(screen.getByLabelText("Preset name"), "Mine{Enter}");
      },
    ],
    [
      "Cancel by pointer",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      },
    ],
    [
      // The pointer path above, and a scripted .focus() on Cancel, both end
      // on the dialog without the fix: React Aria recovers focus while the
      // last interaction was a pointer. A keyboard user who Tabs to Cancel
      // lands on <body> with Escape dead, so this is the case that fails if
      // Cancel stops refocusing "Save as preset".
      "Cancel by keyboard",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
        await userEvent.click(screen.getByLabelText("Preset name"));
        await userEvent.tab();
        await userEvent.tab();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
        await userEvent.keyboard("{Enter}");
      },
    ],
    [
      "a preset's ×",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Delete preset Two weeks" }));
        expect(screen.queryByRole("button", { name: "Two weeks" })).not.toBeInTheDocument();
      },
    ],
    [
      "an offset row's ×",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Date remove offset 1" }));
        expect(screen.getByLabelText("Date offset 1 unit")).toHaveValue("w");
      },
    ],
  ])("keeps focus in the dialog after %s, and Escape still closes it", async (_, act) => {
    render(<InPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    await act();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the name field when naming starts from the keyboard; Escape there cancels the name, a second closes the popover", async () => {
    render(<InPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    screen.getByRole("button", { name: "Save as preset" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Preset name"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Preset name")).not.toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save as preset" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
