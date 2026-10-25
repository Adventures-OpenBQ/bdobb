// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldKind } from "../../lib/pivotTable";
import { tableColumns, type Row } from "../../lib/tableColumns";
import type { PivotConfig } from "../../lib/types";
import { PIVOT_DRAG_TYPE, PivotPanel, PivotStrip } from "./PivotPanel";

const monthly: Row[] = ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"].map((date, i) => ({
  sector: i % 2 ? "Tech" : "Energy",
  date,
  revenue: i,
  note: "n",
}));
const weekly: Row[] = ["2024-01-05", "2024-01-12", "2024-01-19", "2024-01-26"].map((date, i) => ({
  sector: "Tech",
  date,
  revenue: i,
  note: "n",
}));
const KINDS = new Map<string, FieldKind>([
  ["sector", "text"],
  ["date", "date"],
  ["revenue", "number"],
  ["note", "text"],
]);
const EMPTY: PivotConfig = { enabled: false, grouping: [], split: [] };

function setup(config: PivotConfig = EMPTY, rows: Row[] = monthly, kinds = KINDS, hidden: string[] = []) {
  const onChange = vi.fn();
  const columns = tableColumns(rows, undefined);
  render(
    <PivotPanel
      columns={columns}
      order={columns.map((c) => c.field)}
      hidden={hidden}
      kinds={kinds}
      rows={rows}
      config={config}
      onChange={onChange}
    />,
  );
  return onChange;
}
const list = (name: string) => screen.getByRole("list", { name });
const pill = (name: RegExp | string) => screen.getByRole("button", { name });
/** A plain item is a `menuitem`; one that can be ticked is a `menuitemcheckbox`. */
const pick = (name: string) =>
  userEvent.click(screen.queryByRole("menuitem", { name }) ?? screen.getByRole("menuitemcheckbox", { name }));

