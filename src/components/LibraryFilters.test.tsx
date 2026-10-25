// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WidgetDef } from "../lib/types";
import { BUILTIN_BACKEND_ID } from "../lib/builtins";
import { widget as baseWidget } from "../test/fixtures";
import {
  EMPTY_FILTER,
  LibraryFilters,
  backendLabel,
  filterOptions,
  matchesFilter,
} from "./LibraryFilters";

const widget = (over: Partial<WidgetDef>): WidgetDef => baseWidget({ name: "Widget", ...over });

const SET = [
  widget({ id: "a", category: "Equity", subCategory: "Calendar", type: "table", source: ["FMP"] }),
  widget({ id: "b", category: "Equity", subCategory: "Ownership", type: "pdf", source: ["SEC"] }),
  widget({ id: "c", category: "Economy", subCategory: "CPI", type: "table", source: ["FRED", "OECD"] }),
  widget({ id: "d", category: "Economy", subCategory: "", type: "markdown", source: [] }),
];

/** The one backend every fixture widget comes from (baseWidget's default). */
const BACKENDS = [{ id: "b1", name: "OpenBB" }];

describe("filterOptions", () => {
  it("derives every list from the widgets, with no hardcoded values", () => {
    const o = filterOptions(SET, EMPTY_FILTER);
    expect(o.categories).toEqual(["Economy", "Equity"]);
    expect(o.types).toEqual(["markdown", "pdf", "table"]);
    expect(o.providers).toEqual(["FMP", "FRED", "OECD", "SEC"]);
  });

  it("offers no type that no widget has", () => {
    expect(filterOptions(SET, EMPTY_FILTER).types).not.toContain("chart");
  });

  it("narrows subcategories to the selected category", () => {
    const o = filterOptions(SET, { ...EMPTY_FILTER, category: "Equity" });
    expect(o.subCategories).toEqual(["Calendar", "Ownership"]);
  });

  it("lists every subcategory when no category is selected", () => {
    // localeCompare order, matching every other derived list. The plan's
    // original expectation here was a typo, and preserving it had forced a
    // bespoke category-grouped ordering the spec never asked for.
    expect(filterOptions(SET, EMPTY_FILTER).subCategories).toEqual([
      "Calendar",
      "CPI",
      "Ownership",
    ]);
  });

  it("does not narrow categories, types or providers when a filter is set", () => {
    const o = filterOptions(SET, { ...EMPTY_FILTER, category: "Equity", provider: "SEC" });
    expect(o.categories).toEqual(["Economy", "Equity"]);
    expect(o.types).toEqual(["markdown", "pdf", "table"]);
    expect(o.providers).toEqual(["FMP", "FRED", "OECD", "SEC"]);
  });

  it("omits the empty string left by widgets with no subcategory", () => {
    expect(filterOptions(SET, EMPTY_FILTER).subCategories).not.toContain("");
  });
});

describe("matchesFilter", () => {
  it("passes everything when nothing is selected", () => {
    expect(SET.every((w) => matchesFilter(w, EMPTY_FILTER))).toBe(true);
  });

  it.each([
    ["category", { category: "Economy" }, ["c", "d"]],
    ["subCategory", { subCategory: "Calendar" }, ["a"]],
    ["type", { type: "table" }, ["a", "c"]],
    ["provider", { provider: "SEC" }, ["b"]],
  ])("filters by %s", (_label, patch, expected) => {
    const ids = SET.filter((w) => matchesFilter(w, { ...EMPTY_FILTER, ...patch })).map((w) => w.id);
    expect(ids).toEqual(expected);
  });

  it("requires every set constraint to match, not just one", () => {
    const ids = SET.filter((w) =>
      matchesFilter(w, { ...EMPTY_FILTER, category: "Equity", type: "table" }),
    ).map((w) => w.id);
    expect(ids).toEqual(["a"]);
  });

  it("matches a multi-source widget on any of its sources", () => {
    const c = SET[2];
    expect(matchesFilter(c, { ...EMPTY_FILTER, provider: "FRED" })).toBe(true);
    expect(matchesFilter(c, { ...EMPTY_FILTER, provider: "OECD" })).toBe(true);
  });

  it("excludes a source-less widget from a specific provider but not from All", () => {
    const d = SET[3];
    expect(matchesFilter(d, { ...EMPTY_FILTER, provider: "FMP" })).toBe(false);
    expect(matchesFilter(d, EMPTY_FILTER)).toBe(true);
  });
});

