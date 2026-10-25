// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// The Export menu goes through the native save dialog. Nothing else on this
// card touches plugin-dialog, so the whole module is one fn.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn(), confirm: vi.fn() }));
// Real SheetJS is exercised in export.test.ts. Here the workbook is a stub,
// so the Excel case tests only this card's wiring: bytes in, writeFile out.
vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: () => ({}),
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    book_append_sheet: () => {},
    sheet_add_aoa: () => {},
  },
  write: () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
}));

// REPLACED like RssRenderer: the real one opens a websocket. What the card
// owes it is five props, and this makes them observable.
vi.mock("./renderers/NewsRenderer", () => ({
  NewsRenderer: (props: {
    base: string;
    feeds: unknown;
    highlights: unknown;
    refreshKey: number;
    tabOrder: string[];
    onConfigure?: () => void;
    onReorderTabs?: (order: string[]) => void;
  }) => (
    <>
      <span data-testid="news-props">
        {JSON.stringify({ base: props.base, feeds: props.feeds, highlights: props.highlights, refreshKey: props.refreshKey, tabOrder: props.tabOrder })}
      </span>
      {/* Uncontrolled, so it stands in for the renderer's own state: it is
          cleared only by a remount. */}
      <input aria-label="news-local-state" />
      {/* Absent callbacks (a locked card) render no stand-in, as the renderer offers no affordance. */}
      {props.onConfigure ? <button type="button" onClick={props.onConfigure}>configure-from-body</button> : null}
      {props.onReorderTabs ? (
        <button type="button" onClick={() => props.onReorderTabs?.(["Substack", "Wires"])}>reorder-from-body</button>
      ) : null}
    </>
  ),
}));

const useWidgetData = vi.fn();
vi.mock("../hooks/useWidgetData", () => ({
  // The third argument is forwarded so a test can assert WHAT the card told
  // the hook about the widget's run button, not only what it did with the
  // answer. `paramsFor` below still reads [1] and is unaffected.
  useWidgetData: (c: unknown, p: unknown, o: unknown) => useWidgetData(c, p, o),
}));

// Only the one function a widget form calls. Everything else in dataClient is
// the real module -- this file must not stub the URL building or the error
// rendering that dataClient.test.ts covers over genuine HTTP.
const postForm = vi.fn();
// A statement card's year-end lookup is answered here when a test sets
// `fiscalYearEndAnswer`; every other test keeps the real function.
let fiscalYearEndAnswer: ((symbol: string) => Promise<unknown>) | null = null;
vi.mock("../lib/dataClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/dataClient")>();
  return {
    ...actual,
    postForm: (...args: unknown[]) => postForm(...args),
    fetchFiscalYearEnd: (b: Parameters<typeof actual.fetchFiscalYearEnd>[0], symbol: string) =>
      fiscalYearEndAnswer ? fiscalYearEndAnswer(symbol) : actual.fetchFiscalYearEnd(b, symbol),
  };
});

/**
 * What the stubbed cell hands WidgetCard when it is clicked. Mutable so each
 * test can describe the click it is about; reset in beforeEach.
 */
const cellClick = { paramName: "symbol", value: "MSFT", forceUpdate: false };
const CELL_CLICK_DEFAULT = { ...cellClick };

// Wraps the REAL renderer -- every other test in this file still exercises the
// genuine one, table.widget-table included -- and adds the one thing jsdom
// cannot produce: a clickable cell. TableRenderer virtualises its rows and
// jsdom gives the scroll container no height, so no <td> is ever in the DOM
// here (see the comment on the stale-data test below). What is under test is
// WidgetCard's handler, not the renderer's cell markup, which
// TableRenderer.test.tsx covers against a real DOM.
vi.mock("./renderers/TableRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderers/TableRenderer")>();
  return {
    ...actual,
    TableRenderer: (props: Parameters<typeof actual.TableRenderer>[0]) => {
      const onCellClick = props.onCellClick;
      return (
        <>
          {onCellClick ? (
            <button type="button" aria-label="Click cell" onClick={() => onCellClick({ ...cellClick })} />
          ) : null}
          {props.onSendToAgent ? (
            <button type="button" aria-label="Send row" onClick={() => props.onSendToAgent!("row text", undefined)} />
          ) : null}
          {/* What the card hands the renderer as the manifest's Pivot preset. */}
          <span hidden data-testid="table-pivot-preset">{JSON.stringify(props.pivotPreset ?? null)}</span>
          <actual.TableRenderer {...props} />
        </>
      );
    },
  };
});

// Wraps the REAL renderer rather than replacing it -- every other test in this
// file still exercises the genuine one -- and makes only the refreshKey it is
// handed observable. That prop is the whole of this card's Refresh: a
// multi_file_viewer fetches nothing through useWidgetData, so there is no
// request here for Refresh to repeat.
vi.mock("./renderers/MultiFileRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderers/MultiFileRenderer")>();
  return {
    MultiFileRenderer: (props: Parameters<typeof actual.MultiFileRenderer>[0]) => (
      <>
        <span data-testid="refresh-key">{String(props.refreshKey)}</span>
        {/* The params that ride on this renderer's own documents POST. */}
        <span data-testid="mf-params">{JSON.stringify(props.params)}</span>
        <actual.MultiFileRenderer {...props} />
      </>
    ),
  };
});

// REPLACED, not wrapped: the real one issues its own HTTP request, and
// @tauri-apps/plugin-http is not mocked in this file. Its behaviour has its
// own test file; what is under test here is what the CARD hands it.
vi.mock("./renderers/RssRenderer", () => ({
  RssRenderer: (props: Record<string, unknown>) => {
    // The one url the card-boundary suite at the end of this file uses.
    // Throwing DURING RENDER is the only thing an error boundary catches, and
    // this stub is already the file's throwaway renderer -- so the crash is
    // provoked through a prop rather than through a second mock.
    if (props.url === "throw://boom") throw new Error("the feed renderer exploded");
    return <span data-testid="rss-props">{JSON.stringify(props)}</span>;
  },
}));

// REPLACED, for the same reason as RssRenderer: the real one issues its own
// UDF request and draws on canvas. What is under test is what the CARD hands it.
vi.mock("./renderers/TradingViewRenderer", () => ({
  TradingViewRenderer: (props: { spec: unknown; refreshKey: unknown }) => (
    <span data-testid="tv-props">{JSON.stringify({ spec: props.spec, refreshKey: props.refreshKey })}</span>
  ),
}));

// REPLACED, for the same reason as RssRenderer: the real one fetches its own
// snapshot and opens a socket (both have their own test file). What is under
// test is what the CARD hands it.
vi.mock("./renderers/LiveGridRenderer", () => ({
  LiveGridRenderer: (props: Record<string, unknown>) => <LiveGridStub {...props} />,
}));
// The Live Chart (V10-P4) reports through the same onLive/onStatus pair, so
// the same stand-in serves it; LiveChartRenderer.test.tsx pins the real one.
vi.mock("./renderers/LiveChartRenderer", () => ({
  LiveChartRenderer: (props: Record<string, unknown>) => <LiveGridStub {...props} />,
}));
// The stand-in keeps the real renderer's one lifecycle contract the card relies
// on: it reports "idle" as it unmounts (LiveGridRenderer.test.tsx pins the real one).
function LiveGridStub(props: Record<string, unknown>) {
  const onStatus = props.onStatus as ((s: string) => void) | undefined;
  useEffect(() => () => onStatus?.("idle"), [onStatus]);
  return (
    <>
      <span data-testid="live-grid-props">
        {JSON.stringify({
          params: props.params,
          refreshKey: props.refreshKey,
          state: props.state,
          tableState: typeof props.onStateChange,
          filterRow: props.filterRow,
          sendToAgent: typeof props.onSendToAgent,
        })}
      </span>
      {/* Stands in for a snapshot or a streamed row reaching the grid. */}
      <button type="button" onClick={() => (props.onLive as ((at: number) => void) | undefined)?.(Date.now())}>
        live-tick
      </button>
      <button type="button" onClick={() => (props.onStatus as ((s: string) => void) | undefined)?.("reconnecting")}>
        socket-drop
      </button>
      <button type="button" onClick={() => (props.onStatus as ((s: string) => void) | undefined)?.("live")}>
        socket-open
      </button>
    </>
  );
}

/**
 * Replaced outright, not wrapped: the real one reads the filesystem through
 * SheetJS, which this file stubs for the Export menu. What WidgetCard owes it
 * is three props, and this makes exactly those observable.
 */
// A backend table goes to the table worker unless its payload is past the
// ceiling. These tests mount no execution runtime, so the suite defaults to
// the in-thread path (what an oversized table still gets); the worker tests
// below switch it on.
const worker = vi.hoisted(() => ({ fits: false }));
vi.mock("../lib/tableExecution/eligibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tableExecution/eligibility")>()),
  fitsTableWorker: () => worker.fits,
}));

vi.mock("./renderers/LocalTableRenderer", async (importOriginal) => ({
  schemaColumns: (await importOriginal<typeof import("./renderers/LocalTableRenderer")>()).schemaColumns,
  LocalTableRenderer: (props: { file: string; label: string; refreshKey: number; executionIdentity?: { widgetId: string }; spec?: unknown }) => (
    <span data-testid="local-table" data-runtime={props.executionIdentity?.widgetId} data-spec={props.spec ? "yes" : "no"}>{`${props.file}|${props.label}|${props.refreshKey}`}</span>
  ),
}));

// REPLACED, not wrapped: the real one mounts BlockNote, which needs a DOM
// ProseMirror can run in. Its own test covers it against a fake editor; what
// this card owes it is the text and an onChange that lands in the param.
vi.mock("./renderers/MarkdownEditorRenderer", () => ({
  MarkdownEditorRenderer: (props: { text: string; onChange: (t: string) => void }) => (
    <>
      <span data-testid="md-text">{props.text}</span>
      <button type="button" aria-label="Emit edit" onClick={() => props.onChange("changed")} />
    </>
  ),
}));

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  resizePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

// jsdom implements no ResizeObserver; ChartRenderer needs one to mount at
// all (see ChartRenderer.test.tsx for a stub that exercises the resize
// behavior itself — this file only needs the chart to mount without
// throwing).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

import { confirm, open, save } from "@tauri-apps/plugin-dialog";

import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { __failPath, __read, __readBytes, __reset, __seed, __writes } from "../test/memfs";
import { __resetLoggerForTests, logInfo } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { NOTHING_TO_TRANSPOSE } from "../lib/transpose";
import type { Dashboard, DashboardCard, WidgetDef } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { useBackendsStore } from "../stores/backendsStore";
import { useChatStore } from "../stores/chatStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { DOCKS_ID, makeDefaultDocks } from "../lib/dashboardsFile";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __resetStatementYearEndsForTests } from "../hooks/useStatementYearEnds";
import { WidgetCard } from "./WidgetCard";

// vi.restoreAllMocks() does not undo a setState-installed mock, so real actions are
// captured once at module load and reinstated before every test.
const REAL_ACTIONS = {
  setCardMinimized: useDashboardStore.getState().setCardMinimized,
  setMaximized: useDashboardStore.getState().setMaximized,
  duplicateCard: useDashboardStore.getState().duplicateCard,
  copyCardTo: useDashboardStore.getState().copyCardTo,
};

const card: DashboardCard = makeCard({ id: "c1", widgetId: "w1" });
const CARD_ID = card.id;

function register(over: Partial<WidgetDef> = {}) {
  useWidgetRegistryStore.setState({
    widgets: [makeWidget({ id: "w1", name: "Price History", ...over })],
  });
}

// Found rendering the Episode 5 Treasury example against a live stack: a
// Static calendar draws the widget's own start/end range, and it was handed
// the raw params, so a date expression ("T-6w", "T") reached date parsing
// and the card crashed with "Invalid time value". It must draw the resolved
// range -- the same values the request sends.
it("a Static calendar draws a range given as date expressions", async () => {
  register({
    type: "table",
    params: [
      { paramName: "start_date", label: "Start", type: "date" },
      { paramName: "end_date", label: "End", type: "date" },
    ],
  });
  const calendarCard: DashboardCard = {
    ...card,
    params: { start_date: "T-6w", end_date: "T" },
    view: "calendar",
    calendar: { mode: "static", unit: "month", dateField: "auction_date", titleField: "security_term" },
  };
  // A weekday about two weeks back: inside T-6w..T, and not on a hidden weekend.
  const day = new Date();
  day.setDate(day.getDate() - 14);
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() - 1);
  const inRange = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  useWidgetData.mockReturnValue({ status: "ready", data: [{ auction_date: inRange, security_term: "13-Week" }], retry: vi.fn() });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [calendarCard] }] }],
    activeId: "d1",
    activeTabId: "t1",
  });
  render(<WidgetCard card={calendarCard} onRemove={vi.fn()} />);
  expect(await screen.findByTestId("cal-grid")).toBeInTheDocument();
  expect(screen.queryByText(/Invalid time value|Something went wrong/)).toBeNull();
  expect(screen.getAllByText(/13-Week/).length).toBeGreaterThan(0);
});

/** A resolved, ready, one-dashboard card with no visible params -- the ⋯
 * menu's baseline shape (Rename…, Maximize, no Parameters section). */
function renderReadyCard() {
  register();
  useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
    activeId: "d1",
    activeTabId: "t1",
  });
  render(<WidgetCard card={card} onRemove={vi.fn()} />);
}

/** A resolved, ready table card with one visible param -- what the menu-order
 * and Parameters-popover tests need (hasControls, showsTable and canExport
 * all true). */
function renderReadyTableCardWithParams() {
  register({ type: "table", params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
  const withParams = { ...card, params: { symbol: "AAPL" } };
  useWidgetData.mockReturnValue({ status: "ready", data: [{ symbol: "AAPL" }], retry: vi.fn() });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [withParams] }] }],
    activeId: "d1",
    activeTabId: "t1",
  });
  render(<WidgetCard card={withParams} onRemove={vi.fn()} />);
}

// Back-port of dev 30ceb877d (v5.7.0): the widget's data.table.pivot preset
// reaches the table, where the card's own pivot (if any) still wins.
it("hands a table widget's manifest Pivot preset to the table", () => {
  const pivot = { enabled: true, grouping: ["symbol"], split: [] };
  register({ type: "table", pivot });
  useWidgetData.mockReturnValue({ status: "ready", data: [{ symbol: "AAPL" }], retry: vi.fn() });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
    activeId: "d1",
    activeTabId: "t1",
  });
  render(<WidgetCard card={card} onRemove={vi.fn()} />);
  expect(JSON.parse(screen.getByTestId("table-pivot-preset").textContent!)).toEqual(pivot);
});

beforeEach(() => {
  vi.mocked(save).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(confirm).mockReset();
  __reset();
  __resetLoggerForTests();
  useWidgetRegistryStore.setState({ widgets: [] });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  // `viewer` included: the viewer-mode suite below flips it, and nothing else
  // in this file would put it back.
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    refreshEpoch: 0,
    maximizedCardId: null,
    viewer: false,
  });
  useWidgetData.mockReset();
  postForm.mockReset();
  postForm.mockResolvedValue(undefined);
  useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
  Object.assign(cellClick, CELL_CLICK_DEFAULT);
});

describe("WidgetCard", () => {
  it("renders the widget name as the drag handle", () => {
    register();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const title = screen.getByText("Price History");
    expect(title).toHaveClass("card-title");
  });

  it("calls onRemove when the close button is clicked", async () => {
    register();
    const onRemove = vi.fn();
    render(<WidgetCard card={card} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: /remove card/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows the backend's warnings as a notice on the card", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn(), warnings: ["MBS truncated at the first 250,000 records"] });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("MBS truncated at the first 250,000 records");
  });

  // User ruling 2026-10-10: OPENBQ yfinance statements arrive long-form
  // (symbol, date, period, line_item, value); the card still offers Statement.
  it("offers the Statement view for long-form statement rows from a backend table", () => {
    register({ type: "table" });
    const data = [["total_revenue", 416], ["net_income", 112]].flatMap(([line_item, value]) =>
      ["2025-09-30", "2024-09-30"].map((date) => ({ symbol: "AAPL", date, period: "annual", line_item, value })));
    useWidgetData.mockReturnValue({ status: "ready", data, retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Statement" })).toBeInTheDocument();
  });

  it("shows a retryable error state, never a blank card", () => {
    register();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "error", data: null, error: "HTTP 500", retry });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 500");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("names the widget it cannot find rather than rendering nothing", () => {
    useWidgetData.mockReturnValue({ status: "unresolved", data: null, retry: vi.fn() });
    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    // The header's fallback title also matches /w1/, so asserting only that
    // would pass even if the body itself rendered nothing at all — the body
    // needs its own assertion, scoped to .card-body, to prove it renders
    // actual content rather than null.
    expect(screen.getByText("w1")).toHaveClass("card-title");
    expect(container.querySelector(".card-body")).toHaveTextContent(/waiting for widget/i);
  });

  it("shows which required param is missing, with no Retry, when nothing was requested", () => {
    register();
    useWidgetData.mockReturnValue({
      status: "incomplete",
      data: null,
      error: "Enter Symbol to load this widget.",
      retry: vi.fn(),
    });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByText("Enter Symbol to load this widget.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("shows a loading state, never a blank card", () => {
    register();
    useWidgetData.mockReturnValue({ status: "loading", data: null, retry: vi.fn() });

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".card-body")).toHaveTextContent(/loading/i);
    // The placeholder and the refreshing marker are mutually exclusive: this
    // is the state a param change lands in (useWidgetData clears `data` when
    // the key changes), and a dimmed, dotted title over a "Loading…" body
    // would claim stale rows are on screen when none are.
    expect(container.querySelector(".widget-card")).not.toHaveAttribute("data-refreshing");
  });

  it("keeps the last payload on screen while an auto-refresh refetches, rather than unmounting the renderer", () => {
    // Every auto-refresh tick puts this card back into "loading". Swapping
    // the renderer for "Loading…" and back destroys everything the renderer
    // holds that the payload does not: a chart's zoom/pan, a table's scroll
    // position and sort. On a 1-minute interval that is unusable.
    register();
    useWidgetData.mockReturnValue({
      status: "loading",
      data: [{ symbol: "AAPL", price: 187.25 }],
      retry: vi.fn(),
    });

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".card-body")).not.toHaveTextContent(/loading/i);
    // The table element, not a cell: TableRenderer virtualises its rows and
    // jsdom gives the scroll container no height, so no <td> is ever in the
    // DOM here. The renderer still being mounted -- with the payload's own
    // columns -- is the claim.
    expect(container.querySelector("table.widget-table")).toBeInTheDocument();
    expect(screen.getByText("symbol")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
  });

  it("marks a card refreshing over stale data, so a manual Refresh still shows it was heard", () => {
    register();
    useWidgetData.mockReturnValue({
      status: "loading",
      data: [{ symbol: "AAPL", price: 187.25 }],
      retry: vi.fn(),
    });

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".widget-card")).toHaveAttribute("data-refreshing", "true");
  });

  it("carries no refreshing marker once the answer has landed", () => {
    register();
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [{ symbol: "AAPL", price: 187.25 }],
      retry: vi.fn(),
    });

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".widget-card")).not.toHaveAttribute("data-refreshing");
  });

  it("closes the export menu on Escape", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Card menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // .widget-card clips its overflow, so a menu inside it was cut off at a
  // short card's bottom edge and covered by the card below.
  it("renders the export menu outside the card, so the card's clipping cannot cut it off", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));

    expect(container.querySelector(".widget-card")).not.toContainElement(screen.getByRole("menu"));
  });

  it("closes the export menu on a press outside it", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the export menu open for a press inside it, so a menu item can still be chosen", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    const menu = screen.getByRole("menu");

    await userEvent.pointer({ target: menu, keys: "[MouseLeft>]" });

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("shows a 'No data' body for a 204, not an error and not the raw view", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });

    const { container } = render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);

    expect(container.querySelector(".card-body")).toHaveTextContent(/no data for these parameters/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
  });

  it("returns the raw view before type dispatch when view is raw", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: { a: 1 }, retry: vi.fn() });

    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);

    expect(screen.getByTestId("raw-json")).toBeInTheDocument();
  });

  it("falls back to raw JSON for a type with no renderer", () => {
    // SP1's "chart" case is gone now that SP2 wires ChartRenderer to that
    // type (see the dispatch tests below); this exercises the default
    // branch with a type the switch genuinely does not recognise.
    register({ type: "future_type" });
    useWidgetData.mockReturnValue({ status: "ready", data: { a: 1 }, retry: vi.fn() });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByTestId("raw-json")).toBeInTheDocument();
  });

  it("shows no minimize button when the minimizeButton setting is off", () => {
    register();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /minimize/i })).not.toBeInTheDocument();
  });

  it("shows a minimize button and hides the card body when clicked, with the setting on", async () => {
    register();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, minimizeButton: true },
    });
    const setCardMinimized = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ setCardMinimized });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /minimize/i }));

    expect(setCardMinimized).toHaveBeenCalledWith("c1", true);
  });

  it("hides the card body, and the controls row, when the card's own minimized flag is true", () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, minimizeButton: true },
    });
    // The controls row needs a dashboard to read its groups from; the header
    // controls suite below renders the same setup unminimized and finds it.
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, params: { symbol: "AAPL" } }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
    const { container } = render(
      <WidgetCard card={{ ...card, params: { symbol: "AAPL" }, minimized: true }} onRemove={vi.fn()} />,
    );
    expect(container.querySelector(".card-body")).not.toBeInTheDocument();
    // The `!minimized` guard on the row is the only thing collapsing it: the
    // header itself still renders.
    expect(container.querySelector(".card-params")).not.toBeInTheDocument();
  });

  it("still shows the expand button for an already-minimized card even when the minimizeButton setting is off", () => {
    register();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, minimizeButton: false },
    });
    render(<WidgetCard card={{ ...card, minimized: true }} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: /expand card/i })).toBeInTheDocument();
  });

  it("round-trips the minimized flag through the real store into the button's accessible name", async () => {
    // WidgetCard reads `card.minimized` off its own prop rather than the
    // store, so a subscribing wrapper (mirroring how DashboardGrid hands it
    // a fresh card on every render) is needed to observe the round trip.
    register();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, minimizeButton: true },
    });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    function Wrapper() {
      const liveCard = useDashboardStore((s) =>
        s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
      );
      return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
    }

    render(<Wrapper />);

    await userEvent.click(screen.getByRole("button", { name: "Minimize card" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand card" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Expand card" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Minimize card" })).toBeInTheDocument();
    });
  });

  it("sets data-minimized on the card root when minimized, and omits it otherwise", () => {
    register();
    const { container: minimizedContainer } = render(
      <WidgetCard card={{ ...card, minimized: true }} onRemove={vi.fn()} />,
    );
    expect(minimizedContainer.querySelector(".widget-card")).toHaveAttribute(
      "data-minimized",
      "true",
    );

    const { container: normalContainer } = render(
      <WidgetCard card={{ ...card, minimized: false }} onRemove={vi.fn()} />,
    );
    expect(normalContainer.querySelector(".widget-card")).not.toHaveAttribute("data-minimized");
  });

  it("shows action icons directly, not behind a chevron, when collapseWidgetControls is off", () => {
    register();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /show widget controls/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove card/i })).toBeInTheDocument();
  });

  it("collapses action icons behind a chevron when collapseWidgetControls is on", () => {
    register();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapseWidgetControls: true },
    });
    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: /show widget controls/i })).toBeInTheDocument();
    expect(container.querySelector(".card-controls-collapsed")).toBeInTheDocument();
    // Verify the action buttons are still in the DOM (CSS-hidden, not unmounted)
    expect(screen.getByRole("button", { name: /remove card/i })).toBeInTheDocument();
  });

  it("toggles the chevron open and closed on click", async () => {
    register();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, collapseWidgetControls: true },
    });
    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const chevron = screen.getByRole("button", { name: /show widget controls/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".card-controls-open")).toBeInTheDocument();

    await userEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".card-controls-open")).not.toBeInTheDocument();
  });
});