describe("the three lists", () => {
  it("returns keyboard focus to a moved pill after it enters another list", async () => {
    const columns = tableColumns(monthly, undefined);
    function Harness() {
      const [config, setConfig] = useState(EMPTY);
      return <PivotPanel columns={columns} order={columns.map((c) => c.field)} hidden={[]} kinds={KINDS} rows={monthly} config={config} onChange={(patch) => setConfig(patch.pivot)} />;
    }
    render(<Harness />);
    pill("sector").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    const moved = within(list("Row Groups")).getByRole("button", { name: "sector" });
    expect(document.activeElement).toBe(moved);
    expect(moved).toHaveAttribute("aria-expanded", "false");
  });

  it("returns focus after reordering and preserves focus on Escape", async () => {
    const columns = tableColumns(monthly, undefined);
    function Harness() {
      const [config, setConfig] = useState<PivotConfig>({ enabled: true, grouping: ["sector", "note"], split: [] });
      return <PivotPanel columns={columns} order={columns.map((c) => c.field)} hidden={[]} kinds={KINDS} rows={monthly} config={config} onChange={(patch) => setConfig(patch.pivot)} />;
    }
    render(<Harness />);
    pill("sector").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(document.activeElement).toBe(within(list("Row Groups")).getByRole("button", { name: "sector" }));
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(within(list("Row Groups")).getByRole("button", { name: "sector" }));
  });
  it("starts with every column in Data Columns, in table order, and the groups empty", () => {
    setup();
    expect(within(list("Data Columns")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "sector",
      "date",
      "revenue",
      "note",
    ]);
    expect(within(list("Row Groups")).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(list("Column Groups")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("moves a pill through its menu, in exactly one change", async () => {
    const onChange = setup();
    await userEvent.click(pill("sector"));
    await pick("Move to Row Groups");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: true, grouping: ["sector"], split: [] } });
  });

  it("opens the menu from the keyboard, and offers no move to the list the pill is in", async () => {
    setup({ enabled: true, grouping: ["sector"], split: [] });
    pill("sector").focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Move to Row Groups" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move to Data Columns" })).toBeEnabled();
  });

  it("closes the menu on a second click of its pill, and leaves it closed", async () => {
    setup();
    await userEvent.click(pill("sector"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(pill("sector"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("marks its pill aria-expanded while its own menu is open, and not once closed", async () => {
    setup();
    expect(pill("sector")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(pill("sector"));
    expect(pill("sector")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(pill("sector"));
    expect(pill("sector")).toHaveAttribute("aria-expanded", "false");
  });

  it("reorders within a list", async () => {
    const onChange = setup({ enabled: true, grouping: ["sector", "note"], split: [] });
    await userEvent.click(pill("sector"));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await pick("Move down");
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: true, grouping: ["note", "sector"], split: [] } });
  });

  it("reorders Data Columns by writing the table's own column order", async () => {
    const onChange = setup();
    await userEvent.click(pill("note"));
    await pick("Move up");
    expect(onChange).toHaveBeenCalledWith({ pivot: EMPTY, columnOrder: ["sector", "date", "note", "revenue"] });
  });
});

describe("aggregations", () => {
  it("has none until one is picked, and offers a text column no arithmetic", async () => {
    const onChange = setup({ enabled: true, grouping: ["sector"], split: [] });
    expect(pill("revenue")).toHaveTextContent(/^revenue$/);
    await userEvent.click(pill("note"));
    await pick("Aggregation");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Sum" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Count" })).toBeInTheDocument();
    await pick("Count");
    expect(onChange).toHaveBeenCalledWith({
      pivot: { enabled: true, grouping: ["sector"], split: [], aggregationFns: { note: "count" } },
    });
  });

  it("shows the pick on the pill, and clears it with None", async () => {
    const config: PivotConfig = { enabled: true, grouping: ["sector"], split: [], aggregationFns: { revenue: "sum" } };
    const onChange = setup(config);
    expect(pill(/revenue/)).toHaveTextContent("revenue · Sum");
    await userEvent.click(pill(/revenue/));
    await pick("Aggregation");
    await pick("None");
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: true, grouping: ["sector"], split: [] } });
  });

  it("says Choose, and counts what is waiting, only under a split", () => {
    setup({ enabled: true, grouping: [], split: ["sector"] });
    expect(pill(/revenue/)).toHaveTextContent("revenue · Choose");
    expect(screen.getByText("3 data columns need an aggregation")).toBeInTheDocument();
  });

  it("does not count a hidden Data Columns field as waiting -- the engine drops hidden columns", () => {
    // Without "revenue" hidden this is the "3 data columns" case above
    // (date, revenue, note); hiding "revenue" leaves only date and note.
    setup({ enabled: true, grouping: [], split: ["sector"] }, monthly, KINDS, ["revenue"]);
    expect(screen.getByText("2 data columns need an aggregation")).toBeInTheDocument();
  });

  it("disables First and Last, with the reason, when the table has no date column", async () => {
    const kinds = new Map(KINDS).set("date", "text");
    setup({ enabled: true, grouping: ["sector"], split: [] }, monthly, kinds);
    await userEvent.click(pill("revenue"));
    await pick("Aggregation");
    const first = screen.getByRole("menuitemcheckbox", { name: "First" });
    expect(first).toBeDisabled();
    expect(first).toHaveAttribute("title", "Needs a date column");
  });
});

describe("date buckets", () => {
  it("shows the data's own periodicity, and offers only coarser buckets", async () => {
    const onChange = setup({ enabled: true, grouping: ["date"], split: [] });
    expect(pill(/date/)).toHaveTextContent("date · Monthly");
    await userEvent.click(pill(/date/));
    await pick("Bucket");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Week" })).toBeNull();
    await pick("Quarter");
    expect(onChange).toHaveBeenCalledWith({
      pivot: { enabled: true, grouping: ["date"], split: [], buckets: { date: "quarter" } },
    });
  });

  it("marks a weekly roll-up that straddles, and any Sum riding on it", () => {
    setup(
      {
        enabled: true,
        grouping: ["date"],
        split: [],
        buckets: { date: "month" },
        aggregationFns: { revenue: "sum", note: "count" },
      },
      weekly,
    );
    expect(pill(/date/)).toHaveTextContent("date · Month ⚠");
    expect(pill(/revenue/)).toHaveTextContent("revenue · Sum ⚠");
    expect(pill(/note/)).toHaveTextContent(/^note · Count$/);
    expect(pill(/date/)).toHaveAttribute(
      "title",
      "Weekly rows are assigned to the month containing their date; months hold 4 or 5 weeks.",
    );
  });
});

