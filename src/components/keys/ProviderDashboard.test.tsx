// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeysRow } from "../renderers/KeysRenderer";
import { type View } from "../../lib/providerAvailability";
import { ProviderDashboard } from "./ProviderDashboard";

const rows: KeysRow[] = [
  { provider: "FMP", env_var: "FMP_API_KEY", status: "set", value: "sk-SECRET", test: { result: "ok", detail: "HTTP 200" } },
  { provider: "Polygon", env_var: "POLY", status: "missing" },
  { provider: "Alpha Vantage", env_var: "AV", status: "set", demo: true, test: { result: "ok", detail: "Demo access is limited" } },
];
const keylessRows: KeysRow[] = [
  ...rows,
  { provider: "yfinance", env_var: "YF", status: "empty", auth: "not_required", test: { result: "ok", detail: "passed" } },
];
const view: View = { filter: "all", sort: "name-asc" };

function setup(props: Partial<React.ComponentProps<typeof ProviderDashboard>> = {}) {
  const onViewChange = vi.fn();
  const onProbe = vi.fn();
  const onOpenDetails = vi.fn();
  render(<ProviderDashboard rows={rows} view={view} onViewChange={onViewChange} onProbe={onProbe} onOpenDetails={onOpenDetails} {...props} />);
  return { onViewChange, onProbe, onOpenDetails };
}

describe("ProviderDashboard", () => {
  it("renders a card per provider with status, credential and a Details button, and never probes on render", () => {
    const { onProbe, onOpenDetails } = setup();
    expect(screen.getByRole("heading", { name: "FMP" })).toBeInTheDocument();
    expect(screen.getByText("Credential: Own key")).toBeInTheDocument();
    expect(screen.getByText("Credential: Not set")).toBeInTheDocument();
    expect(screen.getByText("Demo access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details for FMP" })).toBeInTheDocument();
    expect(onProbe).not.toHaveBeenCalled();
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it("Check all calls onProbe exactly once; Details calls onOpenDetails with the provider", async () => {
    const { onProbe, onOpenDetails } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));
    expect(onProbe).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(onOpenDetails).toHaveBeenCalledWith(expect.objectContaining({ id: "FMP_API_KEY", name: "FMP" }));
  });

  it("tile counts come from the full set and each tile stages its filter; the active tile clears it", async () => {
    const { onViewChange } = setup();
    const attention = screen.getByRole("button", { name: /Needs attention/ });
    expect(attention).toHaveTextContent("1"); // Alpha Vantage demo
    await userEvent.click(attention);
    expect(onViewChange).toHaveBeenCalledWith({ filter: "attention", sort: "name-asc" });
    onViewChange.mockClear();
    // When already active, clicking clears to "all".
    render(<ProviderDashboard rows={rows} view={{ filter: "attention", sort: "name-asc" }} onViewChange={onViewChange} onProbe={vi.fn()} onOpenDetails={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: /Needs attention/ })[1]);
    expect(onViewChange).toHaveBeenCalledWith({ filter: "all", sort: "name-asc" });
  });

  it("counts stay from the full set while a filter is active, and the result count reads shown of total", () => {
    setup({ view: { filter: "attention", sort: "name-asc" } });
    expect(screen.getByRole("button", { name: /Available/ })).toHaveTextContent("1"); // FMP, still counted
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 · Needs attention");
    // Only the attention card is in the grid.
    expect(screen.getByRole("heading", { name: "Alpha Vantage" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "FMP" })).toBeNull();
  });

  it("a zero-count filter shows the empty state", () => {
    setup({ view: { filter: "not_checked", sort: "name-asc" } });
    expect(screen.getByText("No providers match this status. Select All providers to clear the filter.")).toBeInTheDocument();
  });

  it("the fifth tile and footnote are hidden without auth and shown with it; its count is not summed", () => {
    const { onViewChange } = setup();
    expect(screen.queryByRole("button", { name: /No key required/ })).toBeNull();
    expect(screen.queryByText(/overlaps the availability statuses/)).toBeNull();
    render(<ProviderDashboard rows={keylessRows} view={view} onViewChange={onViewChange} onProbe={vi.fn()} onOpenDetails={vi.fn()} />);
    const keyless = screen.getByRole("button", { name: /No key required/ });
    expect(keyless).toHaveTextContent("1");
    expect(screen.getAllByText(/overlaps the availability statuses/).length).toBeGreaterThan(0);
    // yfinance is also counted under Available, proving the overlap is not summed away.
    expect(screen.getAllByRole("button", { name: /Available/ })[1]).toHaveTextContent("2");
  });

  it("the Sort select stages a new sort without changing the filter", async () => {
    const { onViewChange } = setup({ view: { filter: "attention", sort: "name-asc" } });
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "available-first");
    expect(onViewChange).toHaveBeenCalledWith({ filter: "attention", sort: "available-first" });
  });

  it("renders no tier-3 value anywhere (Review Focus)", () => {
    const { container } = render(<ProviderDashboard rows={rows} view={view} onViewChange={vi.fn()} onProbe={vi.fn()} onOpenDetails={vi.fn()} />);
    expect(container.textContent).not.toContain("sk-SECRET");
  });
});