describe("WidgetCard header controls", () => {
  it("renders a control per visible param in the header", () => {
    register({
      params: [
        { paramName: "symbol", label: "Symbol", type: "text" },
        { paramName: "provider", label: "Provider", type: "text", show: false },
      ],
    });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, params: { symbol: "AAPL" } }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    const { container } = render(
      <WidgetCard card={{ ...card, params: { symbol: "AAPL" } }} onRemove={vi.fn()} />,
    );

    expect(container.querySelector("header .card-params")).toContainElement(
      screen.getByLabelText("Symbol"),
    );
    expect(screen.queryByLabelText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Parameters \(/ })).toBeNull();
  });

  it("hands the hook the group-merged params, not the card's own", () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    const grouped = {
      ...card,
      params: { symbol: "AAPL" },
      bindings: [{ groupId: "g1", paramName: "symbol" }],
    };
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [grouped] }],
          groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "MSFT" }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={grouped} onRemove={vi.fn()} />);

    expect(useWidgetData).toHaveBeenCalledWith(grouped, { symbol: "MSFT" }, undefined);
  });

  it("hands the hook the card's OWN params when the dashboard has grouping disabled", () => {
    // groupsDisabled is the mirror of the test above: the group is still on
    // the dashboard — disabling is not deleting — but no card reads it.
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    const grouped = {
      ...card,
      params: { symbol: "AAPL" },
      bindings: [{ groupId: "g1", paramName: "symbol" }],
    };
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [grouped] }],
          groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "MSFT" }],
          groupsDisabled: true,
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={grouped} onRemove={vi.fn()} />);

    expect(useWidgetData).toHaveBeenCalledWith(grouped, { symbol: "AAPL" }, undefined);
  });

  it("does not refetch on re-render when nothing changed", () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    const c = { ...card, params: { symbol: "AAPL" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    const { rerender } = render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const first = useWidgetData.mock.calls.at(-1)![1];
    rerender(<WidgetCard card={c} onRemove={vi.fn()} />);
    const second = useWidgetData.mock.calls.at(-1)![1];

    expect(second).toBe(first);
  });

  it("keeps the params reference stable across a drag-only layout change", () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    const c = { ...card, params: { symbol: "AAPL" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    const { rerender } = render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const first = useWidgetData.mock.calls.at(-1)![1];

    // This is exactly what updateLayouts (src/stores/dashboardStore.ts) hands
    // every card on any drag or resize: a brand-new card object, but with
    // `params` and `groupIds` preserved by reference via `{ ...c, layout }`.
    const dragged = { ...c, layout: { x: 1, y: 0, w: 20, h: 9 } };
    rerender(<WidgetCard card={dragged} onRemove={vi.fn()} />);
    const second = useWidgetData.mock.calls.at(-1)![1];

    expect(second).toBe(first);
  });

  it("keeps another card's params reference stable when an unrelated card mutates", async () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });

    const card1: DashboardCard = { ...card, id: "c1", params: { symbol: "AAPL" } };
    const card2: DashboardCard = { ...card, id: "c2", params: { symbol: "MSFT" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card1, card2] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    function TwoCards() {
      const cards = useDashboardStore(
        (s) => s.dashboards.find((d) => d.id === s.activeId)!.tabs[0].cards,
      );
      return (
        <>
          {cards.map((c) => (
            <WidgetCard key={c.id} card={c} onRemove={vi.fn()} />
          ))}
        </>
      );
    }

    render(<TwoCards />);

    function paramsForCard2(): unknown {
      const calls = useWidgetData.mock.calls.filter(
        ([c]) => (c as DashboardCard).id === "c2",
      );
      return calls.at(-1)![1];
    }

    const before = paramsForCard2();

    // Touches only card1 — setCardView rebuilds the dashboard's top-level
    // object, but leaves card2's own array entry (and dashboard.groups)
    // referentially unchanged.
    await act(async () => {
      await useDashboardStore.getState().patchCardField("c1", "view", "raw");
    });

    const after = paramsForCard2();
    expect(after).toBe(before);
  });

  it("switches to the raw view and persists it", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Raw");

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].view).toBe("raw");
  });

  // The toggle's write was `void`ed, so a failed save escaped as an
  // unhandled rejection with nothing in the log.
  it("logs a failed view write rather than letting it escape", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    __failPath("dashboards/d1.json");

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Raw");

    await waitFor(() =>
      expect(__read("logs/bdobb.log") ?? "").toContain("failed to save the view for card c1"),
    );
  });

  // v9 (donor c8ad6a77, the Calendar view's 9.x backport): the donor's three
  // card-level calendar cases, on clean's card. Clean has drawn the view since
  // v4; these pin the store round trip and the range write path end to end.
  const dated = [
    { date: "2026-09-11 12:30:00", event: "CPI", previous: 333.92 },
    { date: "2026-09-10 12:30:00", event: "PPI", previous: 156.5 },
  ];

  // Subscribed to the store the way the app renders a card, so a view write
  // lands back on the props and the calendar actually mounts.
  function LiveCalendarCard() {
    const liveCard = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
    );
    return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
  }

  function seedCalendarStore() {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("renders the calendar for view: calendar and persists its state", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: dated, retry: vi.fn() });
    seedCalendarStore();

    render(<LiveCalendarCard />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "calendar");
    expect(await screen.findByTestId("cal-grid")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].calendar).toEqual({ unit: "week" });
  });

  it("pushes the visible range into start_date/end_date when the widget declares them", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.setSystemTime(new Date("2026-09-09T14:00:00Z"));
      register({
        params: [
          { paramName: "start_date", label: "Start", type: "date" },
          { paramName: "end_date", label: "End", type: "date" },
          { paramName: "country", label: "Country", type: "text" },
        ],
      });
      useWidgetData.mockReturnValue({ status: "ready", data: dated, retry: vi.fn() });
      seedCalendarStore();

      render(<LiveCalendarCard />);
      await user.selectOptions(screen.getByRole("combobox", { name: "View" }), "calendar");
      await vi.advanceTimersByTimeAsync(400);
      const params = useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params;
      expect(params.start_date).toBe("2026-07-27");
      expect(params.end_date).toBe("2026-11-01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch params for a widget without start_date/end_date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      register();
      useWidgetData.mockReturnValue({ status: "ready", data: dated, retry: vi.fn() });
      seedCalendarStore();

      render(<LiveCalendarCard />);
      await user.selectOptions(screen.getByRole("combobox", { name: "View" }), "calendar");
      await vi.advanceTimersByTimeAsync(400);
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.start_date).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps 'Raw' as a stable option and lets the select's value alone carry the state", async () => {
    // WidgetCard reads `view` straight off its `card` prop, so proving the
    // select's own value moves (not just the store) needs a render that is
    // actually subscribed to the store, the way the app always renders it.
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    function LiveCard() {
      const liveCard = useDashboardStore((s) =>
        s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
      );
      return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
    }

    render(<LiveCard />);
    const select = screen.getByRole("combobox", { name: "View" });
    expect(select).toHaveValue("");
    await userEvent.selectOptions(select, "Raw");
    expect(select).toHaveValue("raw");
    expect(screen.getByRole("option", { name: "Raw" })).toBeInTheDocument();
  });

  it("refreshes through the hook's retry", async () => {
    register();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(retry).toHaveBeenCalled();
  });
});

describe("WidgetCard Raw availability", () => {
  it("offers no Raw segment for a built-in card, which always reports data: null", () => {
    register({ backendId: "builtin", type: "note" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.queryByRole("option", { name: "Raw" })).not.toBeInTheDocument();
  });

  it("still offers Raw for an ordinary backend widget", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Raw" })).toBeInTheDocument();
  });
});

describe("WidgetCard renderer dispatch", () => {
  function setUp(widgetOver: Partial<WidgetDef>, data: unknown) {
    register(widgetOver);
    useWidgetData.mockReturnValue({ status: "ready", data, retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("dispatches pdf to the pdf renderer, ahead of a persisted view: raw", () => {
    // A csv-typed document, deliberately: it proves the dispatch reached
    // PdfRenderer without mounting PdfView, whose pdfjs-dist import cannot be
    // evaluated under jsdom (see PdfView.tsx' loadPdfjs comment).
    setUp({ type: "pdf" }, {
      content: "aGk=",
      data_format: { data_type: "csv", filename: "table.csv" },
    });

    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);

    expect(
      screen.getByText("table.csv: csv files are not displayable in this version."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
  });

  it("dispatches multi_file_viewer to the file renderer, ahead of both the no-data gate and a persisted view: raw", () => {
    // fetchesData is false for this type, so useWidgetData reports ready with
    // data: null -- the early return is what stops "No data for these
    // parameters." from claiming the card. No backend is configured in this
    // file, so the renderer issues no request at all.
    setUp({ type: "multi_file_viewer", params: [
      { paramName: "files", roles: ["fileSelector"], show: false, optionsEndpoint: "choices" },
    ] }, null);

    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);

    expect(screen.getByText("Choose documents in the rail.")).toBeInTheDocument();
    expect(screen.queryByText(/no data for these parameters/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
  });

  it("Refresh bumps the refreshKey a multi_file_viewer renderer sees, since it has no hook fetch to repeat", async () => {
    // The hook is mocked in this file, so it is given the same shape the real
    // one has -- retry bumps the attempt it returns (pinned for real in
    // useWidgetData.test.tsx). What is under test here is the wiring in
    // between: Refresh -> retry -> attempt -> the renderer's refreshKey.
    register({ type: "multi_file_viewer", params: [] });
    useWidgetData.mockImplementation(() => {
      const [attempt, setAttempt] = useState(0);
      return { status: "ready", data: null, retry: () => setAttempt((n) => n + 1), attempt };
    });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByTestId("refresh-key")).toHaveTextContent("0");

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByTestId("refresh-key")).toHaveTextContent("1");
  });

  it("adds the refresh epoch into the refreshKey, so a refresh-all reopens a multi_file_viewer's documents too", async () => {
    register({ type: "multi_file_viewer", params: [] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 2 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
      refreshEpoch: 0,
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByTestId("refresh-key")).toHaveTextContent("2");

    await act(async () => {
      useDashboardStore.getState().refreshAll();
    });

    expect(screen.getByTestId("refresh-key")).toHaveTextContent("3");
  });

  it("renders no view toggle for either document type: there is no second way to look at a PDF", () => {
    setUp({ type: "pdf" }, {
      content: "aGk=",
      data_format: { data_type: "csv", filename: "table.csv" },
    });
    const { unmount } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "View" })).not.toBeInTheDocument();
    unmount();

    setUp({ type: "multi_file_viewer", params: [] }, null);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "View" })).not.toBeInTheDocument();
  });

  it("still renders the view toggle for an ordinary table card", () => {
    setUp({ type: "table" }, [{ symbol: "AAPL" }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "View" })).toBeInTheDocument();
  });

  it("dispatches markdown to the markdown renderer", () => {
    setUp({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("offers a Chart mode when the rows carry a time column", () => {
    setUp({ type: "table" }, [{ date: "2026-01-02", value: 1 }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Chart" })).toBeInTheDocument();
  });

  it("offers a Chart mode when a text column can carry numeric columns", () => {
    setUp({ type: "table" }, [{ symbol: "AAPL", value: 1 }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Chart" })).toBeInTheDocument();
  });

  it("offers no Chart mode when the rows carry no axis with numbers to plot", () => {
    setUp({ type: "table" }, [{ symbol: "AAPL", name: "Apple" }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("option", { name: "Chart" })).not.toBeInTheDocument();
  });

  it("labels the default mode by the widget's own type", () => {
    setUp({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Markdown" })).toBeInTheDocument();
  });

  it("persists chart view and clears it when the default is chosen again", async () => {
    setUp({ type: "table" }, [{ date: "2026-01-02", value: 1 }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Chart");
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].view).toBe("chart");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Table");
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].view).toBeUndefined();
  });

  // The switch in WidgetCard.tsx's body() is what routes a widget's `type`
  // to its renderer. Swapping any of these cases (or dropping one) would
  // otherwise go undetected — nothing else here proves the type actually
  // reaches the renderer it's supposed to.
  it("dispatches chart to the chart renderer", () => {
    setUp({ type: "chart" }, { data: [{ type: "scatter", x: [1], y: [2] }], layout: {} });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByTestId("chart-plot")).toBeInTheDocument();
  });

  it("dispatches html to the html renderer", () => {
    setUp({ type: "html" }, "<p>hi</p>");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByTitle("Widget content")).toBeInTheDocument();
  });

  it("dispatches iframe to the iframe renderer", () => {
    setUp({ type: "iframe", endpoint: "https://example.com/page" }, null);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByTitle("Embedded page")).toHaveAttribute("src", "https://example.com/page");
  });

  it("dispatches metric to the metric renderer", () => {
    setUp({ type: "metric" }, { value: 42, label: "Answer" });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Answer")).toBeInTheDocument();
  });

  // A note never fetches (see fetchesData/useWidgetData), so its real data
  // is always null. Without the early return in body() that this guards,
  // the `data === null` gate meant for a real backend's 204 would catch
  // every note first and show "No data for these parameters" instead.
  it("dispatches note to the note renderer even though its data is null", () => {
    setUp({ type: "note" }, null);
    const noteCard = { ...card, params: { text: "hello" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [noteCard] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={noteCard} onRemove={vi.fn()} />);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByText(/no data for these parameters/i)).not.toBeInTheDocument();
  });

  it("commits a note edit through applyCardParams", async () => {
    setUp({ type: "note" }, null);
    const noteCard = { ...card, params: { text: "hello" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [noteCard] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={noteCard} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "hello" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "changed");
    await userEvent.tab();

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.text).toBe("changed");
  });

  it("offers Transposed for a table card with rows, and only then", () => {
    setUp({ type: "table" }, [{ symbol: "AAPL", price: 1 }]);
    const { unmount } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Transposed" })).toBeInTheDocument();
    unmount();

    setUp({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("option", { name: "Transposed" })).not.toBeInTheDocument();
  });

  it("renders the transposed grid with Field and the first column's values as headers, toolkit hidden", () => {
    setUp({ type: "table" }, [
      { symbol: "AAPL", price: 1, volume: 10 },
      { symbol: "MSFT", price: 2, volume: 20 },
    ]);
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, view: "transposed" }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "View" })).toHaveValue("transposed");
    expect(screen.getByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "AAPL" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "MSFT" })).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("volume")).toBeInTheDocument();
    // The ⌕ filter toggle belongs to the toolkit, which the plain grid has none of.
    expect(screen.queryByRole("button", { name: "Filter rows" })).not.toBeInTheDocument();
  });

  it("offers no Transposed option for an array-of-arrays payload", () => {
    // rowsOf accepts array elements; tableRows (what the transposed view
    // actually renders through) rejects them. Offering the option here would
    // dead-end in the empty state and disable every export.
    setUp({ type: "table" }, [
      [1, 2],
      [3, 4],
    ]);

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.queryByRole("option", { name: "Transposed" })).not.toBeInTheDocument();
  });

  it("draws the transposed headers in transposeRows' order, Field first", () => {
    // "2024"/"2025" are integer-like keys: read off a transposed row's own
    // keys they would enumerate ahead of Field. Column order comes from
    // Transposed.columns and nowhere else.
    setUp({ type: "table" }, [
      { year: 2024, v: 1 },
      { year: 2025, v: 2 },
    ]);

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Field",
      "2024",
      "2025",
    ]);
  });

  it("persists the transposed view through the same store path as chart", async () => {
    setUp({ type: "table" }, [{ symbol: "AAPL", price: 1 }]);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "View" }), "Transposed");

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].view).toBe("transposed");
  });

  it("shows the empty state when there is nothing to transpose", () => {
    setUp({ type: "table" }, [{ only: 1 }]);

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);

    expect(
      screen.getByText(NOTHING_TO_TRANSPOSE),
    ).toBeInTheDocument();
  });

});

describe("the website built-in", () => {
  it("frames the url param, not the widget endpoint", () => {
    register({ id: "website", backendId: "builtin", type: "iframe", endpoint: "" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    const c = { ...card, widgetId: "website", backendId: "builtin", params: { url: "https://example.com/" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    expect(screen.getByTitle("Embedded page")).toHaveAttribute("src", "https://example.com/");
  });
});

describe("the clock built-in", () => {
  it("dispatches a clock card to the clock renderer", () => {
    register({ id: "clock", backendId: "builtin", type: "clock", endpoint: "" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    const c = {
      ...card, widgetId: "clock", backendId: "builtin",
      params: { zones: "Europe/London" },
    };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.queryByText(/No data for these parameters/)).not.toBeInTheDocument();
  });
});

describe("the rss built-in", () => {
  /** Registers the built-in and puts one rss card on the active tab. */
  function setUpRss(params: Record<string, string>) {
    register({ id: "rss", backendId: "builtin", type: "rss", endpoint: "", params: [
      { paramName: "url", label: "Feed URL", type: "text", show: true },
      { paramName: "limit", label: "Items", type: "number", value: "20", show: true },
    ] });
    const c = { ...card, widgetId: "rss", backendId: "builtin", params };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    return c;
  }

  const props = () => JSON.parse(screen.getByTestId("rss-props").textContent!);

  it("passes the card's url and limit, ahead of the no-data gate", () => {
    // fetchesData is false for a built-in, so the hook reports ready with
    // data: null -- the early return is what stops "No data for these
    // parameters." from claiming the card.
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = setUpRss({ url: "https://wire.example/rss", limit: "5" });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    expect(props()).toMatchObject({ url: "https://wire.example/rss", limit: 5 });
    expect(screen.queryByText(/No data for these parameters/)).not.toBeInTheDocument();
  });

  it("falls back to an empty url and 20 items when the card stores neither", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = setUpRss({});

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    expect(props()).toMatchObject({ url: "", limit: 20 });
  });

  it("hands on the hook's resolved auto-refresh interval, so the feed polls like every other card", () => {
    useWidgetData.mockReturnValue({
      status: "ready", data: null, retry: vi.fn(), attempt: 0, intervalMs: 300_000,
    });
    const c = setUpRss({ url: "https://wire.example/rss" });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    expect(props().intervalMs).toBe(300_000);
  });

  it("Refresh bumps the refreshKey, since the card has no hook fetch to repeat", async () => {
    useWidgetData.mockImplementation(() => {
      const [attempt, setAttempt] = useState(0);
      return { status: "ready", data: null, retry: () => setAttempt((n) => n + 1), attempt };
    });
    const c = setUpRss({ url: "https://wire.example/rss" });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().refreshKey).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(props().refreshKey).toBe(1);
  });

  it("adds the refresh epoch in, so a refresh-all reloads the feed too", async () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = setUpRss({ url: "https://wire.example/rss" });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().refreshKey).toBe(0);

    await act(async () => {
      useDashboardStore.getState().refreshAll();
    });

    expect(props().refreshKey).toBe(1);
  });

  it("shows the feed even on a card persisted with view: raw, which has no payload to dump", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = setUpRss({ url: "https://wire.example/rss" });

    render(<WidgetCard card={{ ...c, view: "raw" }} onRemove={vi.fn()} />);

    expect(screen.getByTestId("rss-props")).toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
  });
});

