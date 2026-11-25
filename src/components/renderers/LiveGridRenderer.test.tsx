// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: vi.fn(async () => [{ symbol: "TSLA", price: 10 }]),
  fetchWidgetPath: vi.fn(async () => []),
  ticketedWsUrl: vi.fn(async (_backend: unknown, url: string) => `${url}?ticket=t${++tickets}`),
}));
let tickets = 0;
vi.mock("../../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../../lib/logger")>()),
  logOnce: vi.fn(async () => {}),
}));

import { frameRows, LiveGridRenderer, normaliseMeta, symbolMetaRead } from "./LiveGridRenderer";
import { fetchWidgetData, fetchWidgetPath } from "../../lib/dataClient";
import { logOnce } from "../../lib/logger";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { FakeSocket } from "../../test/fakeSocket";
import { installVirtualizerDom } from "../../test/virtualizer";

installVirtualizerDom();

// The real useReconnectingSocket runs under these tests, on the spec-accurate
// fake: what is pinned is the wire a backend sees, not a mocked hook's calls.
const widget = {
  id: "g",
  type: "live_grid",
  endpoint: "live_grid",
  wsEndpoint: "live_grid_ws",
  wsRowIdColumn: "symbol",
  table: { columns: [{ field: "symbol", renderFn: [] }, { field: "price", renderFn: [] }] },
} as unknown as WidgetDef;
const backend = { id: "b", name: "Reference", baseUrl: "http://h" } as BackendConfig;

