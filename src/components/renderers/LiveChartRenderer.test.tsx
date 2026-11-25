// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so lwChart is mocked, as in TradingViewRenderer.test.
const handle = { setBars: vi.fn(), updateBar: vi.fn(), applyTheme: vi.fn(), dispose: vi.fn() };
const mountCandleChart = vi.fn(async (_el: HTMLElement, _opts: unknown) => handle);
vi.mock("../../lib/lwChart", () => ({
  mountCandleChart: (el: HTMLElement, opts: unknown) => mountCandleChart(el, opts),
  TRADINGVIEW_CREDIT_URL: "https://www.tradingview.com/lightweight-charts/",
  TRADINGVIEW_CREDIT_LABEL: "Rendered by TradingView",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: vi.fn(),
  fetchEndpoint: vi.fn(),
  ticketedWsUrl: vi.fn(async (_backend: unknown, url: string) => `${url}?ticket=t${++tickets}`),
}));
let tickets = 0;
vi.mock("../../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../../lib/logger")>()),
  logOnce: vi.fn(async () => {}),
}));

import { LiveChartRenderer } from "./LiveChartRenderer";
import { fetchEndpoint, fetchWidgetData, ticketedWsUrl } from "../../lib/dataClient";
import { logOnce } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { FakeSocket } from "../../test/fakeSocket";

// The real useReconnectingSocket runs on the spec-accurate fake, as in
// LiveGridRenderer.test: what is pinned is the wire the backend sees.
const widget = { id: "lc", type: "live_chart", endpoint: "series", wsEndpoint: "live_grid_ws" } as unknown as WidgetDef;
const backend = { id: "b", name: "live-grid", baseUrl: "http://h" } as BackendConfig;
const T0 = Date.UTC(2026, 9, 9, 13, 30) / 1000;
const envelope = {
  symbol: "AAPL",
  interval: "1m",
  bars: [{ date: "2026-10-09T13:30:00+00:00", open: 10, high: 11, low: 9, close: 10.5, volume: 100 }],
  cache: {},
};
const seeded = { time: T0, open: 10, high: 11, low: 9, close: 10.5, volume: 100 };