describe("a persisted keys card", () => {
  it("shows the moved notice, never the raw payload, even with view: raw persisted", () => {
    register({ id: "keys", type: "keys" });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: { tier: 3, rows: [{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", value: "sk-SECRET" }] },
      retry: vi.fn(),
    });

    render(<WidgetCard card={{ ...card, widgetId: "keys", view: "raw" }} onRemove={vi.fn()} />);

    expect(screen.getByText("Provider keys moved to Settings.")).toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
    expect(screen.queryByText("sk-SECRET")).not.toBeInTheDocument();
    expect(screen.queryByText("Own key")).not.toBeInTheDocument();
  });

  it("offers no Raw segment for a keys card", () => {
    register({ id: "keys", type: "keys" });
    useWidgetData.mockReturnValue({ status: "ready", data: { tier: 1, rows: [] }, retry: vi.fn() });
    render(<WidgetCard card={{ ...card, widgetId: "keys" }} onRemove={vi.fn()} />);
    expect(screen.queryByRole("option", { name: /^raw$/i })).not.toBeInTheDocument();
  });
});

/**
 * Dispatch only. useWidgetData is mocked in this file, so the zero-request
 * assertion lives in useWidgetData.test.tsx against a real mock backend; what
 * is under test here is that the card says why it is empty instead of showing
 * a table, a raw dump, or "No data for these parameters."
 */
describe("a server-side row model (ssrm_table) card", () => {
  function setUpSsrm(type: string) {
    register({ type });
    useBackendsStore.setState({backends:[backend()]});
    // What the hook really reports for a type fetchesData refuses: ready,
    // with nothing fetched.
    useWidgetData.mockReturnValue({
      status: "ready",
      data: null,
      error: undefined,
      retry: vi.fn(),
    });
  }

  it.each([["ssrm_table"], ["table_ssrm"]])(
    "routes a %s card to LIVE server execution ahead of the no-data gate",
    (type) => {
      setUpSsrm(type);
      render(<WidgetCard card={card} onRemove={vi.fn()} />);
      // Both spellings name the canonical one: the reader is being told which
      // OpenBB feature is missing, not which string their manifest used.
      expect(screen.getByText(/LIVE · paged/)).toBeInTheDocument();
      expect(screen.queryByText(/No data for these parameters/)).not.toBeInTheDocument();
    },
  );

  it("routes a persisted raw view to server execution, never RawJsonView", () => {
    setUpSsrm("ssrm_table");
    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);
    expect(screen.getByText(/LIVE · paged/)).toBeInTheDocument();
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument();
  });

  it("offers an explicit reopen control for server requests", () => {
    setUpSsrm("ssrm_table");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", {name:"Reopen table"})).toBeInTheDocument();
  });

  it("offers no Raw segment, leaving the lone inert Default one a keys card also shows", () => {
    setUpSsrm("ssrm_table");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const toggle = screen.getByRole("combobox", { name: "View" });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^raw$/i })).not.toBeInTheDocument();
    // TYPE_LABELS is deliberately not extended, so the first segment falls
    // back to "Default". Inventing a label for a type the app refuses would
    // be the wrong kind of polish.
    expect(screen.getByRole("option", { name: "Default" })).toBeInTheDocument();
  });

  it("offers no Export, and no Quick actions, Columns or Reset columns: those sections stay gated on fetchesData, as they already are for keys, though the ⋯ menu itself is now always present", async () => {
    setUpSsrm("ssrm_table");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    // The menu is unconditional from Task 2 on -- every resolved widget gets
    // Rename/Maximize -- so what this test actually pins is that the
    // fetchesData-gated sections inside it are still absent for a refused
    // ssrm_table card.
    expect(screen.getByRole("button", { name: "Card menu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: /^Export/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Quick actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Columns/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset columns" })).not.toBeInTheDocument();
    // showsTable requires type === "table", so the filter-row toggle -- which
    // lives outside that menu -- is gone too.
    expect(screen.queryByRole("button", { name: "Filter rows" })).not.toBeInTheDocument();
  });

  it("keeps the ordinary header: the widget's title, and Maximize", () => {
    // A refused card is a normal card whose body says why it is empty.
    setUpSsrm("ssrm_table");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByText("Price History")).toHaveClass("card-title");
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
  });
});

describe("WidgetCard export menu", () => {
  function setUpExport(widgetOver: Partial<WidgetDef>, data: unknown) {
    register(widgetOver);
    useWidgetData.mockReturnValue({ status: "ready", data, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** The ⋯ menu, then its Export section — CSV/JSON/Excel live one level down. */
  const openMenu = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Export/ }));
  };

  it.each(["table", "chart", "metric", "markdown", "html"])(
    "offers an export menu on a %s card",
    async (type) => {
      setUpExport({ type }, [{ a: 1 }]);
      render(<WidgetCard card={card} onRemove={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Card menu" })).toBeInTheDocument();
    },
  );

  it.each([
    ["iframe", { type: "iframe", endpoint: "https://example.com/p" }],
    ["note", { type: "note", backendId: "builtin" }],
    ["clock", { type: "clock", backendId: "builtin" }],
    ["keys", { type: "keys" }],
    ["pdf", { type: "pdf" }],
    ["multi_file_viewer", { type: "multi_file_viewer", params: [] }],
    ["rss", { type: "rss", backendId: "builtin" }],
  ])("offers no export menu on a %s card", async (_label, over) => {
    const widgetOver = over as Partial<WidgetDef>;
    setUpExport(widgetOver, null);
    // The three builtin rows register their widget under backendId
    // "builtin", not the fixture card's own "b1" -- match it here so the
    // widget actually resolves and the test exercises canExport itself
    // rather than accidentally passing because no widget was found at all.
    const rowCard = widgetOver.backendId ? { ...card, backendId: widgetOver.backendId } : card;
    render(<WidgetCard card={rowCard} onRemove={vi.fn()} />);
    // The ⋯ menu itself is unconditional from Task 2 on -- what this test
    // pins is that canExport being false for these types still hides the
    // Export section inside it.
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: /^Export/ })).not.toBeInTheDocument();
  });

  it("disables CSV and Excel, and says why, for a payload that is not tabular", async () => {
    setUpExport({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();

    const csv = screen.getByRole("menuitem", { name: "CSV" });
    const excel = screen.getByRole("menuitem", { name: "Excel" });
    expect(csv).toBeDisabled();
    expect(excel).toBeDisabled();
    expect(csv).toHaveAttribute("title", "Only JSON export is available for this payload");
    expect(excel).toHaveAttribute("title", "Only JSON export is available for this payload");
    expect(screen.getByRole("menuitem", { name: "JSON" })).toBeEnabled();
  });

  it("disables JSON along with CSV and Excel when the transposed view has nothing to transpose", async () => {
    setUpExport({ type: "table" }, [{ only: 1 }]);

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);
    await openMenu();

    const csv = screen.getByRole("menuitem", { name: "CSV" });
    const json = screen.getByRole("menuitem", { name: "JSON" });
    const excel = screen.getByRole("menuitem", { name: "Excel" });
    expect(csv).toBeDisabled();
    expect(json).toBeDisabled();
    expect(excel).toBeDisabled();
    // Its own reason, not NON_TABULAR_TITLE: "Only JSON export is available"
    // would be a lie on a card where JSON is disabled too.
    expect(csv).toHaveAttribute("title", "Nothing to transpose");
    expect(json).toHaveAttribute("title", "Nothing to transpose");
    expect(excel).toHaveAttribute("title", "Nothing to transpose");
  });

  it("ignores a transposed view on a card type that cannot transpose: it renders and exports normally", async () => {
    // A stray `view: "transposed"` -- a hand-edited dashboard, or a widget
    // re-registered under another type -- must not cost a markdown card its
    // JSON export for a view it never shows.
    setUpExport({ type: "markdown" }, "## Hello");

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    await openMenu();
    const json = screen.getByRole("menuitem", { name: "JSON" });
    expect(json).toBeEnabled();
    expect(json).not.toHaveAttribute("title");
  });

  it("disables every item, JSON included, when there is no payload at all", async () => {
    setUpExport({ type: "table" }, null);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();

    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "JSON" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Excel" })).toBeDisabled();
  });

  it("heads CSV columns with the widget's columnsDefs headerName, and keeps JSON on field keys", async () => {
    setUpExport(
      { type: "table", table: { columns: [{ field: "date" }, { field: "RPI", headerName: "Real Personal Income" }] } } as Partial<WidgetDef>,
      [{ date: "2026-01-01", RPI: 1.5 }],
    );
    vi.mocked(save).mockResolvedValue("/tmp/rpi.csv");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));
    await waitFor(() => expect(__read("/tmp/rpi.csv")).toBe("date,Real Personal Income\r\n2026-01-01,1.5"));

    vi.mocked(save).mockResolvedValue("/tmp/rpi.json");
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "JSON" }));
    await waitFor(() => expect(__read("/tmp/rpi.json")).toContain('"RPI": 1.5'));
  });

  it("writes RFC-4180 CSV of the RAW values to the path the save dialog returned", async () => {
    // 2300000, not the "2.3M" the table cell shows: formatCell is a view
    // concern and must never reach an export.
    setUpExport({ type: "table" }, [
      { symbol: "AAPL", volume: 2_300_000 },
      { symbol: "MSFT", volume: 1_500 },
    ]);
    vi.mocked(save).mockResolvedValue("/tmp/out.csv");

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() => expect(__read("/tmp/out.csv")).toBeDefined());
    expect(__read("/tmp/out.csv")).toBe("symbol,volume\r\nAAPL,2300000\r\nMSFT,1500");
    expect(vi.mocked(save).mock.calls[0][0]).toEqual(
      expect.objectContaining({ defaultPath: expect.stringMatching(/^Price History .*\.csv$/) }),
    );
  });

  it("exports the transposed rows when the transposed view is showing", async () => {
    // The rows handed to toCsv are the transposed ones, in transposeRows'
    // explicit column order -- Field first, never the payload's own columns.
    setUpExport({ type: "table" }, [{ symbol: "AAPL", price: 1 }]);
    vi.mocked(save).mockResolvedValue("/tmp/out.csv");

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() => expect(__read("/tmp/out.csv")).toBeDefined());
    expect(__read("/tmp/out.csv")).toBe("Field,AAPL\r\nprice,1");
  });

  it("exports the transposed rows as JSON too, in transposeRows' column order", async () => {
    // JSON follows the view exactly like CSV/Excel now (spec D5): the
    // transposed rows in transposeRows' explicit column order, not the raw
    // payload -- and not the row's own key order either. A "2024" header is
    // an integer-like key, which JS enumerates BEFORE "Field" whatever the
    // insertion order, so this is asserted on the written TEXT: toEqual is
    // key-order-blind and would pass either way.
    setUpExport({ type: "table" }, [{ year: 2024, v: 1 }]);
    vi.mocked(save).mockResolvedValue("/tmp/out.json");

    render(<WidgetCard card={{ ...card, view: "transposed" }} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "JSON" }));

    await waitFor(() => expect(__read("/tmp/out.json")).toBeDefined());
    expect(__read("/tmp/out.json")).toBe('[\n  {\n    "Field": "v",\n    "2024": 1\n  }\n]');
  });

  it("writes xlsx BYTES for the Excel item, through writeFile rather than writeTextFile", async () => {
    setUpExport({ type: "table" }, [{ a: 1 }]);
    vi.mocked(save).mockResolvedValue("/tmp/out.xlsx");

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Excel" }));

    await waitFor(() => expect(__readBytes("/tmp/out.xlsx")).toBeDefined());
    expect([...__readBytes("/tmp/out.xlsx")!]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Not the text writer: a workbook is not text, and writeTextFile would
    // mangle it.
    expect(__read("/tmp/out.xlsx")).toBeUndefined();
  });

  it("writes pretty JSON for the JSON item", async () => {
    setUpExport({ type: "table" }, { a: 1 });
    vi.mocked(save).mockResolvedValue("/tmp/out.json");

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "JSON" }));

    await waitFor(() => expect(__read("/tmp/out.json")).toBe('{\n  "a": 1\n}'));
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    setUpExport({ type: "table" }, [{ a: 1 }]);
    vi.mocked(save).mockResolvedValue(null);

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(__writes()).toEqual([]);
    expect(screen.queryByText(/export failed/i)).not.toBeInTheDocument();
  });

  it("shows a notice and logs the failure, without ever logging the data", async () => {
    setUpExport({ type: "table" }, [{ symbol: "AAPL", secret_looking_value: "ROW-CONTENT" }]);
    vi.mocked(save).mockRejectedValue(new Error("disk full"));

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() =>
      expect(screen.getByText("Export failed: disk full")).toBeInTheDocument(),
    );
    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain('widget Price History export failed: disk full');
      expect(log).not.toContain("ROW-CONTENT");
      expect(log).not.toContain("AAPL");
    });
  });

  it("cannot let a backend's widget name forge a line in the log", async () => {
    // The name comes from whatever backend the user added, not from this app
    // -- a newline in it would end the log line early and write a second one
    // of the attacker's choosing, in a file read on the user's machine to
    // work out what went wrong.
    setUpExport({ type: "table", name: "Prices\n2026-01-01T00:00:00.000Z INFO all clear" }, [
      { a: 1 },
    ]);
    vi.mocked(save).mockRejectedValue(new Error("disk full"));

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("export failed: disk full");
      // One line: the forged one never begins. Its TEXT survives inline,
      // where it is plainly part of a widget's name -- the line structure is
      // the channel being closed here, not the words.
      expect(log.trimEnd().split("\n")).toHaveLength(1);
    });
  });

  it("closes the menu once an item has been chosen", async () => {
    setUpExport({ type: "table" }, [{ a: 1 }]);
    vi.mocked(save).mockResolvedValue("/tmp/out.csv");

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("an imported card whose widget is on no connected backend", () => {
  const orphan: DashboardCard = makeCard({
    id: "c9",
    widgetId: "nowhere",
    backendId: UNRESOLVED_BACKEND_ID,
  });

  it("says so by name instead of the generic waiting placeholder", () => {
    useWidgetData.mockReturnValue({ status: "unresolved", data: null, retry: vi.fn() });

    render(<WidgetCard card={orphan} onRemove={vi.fn()} />);

    expect(
      screen.getByText("Widget nowhere is not on any connected backend."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Waiting for widget…")).not.toBeInTheDocument();
  });

  it("leaves an ordinary unresolved card's placeholder alone", () => {
    useWidgetData.mockReturnValue({ status: "unresolved", data: null, retry: vi.fn() });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByText("Waiting for widget…")).toBeInTheDocument();
  });
});

describe("WidgetCard in viewer mode", () => {
  it("hides Remove and Minimize, and keeps Refresh and the param controls", () => {
    register({ params: [{ paramName: "symbol", label: "Symbol" }] });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, minimizeButton: true } });
    // The controls row reads the card's dashboard for its groups, so the
    // viewer needs one seeded to render the row at all.
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={card} viewer onRemove={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Remove card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Minimize card" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByLabelText("Symbol")).toBeInTheDocument();
  });

  it("still expands a card saved minimized, and writes nothing doing it", async () => {
    // A card persisted with minimized: true would otherwise be stuck showing
    // only its header, with no control in the viewer to open it. The toggle is
    // safe here because the store's viewer guard applies it in memory and
    // skips the write — which is the second half of what this asserts.
    register();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, minimizeButton: true } });
    useDashboardStore.setState({
      viewer: true,
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, minimized: true }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    // Subscribes, mirroring how DashboardGrid hands the card down fresh on
    // every render, so the in-memory toggle is observable.
    function Wrapper() {
      const liveCard = useDashboardStore((s) =>
        s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
      );
      return liveCard ? <WidgetCard card={liveCard} viewer onRemove={vi.fn()} /> : null;
    }

    const { container } = render(<Wrapper />);
    expect(container.querySelector(".card-body")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand card" }));

    await waitFor(() => {
      expect(container.querySelector(".card-body")).not.toBeNull();
    });
    // Expanded, and now offering no way back down: Minimize stays out of the
    // viewer.
    expect(screen.queryByRole("button", { name: "Minimize card" })).not.toBeInTheDocument();
    // The store applied the toggle in memory and logged its own
    // "viewer-no-write" line, so `logs/bdobb.log` is the one write there is —
    // no dashboard file was touched.
    expect(__writes().filter((f) => f.startsWith("dashboards/"))).toEqual([]);
  });

  it("offers a period control's Relative tab read-only: chips and Apply, but no Save as preset and no ×", async () => {
    // The viewer's store refuses both preset writes and only logs it, so a
    // Save here would look as if it worked. The tab itself stays: a chip still
    // loads its rows and Apply still commits the card's own value.
    register({ params: [{ paramName: "quarter", label: "Quarter", type: "quarter" }] });
    const quarterCard: DashboardCard = { ...card, params: { quarter: "2026-Q3" } };
    useDashboardStore.setState({
      viewer: true,
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [quarterCard] }],
          presets: [{ name: "Mine", expr: "Q-1" }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={quarterCard} viewer onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Relative" }));

    expect(screen.getByRole("button", { name: "Mine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save as preset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete preset Mine" })).not.toBeInTheDocument();
  });

  it("still offers both in the main window", () => {
    register();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, minimizeButton: true } });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize card" })).toBeInTheDocument();
  });
});

describe("WidgetCard hands the table renderer the widget's columnsDefs", () => {
  it("renders the spec's headerName instead of the raw field name", () => {
    // jsdom gives the scroll container no height, so no <td> is ever
    // rendered here (see TableRenderer.test.tsx' stubs) — the header row is
    // what proves the spec arrived.
    register({
      type: "table",
      table: {
        columns: [{ field: "close", headerName: "Close", prefix: "$" }],
      },
    });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [{ symbol: "AAPL", close: 190.5 }],
      retry: vi.fn(),
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByText("$Close")).toBeInTheDocument();
    expect(screen.queryByText("close")).not.toBeInTheDocument();
    // The data-only field keeps its raw name.
    expect(screen.getByText("symbol")).toBeInTheDocument();
  });

  it("leaves a widget with no table spec rendering its raw field names", () => {
    register({ type: "table" });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [{ symbol: "AAPL", close: 190.5 }],
      retry: vi.fn(),
    });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByText("close")).toBeInTheDocument();
    expect(screen.getByText("symbol")).toBeInTheDocument();
  });
});

