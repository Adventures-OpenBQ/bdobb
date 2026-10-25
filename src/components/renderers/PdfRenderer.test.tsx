// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * PdfView is stubbed, not exercised: its own behaviour has its own test file,
 * and stubbing it here keeps pdfjs-dist (which cannot be imported under jsdom)
 * out of this file's module graph entirely.
 *
 * `receivedBytes` records every `bytes` instance the stub is mounted with, so
 * a test can assert on identity across rerenders — vi.hoisted because
 * vi.mock's factory is hoisted above the file's own consts and would
 * otherwise hit them in the temporal dead zone.
 */
const receivedBytes = vi.hoisted((): Uint8Array[] => []);

vi.mock("./PdfView", () => ({
  PdfView: ({ bytes, filename }: { bytes: Uint8Array; filename: string }) => {
    receivedBytes.push(bytes);
    return <div data-testid="pdf-view">{`${filename} (${bytes.length} bytes)`}</div>;
  },
}));

const fetchDocumentBytes = vi.hoisted(() =>
  vi.fn<(url: string, signal?: AbortSignal) => Promise<Uint8Array>>(),
);
vi.mock("../../lib/dataClient", () => ({ fetchDocumentBytes }));

import { PdfRenderer } from "./PdfRenderer";

/** "hi" as base64 — two decoded bytes, which the stub above reports. */
const HI = "aGk=";

describe("PdfRenderer", () => {
  it("mounts the viewer on the decoded bytes of a pdf payload", () => {
    render(
      <PdfRenderer
        data={{ content: HI, data_format: { data_type: "pdf", filename: "report.pdf" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pdf-view")).toHaveTextContent("report.pdf (2 bytes)");
  });

  it("fetches a document the backend sent as a url and mounts the viewer on its bytes", async () => {
    fetchDocumentBytes.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    render(
      <PdfRenderer
        data={{ url: "https://example.com/sample.pdf", data_format: { data_type: "pdf", filename: "Sample.pdf" } }}
        onRetry={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("pdf-view")).toHaveTextContent("Sample.pdf (3 bytes)");
    expect(fetchDocumentBytes).toHaveBeenCalledWith("https://example.com/sample.pdf", expect.any(AbortSignal));
  });

  // The url is the backend's choice: a host that never finishes must not hold
  // a download open after the card is gone, or forever while it is shown.
  it("aborts a linked download when the card unmounts", () => {
    fetchDocumentBytes.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(
      <PdfRenderer data={{ url: "https://example.com/a.pdf", data_format: { data_type: "pdf" } }} onRetry={vi.fn()} />,
    );
    const signal = fetchDocumentBytes.mock.calls.at(-1)![1]!;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("aborts a linked download that outlives its deadline", () => {
    vi.useFakeTimers();
    try {
      fetchDocumentBytes.mockReturnValueOnce(new Promise(() => {}));
      render(
        <PdfRenderer data={{ url: "https://example.com/a.pdf", data_format: { data_type: "pdf" } }} onRetry={vi.fn()} />,
      );
      const signal = fetchDocumentBytes.mock.calls.at(-1)![1]!;
      vi.advanceTimersByTime(30_000);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the download's failure for a linked document", async () => {
    fetchDocumentBytes.mockRejectedValueOnce(new Error("HTTP 403"));
    render(
      <PdfRenderer
        data={{ url: "https://example.com/sample.pdf", data_format: { data_type: "pdf", filename: "Sample.pdf" } }}
        onRetry={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Sample.pdf: HTTP 403");
  });

  it("takes the first document when the payload is a list", () => {
    render(
      <PdfRenderer
        data={[
          { content: HI, data_format: { data_type: "pdf", filename: "first.pdf" } },
          { content: HI, data_format: { data_type: "pdf", filename: "second.pdf" } },
        ]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pdf-view")).toHaveTextContent("first.pdf");
  });

  it("names the type it cannot show, rather than mounting an empty viewer", () => {
    render(
      <PdfRenderer
        data={{ content: HI, data_format: { data_type: "csv", filename: "table.csv" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByText("table.csv: csv files are not displayable in this version."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-view")).not.toBeInTheDocument();
  });

  it("shows a retryable error for a payload that is not a document at all", async () => {
    const onRetry = vi.fn();
    render(<PdfRenderer data={{ rows: [] }} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("not a document payload");

    // The card's own refetch: a parse failure is very often a backend that
    // answered the wrong thing, and asking again is the only move available.
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("says so when the payload is an empty list, without erroring", () => {
    render(<PdfRenderer data={[]} onRetry={vi.fn()} />);

    expect(screen.getByText("No document in this payload.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the same bytes instance across a re-render with the same data, and builds a new one when data changes", () => {
    receivedBytes.length = 0;
    const data = { content: HI, data_format: { data_type: "pdf", filename: "report.pdf" } };
    const { rerender } = render(<PdfRenderer data={data} onRetry={vi.fn()} />);
    const first = receivedBytes[0];

    // Same `data` object, an unrelated prop changes: PdfView must not see a
    // new `bytes` array, or it reloads and re-rasterises the whole PDF.
    rerender(<PdfRenderer data={data} onRetry={vi.fn()} />);
    expect(receivedBytes.at(-1)).toBe(first);

    // A genuinely new `data` object: a new `bytes` array is expected.
    const newData = { content: HI, data_format: { data_type: "pdf", filename: "report.pdf" } };
    rerender(<PdfRenderer data={newData} onRetry={vi.fn()} />);
    expect(receivedBytes.at(-1)).not.toBe(first);
  });
});