function socket(): FakeSocket {
  if (!FakeSocket.last) throw new Error("no socket was opened");
  return FakeSocket.last;
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeSocket.last = null;
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(fetchWidgetData).mockResolvedValue(envelope);
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
  // 13:30:20 UTC: inside the seeded bar's minute.
  vi.spyOn(Date, "now").mockReturnValue((T0 + 20) * 1000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveChartRenderer", () => {
  it("seeds from /series for the first symbol, subscribes, folds ticks, and closes the socket on unmount", async () => {
    const { unmount } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL, MSFT", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(vi.mocked(fetchWidgetData).mock.calls[0][2]).toEqual({ symbol: "AAPL", interval: "1m" });
    // One symbol is drawn, and the card says so.
    expect(screen.getByText(/Charting AAPL only/)).toBeInTheDocument();
    expect(screen.getByText("Rendered by TradingView")).toBeInTheDocument();

    expect(socket().url).toBe("ws://h/live_grid_ws");
    act(() => socket().open());
    expect(socket().sent).toEqual([JSON.stringify({ params: { symbol: "AAPL" } })]);

    // Same minute: the seeded bar moves. Another symbol: nothing.
    act(() => socket().emit({ symbol: "AAPL", price: 12, last_size: 5, updated_at: "13:30:15" }));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 12, close: 12, volume: 105 });
    act(() => socket().emit({ symbol: "MSFT", price: 400, updated_at: "13:30:16" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(1);
    // The next minute, in the array shape: a new bar, built on the folded one.
    act(() => socket().emit([{ symbol: "AAPL", price: 13, last_size: 1, updated_at: "13:31:02" }]));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ time: T0 + 60, open: 13, high: 13, low: 13, close: 13, volume: 1 });
    // Older than the newest bar: ignored.
    act(() => socket().emit({ symbol: "AAPL", price: 1, updated_at: "13:29:59" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(2);

    unmount();
    expect(socket().closed).toBe(true);
    expect(handle.dispose).toHaveBeenCalled();
  });

  it("adds the change in stream_volume: baseline first, then deltas; volume and last_size ignored", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    const tick = (price: number, stream: number, volume: number) =>
      act(() => socket().emit({ symbol: "AAPL", price, last_size: 99, stream_volume: stream, volume, updated_ts: "2026-10-09T13:30:10+00:00" }));
    tick(11, 300, 50_000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 100 });
    // A re-seed on the server moved `volume` by 9,000; only the stream's 40 count.
    tick(11.5, 340, 59_000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11.5, close: 11.5, volume: 140 });
  });

  it("falls back to the day volume's deltas without stream_volume (an older live-grid)", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 11, last_size: 99, volume: 50_000, updated_ts: "2026-10-09T13:30:10+00:00" }));
    act(() => socket().emit({ symbol: "AAPL", price: 11, last_size: 99, volume: 50_025, updated_ts: "2026-10-09T13:30:11+00:00" }));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 125 });
  });

  // Review F1: the first row after a gap must not credit the outage's volume to one bar.
  it("re-seeds on a reopen and starts the volume baseline over", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(1));
    act(() => socket().open());
    const tick = (stream: number) =>
      act(() => socket().emit({ symbol: "AAPL", price: 11, stream_volume: stream, updated_ts: "2026-10-09T13:30:10+00:00" }));
    tick(1000);
    const first = socket();
    act(() => first.close());
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2), { timeout: 3000 });
    // The first open does not re-seed; the reopen does.
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    act(() => socket().open());
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(2));
    expect(fetchWidgetData).toHaveBeenCalledTimes(2);
    tick(5000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 100 });
    tick(5010);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 110 });
  });

  it("asks a fresh socket ticket for every connect when the credential is a header", async () => {
    const keyed = { ...backend, authLocation: "header", headerName: "Authorization", headerValue: "Bearer x" } as BackendConfig;
    render(<LiveChartRenderer widget={widget} backend={keyed} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    expect(socket().url).toMatch(/^ws:\/\/h\/live_grid_ws\?ticket=t\d+$/);
    expect(socket().url).not.toContain("Bearer");
    act(() => socket().close());
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2), { timeout: 3000 });
    expect(FakeSocket.all[1].url).not.toBe(FakeSocket.all[0].url);
    expect(ticketedWsUrl).toHaveBeenCalledTimes(2);
  });

  it("re-themes the live chart on a theme flip instead of remounting it", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    expect(mountCandleChart.mock.calls[0][1]).toEqual({ theme: "dark", colors: {}, showVolume: true, barSeconds: 60 });
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } }));
    expect(handle.applyTheme).toHaveBeenLastCalledWith("light");
    expect(mountCandleChart).toHaveBeenCalledTimes(1);
  });

  it("under StrictMode leaves one live chart and one open socket", async () => {
    render(
      <StrictMode>
        <LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />
      </StrictMode>,
    );
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(handle.dispose).toHaveBeenCalledTimes(mountCandleChart.mock.calls.length - 1);
    expect(FakeSocket.all.filter((s) => !s.closed)).toHaveLength(1);
  });

  it("disposes the chart and mounts a new one for a new symbol, clearing the old one's error", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("HTTP 502: Bad Gateway")).toBeInTheDocument());
    let answer: (v: unknown) => void = () => {};
    vi.mocked(fetchWidgetData).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "1m" }} />);
    // Review F7: AAPL's error is not MSFT's.
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await act(async () => answer(envelope));
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(1));

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "TSLA", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(2));
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(mountCandleChart).toHaveBeenCalledTimes(2);
  });

  it("keeps the drawn chart when a Refresh fails, and logs it once", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} refreshKey={1} />);
    await waitFor(() => expect(logOnce).toHaveBeenCalledWith("live-chart-refetch:lc", expect.stringContaining("keeping the last bars")));
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByTestId("live-chart-plot")).toBeInTheDocument();
  });

  // Review F5: an empty seed that ticks then fills.
  it("drops the empty-seed note once a tick draws, and keeps those bars through a failed Refresh", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValueOnce({ ...envelope, bars: [] });
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("No bars for AAPL yet.")).toBeInTheDocument());
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([]));
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 12, updated_ts: "2026-10-09T13:30:15+00:00" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No bars for AAPL yet.")).toBeNull();
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} refreshKey={1} />);
    await waitFor(() => expect(logOnce).toHaveBeenCalledWith("live-chart-refetch:lc", expect.any(String)));
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByTestId("live-chart-plot")).toBeInTheDocument();
  });

  it("shows a chart library that fails to load as an error, and Retry mounts it again", async () => {
    mountCandleChart.mockRejectedValueOnce(new Error("chunk failed"));
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("chart library failed to load")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(mountCandleChart).toHaveBeenCalledTimes(2);
  });

  // Review F6.
  it("with an interval it cannot bucket, shows the seed and a note and opens no socket", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "2w" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(screen.getByText('Live updates are off: "2w" is not an interval this chart reads.')).toBeInTheDocument();
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL" }} />);
    await waitFor(() => expect(screen.getByText("Live updates are off: no interval is set.")).toBeInTheDocument());
    expect(FakeSocket.all).toHaveLength(0);
  });

  // The deleted WidgetCard raw-JSON test also pinned this (review F12): keys a release
  // adds to /series' cache (the lake read-back's, or none yet named) are no error.
  it("draws an envelope whose cache carries keys the client has never heard of, with no error", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValueOnce({
      ...envelope,
      cache: { cache: "hit", rows_from_ticks: 3, rows_from_lake: 390, lake_days: ["2026-10-09"], a_key_no_release_has_yet: { nested: [1] } },
    });
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("re-seeds on an interval change without re-sending the unchanged subscribe frame", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "5m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(socket().sent).toEqual([JSON.stringify({ params: { symbol: "AAPL" } })]);
  });

  it("re-seeds and re-subscribes on a symbol change, and re-fetches the seed on Refresh", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "1m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchWidgetData).mock.calls[1][2]).toEqual({ symbol: "MSFT", interval: "1m" });
    expect(socket().sent.at(-1)).toBe(JSON.stringify({ params: { symbol: "MSFT" } }));
    expect(FakeSocket.all).toHaveLength(1);

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "5m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(3));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "5m" }} refreshKey={1} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(4));
  });

  it("without a wsEndpoint (a v3 reference backend) shows the seeded chart and opens no socket", async () => {
    const plain = { ...widget, wsEndpoint: undefined } as WidgetDef;
    render(<LiveChartRenderer widget={plain} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(FakeSocket.all).toHaveLength(0);
  });

  it("shows a failed seed as an error with Retry", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValue(new Error("HTTP 502: Bad Gateway"));
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("HTTP 502: Bad Gateway")).toBeInTheDocument());
  });
});