describe("WidgetCard persists the table toolkit's state", () => {
  function setUpTable() {
    register({ type: "table" });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [
        { symbol: "AAPL", close: 190.5 },
        { symbol: "MSFT", close: 410.25 },
      ],
      retry: vi.fn(),
    });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** Subscribes, mirroring how DashboardGrid hands the card down each render. */
  function Wrapper() {
    const liveCard = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
    );
    return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
  }

  it("writes a sort onto the card and renders the round trip", async () => {
    setUpTable();
    render(<Wrapper />);

    await userEvent.click(screen.getByRole("columnheader", { name: /close/i }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual({
        sorting: [{ id: "close", desc: false }],
      });
    });
  });

  it("renders a card that arrives already carrying a persisted order", () => {
    setUpTable();
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [
            {
              id: "t1",
              name: "Main",
              cards: [{ ...card, table: { columnOrder: ["close", "symbol"] } }],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<Wrapper />);

    expect(
      screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field")),
    ).toEqual(["close", "symbol"]);
  });

  it("writes nothing to disk from the viewer window", async () => {
    setUpTable();
    useDashboardStore.setState({ viewer: true });

    render(<Wrapper />);
    await userEvent.click(screen.getByRole("columnheader", { name: /close/i }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual({
        sorting: [{ id: "close", desc: false }],
      });
    });
    expect(__writes().filter((f) => f.startsWith("dashboards/"))).toEqual([]);
  });
});
describe("WidgetCard table toolkit controls", () => {
  const tableData = [
    { symbol: "AAPL", close: 190.5 },
    { symbol: "MSFT", close: 410.25 },
  ];

  function setUpToolkit(over: Partial<WidgetDef> = {}, data: unknown = tableData) {
    register({ type: "table", ...over });
    useWidgetData.mockReturnValue({ status: "ready", data, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** Subscribes, so a store write is visible in the next render. */
  function Wrapper() {
    const liveCard = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
    );
    return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
  }

  const openCardMenu = () => userEvent.click(screen.getByRole("button", { name: "Card menu" }));

  it("toggles the filter row from the card header", async () => {
    setUpToolkit();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Filter rows" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("tr.filter-row")).toBeNull();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("tr.filter-row")).not.toBeNull();
  });

  it("offers no filter toggle on a card that is not showing a table", () => {
    setUpToolkit({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Filter rows" })).not.toBeInTheDocument();
  });

  it("offers no filter toggle while a table card is showing the raw view", () => {
    setUpToolkit();
    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Filter rows" })).not.toBeInTheDocument();
  });

  it("keeps the export items working, one level down, and adds Quick actions and Columns", async () => {
    setUpToolkit();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openCardMenu();

    expect(screen.getByRole("menuitem", { name: /^Export/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Quick actions/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Columns/ })).toBeInTheDocument();
    // Collapsed until asked for.
    expect(screen.queryByRole("menuitem", { name: "CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset columns" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: /^Quick actions/ }));
    expect(screen.getByRole("menuitem", { name: "Autosize columns" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset columns" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: /^Export/ }));
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
  });

  it("offers only Export on a card that is not showing a table", async () => {
    setUpToolkit({ type: "markdown" }, "## Hello");
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openCardMenu();

    expect(screen.getByRole("menuitem", { name: /^Export/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Quick actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Columns/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset columns" })).not.toBeInTheDocument();
  });

  it("lists the columns in the current order, with the spec's header names", async () => {
    setUpToolkit({
      table: { columns: [{ field: "close", headerName: "Close" }, { field: "symbol" }] },
    });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    await openCardMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /^Columns/ }));

    expect(screen.getAllByRole("menuitemcheckbox").map((b) => b.textContent?.trim())).toEqual([
      "☑ Close",
      "☑ symbol",
    ]);
  });

  it("hides a column from the checklist and persists it", async () => {
    setUpToolkit();
    render(<Wrapper />);
    await openCardMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /^Columns/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /close/ }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual({
        hidden: ["close"],
      });
    });
    expect(
      screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field")),
    ).toEqual(["symbol"]);
    expect(screen.getByRole("menuitemcheckbox", { name: /close/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows a column the spec ships hidden, and persists the empty hidden list", async () => {
    setUpToolkit({
      table: { columns: [{ field: "symbol" }, { field: "close", hide: true }] },
    });
    render(<Wrapper />);
    expect(
      screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field")),
    ).toEqual(["symbol"]);

    await openCardMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /^Columns/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /close/ }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual({
        hidden: [],
      });
    });
    expect(
      screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field")),
    ).toEqual(["symbol", "close"]);
  });

  it("Reset columns (Quick actions ▸) removes the whole field and puts the table back", async () => {
    setUpToolkit();
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [
            {
              id: "t1",
              name: "Main",
              cards: [
                {
                  ...card,
                  table: {
                    hidden: ["close"],
                    columnOrder: ["close", "symbol"],
                    sorting: [{ id: "symbol", desc: true }],
                    widths: { symbol: 300 },
                    pinned: { symbol: "left" },
                  },
                },
              ],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<Wrapper />);
    await openCardMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /^Quick actions/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reset columns" }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0]).not.toHaveProperty(
        "table",
      );
    });
    const headers = screen.getAllByRole("columnheader") as HTMLElement[];
    expect(headers.map((th) => th.getAttribute("data-field"))).toEqual(["symbol", "close"]);
    // Remounted, so the once-seeded 300px width is back to TanStack's default.
    expect(headers[0].style.width).toBe("150px");
    // The pins go with the rest of it: this widget's spec pins nothing.
    expect(document.querySelector('th[data-field="symbol"]')).not.toHaveClass("pin-left");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("WidgetCard cell-click grouping", () => {
  const clickRows = [{ symbol: "AAPL", price: 187.25 }];

  /**
   * Dashboard writes only -- the logger writes to memfs too. jsonStore.saveJson
   * writes a `<path>.tmp.<nonce>.<n>` file and renames it, and only the
   * writeTextFile is recorded, so these are temp names: what they COUNT is one
   * save per click, which is the claim. Same filter as the viewer tests above.
   */
  const dashboardWrites = () => __writes().filter((f) => f.startsWith("dashboards/"));

  /**
   * A table card that declares `symbol`, plus a sibling that declares it too.
   * `groups` is passed through verbatim, so a test can put both cards in one
   * ParamGroup or leave the dashboard with none at all.
   */
  function seed({
    params = [{ paramName: "symbol", label: "Symbol", type: "text" }] as WidgetDef["params"],
    groups,
    groupIds,
  }: {
    params?: WidgetDef["params"];
    groups?: Array<{ id: string; name: string; paramName: string; groupType: string; value: string }>;
    groupIds?: string[];
  }) {
    register({ params });
    const bindings = groupIds?.map((groupId) => ({ groupId, paramName: "symbol" }));
    const source: DashboardCard = { ...card, id: "c1", params: { symbol: "AAPL" }, bindings };
    const sibling: DashboardCard = { ...card, id: "c2", params: { symbol: "AAPL" }, bindings };
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [source, sibling] }],
          groups,
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
    return { source, sibling };
  }

  /** Both cards, reading themselves out of the store so a write re-renders them. */
  function TwoCards() {
    const cards = useDashboardStore(
      (s) => s.dashboards.find((d) => d.id === s.activeId)!.tabs[0].cards,
    );
    return (
      <>
        {cards.map((c) => (
          <WidgetCard key={c.id} card={c} onRemove={vi.fn()} />
        ))}
      </>
    );
  }

  /** The latest params the hook was handed for one card. */
  function paramsFor(id: string): unknown {
    return useWidgetData.mock.calls.filter(([c]) => (c as DashboardCard).id === id).at(-1)![1];
  }

  it("writes the GROUP value once, and the sibling's effective params follow", async () => {
    seed({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
    });
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry: vi.fn() });
    render(<TwoCards />);

    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].groups![0].value).toBe("MSFT");
    });
    // The GROUP holds the value; the card's own stored param is untouched --
    // that is the whole point of splitParamEdit, and writing both would make
    // the card's copy stale the moment the group moved again.
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe("AAPL");
    // The sibling never rendered a cell and was never clicked; its effective
    // params changed because the group did.
    await waitFor(() => expect(paramsFor("c2")).toEqual({ symbol: "MSFT" }));
    // One click, one dashboard save.
    expect(dashboardWrites()).toHaveLength(1);
  });

  it("writes the card's own param when it is in no group", async () => {
    seed({});
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry: vi.fn() });
    render(<TwoCards />);

    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe("MSFT");
    });
    // No group, so no propagation: explicit groups are the only fan-out.
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].params.symbol).toBe("AAPL");
    expect(dashboardWrites()).toHaveLength(1);
  });

  it("refuses a param the widget does not declare, writes nothing, and logs one line", async () => {
    seed({ params: [] });
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry: vi.fn() });
    render(<TwoCards />);

    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("cell click for undeclared param symbol on c1");
      // The parameter name and the card id, never the clicked VALUE: a cell
      // carries whatever the backend holds.
      expect(log).not.toContain("MSFT");
    });
    expect(dashboardWrites()).toEqual([]);
  });

  it("refetches the source card after the write when forceUpdate is set", async () => {
    Object.assign(cellClick, { forceUpdate: true, value: "AAPL" });
    seed({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
    });
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry });
    render(<TwoCards />);

    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    // The clicked value is the one the group already holds, so nothing this
    // card fetches with changed -- retry() is the only thing that can refresh
    // it, which is exactly what forceUpdate is for.
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it("does NOT refetch when forceUpdate is false and the params did not change", async () => {
    Object.assign(cellClick, { forceUpdate: false, value: "AAPL" });
    seed({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
    });
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry });
    render(<TwoCards />);

    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    await waitFor(() => expect(dashboardWrites()).toHaveLength(1));
    expect(retry).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards[0].groups![0].value).toBe("AAPL");
  });

  it("commits nothing at all when the clicked cell was empty", async () => {
    // forceUpdate is true on purpose: the guard sits ahead of the refetch, so
    // not even that runs. A null cell must not CLEAR the parameter -- a
    // cleared grouped `symbol` would 422 every member of the group.
    Object.assign(cellClick, { value: "", forceUpdate: true });
    seed({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
    });
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: clickRows, retry });
    render(<TwoCards />);

    // The guard returns before the handler's first await, so userEvent.click
    // having flushed is enough -- there is no pending write to wait for.
    await userEvent.click(screen.getAllByRole("button", { name: "Click cell" })[0]);

    expect(dashboardWrites()).toEqual([]);
    expect(retry).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards[0].groups![0].value).toBe("AAPL");
    // Silent: an empty cell is data, not a misconfiguration. The undeclared
    // guard is the only thing in this handler that ever writes a log line.
    expect(__read("logs/bdobb.log")).toBeUndefined();
  });
});

describe("WidgetCard sendToAgent", () => {
  beforeEach(() => {
    register({ type: "table" });
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
  });

  it("pins the pane and puts the row in the draft, unsent, when a sendToAgent cell is clicked", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    const send = vi.fn();
    useChatStore.setState({ send, pinned: false });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Send row" }));

    expect(useChatStore.getState()).toMatchObject({ pinned: true, pendingMessage: "row text" });
    expect(send).not.toHaveBeenCalled();
  });

  // Review U3: the row is card data, gated like every other share.
  it("offers no Send row button with Context sharing off", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: false } });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send row" })).not.toBeInTheDocument();
  });

  it("offers no Send row button with no Rita URL", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "" } });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send row" })).not.toBeInTheDocument();
  });

  it("offers no Send row button in a viewer window", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} viewer />);
    expect(screen.queryByRole("button", { name: "Send row" })).not.toBeInTheDocument();
  });
});

describe("WidgetCard rename", () => {
  /** One card on one dashboard, read back out of the store so a write re-renders it. */
  function seed(over: Partial<DashboardCard> = {}) {
    register();
    useDashboardStore.setState({
      dashboards: [
        { id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...card, ...over }] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  function LiveCard() {
    const liveCard = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
    );
    return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
  }

  const storedCard = () =>
    useDashboardStore.getState().dashboards[0].tabs[0].cards.find((c) => c.id === "c1")!;

  it("shows the widget's name, with no tooltip and no custom class, when there is no override", () => {
    seed();
    render(<LiveCard />);

    const title = screen.getByText("Price History");
    expect(title).toHaveClass("card-title");
    expect(title).not.toHaveClass("card-title-custom");
    // A tooltip repeating the text it is over would be noise.
    expect(title).not.toHaveAttribute("title");
  });

  it("shows the override instead, with the widget's own name as the tooltip", () => {
    seed({ title: "AAPL daily" });
    render(<LiveCard />);

    const title = screen.getByText("AAPL daily");
    expect(title).toHaveClass("card-title", "card-title-custom");
    // The original is still reachable: a renamed card must not become a
    // mystery about which widget it is showing.
    expect(title).toHaveAttribute("title", "Price History");
    expect(screen.queryByText("Price History")).toBeNull();
  });

  it("renames from the ⋯ menu and persists the title through the real store", async () => {
    seed();
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));

    // The field opens on the effective title, and the menu closes with it.
    const field = screen.getByRole("textbox", { name: "Card title" });
    expect(field).toHaveValue("Price History");
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.clear(field);
    await userEvent.type(field, "AAPL daily{Enter}");

    await waitFor(() => expect(storedCard().title).toBe("AAPL daily"));
    expect(screen.getByText("AAPL daily")).toHaveClass("card-title-custom");
  });

  it("double-clicking the title starts the same rename", async () => {
    seed();
    render(<LiveCard />);

    await userEvent.dblClick(screen.getByText("Price History"));

    expect(screen.getByRole("textbox", { name: "Card title" })).toHaveValue("Price History");
  });

  it("clears the override when the committed title is the widget's own name", async () => {
    seed({ title: "AAPL daily" });
    render(<LiveCard />);

    await userEvent.dblClick(screen.getByText("AAPL daily"));
    const field = screen.getByRole("textbox", { name: "Card title" });
    await userEvent.clear(field);
    await userEvent.type(field, "Price History{Enter}");

    // Removed, not stored: the card follows the widget again, so a manifest
    // rename still reaches it.
    await waitFor(() => expect(storedCard()).not.toHaveProperty("title"));
    expect(screen.getByText("Price History")).not.toHaveClass("card-title-custom");
  });

  it("cancels on Escape, writing nothing and putting the title back", async () => {
    seed({ title: "AAPL daily" });
    render(<LiveCard />);

    await userEvent.dblClick(screen.getByText("AAPL daily"));
    await userEvent.type(screen.getByRole("textbox", { name: "Card title" }), "typed{Escape}");

    expect(screen.queryByRole("textbox", { name: "Card title" })).toBeNull();
    expect(screen.getByText("AAPL daily")).toHaveClass("card-title");
    expect(storedCard().title).toBe("AAPL daily");
    expect(__writes().filter((f) => f.startsWith("dashboards/"))).toEqual([]);
  });

  it("treats an emptied field as a cancel, never as an empty title", async () => {
    // InlineRename already reports an empty commit as a cancel, so the card
    // never sees "" -- and a card titled "" would be a header with no name.
    seed({ title: "AAPL daily" });
    render(<LiveCard />);

    await userEvent.dblClick(screen.getByText("AAPL daily"));
    const field = screen.getByRole("textbox", { name: "Card title" });
    await userEvent.clear(field);
    await userEvent.type(field, "{Enter}");

    expect(storedCard().title).toBe("AAPL daily");
    expect(screen.getByText("AAPL daily")).toBeInTheDocument();
  });
});

describe("WidgetCard maximize", () => {
  function seed(over: Partial<DashboardCard> = {}) {
    register();
    useDashboardStore.setState({
      dashboards: [
        { id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...card, ...over }] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  function LiveCard() {
    const liveCard = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards.find((c) => c.id === "c1"),
    );
    return liveCard ? <WidgetCard card={liveCard} onRemove={vi.fn()} /> : null;
  }

  const maximizedId = () => useDashboardStore.getState().maximizedCardId;

  // A toggle button keeps one name and flips aria-pressed; flipping the name
  // too made a screen reader say "Restore, pressed" for a maximized card.
  it("toggles the store's maximizedCardId from the header button, by aria-pressed under one name", async () => {
    seed();
    render(<LiveCard />);

    const button = () => screen.getByRole("button", { name: "Maximize" });
    expect(button()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button());

    await waitFor(() => expect(maximizedId()).toBe("c1"));
    expect(button()).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(button());

    await waitFor(() => expect(maximizedId()).toBeNull());
  });

  it("opens the ⋯ menu on its first item and moves through the items with the arrow keys", async () => {
    seed();
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("toggles from the ⋯ menu too", async () => {
    seed();
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Maximize" }));

    await waitFor(() => expect(maximizedId()).toBe("c1"));
    // The menu closes with it, like Rename… -- the card underneath has just
    // moved, and a menu left open would be anchored over the new position.
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Restore" }));

    await waitFor(() => expect(maximizedId()).toBeNull());
  });

  it("toggles on a double-click of the header background, but not of the title", async () => {
    seed();
    const { container } = render(<LiveCard />);

    // The title renames; only the background maximizes.
    await userEvent.dblClick(screen.getByText("Price History"));
    expect(maximizedId()).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.dblClick(container.querySelector(".card-header")!);

    await waitFor(() => expect(maximizedId()).toBe("c1"));
  });

  it("does not maximize when a header BUTTON is double-clicked", async () => {
    // Refresh is the plainest one: double-clicking it must refresh twice and
    // do nothing else.
    seed();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    render(<LiveCard />);

    await userEvent.dblClick(screen.getByRole("button", { name: "Refresh" }));

    expect(retry).toHaveBeenCalledTimes(2);
    expect(maximizedId()).toBeNull();
  });

  it("restores on Escape while maximized, and listens for it only then", async () => {
    seed();
    render(<LiveCard />);

    // Nothing is maximized: Escape must not reach a listener at all.
    await userEvent.keyboard("{Escape}");
    expect(maximizedId()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(maximizedId()).toBe("c1"));

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(maximizedId()).toBeNull());
  });

  it("lets an open ⋯ menu take the Escape first, and restores on the next one", async () => {
    seed();
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(maximizedId()).toBe("c1"));
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    // One press, one thing: the innermost open surface closes and the card is
    // still maximized underneath it.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(maximizedId()).toBe("c1");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(maximizedId()).toBeNull());
  });

  it("un-minimizes a minimized card when it is maximized", async () => {
    // Exclusive: a maximized card that is still a header bar would fill the
    // dashboard with nothing. The un-minimize is the ordinary persisted flip.
    seed({ minimized: true });
    const { container } = render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Maximize" }));

    await waitFor(() => expect(maximizedId()).toBe("c1"));
    await waitFor(() =>
      expect(
        useDashboardStore.getState().dashboards[0].tabs[0].cards[0].minimized,
      ).toBe(false),
    );
    // The body is back and the Expand button is gone. NOT "Minimize card" is
    // now shown: the minimizeButton setting is off by default, and Expand only
    // ever appeared because the card was minimized.
    expect(screen.queryByRole("button", { name: "Expand card" })).toBeNull();
    expect(container.querySelector(".card-body")).not.toBeNull();
  });

  it("finishes the un-minimize BEFORE it maximizes", async () => {
    // Order, not just outcome. A card that went fixed-position while still
    // collapsed would stretch a bare header bar across the whole dashboard
    // for as long as the persisted un-minimize took to land. "un-minimized"
    // is pushed once setCardMinimized RESOLVES, so this fails if the await
    // is dropped as well as if the two calls are swapped.
    seed({ minimized: true });
    const order: string[] = [];
    useDashboardStore.setState({
      setCardMinimized: async (id, next) => {
        await REAL_ACTIONS.setCardMinimized(id, next);
        order.push("un-minimized");
      },
      setMaximized: (id) => {
        order.push("maximized");
        REAL_ACTIONS.setMaximized(id);
      },
    });
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Maximize" }));

    await waitFor(() => expect(maximizedId()).toBe("c1"));
    expect(order).toEqual(["un-minimized", "maximized"]);
  });

  it("restores a maximized card when it is minimized", async () => {
    seed();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, minimizeButton: true } });
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(maximizedId()).toBe("c1"));

    await userEvent.click(screen.getByRole("button", { name: "Minimize card" }));

    await waitFor(() => expect(maximizedId()).toBeNull());
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].minimized).toBe(true);
  });
});

/**
 * A `tabs` param renders in the card BODY, above the renderer, not behind the
 * parameter panel toggle -- tabs are meant to be visible. Selecting one is an
 * ordinary parameter edit, so it persists and the card re-asks the question.
 */
