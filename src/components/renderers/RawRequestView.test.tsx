// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWidgetData = vi.fn();
vi.mock("../../lib/dataClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: (...args: unknown[]) => fetchWidgetData(...args),
}));

import { backend, widget } from "../../test/fixtures";
import { RawRequestView } from "./RawRequestView";

const html = widget({ id: "portfolio", type: "html", raw: true });

beforeEach(() => {
  fetchWidgetData.mockReset();
});

describe("RawRequestView", () => {
  it("asks the same endpoint with the card's params plus raw=true", async () => {
    fetchWidgetData.mockResolvedValue([]);
    render(<RawRequestView backend={backend()} widget={html} params={{ symbol: "AAPL" }} refreshKey={0} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData.mock.calls[0][2]).toEqual({ symbol: "AAPL", raw: "true" });
  });

  it("shows a list of records as a table", async () => {
    fetchWidgetData.mockResolvedValue([{ symbol: "AAPL", shares: 100 }]);
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows an object's results list as a table", async () => {
    fetchWidgetData.mockResolvedValue({ results: [{ symbol: "AAPL" }] });
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows anything else as JSON", async () => {
    fetchWidgetData.mockResolvedValue("<ul></ul>");
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByTestId("raw-json")).toHaveTextContent('"<ul></ul>"');
  });

  it("refetches the raw request when refreshKey changes", async () => {
    fetchWidgetData.mockResolvedValue([]);
    const { rerender } = render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    rerender(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={1} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(fetchWidgetData.mock.calls[1][2]).toEqual({ raw: "true" });
  });

  it("shows the error when the raw request fails", async () => {
    fetchWidgetData.mockRejectedValue(new Error("HTTP 422"));
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByText("HTTP 422")).toBeInTheDocument();
  });
});