it('selects the advertised chart protocol and draws full historical replacements without a quote seed', async () => {
  const streamed = { ...widget, chartStreamV1: true, wsEndpoint: 'chart_stream_ws' };
  const { unmount } = render(<LiveChartRenderer widget={streamed} backend={{...backend, baseUrl:'https://funnel.example/grid'}} params={{symbol:'AAPL',interval:'1m',start:'2026-11-20T14:30:00.000000000Z'}} />);
  await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
  expect(socket().url).toMatch(/^wss:\/\/funnel.example\/grid\/chart_stream_ws\?ticket=t[0-9]+$/);
  act(() => socket().open());
  expect(JSON.parse(socket().sent[0])).toMatchObject({type:'subscribe',protocol_version:1,view:{symbol:'AAPL',mode:'candles',interval:'1m'}});
  const examples = await import('../../lib/chart-stream-v1.examples.json');
  for (const frame of examples.default[1].frames.slice(0,4)) act(() => socket().emit({...frame,subscription_id:'chart'}));
  await waitFor(() => expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({open:99,volume:5})]));
  expect(fetchWidgetData).not.toHaveBeenCalled();
  expect(handle.updateBar).not.toHaveBeenCalled();
  await waitFor(()=>expect(socket().sent.map(x=>JSON.parse(x).type)).toContain('ack'));
  unmount();
  expect(socket().sent.map(x=>JSON.parse(x).type)).toContain('unsubscribe');
});
it('resumes the applied checkpoint with fresh desktop tickets and unsubscribes on a view change', async () => {
  const streamed = {...widget,chartStreamV1:true,wsEndpoint:'chart_stream_ws'};
  const keyed = {...backend,authLocation:'header',headerName:'Authorization',headerValue:'Bearer private'} as BackendConfig;
  const {rerender} = render(<LiveChartRenderer widget={streamed} backend={keyed} params={{symbol:'AAPL',interval:'1m'}}/>);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(1));
  act(()=>socket().open());
  const examples = await import('../../lib/chart-stream-v1.examples.json');
  for(const frame of examples.default[1].frames.slice(0,3)) act(()=>socket().emit({...frame,subscription_id:'chart'}));
  const first = socket();
  act(()=>first.close());
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(2),{timeout:3000});
  expect(socket().url).not.toBe(first.url);
  expect(socket().url).not.toContain('private');
  act(()=>socket().open());
  expect(JSON.parse(socket().sent[0])).toMatchObject({type:'resume',checkpoint:{cursor:{epoch:'epoch-a',seq:'9007199254740993'},retained_candle_keys:[expect.objectContaining({symbol:'AAPL'})]}});
  const previous=socket();
  rerender(<LiveChartRenderer widget={streamed} backend={keyed} params={{symbol:'MSFT',interval:'1m'}}/>);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(3));
  expect(previous.sent.map(x=>JSON.parse(x).type)).toContain('unsubscribe');
  act(()=>socket().open());
  expect(JSON.parse(socket().sent[0])).toMatchObject({type:'subscribe',view:{symbol:'MSFT'}});
});
it('uses a fresh snapshot when retained candle keys would exceed the control byte limit', async () => {
  const streamed={...widget,chartStreamV1:true,wsEndpoint:'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}}/>);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(1));
  act(()=>socket().open());
  const examples=await import('../../lib/chart-stream-v1.examples.json');
  const [begin,chunk,end]=examples.default[1].frames;
  const candle=(chunk as unknown as {items:{key:{bucket_start:string}}[]}).items[0];
  const items=Array.from({length:1000},(_,n)=>({...candle,key:{symbol:'AAPL',interval:'1m',bucket_start:new Date(Date.UTC(2026,10,20,14,30+n)).toISOString().replace('000Z','000000000Z')}}));
  act(()=>socket().emit({...begin,subscription_id:'chart',item_count:'1000'}));
  act(()=>socket().emit({...chunk,subscription_id:'chart',items}));
  act(()=>socket().emit({...end,subscription_id:'chart',item_count:'1000'}));
  act(()=>socket().close());
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(2),{timeout:3000});
  act(()=>socket().open());
  expect(JSON.parse(socket().sent[0]).type).toBe('subscribe');
  expect(new TextEncoder().encode(socket().sent[0]).length).toBeLessThan(65536);
});
it('coalesces acknowledgments under the gateway control-rate budget', async () => {
  const streamed={...widget,chartStreamV1:true,wsEndpoint:'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}}/>);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(1)); act(()=>socket().open());
  const examples=await import('../../lib/chart-stream-v1.examples.json');
  for(const frame of examples.default[1].frames.slice(0,3)) act(()=>socket().emit({...frame,subscription_id:'chart'}));
  for(let n=0;n<20;n++) act(()=>socket().emit({...examples.default[1].frames[3],subscription_id:'chart',from_cursor:{epoch:'epoch-a',seq:String(9007199254740993n+BigInt(n))},through_cursor:{epoch:'epoch-a',seq:String(9007199254740994n+BigInt(n))},candles:[]}));
  expect(socket().sent.filter(x=>JSON.parse(x).type==='ack').length).toBeLessThanOrEqual(1);
  await waitFor(()=>expect(socket().sent.map(x=>JSON.parse(x))).toContainEqual(expect.objectContaining({type:'ack',cursor:{epoch:'epoch-a',seq:'9007199254741013'}})));
});

it('applies a logical candle change above the snapshot chunk cap without reconnecting', async () => {
  const streamed = {...widget, chartStreamV1: true, wsEndpoint: 'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}} />);
  await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
  const connection = socket();
  act(() => connection.open());
  const examples = await import('../../lib/chart-stream-v1.examples.json');
  const [begin, chunk, end] = examples.default[1].frames;
  const epoch = 'e'.repeat(64);
  const cursor = {epoch, seq:'9007199254740993'};
  const through = {epoch, seq:'9007199254740994'};
  const candles = Array.from({length:2000}, (_, n) => ({
    key:{symbol:'AAPL',interval:'1m',bucket_start:new Date(Date.UTC(2026,10,20,14,30+n)).toISOString().replace('000Z','000000000Z')},
    open:9, high:12, low:8, close:11, volume:7, vwap:10, tickCount:'2', revision:through, status:'closed',
  }));
  act(() => connection.emit({...begin, subscription_id:'chart', cursor}));
  act(() => connection.emit({...chunk, subscription_id:'chart', items:[{...candles[0],volume:3,revision:cursor}]}));
  act(() => connection.emit({...end, subscription_id:'chart', cursor}));
  await waitFor(() => expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({volume:3})]));
  const change = {protocol_version:1,type:'candles',subscription_id:'chart',generation:'generation-a',from_cursor:cursor,through_cursor:through,candles};
  const bytes = new TextEncoder().encode(JSON.stringify(change)).length;
  expect(bytes).toBeGreaterThan(512 * 1024);
  expect(bytes).toBeLessThan(8 * 1024 * 1024);
  act(() => connection.emit(change));
  await waitFor(() => expect(handle.setBars.mock.lastCall?.[0]).toHaveLength(2000));
  expect(handle.setBars.mock.lastCall?.[0][0]).toMatchObject({open:9,volume:7});
  await waitFor(() => expect(connection.sent.map(frame => JSON.parse(frame))).toContainEqual(expect.objectContaining({type:'ack',cursor:through})));
  expect(connection.closed).toBe(false);
  expect(FakeSocket.all).toHaveLength(1);
});