describe("WidgetCard tabs", () => {
  const TABS: WidgetDef["params"][number] = {
    paramName: "period",
    type: "tabs",
    label: "Period",
    value: "d",
    options: [
      { label: "Daily", value: "d" },
      { label: "Weekly", value: "w" },
    ],
  };

  function seed(params: WidgetDef["params"], cardParams: Record<string, string>) {
    register({ params });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, params: cardParams }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** The card, read back out of the store so a write re-renders it. */
  function LiveCard() {
    const live = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards[0],
    );
    return live ? <WidgetCard card={live} onRemove={vi.fn()} /> : null;
  }

  const stored = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params;
  /** The latest params the card handed the fetch hook. */
  const askedWith = () => useWidgetData.mock.calls.at(-1)![1];

  it("renders a tabs param as a tablist in the body, with the card's value selected", () => {
    seed([TABS], { period: "w" });
    const { container } = render(<LiveCard />);

    const list = screen.getByRole("tablist", { name: "Period" });
    expect(container.querySelector(".card-body")).toContainElement(list);
    expect(screen.getByRole("tab", { name: "Weekly" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Daily" })).toHaveAttribute("aria-selected", "false");
    // And nothing behind the panel toggle: the tabs ARE the control.
    expect(screen.queryByRole("button", { name: /Parameters/ })).toBeNull();
  });

  it("commits the selected tab through the card's ordinary param edit", async () => {
    seed([TABS], { period: "d" });
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("tab", { name: "Weekly" }));

    await waitFor(() => expect(stored().period).toBe("w"));
    // A tab IS a query parameter, so the card asks the new question.
    await waitFor(() => expect(askedWith()).toEqual({ period: "w" }));
  });
});

/**
 * A `form` param renders in the card BODY, above the renderer. Its fields
 * persist on the card as they are edited but ask the backend nothing; its
 * button POSTs the assembled body and, on a 2xx, refetches the card.
 */
describe("WidgetCard forms", () => {
  const FORM: WidgetDef["params"][number] = {
    paramName: "order",
    type: "form",
    form: {
      endpoint: "orders/submit",
      inputs: [
        { paramName: "symbol", type: "text", label: "Symbol", value: "AAPL" },
        { paramName: "qty", type: "number", label: "Quantity", value: "10" },
        { paramName: "submit", type: "button", label: "Send" },
      ],
    },
  };

  function seed(
    params: WidgetDef["params"],
    cardParams: Record<string, string>,
    widgetOver: Partial<WidgetDef> = {},
  ) {
    register({ params, ...widgetOver });
    useBackendsStore.setState({
      backends: [backend({ name: "Mock", baseUrl: "http://host:6900" })],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [{ ...card, params: cardParams }] }],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** The card, read back out of the store so a write re-renders it. */
  function LiveCard() {
    const live = useDashboardStore((s) =>
      s.dashboards.find((d) => d.id === s.activeId)?.tabs[0]?.cards[0],
    );
    return live ? <WidgetCard card={live} onRemove={vi.fn()} /> : null;
  }

  const stored = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params;
  /** The latest params the card handed the fetch hook. */
  const askedWith = () => useWidgetData.mock.calls.at(-1)![1];
  /**
   * Dashboard saves only -- the logger writes to memfs too. saveJson writes a
   * temp name and renames it, so these are temp names: what they COUNT is how
   * many times the dashboard was saved, which is the claim.
   */
  const dashboardWrites = () => __writes().filter((f) => f.startsWith("dashboards/"));

  it("renders a form's fields in the body, seeded from the card's params", () => {
    seed([FORM], { "order.symbol": "MSFT", "order.qty": "10" });
    const { container } = render(<LiveCard />);

    const form = container.querySelector<HTMLFormElement>("form.widget-form");
    expect(form).not.toBeNull();
    expect(container.querySelector(".card-body")).toContainElement(form);
    expect(screen.getByLabelText("Symbol")).toHaveValue("MSFT");
    expect(screen.getByLabelText("Quantity")).toHaveValue(10);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("shows the group badge beside a form field that is bound", () => {
    seed([FORM], { "order.symbol": "MSFT", "order.qty": "10" });
    // The form card bound by the field's NAME (`symbol`), which is how a
    // form field has always grouped, to a group on that name.
    useDashboardStore.setState((s) => ({
      dashboards: s.dashboards.map((d) => ({
        ...d,
        groups: [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" }],
        tabs: d.tabs.map((t) => ({
          ...t,
          cards: t.cards.map((c) => ({ ...c, bindings: [{ groupId: "g1", paramName: "symbol" }] })),
        })),
      })),
    }));
    render(<LiveCard />);
    expect(
      screen.getByRole("button", { name: "Group 1: Ticker — shared across grouped cards" }),
    ).toBeInTheDocument();
  });

  it("persists a field edit on blur without asking the backend a new question", async () => {
    seed([FORM, { paramName: "symbol", type: "text" }], {
      symbol: "AAPL",
      "order.symbol": "AAPL",
    });
    render(<LiveCard />);

    // The form's own entries never reach the fetch.
    expect(askedWith()).toEqual({ symbol: "AAPL" });

    await userEvent.type(screen.getByLabelText("Symbol"), "X");
    fireEvent.blur(screen.getByLabelText("Symbol"));

    await waitFor(() => expect(stored()["order.symbol"]).toBe("AAPLX"));
    // Persisted, and the card is still asking exactly what it was asking.
    expect(askedWith()).toEqual({ symbol: "AAPL" });
  });

  it("saves the dashboard ONCE for a typed field, on blur, not once per keystroke", async () => {
    seed([FORM], { "order.symbol": "", "order.qty": "10" });
    render(<LiveCard />);
    const field = screen.getByLabelText("Symbol");

    await userEvent.type(field, "AAPL");

    // Four characters, and the dashboard has not been touched yet: the draft
    // is local until focus leaves.
    expect(field).toHaveValue("AAPL");
    expect(dashboardWrites()).toEqual([]);
    expect(stored()["order.symbol"]).toBe("");

    fireEvent.blur(field);

    await waitFor(() => expect(stored()["order.symbol"]).toBe("AAPL"));
    expect(dashboardWrites()).toHaveLength(1);
  });

  it("writes nothing when a field is blurred without having been edited", async () => {
    seed([FORM], { "order.symbol": "MSFT", "order.qty": "10" });
    render(<LiveCard />);

    const field = screen.getByLabelText("Symbol");
    await userEvent.click(field);
    fireEvent.blur(field);

    await waitFor(() => expect(field).toHaveValue("MSFT"));
    expect(dashboardWrites()).toEqual([]);
  });

  it("commits an uncommitted draft before it POSTs, so a typed value is not lost", async () => {
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    seed([FORM], { "order.symbol": "AAPL", "order.qty": "10" });
    render(<LiveCard />);

    await userEvent.clear(screen.getByLabelText("Symbol"));
    await userEvent.type(screen.getByLabelText("Symbol"), "MSFT");
    // fireEvent, not userEvent: a real click moves focus and would blur the
    // field first, which is exactly the commit this test must NOT rely on.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    expect(postForm.mock.calls[0][3]).toEqual({ symbol: "MSFT", qty: 10, submit: true });
    // And it was persisted too, not only sent.
    await waitFor(() => expect(stored()["order.symbol"]).toBe("MSFT"));
  });

  // Each pending draft was committed with its own write built from the same
  // render's params, so the second write put the first field back.
  it("commits every pending draft on submit, not only the last one", async () => {
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    seed([FORM], { "order.symbol": "AAPL", "order.qty": "10" });
    render(<LiveCard />);

    // fireEvent.change, not userEvent.type: typing into the second field
    // would blur the first and commit it on its own.
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "MSFT" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stored()).toMatchObject({ "order.symbol": "MSFT", "order.qty": "25" }));
  });

  it("POSTs the assembled body on submit and refetches the card on success", async () => {
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    seed([FORM, { paramName: "symbol", type: "text" }], {
      symbol: "AAPL",
      "order.symbol": "MSFT",
      "order.qty": "25",
    });
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    const [backend, form, query, values] = postForm.mock.calls[0];
    expect((backend as { id: string }).id).toBe("b1");
    expect((form as { endpoint: string }).endpoint).toBe("orders/submit");
    // The widget's own params ride on the URL; the fields go in the body,
    // under their bare names and typed as declared.
    expect(query).toEqual({ symbol: "AAPL" });
    expect(values).toEqual({ symbol: "MSFT", qty: 25, submit: true });
  });

  it("shows a field that cannot resolve on the form and does not POST it (R7a)", async () => {
    const dated: WidgetDef["params"][number] = {
      ...FORM,
      form: { ...FORM.form!, inputs: [{ paramName: "d", type: "date", label: "Day" }, FORM.form!.inputs[2]] },
    };
    seed([dated], { "order.d": "T(XNYZ)" });
    const { container } = render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(container.querySelector(".widget-form-error")).toHaveTextContent("d: Unknown calendar XNYZ"));
    expect(postForm).not.toHaveBeenCalled();
  });

  it("shows the failure on the form and does not refetch when the POST is refused", async () => {
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    postForm.mockRejectedValue(new Error("HTTP 422: qty — must be positive"));
    seed([FORM], { "order.symbol": "MSFT", "order.qty": "-1" });
    const { container } = render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(container.querySelector(".widget-form-error")).toHaveTextContent(
        "HTTP 422: qty — must be positive",
      ),
    );
    expect(retry).not.toHaveBeenCalled();
    // The form comes back to life: a refusal is a correction the user makes
    // here, and a card left disabled would strand them with the error.
    expect(screen.getByLabelText("Symbol")).toBeEnabled();
    expect(screen.getByLabelText("Quantity")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("keeps a form's entries out of the export filename", async () => {
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    vi.mocked(save).mockResolvedValue(null);
    seed([FORM, { paramName: "symbol", type: "text" }], {
      symbol: "AAPL",
      "order.symbol": "MSFT",
      "order.qty": "25",
    });
    render(<LiveCard />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Export/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "JSON" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const path = String(vi.mocked(save).mock.calls[0][0]!.defaultPath);
    // The question the payload answers, and nothing the user typed into the
    // form: a filename lands on disk.
    expect(path).toContain("symbol=AAPL");
    expect(path).not.toContain("order.");
  });

  /**
   * HTML implicit submission: a form whose fields amount to ONE text or number
   * control submits itself when Enter is pressed in that field, with no submit
   * button anywhere in it. Measured in both Chromium and WebKit. In this app a
   * native submit navigates -- the SPA reloads and a viewer window loses its
   * `?viewer=` query -- so the form must refuse it. jsdom does not implement
   * implicit submission, so the event is raised directly: what is asserted is
   * the handler's answer to a submit, which is the half this code owns.
   */
  const ONE_FIELD_FORM: WidgetDef["params"][number] = {
    paramName: "ask",
    type: "form",
    form: {
      endpoint: "ask/submit",
      inputs: [
        { paramName: "q", type: "text", label: "Question" },
        { paramName: "ask", type: "button", label: "Ask" },
      ],
    },
  };

  it("refuses a native submit, so a one-field form cannot reload the app", () => {
    seed([ONE_FIELD_FORM], { "ask.q": "why" });
    const { container } = render(<LiveCard />);

    const form = container.querySelector<HTMLFormElement>("form.widget-form")!;
    const submit = createEvent.submit(form);
    fireEvent(form, submit);

    expect(submit.defaultPrevented).toBe(true);
    // And nothing was sent: implicit submission is not a press of the button.
    expect(postForm).not.toHaveBeenCalled();
  });

  it("keeps a form's entries off a multi_file_viewer's documents request", () => {
    seed(
      [FORM, { paramName: "symbol", type: "text" }],
      { symbol: "AAPL", "order.symbol": "MSFT", "order.qty": "25" },
      { type: "multi_file_viewer" },
    );
    render(<LiveCard />);

    expect(screen.getByTestId("mf-params")).toHaveTextContent(JSON.stringify({ symbol: "AAPL" }));
  });
});

/**
 * Same jsdom mechanics as IframeRenderer.test.tsx: `contentWindow` is stubbed
 * on the element, and `source` is defined on the event because the
 * MessageEvent constructor refuses a plain object for it. The REAL renderers
 * are used here, unmocked — so what these assert is WidgetCard's end of the
 * wiring: which headers it hands over, which params, and what it does with an
 * update that comes back.
 */
function stubFrame(frame: Element): { win: Window; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", { value: { postMessage }, configurable: true });
  return { win: (frame as HTMLIFrameElement).contentWindow as Window, postMessage };
}

/**
 * Flushes the frame's mount effects inside act(), so the message listener
 * useWidgetMessages registers is live before a test posts to the frame.
 */
async function settleFrameEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function frameEvent(source: unknown, data: unknown, origin: string): MessageEvent {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  return event;
}

function sendToFrame(source: unknown, data: unknown, origin: string): void {
  act(() => {
    window.dispatchEvent(frameEvent(source, data, origin));
  });
}

describe("WidgetCard iframe widget messages", () => {
  const dashboardWrites = () => __writes().filter((f) => f.startsWith("dashboards/"));

  /**
   * An iframe card whose endpoint IS the URL, plus a sibling table card that
   * declares `symbol` too. `groups` is passed through verbatim, so a test can
   * put both cards in one ParamGroup or leave the dashboard with none.
   */
  function seedIframe({
    groups,
    groupIds,
    viewer = false,
  }: {
    groups?: Array<{ id: string; name: string; paramName: string; groupType: string; value: string }>;
    groupIds?: string[];
    viewer?: boolean;
  }) {
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({
          id: "w1",
          name: "Embedded Page",
          type: "iframe",
          category: "Fixture",
          endpoint: "https://embed.example/p",
          gridData: { w: 20, h: 12 },
          params: [
            { paramName: "symbol", label: "Symbol", type: "text" },
            { paramName: "interval", label: "Interval", type: "text" },
          ],
        }),
        makeWidget({
          id: "w2",
          name: "Quote",
          endpoint: "quote",
          params: [{ paramName: "symbol", label: "Symbol", type: "text" }],
        }),
      ],
    });
    useBackendsStore.setState({
      backends: [
        backend({
          name: "Mock",
          // The frame's own origin: a backend serving its own framed page is
          // the one case its credential may be handed over in.
          baseUrl: "https://embed.example",
          headerName: "X-Key",
          headerValue: "secret-value",
        }),
      ],
    });
    const bindings = groupIds?.map((groupId) => ({ groupId, paramName: "symbol" }));
    const source: DashboardCard = { ...card, id: "c1", params: { symbol: "AAPL" }, bindings };
    const sibling: DashboardCard = {
      ...card,
      id: "c2",
      widgetId: "w2",
      params: { symbol: "AAPL" },
      bindings,
    };
    useDashboardStore.setState({
      viewer,
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [source, sibling] }],
          groups,
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  /** Both cards, reading themselves out of the store so a write re-renders them. */
  function TwoCards() {
    const cards = useDashboardStore(
      (s) => s.dashboards.find((d) => d.id === s.activeId)!.tabs[0].cards,
    );
    return (
      <>
        {cards.map((c) => (
          <WidgetCard key={c.id} card={c} viewer={useDashboardStore.getState().viewer} onRemove={vi.fn()} />
        ))}
      </>
    );
  }

  /** The latest params the hook was handed for one card. */
  function paramsFor(id: string): unknown {
    return useWidgetData.mock.calls.filter(([c]) => (c as DashboardCard).id === id).at(-1)![1];
  }

  it("hands the frame the backend's own auth headers, and nothing else", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    await settleFrameEffects();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(win, { type: "openbb-connect" }, "https://embed.example");

    expect(postMessage).toHaveBeenCalledWith(
      { type: "openbb-auth", headers: { "X-Key": "secret-value" } },
      "https://embed.example",
    );
    // The credential reached the frame and nothing else: not the log, not
    // the DOM.
    expect(__read("logs/bdobb.log") ?? "").not.toContain("secret-value");
    // innerHTML, not textContent: a credential leaked into an attribute (a
    // title, a data-, the frame's own src) is just as leaked as one in text.
    expect(document.body.innerHTML).not.toContain("secret-value");
  });

  it("sends no credential to a frame on an origin other than the backend's own", async () => {
    // widgets.json may frame any page at all. The backend's credential is
    // for the backend, so a third-party page it frames must never receive
    // it -- though it still gets the params, which carry no credential.
    seedIframe({});
    useBackendsStore.setState({
      backends: [
        backend({
          name: "Mock",
          baseUrl: "https://api.example",
          headerName: "X-Key",
          headerValue: "secret-value",
        }),
      ],
    });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    await settleFrameEffects();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(win, { type: "openbb-connect" }, "https://embed.example");

    const types = postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
    expect(types).not.toContain("openbb-auth");
    expect(types).toContain("openbb-params-update");
  });

  it("sends no credential for the Website built-in, which names no backend", async () => {
    register({ id: "website", backendId: "builtin", type: "iframe", endpoint: "" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    const c = {
      ...card,
      widgetId: "website",
      backendId: "builtin",
      params: { url: "https://embed.example/p" },
    };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await settleFrameEffects();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(win, { type: "openbb-connect" }, "https://embed.example");

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
  });

  it("commits an inbound params update onto the GROUP, once, and the sibling follows", async () => {
    seedIframe({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
    });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(
      win,
      { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" },
      "https://embed.example",
    );

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].groups![0].value).toBe("MSFT");
    });
    // The group holds it; the card's own stored param is untouched. Same
    // split a cell click and the Apply button produce.
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe("AAPL");
    await waitFor(() => expect(paramsFor("c2")).toEqual({ symbol: "MSFT" }));
    expect(dashboardWrites()).toHaveLength(1);
  });

  it("writes the card's own param when it is in no group", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(
      win,
      { type: "openbb:widget-params:update", params: { symbol: "MSFT" } },
      "https://embed.example",
    );

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe("MSFT");
    });
    // No group, so no propagation: explicit groups are the only fan-out.
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].params.symbol).toBe("AAPL");
    expect(dashboardWrites()).toHaveLength(1);
  });

  it("writes nothing when the update only repeats what the card already holds", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    // The value the card was seeded with: a page echoing our own
    // openbb-params-update back must not cost a dashboard write per echo.
    sendToFrame(
      win,
      { type: "openbb:widget-params:update", params: { symbol: "AAPL" } },
      "https://embed.example",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe("AAPL");
    expect(dashboardWrites()).toEqual([]);
  });

  it("refuses a param the widget does not declare, writes nothing, and logs one line", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(
      win,
      { type: "openbb:widget-params:update", params: { nonsense: "MSFT" } },
      "https://embed.example",
    );

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("widget frame set undeclared param nonsense on c1");
      // The parameter name and the card id, never the pushed VALUE.
      expect(log).not.toContain("MSFT");
    });
    expect(dashboardWrites()).toEqual([]);
  });

  it("logs ONE line for a burst of undeclared names, with the name clamped", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    // The name is chosen by the framed page, so it is both attacker-chosen
    // and unbounded. Keying logOnce on it would let a page write a line per
    // name -- growing the log file and the once-key set without bound -- and
    // interpolating it raw would let the embedded newline forge a log line.
    const hostile = `x\nINJECTED-LINE\r${"y".repeat(100)}`;
    sendToFrame(
      win,
      { type: "openbb:widget-params:update", params: { [hostile]: "v" } },
      "https://embed.example",
    );
    for (let i = 0; i < 49; i++) {
      sendToFrame(
        win,
        { type: "openbb:widget-params:update", params: { [`junk${i}`]: "v" } },
        "https://embed.example",
      );
    }

    // Drains the logger's serialized write chain: this line is queued behind
    // every notice the burst produced, so once it has landed they all have.
    await act(async () => {
      await logInfo("drain");
    });
    const lines = (__read("logs/bdobb.log") ?? "").trim().split("\n");
    const notices = lines.filter((l) => l.includes("undeclared param"));
    expect(notices).toHaveLength(1);
    expect(lines).toHaveLength(2);

    // C0 bytes stripped, so the name cannot forge a line of its own, and 64
    // characters at most.
    const name = notices[0].match(/undeclared param (.*) on c1$/)![1];
    expect(name).toBe(`xINJECTED-LINE${"y".repeat(50)}`);
    expect(dashboardWrites()).toEqual([]);
  });

  it("merges two updates that arrive in the same tick instead of dropping the first", async () => {
    seedIframe({});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    // ONE act() for both, which is what "the same tick" means: no render
    // happens between them, so a handler splitting against the card it closed
    // over at render time would build the second edit's cardParams from
    // params that predate the first, and the write would drop `symbol`.
    act(() => {
      window.dispatchEvent(
        frameEvent(
          win,
          { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" },
          "https://embed.example",
        ),
      );
      window.dispatchEvent(
        frameEvent(
          win,
          { type: "openbb:widget-params:update", paramName: "interval", value: "1d" },
          "https://embed.example",
        ),
      );
    });

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params).toMatchObject({
        symbol: "MSFT",
        interval: "1d",
      });
    });
  });

  it("applies an inbound update in memory in a viewer window, writing no dashboard file", async () => {
    seedIframe({
      groups: [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
      groupIds: ["g1"],
      viewer: true,
    });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    render(<TwoCards />);
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    sendToFrame(
      win,
      { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" },
      "https://embed.example",
    );

    // The store's own viewer guard: applied in memory, logged once as
    // viewer-no-write, and no dashboards/ file written. No check of its own
    // is added anywhere in this feature.
    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].groups![0].value).toBe("MSFT");
    });
    expect(dashboardWrites()).toEqual([]);
  });
});

/**
 * A runButton widget's header. Run replaces Refresh -- it does not join it --
 * because a second button that fetches unconditionally would undo the whole
 * point of the manifest's flag.
 */
