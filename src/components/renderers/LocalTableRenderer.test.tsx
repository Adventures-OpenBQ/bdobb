// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TableRenderer virtualises, and jsdom measures every element as 0x0 — a real
 * one renders zero rows without three layout stubs (see the top of
 * TableRenderer.test.tsx, which owns that job). This file is about what
 * LocalTableRenderer READS and hands over, so the table is a stub that says
 * exactly that.
 */
vi.mock("./TableRenderer", () => ({
  TableRenderer: ({
    data,
    columns,
  }: {
    data: unknown;
    columns?: string[];
  }) => (
    <>
      <pre data-testid="table-data">{JSON.stringify(data)}</pre>
      {/* The transposed view's extra prop: an explicit column order, which
          makes the table a plain grid and is the only thing this renderer
          decides about it. */}
      <pre data-testid="table-columns">{JSON.stringify(columns ?? null)}</pre>
    </>
  ),
}));

import { NOTHING_TO_TRANSPOSE } from "../../lib/transpose";
import { __reset, __seed, writeFile } from "../../test/memfs";
import { dataFromBytes, LocalTableRenderer } from "./LocalTableRenderer";

const CSV = "11111111-1111-4111-8111-111111111111.csv";
const JSON_FILE = "22222222-2222-4222-8222-222222222222.json";
const XLSX_FILE = "33333333-3333-4333-8333-333333333333.xlsx";

const encoder = new TextEncoder();

beforeEach(() => {
  __reset();
});

function shown(): unknown {
  return JSON.parse(screen.getByTestId("table-data").textContent!);
}

describe("dataFromBytes", () => {
  it("reads a csv into one record per row, keyed by the header", async () => {
    const bytes = encoder.encode("symbol,close\nAAPL,190.5\nMSFT,410.25\n");
    expect(await dataFromBytes("x.csv", bytes)).toEqual([
      { symbol: "AAPL", close: 190.5 },
      { symbol: "MSFT", close: 410.25 },
    ]);
  });

  it("reads a tsv the same way", async () => {
    const bytes = encoder.encode("symbol\tclose\nAAPL\t190.5\n");
    expect(await dataFromBytes("x.tsv", bytes)).toEqual([{ symbol: "AAPL", close: 190.5 }]);
  });

  it("reads an xlsx workbook's first sheet", async () => {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ a: 1, b: "two" }]), "One");
    const bytes = new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }));

    expect(await dataFromBytes("x.xlsx", bytes)).toEqual([{ a: 1, b: "two" }]);
  });

  it("parses a json file directly rather than through the spreadsheet reader", async () => {
    const bytes = encoder.encode('[{"a":1},{"a":2}]');
    expect(await dataFromBytes("x.json", bytes)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("throws on bytes that are not a workbook at all", async () => {
    await expect(dataFromBytes("x.json", encoder.encode("{not json"))).rejects.toThrow();
  });
});

describe("LocalTableRenderer", () => {
  it("renders the stored csv through the table", async () => {
    __seed(`files/${CSV}`, "symbol,close\nAAPL,190.5\n");
    render(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} />);

    await waitFor(() => expect(shown()).toEqual([{ symbol: "AAPL", close: 190.5 }]));
  });

  it("hands the table transposed rows and their explicit column order when transposed", async () => {
    __seed(`files/${CSV}`, "symbol,close\nAAPL,190.5\nMSFT,410.25\n");
    render(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} transposed />);

    await waitFor(() =>
      expect(shown()).toEqual([{ Field: "close", AAPL: 190.5, MSFT: 410.25 }]),
    );
    // Read off transposeRows, never off the row's own keys.
    expect(JSON.parse(screen.getByTestId("table-columns").textContent!)).toEqual([
      "Field",
      "AAPL",
      "MSFT",
    ]);
  });

  it("says there is nothing to transpose when the file has a single column", async () => {
    __seed(`files/${CSV}`, "symbol\nAAPL\n");
    render(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} transposed />);

    expect(
      await screen.findByText(NOTHING_TO_TRANSPOSE),
    ).toBeInTheDocument();
  });

  it("renders a stored json array", async () => {
    __seed(`files/${JSON_FILE}`, '[{"a":1}]');
    render(<LocalTableRenderer file={JSON_FILE} label="rows.json" refreshKey={0} />);

    await waitFor(() => expect(shown()).toEqual([{ a: 1 }]));
  });

  it("renders a stored xlsx workbook", async () => {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ a: 1 }]), "One");
    await writeFile(
      `files/${XLSX_FILE}`,
      new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" })),
    );

    render(<LocalTableRenderer file={XLSX_FILE} label="book.xlsx" refreshKey={0} />);

    await waitFor(() => expect(shown()).toEqual([{ a: 1 }]));
  });

  it("names the file the user dropped when it is gone, never the stored uuid", async () => {
    render(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} />);

    expect(await screen.findByText("File missing: prices.csv")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(CSV))).not.toBeInTheDocument();
  });

  it("says so, without quoting the file, when the bytes are not readable", async () => {
    __seed(`files/${JSON_FILE}`, "{not json — s3cret");
    render(<LocalTableRenderer file={JSON_FILE} label="rows.json" refreshKey={0} />);

    expect(await screen.findByText("Could not read rows.json")).toBeInTheDocument();
    expect(screen.queryByText(/s3cret/)).not.toBeInTheDocument();
  });

  it("re-reads the file when refreshKey changes, and not otherwise", async () => {
    __seed(`files/${CSV}`, "a\n1\n");
    const view = render(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} />);
    await waitFor(() => expect(shown()).toEqual([{ a: 1 }]));

    __seed(`files/${CSV}`, "a\n2\n");
    view.rerender(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={0} />);
    await waitFor(() => expect(shown()).toEqual([{ a: 1 }]));

    view.rerender(<LocalTableRenderer file={CSV} label="prices.csv" refreshKey={1} />);
    await waitFor(() => expect(shown()).toEqual([{ a: 2 }]));
  });
});

it('execution identity uses runtime status without legacy file parsing', () => {
 render(<LocalTableRenderer executionIdentity={{dashboardId:'runtime',widgetId:'card'}} file={CSV} label="File" refreshKey={0}/>);
 expect(screen.getByText('Table unavailable')).toBeInTheDocument();
 expect(screen.queryByTestId('table-data')).not.toBeInTheDocument();
});