it.each([
  ['snapshot_chunk',512 * 1024],
  ['candles',8 * 1024 * 1024],
  ['heartbeat',8 * 1024 * 1024],
])('rejects an oversized %s frame before applying it', async (type, limit) => {
  const streamed = {...widget, chartStreamV1:true, wsEndpoint:'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}} />);
  await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
  const connection = socket();
  act(() => connection.open());
  const frame = {protocol_version:1,type,subscription_id:'chart',generation:'generation-a',padding:'x'.repeat(limit)};
  expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeGreaterThan(limit);
  act(() => connection.emit(frame));
  expect(connection.closed).toBe(true);
  expect(connection.sent.map(value => JSON.parse(value).type)).not.toContain('ack');
});
it('draws finite candles with zero volume and null VWAP through snapshot and replacement', async () => {
  const streamed={...widget,chartStreamV1:true,wsEndpoint:'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}} />);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(1));
  const connection=socket(); act(()=>connection.open());
  const examples=await import('../../lib/chart-stream-v1.examples.json');
  const [begin,chunk,end,change]=examples.default[1].frames;
  const initial=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const replacement=(change as unknown as {candles:Record<string,unknown>[]}).candles[0];
  act(()=>connection.emit({...begin,subscription_id:'chart'}));
  act(()=>connection.emit({...chunk,subscription_id:'chart',items:[{...initial,volume:0,vwap:null}]}));
  act(()=>connection.emit({...end,subscription_id:'chart'}));
  await waitFor(()=>expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({open:100,volume:0})]));
  act(()=>connection.emit({...change,subscription_id:'chart',candles:[{...replacement,volume:0,vwap:null}]}));
  await waitFor(()=>expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({open:99,volume:0})]));
  await waitFor(()=>expect(connection.sent.map(frame=>JSON.parse(frame))).toContainEqual(expect.objectContaining({type:'ack',cursor:{epoch:'epoch-a',seq:'9007199254740994'}})));
  expect(connection.sent.map(frame=>JSON.parse(frame).type).filter(type=>type==='subscribe')).toHaveLength(1);
  expect(connection.closed).toBe(false);
});
it('acknowledges nullable candles without plotting fabricated prices or resetting the view', async () => {
  const streamed={...widget,chartStreamV1:true,wsEndpoint:'chart_stream_ws'};
  render(<LiveChartRenderer widget={streamed} backend={backend} params={{symbol:'AAPL',interval:'1m'}} />);
  await waitFor(()=>expect(FakeSocket.all).toHaveLength(1));
  const connection=socket(); act(()=>connection.open());
  const examples=await import('../../lib/chart-stream-v1.examples.json');
  const [begin,chunk,end,change]=examples.default[1].frames;
  const initial=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const replacement=(change as unknown as {candles:Record<string,unknown>[]}).candles[0];
  act(()=>connection.emit({...begin,subscription_id:'chart'}));
  act(()=>connection.emit({...chunk,subscription_id:'chart',items:[{...initial,open:null}]}));
  act(()=>connection.emit({...end,subscription_id:'chart'}));
  await waitFor(()=>expect(screen.getByText('No plottable bars for AAPL yet.')).toBeInTheDocument());
  expect(handle.setBars).toHaveBeenLastCalledWith([]);
  act(()=>connection.emit({...change,subscription_id:'chart',candles:[{...replacement,volume:null}]}));
  await waitFor(()=>expect(connection.sent.map(frame=>JSON.parse(frame))).toContainEqual(expect.objectContaining({type:'ack',cursor:{epoch:'epoch-a',seq:'9007199254740994'}})));
  expect(handle.setBars).toHaveBeenLastCalledWith([]);
  const from={epoch:'epoch-a',seq:'9007199254740994'};
  const through={epoch:'epoch-a',seq:'9007199254740995'};
  act(()=>connection.emit({...change,subscription_id:'chart',from_cursor:from,through_cursor:through,candles:[{...replacement,revision:through}]}));
  await waitFor(()=>expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({open:99,volume:5})]));
  expect(screen.queryByText('No plottable bars for AAPL yet.')).not.toBeInTheDocument();
  expect(connection.sent.map(frame=>JSON.parse(frame).type).filter(type=>type==='subscribe')).toHaveLength(1);
  expect(connection.closed).toBe(false);
});