describe("WidgetCard with a run button", () => {
  /** A dashboard holding this card, which the params panel needs to render. */
  function seedDashboard() {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("tells the hook the widget carries a run button", () => {
    register({ runButton: true });
    seedDashboard();

    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(useWidgetData.mock.calls.at(-1)![2]).toBe(true);
  });

  it("offers Run in place of Refresh, and only for a runButton widget", () => {
    register({ runButton: true });
    seedDashboard();
    // completedAt/stale pinned explicitly so the timer's tooltip is a fixed
    // string ("Click to run") rather than whatever the default mock leaves
    // completedAt as -- the tooltip's exact wording is the timer-control
    // suite's job, this test is only about which control shows.
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      run: vi.fn(),
      stale: false,
      completedAt: null,
    });

    const { unmount } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toHaveClass("card-timer");
    expect(run).toHaveAttribute("title", "Click to run · ⌘-click: hard refresh");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    unmount();
    register();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });

  it("runs on a plain click and hard-refreshes on a Cmd or Ctrl click", async () => {
    register({ runButton: true });
    seedDashboard();
    const run = vi.fn();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry, run, stale: true });

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Run" });
    // A single setup() instance, not the bare top-level userEvent calls used
    // elsewhere in this file: @testing-library/user-event@14 spins up a fresh
    // input-device "system" on every top-level call, so a held modifier from
    // one userEvent.keyboard() call would not reach a later userEvent.click()
    // -- only calls sharing one setup() instance share that state.
    const user = userEvent.setup();

    await user.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();

    // The modifier is the whole difference: Run adopts the pending edit, a
    // modified click re-asks the question already on screen.
    await user.keyboard("{Meta>}");
    await user.click(button);
    await user.keyboard("{/Meta}");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);

    await user.keyboard("{Control>}");
    await user.click(button);
    await user.keyboard("{/Control}");
    expect(retry).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("marks the title while the hook reports un-run edits, and stops when it does not", () => {
    register({ runButton: true });
    seedDashboard();
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      run: vi.fn(),
      stale: true,
    });

    const { container, rerender } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    // The marker is the timer button itself now (aria-label stays the plain
    // "Run" -- see "the timer control" describe block -- so what carries the
    // changed-parameters message is the tooltip, not a separate aria-label).
    const mark = container.querySelector(".card-stale");
    expect(mark).toHaveAttribute("title", "Parameters changed — click to run · ⌘-click: hard refresh");
    // The timer is the header's left-most control, ahead of the title, so it
    // reads as being about this card's question before the card's name.
    expect(container.querySelector("header.card-header")!.firstElementChild).toBe(mark);

    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      run: vi.fn(),
      stale: false,
    });
    rerender(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".card-stale")).toBeNull();
  });

  it("shows no marker on a card that has no run button, whatever it is doing", () => {
    // stale is a constant false out of the hook for these, but the card must
    // not be the thing that depends on that: a marker on an ordinary card
    // would claim it is holding back a fetch it has already made.
    register();
    seedDashboard();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);

    expect(container.querySelector(".card-stale")).toBeNull();
  });

  it("a committed edit writes the parameters without running them", async () => {
    register({ runButton: true, params: [{ paramName: "symbol", label: "Symbol" }] });
    const withParam = { ...card, params: { symbol: "AAPL" } };
    useDashboardStore.setState({
      dashboards: [
        { id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [withParam] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
    const run = vi.fn();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry, run, stale: false });

    render(<WidgetCard card={withParam} onRemove={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("Symbol"));
    await userEvent.type(screen.getByLabelText("Symbol"), "MSFT");
    // A typed control commits when focus leaves it; there is no Apply.
    await userEvent.tab();

    // The edit is committed to the card...
    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.symbol).toBe(
        "MSFT",
      );
    });
    // ...and nothing asked the backend anything. Run is the only thing that
    // does, which is the whole contract.
    expect(run).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("the timer control", () => {
  /** A dashboard holding this card, which the params panel needs to render. */
  function seedDashboard() {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("is the left-most header control, named Refresh, and refetches on click", async () => {
    register();
    const retry = vi.fn();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry });
    seedDashboard();

    const { container } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const header = container.querySelector("header.card-header")!;
    const timer = header.firstElementChild as HTMLElement;
    expect(timer).toHaveClass("card-timer");
    expect(timer).toHaveAccessibleName("Refresh");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBe(timer);

    await userEvent.click(timer);
    expect(retry).toHaveBeenCalled();
  });

  it("says when it last refreshed and is fresh after a completed fetch", async () => {
    register();
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      completedAt: Date.now(),
      stalePastInterval: false,
    });
    seedDashboard();

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const timer = await screen.findByRole("button", { name: "Refresh" });
    expect(timer).toHaveAttribute("title", expect.stringMatching(/^Last refresh just now · /));
    expect(timer).toHaveAttribute("data-tone", "fresh");
  });

  it("restates its tooltip as an accessible description, for assistive tech that never reads `title`", async () => {
    register();
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      completedAt: Date.now(),
      stalePastInterval: false,
    });
    seedDashboard();

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const timer = await screen.findByRole("button", { name: "Refresh" });
    expect(timer).toHaveAccessibleDescription(expect.stringMatching(/^Last refresh /));
  });

  it("reads Not fetched yet before the first completion and Click to retry after an error", () => {
    register();
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      completedAt: null,
    });
    seedDashboard();

    const { unmount } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute(
      "title",
      "Not fetched yet",
    );
    unmount();

    useWidgetData.mockReturnValue({
      status: "error",
      data: null,
      error: "HTTP 500",
      retry: vi.fn(),
      completedAt: null,
    });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute(
      "title",
      "Click to retry",
    );
  });

  it("is named Run on a run-button card and carries the stale class while parameters changed", () => {
    register({ runButton: true });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [],
      retry: vi.fn(),
      run: vi.fn(),
      stale: true,
    });
    seedDashboard();

    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Run" })).toHaveClass("card-stale");
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute(
      "title",
      "Parameters changed — click to run · ⌘-click: hard refresh",
    );
  });
});

describe("a local-file card", () => {
  const localCard: DashboardCard = makeCard({
    id: "c-local",
    widgetId: "local_table",
    backendId: "builtin",
    title: "prices.csv",
    params: { file: "11111111-1111-4111-8111-111111111111.csv" },
    layout: { x: 0, y: 0, w: 24, h: 14 },
  });

  function registerLocal() {
    register({ id: "local_table", backendId: "builtin", type: "local_table", name: "Local file" });
  }

  it("renders its file through the table, not the no-data placeholder", () => {
    registerLocal();
    // What a built-in reports: it fetches nothing, so data is always null.
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });

    render(<WidgetCard card={localCard} onRemove={vi.fn()} />);

    expect(screen.getByTestId("local-table")).toHaveTextContent(
      "11111111-1111-4111-8111-111111111111.csv|prices.csv|0",
    );
    expect(screen.queryByText("No data for these parameters.")).not.toBeInTheDocument();
  });

  it("passes the card's own title as the label, so an error names the dropped file", () => {
    registerLocal();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });

    render(<WidgetCard card={{ ...localCard, title: "Q3 exports.csv" }} onRemove={vi.fn()} />);

    expect(screen.getByTestId("local-table")).toHaveTextContent("|Q3 exports.csv|");
  });

  it("passes only its own Refresh to the runtime renderer, which owns refresh-all", () => {
    registerLocal();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 3 });
    useDashboardStore.setState({ refreshEpoch: 2 });

    render(<WidgetCard card={localCard} onRemove={vi.fn()} />);

    expect(screen.getByTestId("local-table")).toHaveTextContent("|3");
  });

  it("preserves refresh-all on standalone and transposed legacy local views", () => {
    registerLocal();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 3 });
    useDashboardStore.setState({ refreshEpoch: 2 });
    const view = render(<WidgetCard card={{ ...localCard, view: "transposed" }} onRemove={vi.fn()} />);
    expect(screen.getByTestId("local-table")).toHaveTextContent("|5");
    view.unmount();
    useDashboardStore.setState({ dashboards: [], activeId: null });
    render(<WidgetCard card={localCard} onRemove={vi.fn()} />);
    expect(screen.getByTestId("local-table")).toHaveTextContent("|5");
  });

  it("names its default view segment Table, since that is what the card shows", () => {
    registerLocal();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });

    render(<WidgetCard card={localCard} onRemove={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Table" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Default" })).not.toBeInTheDocument();
  });

  it("offers the filter-row toggle, which is the toolkit surface it can reach", () => {
    registerLocal();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });

    render(<WidgetCard card={localCard} onRemove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Filter rows" })).toBeInTheDocument();
  });
});

describe("a card whose renderer throws", () => {
  /**
   * Two cards rendered together: this file mounts WidgetCards directly rather
   * than a DashboardGrid, so a second card IS "the rest of the grid" here --
   * what matters is that a sibling of the crashing card survives it.
   */
  function setUpPair() {
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({ id: "w1", name: "Price History" }),
        // Not named "Feed": that is the rss type label, which the view
        // toggle renders too, and the assertions below want one match each.
        makeWidget({ id: "rss", backendId: "builtin", name: "Market Wire", type: "rss", endpoint: "" }),
      ],
    });
    const healthy = { ...card, id: "c1", widgetId: "w1" };
    const crashing = {
      ...card,
      id: "c2",
      widgetId: "rss",
      backendId: "builtin",
      params: { url: "throw://boom" },
    };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [healthy, crashing] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    return { healthy, crashing };
  }

  it("degrades to its own boundary, keeping its header and every other card", () => {
    // React reports a caught error to console.error as well; that is React
    // working, and it is the only noise this case makes.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useWidgetData.mockReturnValue({ status: "ready", data: [{ symbol: "AAPL" }], retry: vi.fn(), attempt: 0 });
    const { healthy, crashing } = setUpPair();

    const { container } = render(
      <>
        <WidgetCard card={healthy} onRemove={vi.fn()} />
        <WidgetCard card={crashing} onRemove={vi.fn()} />
      </>,
    );

    // The crash is contained to the one body that threw...
    expect(screen.getByText("Something went wrong in Market Wire.")).toBeInTheDocument();
    expect(screen.getByText("the feed renderer exploded")).toBeInTheDocument();
    expect(container.querySelectorAll(".error-box")).toHaveLength(1);
    // ...its header survives, so the card can still be removed or renamed...
    expect(screen.getByText("Market Wire")).toHaveClass("card-title");
    // ...and the other card is untouched.
    expect(screen.getByText("Price History")).toHaveClass("card-title");
    expect(container.querySelectorAll(".widget-card")).toHaveLength(2);

    consoleError.mockRestore();
  });

  it("names the widget in the fallback and the log, never the title the user typed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const { crashing } = setUpPair();
    // A card the user renamed. A title is free text they typed, and
    // commitTitle a few lines up in WidgetCard deliberately logs the card and
    // the error and never the title -- so the boundary, which logs its own
    // label, must not become the second route by which it reaches the file.
    const renamed = { ...crashing, title: "SECRET" };

    render(<WidgetCard card={renamed} onRemove={vi.fn()} />);

    // The header still shows what the user called it...
    expect(screen.getByText("SECRET")).toHaveClass("card-title-custom");
    // ...while the boundary names the widget behind it, which is the same for
    // every install and identifies the card just as well.
    expect(screen.getByText("Something went wrong in Market Wire.")).toBeInTheDocument();

    // Drains the logger's serialized write chain: the boundary's line is
    // queued ahead of this one, so once this has landed it has.
    await act(async () => {
      await logInfo("drain");
    });
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).toContain("unhandled error in Market Wire");
    expect(log).not.toContain("SECRET");

    consoleError.mockRestore();
  });
});

describe("WidgetCard markdown editor", () => {
  // backendId must match the registered widget's ("builtin"): find() strict-
  // matches backendId+widgetId, same as every other builtin-widget test here
  // (note, clock, iframe, rss, local_table) does on its own card.
  const mdCard = (text: string): DashboardCard => ({ ...card, backendId: "builtin", params: { text } });

  function setUpMarkdown(text: string) {
    register({ backendId: "builtin", type: "markdown_editor", name: "Markdown" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = mdCard(text);
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    return c;
  }

  const storedText = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.text;

  it("dispatches to the editor with the stored text even though its data is null", async () => {
    const c = setUpMarkdown("# Hi");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    // Lazy-loaded (WidgetCard.tsx): the mocked chunk still resolves
    // asynchronously, so the stub is not there on the first synchronous pass.
    expect(await screen.findByTestId("md-text")).toHaveTextContent("# Hi");
    expect(screen.queryByText(/no data for these parameters/i)).not.toBeInTheDocument();
  });

  it("commits an edit through applyCardParams", async () => {
    const c = setUpMarkdown("# Hi");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Emit edit" }));
    await waitFor(() => expect(storedText()).toBe("changed"));
  });

  it("offers Open file… and Save as… in the card menu, and no Export", async () => {
    const c = setUpMarkdown("");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    // The lazy chunk must resolve before the ⋯ menu's items — which live in
    // WidgetCard itself, not the editor — are asked to appear.
    await screen.findByTestId("md-text");
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getByRole("menuitem", { name: "Open file…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Save as…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export ▸" })).not.toBeInTheDocument();
  });

  it("Save as… writes the stored markdown with one trailing newline under the card's name", async () => {
    const c = setUpMarkdown("# Hi");
    vi.mocked(save).mockResolvedValue("/out/note.md");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save as…" }));
    await waitFor(() => expect(__read("/out/note.md")).toBe("# Hi\n"));
    expect(vi.mocked(save).mock.calls[0][0]).toMatchObject({
      defaultPath: expect.stringMatching(/^Markdown .*\.md$/),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
  });

  it("Open file… copies the picked file's text into the note without asking when the note is empty", async () => {
    const c = setUpMarkdown("");
    __seed("imports/pick.md", "## From disk");
    vi.mocked(open).mockResolvedValue("/imports/pick.md");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open file…" }));
    await waitFor(() => expect(storedText()).toBe("## From disk"));
    expect(confirm).not.toHaveBeenCalled();
    expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
  });

  it("Open file… asks before replacing a non-empty note, and a cancel keeps it", async () => {
    const c = setUpMarkdown("# Keep me");
    __seed("imports/pick.md", "## From disk");
    vi.mocked(open).mockResolvedValue("/imports/pick.md");
    vi.mocked(confirm).mockResolvedValue(false);
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open file…" }));
    expect(confirm).toHaveBeenCalledWith('Replace this note with "pick.md"?', expect.objectContaining({ kind: "warning" }));
    // Give the (refused) replacement every chance to land before asserting it did not.
    await act(() => Promise.resolve());
    expect(storedText()).toBe("# Keep me");
  });

  it("Open file… refuses a file over 1 MB before reading it, and says so on the card", async () => {
    const c = setUpMarkdown("");
    __seed("imports/pick.md", "x".repeat(1024 * 1024 + 1));
    vi.mocked(open).mockResolvedValue("/imports/pick.md");
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open file…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("pick.md is 1.1 MB; the limit is 1 MB.");
    expect(storedText()).toBe("");
  });

  it("a cancelled dialog is not a failure: nothing is written and no notice shows", async () => {
    const c = setUpMarkdown("# Hi");
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(save).mockResolvedValue(null);
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open file…" }));
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save as…" }));
    await act(() => Promise.resolve());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(__writes().filter((w) => w.endsWith(".md"))).toEqual([]);
    expect(storedText()).toBe("# Hi");
  });
});

describe("WidgetCard sharing with Rita", () => {
  beforeEach(() => {
    useChatStore.setState({ sharedCardIds: [] });
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
  });
  const sharing = (on: boolean) => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, contextSharing: on } });
  const openMenu = () => userEvent.click(screen.getByRole("button", { name: "Card menu" }));
  const badge = () => screen.queryByRole("img", { name: "Shared with Rita" });

  it("offers no Share with Rita while Context Sharing is off", async () => {
    register({ type: "table" });
    sharing(false);
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Share with Rita" })).not.toBeInTheDocument();
  });

  // isAgentOffLimits: key-maint's table, its markdown summary (off limits
  // because its backend serves key-maint) and any settings widget.
  for (const [label, widgets, widgetId] of [
    ["key-maint's provider_api_keys table", [makeWidget({ id: "provider_api_keys", type: "table" })], "provider_api_keys"],
    ["a settings widget", [makeWidget({ id: "w1", type: "settings" })], "w1"],
    [
      "key-maint's summary, on a backend serving key-maint",
      [makeWidget({ id: "provider_api_keys_summary", type: "markdown", endpoint: "keys" }), makeWidget({ id: "provider_api_keys_panel", type: "keys" })],
      "provider_api_keys_summary",
    ],
  ] as const) {
    it(`never offers it on ${label}`, async () => {
      useWidgetRegistryStore.setState({ widgets: [...widgets] });
      useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
      sharing(true);
      render(<WidgetCard card={{ ...card, widgetId }} dashboardId="d1" onRemove={vi.fn()} />);
      await openMenu();
      expect(screen.queryByRole("menuitem", { name: "Share with Rita" })).not.toBeInTheDocument();
    });
  }

  it("tags and untags the card, showing the Rita badge while tagged", async () => {
    register({ type: "table" });
    sharing(true);
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Share with Rita" }));
    expect(useChatStore.getState().sharedCardIds).toEqual(["c1"]);
    expect(badge()).toBeInTheDocument();
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Stop sharing with Rita" }));
    expect(useChatStore.getState().sharedCardIds).toEqual([]);
    expect(badge()).not.toBeInTheDocument();
  });

  it("gives an iframe card, which had no menu, one carrying the item", async () => {
    register({ type: "iframe", endpoint: "https://example.com/p" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    sharing(true);
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Share with Rita" })).toBeInTheDocument();
  });

  // Both of these used to assert the ⋯ button's ABSENCE, which was the same
  // thing at v6.1.0: a keys card and a viewer card had no menu at all, so the
  // item could not be reached. The title bar carried onto this line
  // (v5.5.0) gives EVERY resolved widget the menu, so the absence they mean
  // is the item's, and that is what they now open the menu and check.
  it("never offers it on a keys card", async () => {
    register({ type: "keys" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    sharing(true);
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Share with Rita" })).not.toBeInTheDocument();
  });

  it("never offers it in a viewer window, whose stores are not the main window's", async () => {
    register({ type: "iframe", endpoint: "https://example.com/p" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    sharing(true);
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} viewer />);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Share with Rita" })).not.toBeInTheDocument();
  });

  it("hides the badge while Context Sharing is off, since the tag is not sent", () => {
    register({ type: "table" });
    sharing(false);
    useChatStore.setState({ sharedCardIds: ["c1"] });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    expect(badge()).not.toBeInTheDocument();
  });
});

// Wraps the REAL chart renderer, like the TableRenderer and MultiFileRenderer
// mocks above, and records only the uirevision it is handed.
const chartRevisions = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock("./renderers/ChartRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderers/ChartRenderer")>();
  return {
    ...actual,
    ChartRenderer: (props: Parameters<typeof actual.ChartRenderer>[0]) => {
      chartRevisions.push(props.uirevision);
      return <actual.ChartRenderer {...props} />;
    },
  };
});

describe("a chart's zoom follows the card's params", () => {
  // Plotly keeps zoom and pan while layout.uirevision is unchanged: a refetch
  // or a theme flip of the same params keeps the reader's view, and a params
  // change -- a different question -- starts from the full extent again.
  it("hands the chart a uirevision that is stable for the same params and changes with them", () => {
    register({ type: "chart", params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: { data: [{ type: "scatter", x: [1], y: [2] }], layout: {} },
      retry: vi.fn(),
    });
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }], activeId: "d1", activeTabIds: { d1: "t1" } });
    chartRevisions.length = 0;

    const { rerender } = render(
      <WidgetCard card={{ ...card, params: { symbol: "AAPL" } }} onRemove={vi.fn()} />,
    );
    const first = chartRevisions.at(-1);
    rerender(<WidgetCard card={{ ...card, params: { symbol: "AAPL" } }} onRemove={vi.fn()} />);
    const same = chartRevisions.at(-1);
    rerender(<WidgetCard card={{ ...card, params: { symbol: "MSFT" } }} onRemove={vi.fn()} />);
    const changed = chartRevisions.at(-1);

    expect(first).toBeDefined();
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });
});