beforeEach(() => {
  FakeSocket.last = null;
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(fetchWidgetData).mockReset().mockImplementation(async () => [{ symbol: "TSLA", price: 10 }]);
  vi.mocked(logOnce).mockClear();
  vi.mocked(fetchWidgetPath).mockReset().mockImplementation(async () => []);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function socket(): FakeSocket {
  const s = FakeSocket.last;
  if (!s) throw new Error("no socket was opened");
  return s;
}

describe("LiveGridRenderer -- v3 reference compatibility (OpenBB's /live_grid_ws, no auth)", () => {
  it("renders the snapshot, subscribes by frame, updates a row by id, and appends an unknown one", async () => {
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());

    // No credential and no params on the URL: the reference takes neither.
    expect(socket().url).toBe("ws://h/live_grid_ws");
    act(() => socket().open());
    expect(socket().sent).toEqual([JSON.stringify({ params: { symbol: "TSLA" } })]);

    // One row object per frame, as the reference sends it.
    act(() => socket().emit({ symbol: "TSLA", price: 11 }));
    await waitFor(() => expect(screen.getByText("11")).toBeInTheDocument());

    act(() => socket().emit({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    // A grid that reads no symbol_meta field asks for none, and gains no
    // empty logo or 52-week columns.
    expect(fetchWidgetPath).not.toHaveBeenCalled();
    expect(document.querySelector('th[data-field="logo_url"]')).toBeNull();
  });

  // The reference answers the subscription at once, so its first row can land
  // before the snapshot does: the snapshot must not erase a newer tick.
  it("keeps a tick that arrived while the snapshot was in flight; a Refresh's snapshot replaces older ones", async () => {
    let answer: (rows: unknown) => void = () => {};
    vi.mocked(fetchWidgetData).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} refreshKey={0} />);
    act(() => socket().open());
    act(() => socket().emit({ symbol: "TSLA", price: 11 }));
    await act(async () => answer([{ symbol: "TSLA", price: 10 }]));
    expect(screen.getByText("11")).toBeInTheDocument();

    vi.mocked(fetchWidgetData).mockResolvedValueOnce([{ symbol: "TSLA", price: 12 }]);
    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} refreshKey={1} />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
  });

  it("a symbol edit resubscribes over the socket already open, without reconnecting", async () => {
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    act(() => socket().open());

    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().sent).toEqual([
      JSON.stringify({ params: { symbol: "TSLA" } }),
      JSON.stringify({ params: { symbol: "TSLA,AAPL" } }),
    ]);
    // The snapshot follows the selection too.
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
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

describe("LiveGridRenderer -- v10 (merged onto the v3 renderer)", () => {
  it("reads a frame that carries an array of rows, and merges each field by field", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValueOnce([{ symbol: "TSLA", price: 10, volume: 700 }]);
    const wide = {
      ...widget,
      table: { columns: [...(widget.table?.columns ?? []), { field: "volume", renderFn: [] }] },
    } as WidgetDef;
    render(<LiveGridRenderer widget={wide} backend={backend} params={{ symbol: "TSLA,MSFT" }} />);
    await waitFor(() => expect(screen.getByText("700")).toBeInTheDocument());
    act(() => socket().open());

    act(() => socket().emit([{ symbol: "TSLA", price: 12 }, { symbol: "MSFT", price: 400 }]));
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("400")).toBeInTheDocument();
    // The tick carried no volume, so the seed's stays.
    expect(screen.getByText("700")).toBeInTheDocument();
  });

  it("drops a symbol removed from the param instead of freezing it at its last price", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValue([]);
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalled());
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.queryByText("AAPL")).toBeNull());
  });

  // A tick already in flight when the edit lands must not put the row back.
  it("keeps a removed symbol off the grid when a tick for it arrives after the edit", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValue([]);
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalled());
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.queryByText("AAPL")).toBeNull());
    act(() => socket().emit({ symbol: "AAPL", price: 6 }));
    act(() => socket().emit({ symbol: "TSLA", price: 13 }));
    await waitFor(() => expect(screen.getByText("13")).toBeInTheDocument());
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  // Review R6: the removed set must not outlive a re-add -- the re-added
  // symbol streams again.
  it("streams a symbol again once an edit adds it back", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValue([]);
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalled());
    act(() => socket().open());
    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    act(() => socket().emit({ symbol: "AAPL", price: 5 }));
    expect(screen.queryByText("AAPL")).toBeNull();
    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    act(() => socket().emit({ symbol: "AAPL", price: 6 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  // Review R4: symbols match case-insensitively elsewhere in the app (the
  // statement fiscal code upper-cases both sides), and the param input keeps
  // what was typed: a backend's "AAPL" is the "aapl" the user removed.
  it("matches removed symbols case-insensitively", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValue([]);
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA,aapl" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalled());
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.queryByText("AAPL")).toBeNull());
    act(() => socket().emit({ symbol: "AAPL", price: 6 }));
    act(() => socket().emit({ symbol: "TSLA", price: 13 }));
    await waitFor(() => expect(screen.getByText("13")).toBeInTheDocument());
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  // The v3 renderer showed a snapshot as delivered: rows without the identity
  // column must not collapse into one.
  it("renders every seed row that lacks the identity column", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValue([{ price: 1 }, { price: 2 }, { price: 3 }]);
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("ignores a frame it cannot trust rather than blanking the grid", async () => {
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    act(() => socket().open());
    act(() => {
      socket().emit(42);
      socket().emit(["TSLA", 11]);
      socket().emit({ price: 99 });
      socket().onmessage?.({ data: "not json" });
    });
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("99")).toBeNull();
  });

  // Review B13: the card's ◷ tone follows the socket, so it hears the status.
  it("reports the socket status, reconnecting once the socket drops", async () => {
    const onStatus = vi.fn();
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} onStatus={onStatus} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    act(() => socket().open());
    expect(onStatus).toHaveBeenLastCalledWith("live");
    act(() => socket().close());
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting");
  });

  // Review R1: a minimised card unmounts its grid and the socket closes; the
  // card must not keep the last "live" it heard.
  it("reports idle when it unmounts", async () => {
    const onStatus = vi.fn();
    const { unmount } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} onStatus={onStatus} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    act(() => socket().open());
    expect(onStatus).toHaveBeenLastCalledWith("live");
    unmount();
    expect(onStatus).toHaveBeenLastCalledWith("idle");
  });

  it("Refresh (refreshKey) re-fetches the snapshot over the same socket", async () => {
    const { rerender } = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} refreshKey={0} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} refreshKey={1} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("reports when it last took data -- the snapshot, then streamed rows at most once a second", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const onLive = vi.fn();
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} onLive={onLive} />);
    await waitFor(() => expect(onLive).toHaveBeenCalledWith(1_000_000));
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    act(() => socket().open());
    // Inside the second: the snapshot's report stands, a tick adds none.
    now.mockReturnValue(1_000_400);
    act(() => socket().emit({ symbol: "TSLA", price: 11 }));
    expect(onLive).toHaveBeenCalledTimes(1);
    // A second on, the next tick reports.
    now.mockReturnValue(1_001_500);
    act(() => socket().emit({ symbol: "TSLA", price: 12 }));
    expect(onLive).toHaveBeenLastCalledWith(1_001_500);
    expect(onLive).toHaveBeenCalledTimes(2);
    // A frame it drops is not data taken.
    now.mockReturnValue(1_003_000);
    act(() => socket().emit({ price: 99 }));
    expect(onLive).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    now.mockRestore();
  });

  // V10-P1: a header credential never rides the socket; a fresh ticket does,
  // on every connect, and the drop notice names neither.
  it("opens a header-credential backend's socket on a fresh ticket per connect, and never logs it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gated = { ...backend, authLocation: "header", headerName: "Authorization", headerValue: "Bearer s3cret" } as BackendConfig;
    render(<LiveGridRenderer widget={widget} backend={gated} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(socket().url).toMatch(/^ws:\/\/h\/live_grid_ws\?ticket=t\d+$/));
    const first = socket().url;
    act(() => socket().close());
    await act(async () => vi.advanceTimersByTime(1000));
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2));
    expect(socket().url).not.toBe(first);
    expect(socket().url).toMatch(/\?ticket=t\d+$/);
    for (const s of FakeSocket.all) expect(s.url).not.toContain("s3cret");
    expect(logOnce).toHaveBeenCalledWith("widget-socket:g", "websocket dropped: ws://h/live_grid_ws");
    vi.useRealTimers();
  });

  it("logs a drop once per card, with the socket's query (and so a query credential) stripped", async () => {
    const keyed = { ...backend, authLocation: "query", headerName: "api_key", headerValue: "s3cret" } as BackendConfig;
    const { unmount } = render(<LiveGridRenderer widget={widget} backend={keyed} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    expect(socket().url).toBe("ws://h/live_grid_ws?api_key=s3cret");
    act(() => socket().close());

    expect(logOnce).toHaveBeenCalledWith("widget-socket:g", "websocket dropped: ws://h/live_grid_ws");
    expect(JSON.stringify(vi.mocked(logOnce).mock.calls)).not.toContain("s3cret");
    vi.mocked(logOnce).mockClear();
    // An unmount closes the socket too, and that is not a drop.
    unmount();
    expect(logOnce).not.toHaveBeenCalled();
  });
});