describe("LibraryFilters", () => {
  const setup = (filter = EMPTY_FILTER) => {
    const onChange = vi.fn();
    render(<LibraryFilters widgets={SET} backends={BACKENDS} filter={filter} onChange={onChange} />);
    return onChange;
  };

  it.each([
    ["Category", "All categories"],
    ["Subcategory", "All subcategories"],
    ["Type", "All types"],
    ["Provider", "All providers"],
  ])("renders the %s select with its All option first", (label, allLabel) => {
    setup();
    const select = screen.getByLabelText(label);
    expect((select as HTMLSelectElement).options[0].textContent).toBe(allLabel);
  });

  it("orders the selects Backend, Category, Subcategory, Provider, Type", () => {
    setup();
    const selects = screen.getAllByRole("combobox");
    const expected = ["Backend", "Category", "Subcategory", "Provider", "Type"];
    expected.forEach((label, i) => expect(screen.getByLabelText(label)).toBe(selects[i]));
    expect(selects).toHaveLength(expected.length);
  });

  it("reports a selection through onChange rather than holding state", async () => {
    const onChange = setup();
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Economy");
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, category: "Economy" });
    // Presentational: the value shown still comes from the prop, unchanged.
    expect(screen.getByLabelText("Category")).toHaveValue("");
  });

  it("resets a subcategory the new category cannot reach", async () => {
    const onChange = setup({ ...EMPTY_FILTER, category: "Equity", subCategory: "Calendar" });
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Economy");
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_FILTER,
      category: "Economy",
      subCategory: null,
    });
  });

  it("keeps a subcategory that is still reachable", async () => {
    const onChange = setup({ ...EMPTY_FILTER, category: "Equity", subCategory: "Calendar" });
    await userEvent.selectOptions(screen.getByLabelText("Category"), "");
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_FILTER,
      category: null,
      subCategory: "Calendar",
    });
  });

  it("renders a provider label verbatim, markdown and all", () => {
    const messy = "UN Global Platform; [IMF PortWatch](portwatch.imf.org)";
    render(
      <LibraryFilters
        widgets={[widget({ source: [messy] })]}
        backends={BACKENDS}
        filter={EMPTY_FILTER}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: messy })).toBeInTheDocument();
  });

  it("disables Reset when the filter is already empty", () => {
    setup();
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeDisabled();
  });

  it.each([
    ["category", { category: "Equity" }],
    ["subCategory", { subCategory: "Calendar" }],
    ["type", { type: "table" }],
    ["provider", { provider: "SEC" }],
    ["backendId", { backendId: "b1" }],
  ])("enables Reset when %s is set", (_label, patch) => {
    setup({ ...EMPTY_FILTER, ...patch });
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeEnabled();
  });

  it("clicking Reset calls onChange once with EMPTY_FILTER", async () => {
    const onChange = setup({ ...EMPTY_FILTER, category: "Equity", subCategory: "Calendar" });
    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTER);
  });
});

// #5: the Backend filter and its labels, restored from bdobb-v2 PR #44.
describe("backend filter", () => {
  // Names deliberately out of id order, so a test that passes cannot be
  // passing because the two orders happen to agree.
  const TWO = [
    { id: "b1", name: "Zulu" },
    { id: "b2", name: "Alpha" },
  ];
  const MIXED = [
    widget({ id: "a", backendId: "b1" }),
    widget({ id: "b", backendId: "b2" }),
    widget({ id: "c", backendId: BUILTIN_BACKEND_ID }),
  ];

  const draw = (widgets = MIXED, backends = TWO, filter = EMPTY_FILTER) => {
    const onChange = vi.fn();
    render(<LibraryFilters widgets={widgets} backends={backends} filter={filter} onChange={onChange} />);
    return onChange;
  };

  const backendOptions = () =>
    within(screen.getByLabelText("Backend"))
      .getAllByRole("option")
      .map((o) => o.textContent);

  it("names a builtin, a configured backend, and one that is gone", () => {
    expect(backendLabel(BUILTIN_BACKEND_ID, TWO)).toBe("Built-in");
    expect(backendLabel("b2", TWO)).toBe("Alpha");
    // Removed from Connections, but its widgets outlived it in the registry.
    expect(backendLabel("b9", TWO)).toBe("b9");
  });

  it("keeps only the widgets served by the chosen backend", () => {
    const w = widget({ backendId: "b1" });
    expect(matchesFilter(w, { ...EMPTY_FILTER, backendId: "b1" })).toBe(true);
    expect(matchesFilter(w, { ...EMPTY_FILTER, backendId: "b2" })).toBe(false);
    expect(matchesFilter(w, EMPTY_FILTER)).toBe(true);
  });

  it("renders the Backend select with All backends first", () => {
    draw();
    expect(backendOptions()[0]).toBe("All backends");
  });

  it("orders options by name, not by the opaque id behind it", () => {
    draw();
    expect(backendOptions()).toEqual(["All backends", "Alpha", "Built-in", "Zulu"]);
  });

  it("omits a configured backend that discovered nothing", () => {
    // b2 is in Connections but serves none of these widgets: an option for it
    // could only ever produce an empty library.
    draw([widget({ id: "a", backendId: "b1" })]);
    expect(backendOptions()).toEqual(["All backends", "Zulu"]);
  });

  it("reports the chosen backend by id", async () => {
    const onChange = draw();
    await userEvent.selectOptions(screen.getByLabelText("Backend"), "b2");
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, backendId: "b2" });
  });
});