describe("the ⋯ menu, v5.5.0 items", () => {
  // v8: Pin widget ▸ joins the exact list after Maximize, where the donor put it.
  it("lists Rename…, Parameters, Duplicate, Copy to ▸, Maximize, Pin widget ▸, Quick actions ▸, Columns ▸, Export ▸ for a table card with parameters", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual([
      "Rename…",
      "Parameters",
      "Duplicate",
      "Copy to ▸",
      "Maximize",
      "Pin widget ▸",
      "Quick actions ▸",
      "Columns ▸",
      "Export ▸",
    ]);
  });

  it("Parameters opens the full control row in a docked panel with visible labels; Escape leaves it open", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));

    const dialog = screen.getByRole("region", { name: "Parameters" });
    expect(within(dialog).getByText("Symbol")).toBeVisible();

    // v5.5.1: docked and saved, so only its own toggles close it.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Parameters" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Hide parameters" }));
    expect(screen.queryByRole("region", { name: "Parameters" })).not.toBeInTheDocument();
  });

  it("moves focus into the Parameters dialog when it opens", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));

    const dialog = screen.getByRole("region", { name: "Parameters" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("a mousedown outside the docked Parameters panel does not close it (v5.5.1)", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Show parameters" }));
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    fireEvent.mouseDown(plain);
    expect(screen.getByRole("region", { name: "Parameters" })).toBeInTheDocument();
    document.body.removeChild(plain);
  });

  it("v5.5.1: the ▸ chevron opens the panel closed-by-default, ▾ closes it, and the state is saved on the card", async () => {
    renderReadyTableCardWithParams();
    expect(screen.queryByRole("region", { name: "Parameters" })).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: "Show parameters" });
    expect(show).toHaveTextContent("▸");
    await userEvent.click(show);
    expect(screen.getByRole("region", { name: "Parameters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide parameters" })).toHaveTextContent("▾");
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].paramsOpen).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Hide parameters" }));
    expect(screen.queryByRole("region", { name: "Parameters" })).not.toBeInTheDocument();
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0]).not.toHaveProperty("paramsOpen"));
  });

  it("v5.5.1: a card saved with its panel open mounts open, without taking focus", () => {
    register({ type: "table", params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    const open = { ...card, params: { symbol: "AAPL" }, paramsOpen: true };
    useWidgetData.mockReturnValue({ status: "ready", data: [{ symbol: "AAPL" }], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [open] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    render(<WidgetCard card={open} onRemove={vi.fn()} />);
    const panel = screen.getByRole("region", { name: "Parameters" });
    expect(panel.contains(document.activeElement)).toBe(false);
  });

  it("v5.5.1: a card with no parameters has no chevron", () => {
    register({ type: "table", params: [] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /parameters/i })).not.toBeInTheDocument();
  });

  it("v5.5.1: no ◷ on a card with nothing to refresh; a data card keeps it", () => {
    register({ type: "iframe", endpoint: "https://example.com/p" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    const { unmount } = render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    unmount();
    register({ type: "table" });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("the panel's controls carry their own ids, distinct from the chips row's", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));

    const dialog = screen.getByRole("region", { name: "Parameters" });
    expect(document.querySelectorAll(`[id="${CARD_ID}-symbol"]`)).toHaveLength(1);
    const popoverField = document.getElementById(`params-${CARD_ID}-symbol`);
    expect(popoverField).not.toBeNull();
    expect(dialog.contains(popoverField)).toBe(true);
  });

  it("v5.5.1: Display on title bar is checked by default and unchecking it saves hideTitleParams", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));

    const box = screen.getByRole("checkbox", { name: "Display on title bar" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    const saved = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    expect(saved.hideTitleParams).toBe(true);
  });

  it("a Date expression card starts off the title bar, and checking the box saves an explicit false", async () => {
    register({ type: "date_probe", params: [{ paramName: "expr", label: "Expression", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...card, params: { expr: "T" } }] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    function LiveCard() {
      const live = useDashboardStore((s) => s.dashboards[0]?.tabs[0]?.cards[0]);
      return live ? <WidgetCard card={live} onRemove={vi.fn()} /> : null;
    }
    const stored = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    render(<LiveCard />);
    expect(document.querySelector(".card-chips")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show parameters" }));
    const box = screen.getByRole("checkbox", { name: "Display on title bar" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(document.getElementById(`${CARD_ID}-expr`)).not.toBeNull());
    expect(stored().hideTitleParams).toBe(false);

    await userEvent.click(screen.getByRole("checkbox", { name: "Display on title bar" }));
    await waitFor(() => expect(document.querySelector(".card-chips")).toBeNull());
    expect(stored()).not.toHaveProperty("hideTitleParams");
  });

  it("v5.5.1: a card with hideTitleParams keeps its chips off the title bar but in the Parameters popover", async () => {
    register({ type: "table", params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    const hidden = { ...card, params: { symbol: "AAPL" }, hideTitleParams: true };
    useWidgetData.mockReturnValue({ status: "ready", data: [{ symbol: "AAPL" }], retry: vi.fn() });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [hidden] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    render(<WidgetCard card={hidden} onRemove={vi.fn()} />);

    expect(document.querySelector(".card-chips")).toBeNull();
    expect(document.getElementById(`${CARD_ID}-symbol`)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));
    expect(document.getElementById(`params-${CARD_ID}-symbol`)).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Display on title bar" })).not.toBeChecked();
  });

  it("Duplicate adds a copy of the card", async () => {
    const duplicateCard = vi.fn(async () => "c-copy");
    renderReadyCard();
    act(() => {
      useDashboardStore.setState({ duplicateCard });
    });

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(duplicateCard).toHaveBeenCalledWith(CARD_ID);
  });

  it("Copy to ▸ lists every dashboard's tabs and copies there", async () => {
    const copyCardTo = vi.fn(async () => "c-copy");
    renderReadyCard();
    act(() => {
      useDashboardStore.setState({
        copyCardTo,
        dashboards: [
          { id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] },
          {
            id: "d2",
            name: "Other",
            tabs: [
              { id: "t2", name: "Work", cards: [] },
              { id: "t3", name: "Play", cards: [] },
            ],
          },
        ],
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy to ▸" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Other › Play" }));

    expect(copyCardTo).toHaveBeenCalledWith(CARD_ID, "d2", "t3");
  });

  // Copy to ▸ opens in place, a row per tab of every dashboard, so the menu
  // grows after MenuPanel has clamped it; unless the panel clamps again, the
  // new rows run off the bottom of the window.
  it("clamps the ⋯ menu into the window again when Copy to ▸ opens", async () => {
    const ROW = 60;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const toggle = this.getAttribute("aria-label") === "Card menu";
        const height = this.classList.contains("card-export-menu") ? this.querySelectorAll("button").length * ROW : 0;
        return { left: 0, right: toggle ? 500 : 0, top: 0, bottom: toggle ? 100 : height, width: 0, height, x: 0, y: 0, toJSON() {} } as DOMRect;
      });
    try {
      renderReadyCard();
      act(() => {
        useDashboardStore.setState({
          dashboards: [
            { id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] },
            {
              id: "d2",
              name: "Other",
              tabs: ["a", "b", "c", "d", "e", "f"].map((t) => ({ id: t, name: t, cards: [] })),
            },
          ],
        });
      });

      await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Copy to ▸" }));

      const menu = screen.getByRole("menu");
      const bottomFit = window.innerHeight - menu.querySelectorAll("button").length * ROW;
      expect(bottomFit).toBeLessThan(100);
      expect(menu).toHaveStyle({ top: `${Math.max(0, bottomFit)}px` });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("logs a Duplicate or Copy to whose save fails, rather than leaving it unhandled", async () => {
    const duplicateCard = vi.fn(async () => {
      throw new Error("disk full");
    });
    const copyCardTo = vi.fn(async () => {
      throw new Error("disk full");
    });
    renderReadyCard();
    act(() => {
      useDashboardStore.setState({
        duplicateCard,
        copyCardTo,
        dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy to ▸" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "D" }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain(`failed to duplicate card ${CARD_ID}: Error: disk full`);
      expect(log).toContain(`failed to copy card ${CARD_ID}: Error: disk full`);
    });
  });

  it("Quick actions ▸ offers Autosize columns and Reset columns", async () => {
    renderReadyTableCardWithParams();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Quick actions ▸" }));

    expect(screen.getByRole("menuitem", { name: "Autosize columns" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset columns" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset table" })).not.toBeInTheDocument();
  });
});

describe("advanced_charting", () => {
  const spec = { defaultSymbol: "AAPL", updateFrequency: 60000, colors: {}, showVolume: true };

  it("hands the widget's UDF spec and the Refresh key to the TradingView renderer", () => {
    register({ type: "advanced_charting", endpoint: "/udf", udfChart: spec });
    useBackendsStore.setState({ backends: [backend()] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 2 });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(JSON.parse(screen.getByTestId("tv-props").textContent ?? "")).toEqual({ spec, refreshKey: 2 });
    // The data===null gate below the early returns must not claim this card.
    expect(screen.queryByText("No data for these parameters.")).toBeNull();
    useBackendsStore.setState({ backends: [] });
  });
});

describe("live_chart (v10, V10-P4)", () => {
  function seed(over: Partial<WidgetDef> = {}) {
    register({ type: "live_chart", endpoint: "series", wsEndpoint: "live_grid_ws", ...over });
    useBackendsStore.setState({ backends: [backend()] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 2, completedAt: null });
  }
  const refresh = () => screen.getByRole("button", { name: "Refresh" });

  it("hands the params and the Refresh key to the Live Chart renderer, not to raw JSON", () => {
    seed();
    render(<WidgetCard card={{ ...card, params: { symbol: "AAPL", interval: "1m" } }} onRemove={vi.fn()} />);
    expect(JSON.parse(screen.getByTestId("live-grid-props").textContent ?? "")).toMatchObject({
      params: { symbol: "AAPL", interval: "1m" },
      refreshKey: 2,
    });
    expect(screen.queryByTestId("raw-json")).toBeNull();
    expect(screen.queryByText("No data for these parameters.")).toBeNull();
    useBackendsStore.setState({ backends: [] });
  });

  it("tones the Refresh control as the live grid does, stale while the socket is down", async () => {
    seed();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(refresh()).toHaveAttribute("title", "Waiting for the feed");
    await userEvent.click(screen.getByRole("button", { name: "live-tick" }));
    expect(refresh()).toHaveAttribute("data-tone", "stale");
    await userEvent.click(screen.getByRole("button", { name: "socket-open" }));
    expect(refresh()).toHaveAttribute("data-tone", "fresh");
    useBackendsStore.setState({ backends: [] });
  });

  it("without a wsEndpoint is a seeded chart: fresh once seeded, with no socket to wait for", async () => {
    seed({ wsEndpoint: undefined });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(refresh()).toHaveAttribute("title", "Not fetched yet");
    await userEvent.click(screen.getByRole("button", { name: "live-tick" }));
    expect(refresh()).toHaveAttribute("data-tone", "fresh");
    // Review F14: no feed, so no "Live" -- the ordinary card's words.
    expect(refresh().getAttribute("title")).toMatch(/^Last refresh /);
    useBackendsStore.setState({ backends: [] });
  });
});

describe("live_grid (v10)", () => {
  const symbolParam = [{ paramName: "symbol", label: "Symbols", type: "text" }] as WidgetDef["params"];
  function seed(over: Partial<DashboardCard> = {}, groups?: Dashboard["groups"]) {
    const c = { ...card, ...over };
    register({ type: "live_grid", endpoint: "live_grid", wsEndpoint: "live_grid_ws", params: symbolParam });
    useBackendsStore.setState({ backends: [backend()] });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }], groups }],
      activeId: "d1",
      activeTabId: "t1",
    });
    return c;
  }
  const props = () => JSON.parse(screen.getByTestId("live-grid-props").textContent ?? "") as Record<string, unknown>;

  it("subscribes by the group-bound effective params, not the card's stored copy (donor b3d7ac4c)", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = seed(
      { params: { symbol: "AAPL" }, bindings: [{ groupId: "g1", paramName: "symbol" }] },
      [{ id: "g1", name: "T", paramName: "symbol", groupType: "symbol", value: "MSFT,TSLA" }],
    );
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().params).toEqual({ symbol: "MSFT,TSLA" });
    // fetchesData is false, so the data===null gate must not claim the card.
    expect(screen.queryByText("No data for these parameters.")).toBeNull();
    useBackendsStore.setState({ backends: [] });
  });

  it("is a table card: it gets the card's table state and its owner, and the filter row", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = seed({ params: { symbol: "AAPL" }, table: { sorting: [{ id: "price", desc: true }] } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props()).toMatchObject({ state: { sorting: [{ id: "price", desc: true }] }, tableState: "function", filterRow: false });
    useBackendsStore.setState({ backends: [] });
  });

  // Review B2: a sendToAgent row on a live grid is card data, gated by
  // Context sharing and off-limits exactly as the table case is (canShare).
  it("offers Send to Rita only while Context sharing is on", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = seed({ params: { symbol: "AAPL" } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: false } });
    const { unmount } = render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().sendToAgent).toBe("undefined");
    unmount();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().sendToAgent).toBe("function");
    useBackendsStore.setState({ backends: [] });
  });

  // Review R6: the other two halves of canShare, each with sharing on.
  it("offers no Send to Rita on a backend that serves key-maint (off limits)", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = seed({ params: { symbol: "AAPL" } });
    useWidgetRegistryStore.setState((s) => ({ widgets: [...s.widgets, makeWidget({ id: "provider_api_keys_panel", type: "keys" })] }));
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().sendToAgent).toBe("undefined");
    useBackendsStore.setState({ backends: [] });
  });

  it("offers no Send to Rita in a viewer window", () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const c = seed({ params: { symbol: "AAPL" } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    render(<WidgetCard card={c} onRemove={vi.fn()} viewer />);
    expect(props().sendToAgent).toBe("undefined");
    useBackendsStore.setState({ backends: [] });
  });

  it("reads Waiting for the feed, then Live with the last update, never Not fetched yet", async () => {
    // fetchesData is false for live_grid, so the card's own completedAt stays
    // null while rows tick (web test, 2026-10-12); the renderer reports instead.
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0, completedAt: null });
    const c = seed({ params: { symbol: "AAPL" } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const refresh = () => screen.getByRole("button", { name: "Refresh" });
    expect(refresh()).toHaveAttribute("title", "Waiting for the feed");
    await userEvent.click(screen.getByRole("button", { name: "live-tick" }));
    expect(refresh().getAttribute("title")).toMatch(/^Live · last update /);
    expect(refresh().getAttribute("title")).not.toContain("Not fetched yet");
    useBackendsStore.setState({ backends: [] });
  });

  // Review B13: a feed that has dropped is not fresh, however recent its last row.
  it("tones the Refresh control stale while the socket is reconnecting", async () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0, completedAt: null });
    const c = seed({ params: { symbol: "AAPL" } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const refresh = () => screen.getByRole("button", { name: "Refresh" });
    await userEvent.click(screen.getByRole("button", { name: "live-tick" }));
    await userEvent.click(screen.getByRole("button", { name: "socket-open" }));
    expect(refresh()).toHaveAttribute("data-tone", "fresh");
    await userEvent.click(screen.getByRole("button", { name: "socket-drop" }));
    expect(refresh()).toHaveAttribute("data-tone", "stale");
    useBackendsStore.setState({ backends: [] });
  });

  // Review R1: data from the snapshot alone, with the socket not (yet) open --
  // a first connect still waiting, or a minimised card's closed socket -- is
  // not a fresh feed.
  it("does not tone the Refresh control fresh until the socket is live", async () => {
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0, completedAt: null });
    const c = seed({ params: { symbol: "AAPL" } });
    const { rerender } = render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const refresh = () => screen.getByRole("button", { name: "Refresh" });
    await userEvent.click(screen.getByRole("button", { name: "live-tick" }));
    expect(refresh()).toHaveAttribute("data-tone", "stale");
    await userEvent.click(screen.getByRole("button", { name: "socket-open" }));
    expect(refresh()).toHaveAttribute("data-tone", "fresh");
    // Minimised: the grid unmounts, and the real renderer reports idle as it goes.
    rerender(<WidgetCard card={{ ...c, minimized: true }} onRemove={vi.fn()} />);
    expect(screen.queryByTestId("live-grid-props")).toBeNull();
    expect(refresh()).toHaveAttribute("data-tone", "stale");
    useBackendsStore.setState({ backends: [] });
  });

  it("draws Refresh, and Refresh bumps the refreshKey that re-fetches the snapshot", async () => {
    useWidgetData.mockImplementation(() => {
      const [attempt, setAttempt] = useState(0);
      return { status: "ready", data: null, retry: () => setAttempt((n) => n + 1), attempt };
    });
    const c = seed({ params: { symbol: "AAPL" } });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(props().refreshKey).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props().refreshKey).toBe(1);
    useBackendsStore.setState({ backends: [] });
  });
});

describe("WidgetCard pin widget (v8)", () => {
  function seed(over: Partial<DashboardCard> = {}) {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...card, ...over }] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  function LiveCard({ viewer = false }: { viewer?: boolean }) {
    const live = useDashboardStore((s) => s.dashboards[0]?.tabs[0]?.cards.find((c) => c.id === "c1"));
    return live ? <WidgetCard card={live} viewer={viewer} onRemove={vi.fn()} /> : null;
  }

  const stored = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0];

  async function openPin() {
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Pin widget/ }));
  }

  it("offers Pin to top, Pin to bottom and Unpin, with Unpin disabled on an unpinned card", async () => {
    seed();
    render(<LiveCard />);
    await openPin();
    expect(screen.getByRole("menuitem", { name: "Pin to top" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Pin to bottom" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeDisabled();
  });

  it("pins to the bottom, closes the menu, and then disables that edge", async () => {
    seed();
    render(<LiveCard />);
    await openPin();
    await userEvent.click(screen.getByRole("menuitem", { name: "Pin to bottom" }));
    await waitFor(() => expect(stored().pinned).toBe("bottom"));
    expect(screen.queryByRole("menu")).toBeNull();

    await openPin();
    expect(screen.getByRole("menuitem", { name: "Pin to bottom" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Pin to top" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeEnabled();
  });

  it("unpins", async () => {
    seed({ pinned: "top" });
    render(<LiveCard />);
    await openPin();
    await userEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    await waitFor(() => expect(stored()).not.toHaveProperty("pinned"));
  });

  it("reopening the menu starts with the section collapsed", async () => {
    seed();
    render(<LiveCard />);
    await openPin();
    expect(screen.getByRole("menuitem", { name: "Pin to top" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: "Pin to top" })).toBeNull();
  });

  it("is absent in the viewer window", async () => {
    seed();
    render(<LiveCard viewer />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: /^Pin widget/ })).toBeNull();
  });
});

describe("WidgetCard news", () => {
  const newsCard: DashboardCard = {
    ...card,
    id: "c1",
    widgetId: "news",
    backendId: "builtin",
    params: { url: "https://ticker.example" },
    news: { feeds: [{ url: "https://a.example/feed", name: "A", tab: "Wires" }], highlights: ["fed"] },
  };

  function seedNews(over: Partial<DashboardCard> = {}) {
    register({ id: "news", backendId: "builtin", type: "news", name: "News" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...newsCard, ...over }] }] }],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
  }

  function LiveCard() {
    const live = useDashboardStore((s) => s.dashboards[0]?.tabs[0]?.cards.find((c) => c.id === "c1"));
    return live ? <WidgetCard card={live} dashboardId="d1" onRemove={vi.fn()} /> : null;
  }

  it("hands the renderer the url param, the card's feeds and highlights, and the refresh key", () => {
    seedNews();
    render(<LiveCard />);
    expect(JSON.parse(screen.getByTestId("news-props").textContent!)).toEqual({
      base: "https://ticker.example",
      feeds: newsCard.news!.feeds,
      highlights: ["fed"],
      refreshKey: 0,
      tabOrder: [],
    });
  });

  it("writes a dragged tab order onto the card, keeping feeds and highlights", async () => {
    seedNews();
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "reorder-from-body" }));
    await waitFor(() =>
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].news).toEqual({
        feeds: newsCard.news!.feeds,
        highlights: ["fed"],
        tabOrder: ["Substack", "Wires"],
      }),
    );
  });

  it("an empty server is the web preview's own relay there, and stays empty on the desktop", () => {
    seedNews({ params: {} });
    const { unmount } = render(<LiveCard />);
    expect(JSON.parse(screen.getByTestId("news-props").textContent!).base).toBe("");
    unmount();
    window.__bdobbNewsServer = "https://preview.example.com/news";
    try {
      render(<LiveCard />);
      expect(JSON.parse(screen.getByTestId("news-props").textContent!).base).toBe("https://preview.example.com/news");
    } finally {
      delete window.__bdobbNewsServer;
    }
  });

  it("remounts the renderer empty when the server changes, not when only its spelling does", async () => {
    seedNews();
    render(<LiveCard />);
    const setUrl = (url: string) =>
      act(() => {
        const d = useDashboardStore.getState().dashboards[0];
        const c = d.tabs[0].cards[0];
        useDashboardStore.setState({ dashboards: [{ ...d, tabs: [{ ...d.tabs[0], cards: [{ ...c, params: { ...c.params, url } }] }] }] });
      });
    await userEvent.type(screen.getByLabelText("news-local-state"), "rows");
    setUrl(" https://ticker.example/ ");
    expect(screen.getByLabelText<HTMLInputElement>("news-local-state").value).toBe("rows");
    setUrl("https://other.example");
    expect(screen.getByLabelText<HTMLInputElement>("news-local-state").value).toBe("");
  });

  it("a card's own server wins over the web preview's", () => {
    seedNews();
    window.__bdobbNewsServer = "https://preview.example.com/news";
    try {
      render(<LiveCard />);
      expect(JSON.parse(screen.getByTestId("news-props").textContent!).base).toBe("https://ticker.example");
    } finally {
      delete window.__bdobbNewsServer;
    }
  });

  it("defaults to no feeds and no highlights on an unconfigured card", () => {
    seedNews({ news: undefined });
    render(<LiveCard />);
    expect(JSON.parse(screen.getByTestId("news-props").textContent!)).toMatchObject({ feeds: [], highlights: [] });
  });

  it("opens the feed manager from the ⋯ menu and writes Done back to the card", async () => {
    seedNews();
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Configure feeds…" }));
    const dialog = screen.getByRole("dialog", { name: "Configure feeds" });
    expect(dialog).toHaveAttribute("open");

    await userEvent.click(screen.getByRole("button", { name: "Remove feed 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0]).not.toHaveProperty("news"),
    );
    expect(screen.queryByRole("dialog", { name: "Configure feeds" })).toBeNull();
  });

  it("opens the feed manager from the body's empty-state button too", async () => {
    seedNews({ news: undefined });
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "configure-from-body" }));
    expect(screen.getByRole("dialog", { name: "Configure feeds" })).toBeInTheDocument();
  });

  it("does not offer Configure feeds… on a non-news card", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: "Configure feeds…" })).toBeNull();
  });
});