describe("LiveGridRenderer -- /symbol_meta logos and range bars (v10)", () => {
  const quotes = {
    ...widget,
    table: {
      columns: [
        { field: "logo_url", renderFn: ["logo"] },
        { field: "symbol" },
        { field: "price" },
        { field: "week52_low" },
        { field: "week52_range", renderFn: ["rangeBar"], renderFnParams: { lowKey: "week52_low", highKey: "week52_high" } },
        { field: "week52_high" },
      ],
    },
  } as WidgetDef;

  it("asks symbol_meta for the grid's symbols and decorates each row with its logo and 52-week band", async () => {
    vi.mocked(fetchWidgetPath).mockResolvedValue([
      { symbol: "TSLA", logo_url: "https://cdn.example/TSLA.png", week52_low: 5, week52_high: 15 },
    ]);
    render(<LiveGridRenderer widget={quotes} backend={backend} params={{ symbol: "TSLA" }} />);
    // The columns are there from the first render, before the answer lands.
    await waitFor(() => expect(document.querySelector('th[data-field="logo_url"]')).not.toBeNull());
    await waitFor(() =>
      expect(document.querySelector("img.cell-logo")?.getAttribute("src")).toBe("https://cdn.example/TSLA.png"),
    );
    expect(fetchWidgetPath).toHaveBeenCalledWith(backend, "symbol_meta", { symbol: "TSLA" });
    // The bar marks the row's price (10) halfway along 5..15.
    expect(document.querySelector<HTMLElement>(".cell-range-marker")?.style.left).toMatch(/0\.5/);
  });

  it("does not refetch symbol_meta on a tick, only when the symbol set changes", async () => {
    render(<LiveGridRenderer widget={quotes} backend={backend} params={{ symbol: "TSLA,AAPL" }} />);
    await waitFor(() => expect(fetchWidgetPath).toHaveBeenCalledTimes(1));
    act(() => socket().open());
    act(() => socket().emit({ symbol: "TSLA", price: 11 }));
    await waitFor(() => expect(screen.getByText("11")).toBeInTheDocument());
    expect(fetchWidgetPath).toHaveBeenCalledTimes(1);
    act(() => socket().emit({ symbol: "AAPL", price: 3 }));
    await waitFor(() => expect(fetchWidgetPath).toHaveBeenCalledTimes(2));
    expect(fetchWidgetPath).toHaveBeenLastCalledWith(backend, "symbol_meta", { symbol: "AAPL,TSLA" });
  });

  it("a backend without symbol_meta is not an error: the grid renders, and the outage is logged once", async () => {
    vi.mocked(fetchWidgetPath).mockRejectedValue(new Error("HTTP 404"));
    render(<LiveGridRenderer widget={quotes} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(logOnce).toHaveBeenCalledWith("symbol_meta:g", "symbol_meta unavailable: HTTP 404"));
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("symbol_meta helpers", () => {
  it("symbolMetaRead: the meta keys a column or a range bar's ends read, nothing else", () => {
    expect(symbolMetaRead(undefined)).toEqual([]);
    expect(symbolMetaRead({ columns: [{ field: "symbol" }, { field: "price" }] })).toEqual([]);
    expect(symbolMetaRead({ columns: [{ field: "logo_url" }] })).toEqual(["logo_url"]);
    expect(
      symbolMetaRead({ columns: [{ field: "r", renderFn: ["rangeBar"], renderFnParams: { lowKey: "week52_low", highKey: "week52_high" } }] }),
    ).toEqual(["week52_high", "week52_low"]);
  });

  it("a grid that reads only the logo gains no 52-week columns", async () => {
    vi.mocked(fetchWidgetPath).mockResolvedValue([{ symbol: "TSLA", logo_url: "u", week52_low: 5, week52_high: 15 }]);
    const logoOnly = { ...widget, table: { columns: [{ field: "logo_url", renderFn: ["logo"] }, { field: "symbol" }, { field: "price" }] } } as WidgetDef;
    render(<LiveGridRenderer widget={logoOnly} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(document.querySelector("img.cell-logo")).not.toBeNull());
    expect(document.querySelector('th[data-field="week52_low"]')).toBeNull();
    expect(document.querySelector('th[data-field="week52_high"]')).toBeNull();
  });

  it("normaliseMeta: a list of rows keyed by their own symbol; NA is no logo; junk is skipped", () => {
    const meta = normaliseMeta([
      { symbol: "AAPL", logo_url: "u", week52_high: 2, week52_low: 1 },
      { symbol: "EURUSD", logo_url: "NA" },
      { logo_url: "orphan" },
      "junk",
    ]);
    expect([...meta]).toEqual([
      ["AAPL", { logo_url: "u", week52_high: 2, week52_low: 1 }],
      ["EURUSD", {}],
    ]);
    expect(normaliseMeta({ AAPL: { logo_url: "u" } }).size).toBe(0);
  });
});

describe("frameRows", () => {
  it("reads one row object or an array of row objects, and nothing else", () => {
    expect(frameRows({ symbol: "A" })).toEqual([{ symbol: "A" }]);
    expect(frameRows([{ symbol: "A" }, { symbol: "B" }])).toEqual([{ symbol: "A" }, { symbol: "B" }]);
    expect(frameRows([{ symbol: "A" }, "B"])).toEqual([]);
    expect(frameRows("A")).toEqual([]);
    expect(frameRows(null)).toEqual([]);
  });
});