it('draws closed-session history and redraws a newly selected symbol without pretending it is accepted tape',async()=>{
 const historical=(symbol:string,close:number)=>({schema_version:1,mode:'closed',symbol,interval:'1m',source:'eodhd',session:{date:'2026-11-20',status:'closed'},bars:[{date:'2026-11-20T14:30:00Z',open:close-1,high:close+1,low:close-2,close,volume:5}]});
 vi.mocked(fetchEndpoint).mockImplementation(async(_b,_p,params)=>historical(params.symbol,params.symbol==='AAPL'?102:202));
 const advertised={...widget,chartStreamV1:true,closedSessionHistory:true,wsEndpoint:'chart_stream_ws'};
 const {rerender}=render(<LiveChartRenderer widget={advertised} backend={backend} params={{symbol:'AAPL',interval:'1m'}}/>);
 await waitFor(()=>expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({close:102})]));
 expect(screen.getByRole('status')).toHaveTextContent('EODHD historical session');
 expect(FakeSocket.all).toHaveLength(0);
 rerender(<LiveChartRenderer widget={advertised} backend={backend} params={{symbol:'MSFT',interval:'1m'}}/>);
 await waitFor(()=>expect(handle.setBars).toHaveBeenLastCalledWith([expect.objectContaining({close:202})]));
 expect(screen.getByRole('status')).toHaveTextContent('MSFT');
 expect(fetchWidgetData).not.toHaveBeenCalled();
});