describe("WidgetCard rail chrome (News)", () => {
  const newsCard: DashboardCard = {
    ...card,
    id: "c1",
    widgetId: "news",
    backendId: "builtin",
    params: { url: "https://ticker.example" },
    news: { feeds: [{ url: "https://a.example/feed", name: "A", tab: "Wires" }] },
  };

  function seedRail(over: Partial<DashboardCard> = {}) {
    register({ id: "news", backendId: "builtin", type: "news", name: "News", params: [{ paramName: "url", label: "RSS Aggregator Server", type: "text", show: true }] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [{ ...newsCard, ...over }] }] }],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
  }

  function LiveCard({ viewer = false, onRemove = vi.fn() }: { viewer?: boolean; onRemove?: () => void }) {
    const live = useDashboardStore((s) => s.dashboards[0]?.tabs[0]?.cards.find((c) => c.id === "c1"));
    return live ? <WidgetCard card={live} dashboardId="d1" viewer={viewer} onRemove={onRemove} /> : null;
  }

  // The whole rail menu, in order. Clean v8: the rail's Parameters item is
  // the same saved, docked panel every card opens from its menu (paramsOpen),
  // so it keeps that item's place and name rather than the donor's
  // "Parameters (N)" at the end. No Export for a built-in (fetchesData is
  // false on BUILTIN_BACKEND_ID) and no table sections.
  it("carries exactly this menu, in this order", async () => {
    seedRail();
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual([
      "Rename…",
      "Configure feeds…",
      "Export feeds…",
      "Import feeds…",
      "Parameters",
      "Duplicate",
      "Copy to ▸",
      "Maximize",
      "Pin widget ▸",
      "Refresh",
      "Close",
    ]);
  });

  it("renders no header; the strip carries the chevron menu and the vertical title, which is the drag handle", () => {
    seedRail();
    const { container } = render(<LiveCard />);
    expect(container.querySelector(".card-header")).toBeNull();
    expect(container.querySelector(".widget-card")).toHaveClass("card-rail");
    const strip = container.querySelector(".card-rail-chrome")!;
    expect(strip.querySelector('[aria-label="Card menu"]')).not.toBeNull();
    const title = strip.querySelector(".card-rail-title")!;
    expect(title).toHaveClass("card-title");
    expect(title).toHaveTextContent("RSS Aggregator");
    // None of the header's own controls exist on a rail.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove card" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Parameters/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show parameters" })).toBeNull();
  });

  it("a renamed rail shows its own title", () => {
    seedRail({ title: "Wire" });
    const { container } = render(<LiveCard />);
    expect(container.querySelector(".card-rail-title")).toHaveTextContent("Wire");
    expect(container.querySelector(".card-rail-title")).toHaveClass("card-title-custom");
  });

  it("the chevron menu holds Parameters, Refresh, Configure feeds…, Pin widget and Close", async () => {
    const onRemove = vi.fn();
    const retry = vi.fn();
    seedRail();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry, attempt: 0 });
    render(<LiveCard onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    for (const name of ["Rename…", "Configure feeds…", "Maximize", "Parameters", "Refresh", "Close"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitem", { name: /^Pin widget/ })).toBeInTheDocument();
    // The data export section stays gated on cards that fetch data; the
    // rail's own Export feeds… is a different item.
    expect(screen.queryByRole("menuitem", { name: "Export ▸" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Export feeds…" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Parameters" }));
    expect(screen.getByLabelText("RSS Aggregator Server")).toBeInTheDocument();

    // The same item closes the panel, and says so while it is open.
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Hide parameters" }));
    expect(screen.queryByLabelText("RSS Aggregator Server")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Close" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("offers no Close in the viewer window", async () => {
    seedRail();
    render(<LiveCard viewer />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.queryByRole("menuitem", { name: "Close" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeInTheDocument();
  });

  it("Rename… opens the field above the body and commits to the card", async () => {
    seedRail();
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const field = screen.getByRole("textbox", { name: "Card title" });
    expect(field).toHaveValue("RSS Aggregator");
    expect(field.closest(".card-rail-rename")).not.toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, "The wire{Enter}");
    await waitFor(() =>
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].title).toBe("The wire"),
    );
  });

  it("a rail saved minimized offers Expand in its menu, since it has no header ▢", async () => {
    seedRail({ minimized: true });
    render(<LiveCard />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Expand" }));
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].minimized).toBe(false));
  });

  it("a non-News card keeps its header", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const { container } = render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
    expect(container.querySelector(".card-header")).not.toBeNull();
    expect(container.querySelector(".card-rail-chrome")).toBeNull();
  });
});

// v8 locked widgets (donor 57e2c286, 1fe4ecc0 items 1 and 3; clean's menu).
describe("WidgetCard locked", () => {
  const docksWith = (cards: DashboardCard[], groups?: Dashboard["groups"]): Dashboard => {
    const docks = makeDefaultDocks();
    return { ...docks, tabs: [docks.tabs[0], { ...docks.tabs[1], cards }], ...(groups ? { groups } : {}) };
  };

  it("a locked data card offers no Parameters, Rename, Pin, copies, Minimize or Remove, but keeps Maximize and Export", async () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    useDashboardStore.setState({ docks: docksWith([card]) });
    const { container } = render(<WidgetCard card={card} dashboardId={DOCKS_ID} onRemove={vi.fn()} locked />);
    expect(screen.queryByRole("button", { name: "Show parameters" })).toBeNull();
    expect(container.querySelector(".card-chips")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize card" })).toBeNull();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    for (const gone of ["Rename…", "Parameters", "Duplicate", "Copy to ▸", "Pin widget ▸", "Create linked chart", "Create linked table"]) {
      expect(items).not.toContain(gone);
    }
    expect(items).toContain("Maximize");
    expect(items).toContain("Export ▸");
    // The title does not rename on double-click.
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.dblClick(container.querySelector(".card-title")!);
    expect(screen.queryByRole("textbox", { name: "Card title" })).toBeNull();
  });

  it("in the editor (not locked) a docks card has its chrome back, but never Pin widget ▸", async () => {
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    useDashboardStore.setState({ docks: docksWith([card]) });
    render(<WidgetCard card={card} dashboardId={DOCKS_ID} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show parameters" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(["Rename…", "Parameters", "Duplicate", "Copy to ▸", "Maximize"]));
    expect(items).not.toContain("Pin widget ▸");
  });

  it("a locked News rail keeps Export feeds…, Maximize and Refresh only, and does not rename on double-click", async () => {
    const newsCard: DashboardCard = {
      ...card,
      widgetId: "news",
      backendId: "builtin",
      params: { url: "https://ticker.example" },
      news: { feeds: [{ url: "https://a.example/feed", name: "A", tab: "Wires" }] },
    };
    register({ id: "news", backendId: "builtin", type: "news", name: "News", params: [{ paramName: "url", label: "RSS Aggregator Server", type: "text", show: true }] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({ docks: docksWith([newsCard]) });
    const { container } = render(<WidgetCard card={newsCard} dashboardId={DOCKS_ID} onRemove={vi.fn()} locked />);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual(["Export feeds…", "Maximize", "Refresh"]);
    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
    await userEvent.dblClick(container.querySelector(".card-rail-title")!);
    expect(screen.queryByRole("textbox", { name: "Card title" })).toBeNull();
  });

  it("a locked News rail's body, or one in a viewer window, gets no Configure feeds… and no tab reorder", () => {
    const newsCard: DashboardCard = {
      ...card,
      widgetId: "news",
      backendId: "builtin",
      params: { url: "https://ticker.example" },
      news: { feeds: [] },
    };
    register({ id: "news", backendId: "builtin", type: "news", name: "News", params: [{ paramName: "url", label: "RSS Aggregator Server", type: "text", show: true }] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({ docks: docksWith([newsCard]) });
    const { rerender } = render(<WidgetCard card={newsCard} dashboardId={DOCKS_ID} onRemove={vi.fn()} locked />);
    expect(screen.getByTestId("news-props")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "configure-from-body" })).toBeNull();
    expect(screen.queryByRole("button", { name: "reorder-from-body" })).toBeNull();
    rerender(<WidgetCard card={newsCard} dashboardId={DOCKS_ID} onRemove={vi.fn()} viewer />);
    expect(screen.getByTestId("news-props")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "configure-from-body" })).toBeNull();
    expect(screen.queryByRole("button", { name: "reorder-from-body" })).toBeNull();
  });

  it("binds a locked card to the DOCKS' groups, not to whatever dashboard is showing", () => {
    // A locked card is mounted outside the dashboard switch, so the active
    // dashboard is never its home: reading groups from there would merge
    // another dashboard's symbol -- and applying a param would edit it.
    register({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn() });
    const locked: DashboardCard = { ...card, params: { symbol: "AAPL" }, bindings: [{ groupId: "gd", paramName: "symbol" }] };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [] }], groups: [{ id: "gd", name: "Dashboard's", paramName: "symbol", groupType: "symbol", value: "MSFT" }] }],
      activeId: "d1",
      activeTabId: "t1",
      docks: docksWith([locked], [{ id: "gd", name: "Docks'", paramName: "symbol", groupType: "symbol", value: "GOOG" }]),
    });
    // Both ways a card finds its home: named, and found by its id.
    render(<WidgetCard card={locked} dashboardId={DOCKS_ID} onRemove={vi.fn()} locked />);
    render(<WidgetCard card={locked} onRemove={vi.fn()} locked />);
    const calls = useWidgetData.mock.calls.filter((c) => c[0] === locked);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[1]).toMatchObject({ symbol: "GOOG" });
  });

  it("the open menu consumes its Escape entirely, so the editor's Cancel never sees it", async () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    // Stands in for every bubble-phase window Escape listener around a card --
    // DockEditor's Cancel above all, which would end a dock edit.
    const other = vi.fn();
    window.addEventListener("keydown", other);
    try {
      await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(other).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", other);
    }
  });
});

// A backend table pivots in-thread (TableRenderer's own engine, saved to the
// card's table state); it never moves onto the client table worker (user
// ruling 2026-10-07). It still needs the Pivot button to change its pivot.
describe("a backend table on the table worker", () => {
  beforeEach(() => { worker.fits = true; return () => { worker.fits = false; }; });
  function setUp(data: unknown) {
    register({ type: "table", table: { columns: [{ field: "asset", headerName: "Asset" }] } });
    useWidgetData.mockReturnValue({ status: "ready", data, retry: vi.fn(), attempt: 0 });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("renders the runtime table with the widget's spec and hands the worker the fetched rows", async () => {
    const { tableExecutionStore } = await import("../stores/tableExecutionStore");
    const handOver = vi.spyOn(tableExecutionStore, "setBackendRows").mockImplementation(() => {});
    const data = [{ asset: "AAA", volume: 100 }];
    setUp(data);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const table = screen.getByTestId("local-table");
    expect(table).toHaveAttribute("data-runtime", card.id);
    expect(table).toHaveAttribute("data-spec", "yes");
    expect(handOver).toHaveBeenCalledWith("d1", card.id, data);
    // The worker's drawer replaces the in-thread panel's button.
    expect(screen.getByRole("button", { name: "Pivot" })).toHaveAttribute("data-widget", card.id);
    handOver.mockRestore();
  });

  it("keeps an oversized payload in-thread but still hands it over, so linked children see the store's too-large error", async () => {
    const { tableExecutionStore } = await import("../stores/tableExecutionStore");
    const handOver = vi.spyOn(tableExecutionStore, "setBackendRows").mockImplementation(() => {});
    worker.fits = false;
    const data = [{ asset: "AAA", volume: 100 }];
    setUp(data);
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByTestId("local-table")).toBeNull();
    expect(screen.getByRole("button", { name: "Pivot" })).toHaveAttribute("data-pivot", "off");
    expect(handOver).toHaveBeenCalledWith("d1", card.id, data);
    handOver.mockRestore();
  });

  it.each(["error", "incomplete"])("a %s fetch hands the worker an error instead of leaving the previous rows", async (status) => {
    const { tableExecutionStore } = await import("../stores/tableExecutionStore");
    const handOver = vi.spyOn(tableExecutionStore, "setBackendRows").mockImplementation(() => {});
    setUp([{ asset: "AAA", volume: 100 }]);
    useWidgetData.mockReturnValue({ status, data: [{ asset: "OLD" }], error: "HTTP 404", retry: vi.fn(), attempt: 0 });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(handOver).toHaveBeenCalledTimes(1);
    expect(handOver.mock.calls[0][2]).toEqual(new Error("HTTP 404"));
    handOver.mockRestore();
  });
});

describe("Pivot on a backend table", () => {
  function setUp(cardOver: Partial<DashboardCard> = {}, widgetOver: Partial<WidgetDef> = {}) {
    register({ type: "table", ...widgetOver });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [{ asset: "AAA", volume: 100 }, { asset: "BBB", volume: 50 }],
      retry: vi.fn(),
      attempt: 0,
    });
    const c = { ...card, ...cardOver };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    return c;
  }

  it("offers the Pivot button and opens the in-thread pivot panel", async () => {
    const c = setUp();
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    const pivot = screen.getByRole("button", { name: "Pivot" });
    expect(pivot).toHaveAttribute("aria-expanded", "false");
    expect(pivot).toHaveAttribute("data-pivot", "off");
    await userEvent.click(pivot);
    expect(pivot).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Row Groups" })).toBeInTheDocument();
    await userEvent.click(pivot);
    expect(screen.queryByRole("list", { name: "Row Groups" })).toBeNull();
  });

  it("reads on from the card's own saved pivot", () => {
    const c = setUp({ table: { pivot: { enabled: true, grouping: ["asset"], split: [], values: [] } } as DashboardCard["table"] });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pivot" })).toHaveAttribute("data-pivot", "on");
  });

  it("is not offered on a transposed table", () => {
    const c = setUp({ view: "transposed" });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Pivot" })).toBeNull();
  });
});
describe('managed SSRM consumer controls',()=>{
 function setupManaged(view?:DashboardCard['view']){
  register({type:'table_ssrm',provider:'managed-native',protocolVersion:1});
  useBackendsStore.setState({backends:[backend()]});
  useWidgetData.mockReturnValue({status:'ready',data:null,retry:vi.fn(),attempt:0});
  const managed={...card,view};
  useDashboardStore.setState({dashboards:[{id:'d1',name:'D',tabs:[{id:'t1',name:'T',cards:[managed]}]}],activeId:'d1',activeTabId:'t1'});
  return managed;
 }
 it('offers filtering, linked consumers and export over managed execution with no fetched payload',async()=>{
  render(<WidgetCard card={setupManaged()} onRemove={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Filter rows'})).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Card menu'}));
  expect(screen.getByRole('menuitem',{name:'Create linked chart'})).toBeInTheDocument();
  expect(screen.getByRole('menuitem',{name:'Create linked table'})).toBeInTheDocument();
  expect(screen.getByRole('menuitem',{name:/^Export/})).toBeInTheDocument();
 });
 it('offers the Statement view on a managed table with no fetched payload',()=>{
  render(<WidgetCard card={setupManaged()} onRemove={vi.fn()}/>);
  expect(screen.getByRole('option',{name:'Statement'})).toBeInTheDocument();
 });
 it('routes managed Statement view through the owned result stream',()=>{
  const {container}=render(<WidgetCard card={setupManaged('statement')} onRemove={vi.fn()}/>);
  expect(container.querySelector('.statement-view')).not.toBeNull();
 });
});

describe("WidgetCard statement fiscal labels", () => {
  beforeEach(() => {
    fiscalYearEndAnswer = null;
    __resetStatementYearEndsForTests();
    useBackendsStore.setState({ backends: [backend()] });
  });

  // WMT's fiscal year ends in January, so a quarter ending 2026-07-31 is its
  // second fiscal quarter of FY2027 -- not the "2026" / "quarter" the provider sent.
  async function statementCard(over: Partial<WidgetDef> = {}) {
    register({
      type: "table",
      params: [
        { paramName: "symbol", label: "Symbol", type: "text" },
        { paramName: "period", label: "Period", type: "text", options: [{ label: "annual", value: "annual" }, { label: "quarter", value: "quarter" }] },
      ],
      ...over,
    });
    useWidgetData.mockReturnValue({
      status: "ready",
      data: [{ period_ending: "2026-07-31", fiscal_period: "quarter", fiscal_year: 2026, revenue: 1 }],
      retry: vi.fn(),
    });
    await act(async () => {
      render(<WidgetCard card={{ ...card, params: { symbol: "WMT", period: "quarter" }, view: "raw" }} onRemove={vi.fn()} />);
    });
  }

  it("relabels a statement card's rows from the reporter's fiscal year end", async () => {
    fiscalYearEndAnswer = async () => ({ fiscalYearEnd: "January" });
    await statementCard();
    await waitFor(() => expect(screen.getByTestId("raw-json")).toHaveTextContent('"fiscal_period": "FQ2"'));
    expect(screen.getByTestId("raw-json")).toHaveTextContent('"fiscal_year": "FY2027"');
    expect(screen.queryByText("Fiscal labels as reported")).toBeNull();
  });

  it("says the labels are as reported when the year end is unknown", async () => {
    fiscalYearEndAnswer = async () => null;
    await statementCard();
    expect(await screen.findByText("Fiscal labels as reported")).toBeInTheDocument();
    expect(screen.getByTestId("raw-json")).toHaveTextContent('"fiscal_period": "quarter"');
  });

  it("says nothing and asks nothing on a card that is not a statement widget", async () => {
    const asked = vi.fn(async () => ({ fiscalYearEnd: "January" }));
    fiscalYearEndAnswer = asked;
    await statementCard({ params: [{ paramName: "symbol", label: "Symbol", type: "text" }] });
    expect(screen.queryByText("Fiscal labels as reported")).toBeNull();
    expect(screen.getByTestId("raw-json")).toHaveTextContent('"fiscal_period": "quarter"');
    expect(asked).not.toHaveBeenCalled();
  });
});

// User rulings 2026-10-15: a local statement table names its year-end backend on the card, and any
// table whose runtime rows kept their reported labels (local, managed, linked) shows the note.
describe("fiscal labels on worker and server tables", () => {
  const asReported = {
    status: "ready", requested: { widgetId: "c-local", input: 1, model: 1, output: 1 }, definition: { table: {}, search: "" },
    selection: { kind: "none" }, stale: false,
    ready: { columns: [], inspection: { inputColumns: [] }, completeness: { kind: "complete", warnings: [] }, diagnostics: [{ code: "FISCAL_AS_REPORTED", severity: "info", message: "Fiscal labels as reported" }] },
  };
  const local = (params: Record<string, string> = {}): DashboardCard => makeCard({ id: "c-local", widgetId: "local_table", backendId: "builtin", params: { file: "f.csv", ...params } });
  async function show(c: DashboardCard, view?: object) {
    const { tableExecutionStore } = await import("../stores/tableExecutionStore");
    if (view) vi.spyOn(tableExecutionStore, "readView").mockReturnValue(view as ReturnType<typeof tableExecutionStore.readView>);
    register({ id: "local_table", backendId: "builtin", type: "local_table", name: "Local file" });
    useBackendsStore.setState({ backends: [backend({ id: "openbq", name: "OpenBQ" })] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    const applyCardParams = vi.fn(async () => {});
    useDashboardStore.setState({ applyCardParams, dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "T", cards: [c] }] }], activeId: "d1", activeTabId: "t1" });
    render(<WidgetCard card={c} onRemove={vi.fn()} />);
    return applyCardParams;
  }
  it("shows the note and the year-end backend choice on a local table left as reported, and saves the choice", async () => {
    const apply = await show(local(), asReported);
    expect(screen.getByText("Fiscal labels as reported")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "FY ends from" }), "openbq");
    expect(apply).toHaveBeenCalledWith("c-local", { cardParams: { file: "f.csv", fiscalYearEndBackend: "openbq" }, groupEdits: [] });
    vi.restoreAllMocks();
  });
  it("keeps the choice visible once set, and offers nothing on a plain local table", async () => {
    await show(local({ fiscalYearEndBackend: "openbq" }));
    expect(screen.getByRole("combobox", { name: "FY ends from" })).toHaveValue("openbq");
    cleanup();
    await show(local());
    expect(screen.queryByRole("combobox", { name: "FY ends from" })).toBeNull();
    expect(screen.queryByText("Fiscal labels as reported")).toBeNull();
  });
  it("shows the note on a managed table whose server source kept its reported labels", async () => {
    const { tableExecutionStore } = await import("../stores/tableExecutionStore");
    vi.spyOn(tableExecutionStore, "readView").mockReturnValue(asReported as unknown as ReturnType<typeof tableExecutionStore.readView>);
    register({ type: "table_ssrm", provider: "managed-native", protocolVersion: 1 });
    useBackendsStore.setState({ backends: [backend()] });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn(), attempt: 0 });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByText("Fiscal labels as reported")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "FY ends from" })).toBeNull();
    vi.restoreAllMocks();
  });
});
