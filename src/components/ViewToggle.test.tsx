// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewToggle } from "./ViewToggle";

const modes = [
  { value: undefined, label: "Table" },
  { value: "chart" as const, label: "Chart" },
  { value: "raw" as const, label: "Raw" },
];

describe("ViewToggle", () => {
  it("renders one option per mode inside a select named View", () => {
    render(<ViewToggle modes={modes} current={undefined} onSelect={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "View" });
    expect(select).toHaveClass("card-action");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Table",
      "Chart",
      "Raw",
    ]);
  });

  it("selects the current mode", () => {
    render(<ViewToggle modes={modes} current="chart" onSelect={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "View" })).toHaveValue("chart");
  });

  it("treats an absent view as the first mode being current", () => {
    render(<ViewToggle modes={modes} current={undefined} onSelect={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "View" })).toHaveValue("");
  });

  it("reports undefined when the default mode is chosen", async () => {
    const onSelect = vi.fn();
    render(<ViewToggle modes={modes} current="raw" onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Table");
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("reports the value when another mode is chosen", async () => {
    const onSelect = vi.fn();
    render(<ViewToggle modes={modes} current={undefined} onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Raw");
    expect(onSelect).toHaveBeenCalledWith("raw");
  });

  const withoutTransposed = [
    { value: undefined, label: "Table" },
    { value: "raw" as const, label: "Raw" },
  ];

  it("shows a current view the mode list no longer offers, as a disabled option", () => {
    render(<ViewToggle modes={withoutTransposed} current="transposed" onSelect={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "View" });
    expect(select).toHaveValue("transposed");
    expect(screen.getByRole("option", { name: "Transposed" })).toBeDisabled();
  });

  it("lets the user leave a view the mode list no longer offers", async () => {
    const onSelect = vi.fn();
    render(<ViewToggle modes={withoutTransposed} current="transposed" onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Table");
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});