describe("drag", () => {
  const transfer = () => ({ types: [PIVOT_DRAG_TYPE], setData: vi.fn(), effectAllowed: "", dropEffect: "" });

  it("drops a pill into an empty list as one change", () => {
    const onChange = setup();
    const dataTransfer = transfer();
    fireEvent.dragStart(pill("sector"), { dataTransfer });
    fireEvent.dragOver(list("Column Groups"), { dataTransfer });
    fireEvent.drop(list("Column Groups"), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(PIVOT_DRAG_TYPE, "sector");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: true, grouping: [], split: ["sector"] } });
  });

  it("changes nothing when the drag is cancelled or ends elsewhere", () => {
    const onChange = setup();
    const dataTransfer = transfer();
    fireEvent.dragStart(pill("sector"), { dataTransfer });
    fireEvent.dragOver(list("Row Groups"), { dataTransfer });
    // The indicator is up, so the null check after dragend is not vacuous.
    expect(document.querySelector(".pivot-insert")).not.toBeNull();
    // Escape, or a drop outside the panel: the browser fires dragend and no drop.
    fireEvent.dragEnd(pill("sector"), { dataTransfer });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector(".pivot-insert")).toBeNull();
  });

  it("ignores a drag that is not one of its own pills", () => {
    const onChange = setup();
    fireEvent.drop(list("Row Groups"), { dataTransfer: { ...transfer(), types: ["application/x-bdobb-column"] } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the footer and the strip", () => {
  it("switches the pivot off without losing the arrangement", async () => {
    const onChange = setup({ enabled: true, grouping: ["sector"], split: [] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pivot on" }));
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: false, grouping: ["sector"], split: [] } });
  });

  it("clears to an explicit empty config", async () => {
    const onChange = setup({ enabled: true, grouping: ["sector"], split: [] });
    await userEvent.click(screen.getByRole("button", { name: "Clear groups" }));
    expect(onChange).toHaveBeenCalledWith({ pivot: { enabled: false, grouping: [], split: [] } });
  });

  it("names the arrangement in one line, with an Edit when there is somewhere to go", async () => {
    const onEdit = vi.fn();
    render(
      <PivotStrip
        columns={tableColumns(monthly, undefined)}
        config={{ enabled: true, grouping: ["sector", "note"], split: ["date"] }}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("sector › note × date")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit pivot" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("shows a date field's non-native bucket beside its name, with Edit as a card action", () => {
    render(
      <PivotStrip
        columns={tableColumns(monthly, undefined)}
        config={{ enabled: true, grouping: ["sector"], split: ["date"], buckets: { date: "year" } }}
        kinds={KINDS}
        onEdit={vi.fn()}
      />,
    );
    // "date · Year": the bucket rides beside the date field's name in the strip.
    expect(screen.getByText("sector × date · Year")).toBeInTheDocument();
    // v11.3.0: the Edit button is a card action beside the arrangement (the
    // Data Workbench restyled the strip; the · separator went with it).
    expect(screen.getByRole("button", { name: "Edit pivot" })).toHaveClass("card-action");
  });
});

describe("provider suggestions", () => {
  const hint = (time: "last" | "sum" | null, status: "conditional" | "requires_selection" | "dimension" = time ? "conditional" : "requires_selection") => ({
    time,
    frequencies: ["annual", "quarter"],
    entity: "require_selection" as const,
    status,
    ruleset: "2026-09-20.1",
  });
  const quarterly: Row[] = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"].map((date, i) => ({
    date,
    sector: "Tech",
    cash: i,
    minority: 0,
  }));
  const quarterlyKinds = new Map<string, FieldKind>([["date", "date"], ["sector", "text"], ["cash", "number"], ["minority", "number"]]);
  const spec = {
    columns: [
      { field: "date", aggregation: hint(null, "dimension") },
      { field: "sector" },
      { field: "cash", headerName: "Cash", aggregation: hint("last") },
      { field: "minority", headerName: "Minority", aggregation: hint(null) },
    ],
  };
  function setupWithHints(config: PivotConfig) {
    const onChange = vi.fn();
    const columns = tableColumns(quarterly, spec);
    render(
      <PivotPanel columns={columns} order={columns.map((c) => c.field)} hidden={[]} kinds={quarterlyKinds} rows={quarterly} config={config} onChange={onChange} />,
    );
    return onChange;
  }

  it("shows the suggestion on the pill with a question mark, and applies it in one click", async () => {
    const onChange = setupWithHints({ enabled: true, grouping: [], split: ["date"] });
    expect(pill(/Cash/)).toHaveTextContent("Cash · Last?");
    expect(pill(/Cash/)).toHaveAttribute("title", expect.stringContaining("suggests Last"));
    await userEvent.click(pill(/Cash/));
    await pick("Use suggested Last");
    expect(onChange).toHaveBeenCalledWith({
      pivot: { enabled: true, grouping: [], split: ["date"], aggregationFns: { cash: "last" } },
    });
  });

  it("tells a reviewed no-rule column from one with no hint, both reading Choose", () => {
    setupWithHints({ enabled: true, grouping: [], split: ["date"] });
    expect(pill(/Minority/)).toHaveTextContent("Minority · Choose");
    expect(pill(/Minority/)).toHaveAttribute("title", "No reviewed rule for this column.");
    expect(screen.queryByRole("menuitem", { name: /Use suggested/ })).toBeNull();
  });

  it("withholds the suggestion when the bucket was not reviewed, and says which were", () => {
    setupWithHints({ enabled: true, grouping: [], split: ["date"], buckets: { date: "month" } });
    expect(pill(/Cash/)).toHaveTextContent("Cash · Choose");
    expect(pill(/Cash/)).toHaveAttribute("title", expect.stringContaining("annual, quarter"));
  });

  it("withholds the suggestion when a row group would combine entities", () => {
    setupWithHints({ enabled: true, grouping: ["sector"], split: ["date"] });
    expect(pill(/Cash/)).toHaveTextContent("Cash · Choose");
    expect(pill(/Cash/)).toHaveAttribute("title", expect.stringContaining("sector"));
  });

  it("stays quiet with Row Groups only, except for the question mark", () => {
    setupWithHints({ enabled: true, grouping: ["date"], split: [] });
    expect(pill(/Cash/)).toHaveTextContent(/^Cash · Last\?$/);
    expect(pill(/Minority/)).toHaveTextContent(/^Minority$/);
  });
});

