// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const messageSinks: Array<(m: unknown) => void> = [];
vi.mock("../../hooks/useReconnectingSocket", () => ({
  useReconnectingSocket: (_url: string | null, _sub: unknown, onMessage: (m: unknown) => void) => {
    messageSinks.push(onMessage);
    return "live";
  },
}));
vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: vi.fn(async () => [{ symbol: "TSLA", price: 10 }]),
  buildWidgetWsUrl: () => "ws://x/ws",
}));

import { LiveGridRenderer } from "./LiveGridRenderer";
import { fetchWidgetData } from "../../lib/dataClient";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { installVirtualizerDom } from "../../test/virtualizer";

installVirtualizerDom();

const widget = {
  id: "g",
  type: "live_grid",
  endpoint: "grid_data",
  wsEndpoint: "grid_ws",
  wsRowIdColumn: "symbol",
  table: { columns: [{ field: "symbol", renderFn: [] }, { field: "price", renderFn: [] }] },
} as unknown as WidgetDef;
const backend = { baseUrl: "http://h" } as BackendConfig;

afterEach(() => {
  messageSinks.length = 0;
});

describe("LiveGridRenderer", () => {
  it("renders the snapshot, updates a row by id, and appends an unknown one", async () => {
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());

    act(() => messageSinks[0]({ symbol: "TSLA", price: 11 }));
    await waitFor(() => expect(screen.getByText("11")).toBeInTheDocument());

    act(() => messageSinks[0]({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
  });

  // The card does not fetch a live_grid (builtins exclude it), so a failed
  // snapshot is this renderer's to show -- not a silent "No rows.".
  it("shows a failed snapshot as an error with a Retry that refetches", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 500"));
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