it('uses worker date periodicity hints without reading any source rows', () => {
  const columns = tableColumns(monthly, undefined);
  render(<PivotPanel columns={columns} order={columns.map(c => c.field)} hidden={[]} kinds={KINDS} rows={[]} sourcePeriodicity={new Map([['date', 'weekly']])} config={{ enabled: true, grouping: ['date'], split: [], buckets: { date: 'month' }, aggregationFns: { revenue: 'sum' } }} onChange={vi.fn()} />);
  expect(pill(/date/)).toHaveTextContent('date · Month ⚠');
  expect(pill(/date/)).toHaveAttribute('title', 'Weekly rows are assigned to the month containing their date; months hold 4 or 5 weeks.');
});

it('duplicates a Data instance once and edits reorders and removes only that instance', async () => {
  const changes = vi.fn();
  const columns = tableColumns(monthly, undefined);
  function Harness() {
    const [config, setConfig] = useState<PivotConfig>({ enabled: true, grouping: ['sector'], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' }] });
    return <PivotPanel columns={columns} order={columns.map(c => c.field)} hidden={[]} kinds={KINDS} rows={monthly} config={config} onChange={patch => { changes(patch); setConfig(patch.pivot); }} />;
  }
  render(<Harness />);
  await userEvent.click(pill('revenue — Average'));
  await pick('Duplicate');
  expect(changes).toHaveBeenCalledTimes(1);
  const first = changes.mock.calls[0][0].pivot.measures;
  expect(first).toHaveLength(2);
  expect(first[1]).toMatchObject({ sourceFieldId: 'revenue', aggregation: 'mean' });
  expect(first[1].id).not.toBe('revenue');
  await userEvent.click(pill('revenue — Average (2)'));
  await pick('Aggregation');
  await pick('Sum');
  expect(pill('revenue — Average')).toBeInTheDocument();
  expect(pill('revenue — Total')).toBeInTheDocument();
  expect(changes.mock.calls[1][0].pivot.measures[1].id).toBe(first[1].id);
  await userEvent.click(pill('revenue — Total'));
  await pick('Move up');
  expect(within(list('Data Columns')).getAllByRole('button').map(p => p.textContent)).toEqual(['revenue — Total', 'revenue — Average']);
  await userEvent.click(pill('revenue — Total'));
  await pick('Remove');
  expect(changes.mock.calls[3][0].pivot.measures).toEqual([first[0]]);
  expect(columns.map(c => c.field)).toContain('revenue');
});

it('keeps siblings when grouping one instance and gives returning categories fresh identities', async () => {
  const columns = tableColumns(monthly, undefined);
  const changes = vi.fn();
  function Harness() {
    const [config, setConfig] = useState<PivotConfig>({ enabled: true, grouping: [], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' }, { id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' }] });
    return <PivotPanel columns={columns} order={columns.map(c => c.field)} hidden={[]} kinds={KINDS} rows={monthly} config={config} onChange={patch => { changes(patch); setConfig(patch.pivot); }} />;
  }
  render(<Harness />);
  await userEvent.click(pill('revenue — Average'));
  await pick('Move to Row Groups');
  expect(pill('revenue — Total')).toBeInTheDocument();
  expect(changes.mock.calls[0][0].pivot.measures.map((m: { id: string }) => m.id)).toEqual(['copy']);
  await userEvent.click(within(list('Row Groups')).getByRole('button', { name: 'revenue' }));
  await pick('Move to Data Columns');
  const returned = changes.mock.calls[1][0].pivot.measures;
  expect(returned[1].sourceFieldId).toBe('revenue');
  expect(returned[1].id).not.toBe('revenue');
  expect(returned[1].aggregation).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Clear groups' }));
  expect(changes.mock.calls[2][0].pivot.measures).toEqual(returned);
});

it('keeps category and Data menu identities separate when their IDs coincide', async () => {
  const columns = tableColumns(monthly, undefined);
  function Harness() {
    const [config, setConfig] = useState<PivotConfig>({ enabled: true, grouping: ['revenue'], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' }] });
    return <PivotPanel columns={columns} order={columns.map(c => c.field)} hidden={[]} kinds={KINDS} rows={monthly} config={config} onChange={patch => setConfig(patch.pivot)} />;
  }
  render(<Harness />);
  await userEvent.click(pill('revenue — Average'));
  expect(pill('revenue')).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(pill('revenue'));
  expect(screen.getByRole('menuitem', { name: 'Move to Data Columns' })).toBeEnabled();
  await pick('Move to Data Columns');
  expect(pill('revenue — Average')).toBeInTheDocument();
  expect(within(list('Data Columns')).getAllByRole('button').map(p => p.textContent)).toEqual(['revenue — Average', 'revenue']);
});

it('retains weekly rollup warnings for independent Total instances', () => {
  setup({ enabled: true, grouping: ['date'], split: [], buckets: { date: 'month' }, measures: [{ id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' }] }, weekly);
  expect(pill('revenue — Total ⚠')).toHaveAttribute('title', 'A sum over weekly rows rolled up to a calendar period is approximate.');
});

it('shows category transformations without substituting source field labels', () => {
  const columns = tableColumns([{ year: '2026', quarter: '2026-Q1', ReportDate: '2026-01-01' }], undefined);
  const categories = new Map([
    ['year', { id: 'year', name: 'Year', sourceFieldId: 'ReportDate', transform: 'Y' as const, recipe: 'year-recipe', bucket: 'year' as const, periodicity: 'monthly' as const }],
    ['quarter', { id: 'quarter', name: 'Quarter', sourceFieldId: 'ReportDate', transform: 'Q' as const, recipe: 'quarter-recipe', bucket: 'quarter' as const, periodicity: 'monthly' as const }],
  ]);
  render(<PivotStrip columns={columns} config={{ enabled: true, grouping: ['year', 'quarter'], split: [] }} categoryMetadata={categories} />);
  expect(screen.getByText('Year · Y › Quarter · Q')).toBeInTheDocument();
});

it('keeps migrated legacy bucket labels visible through category metadata', () => {
  const columns = tableColumns([{ monthly: '2026-01' }], undefined);
  render(<PivotStrip columns={columns} config={{ enabled: true, grouping: ['monthly'], split: [] }} categoryMetadata={new Map([['monthly', { id: 'monthly', name: 'Report date', sourceFieldId: 'date', transform: 'native', recipe: 'legacy-month', bucket: 'month', periodicity: 'daily' }]])} />);
  expect(screen.getByText('Report date · Month')).toBeInTheDocument();
});
