// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateProbeRenderer } from "../components/renderers/DateProbeRenderer";
import { WidgetFormPanel } from "../components/WidgetFormPanel";
import { BUILTIN_WIDGETS } from "../lib/builtins";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

/**
 * fetchTradingCalendar passes through to the real one (and the mock server)
 * unless a test sets `hold`, which then answers every calendar request — the
 * only way to land a fetch at an exact point in React's commit.
 */
const calendarFetch = vi.hoisted(() => ({ hold: null as null | ((...args: never[]) => Promise<unknown>) }));
vi.mock("../lib/dataClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/dataClient")>();
  return {
    ...real,
    fetchTradingCalendar: (...args: Parameters<typeof real.fetchTradingCalendar>) =>
      calendarFetch.hold ? calendarFetch.hold(...(args as unknown as never[])) : real.fetchTradingCalendar(...args),
  };
});

import { __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import { startMockServer, type MockServer } from "../test/mockServer";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { previewExpression } from "../lib/dateExpressions";
import { fieldContext, formSubmitBody } from "../lib/params";
import { __resetTradingCalendarCacheForTests, useTradingCalendar, type TradingCalendars } from "./useTradingCalendar";

/** A fabricated XNYS closure on Tue 25 Aug 2026, and nothing else; XLON is not served. */
function calendarFor(url: URL): unknown {
  if (url.searchParams.get("exchange") !== "XNYS") return { __status: 404 };
  const year = Number(url.searchParams.get("year"));
  return {
    data: {
      Name: "Mock NYSE",
      Timezone: "America/New_York",
      TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
      ExchangeHolidays: year === 2026 ? { "2026-08-25": { Holiday: "Fixture Day", Type: "Official" } } : {},
    },
  };
}

const widget: WidgetDef = makeWidget({
  id: "cal",
  params: [
    { paramName: "symbol", type: "text" },
    { paramName: "d", type: "date" },
    { paramName: "l", type: "date", exchange: "XLON" },
  ],
});

const NOW = new Date(2026, 8, 14, 9, 30, 0);
const servers: MockServer[] = [];

async function serve(answer: (url: URL) => unknown = calendarFor): Promise<{ b: BackendConfig; s: MockServer }> {
  const s = await startMockServer({ "/api/v1/calendar/trading": (url: URL) => answer(url) });
  servers.push(s);
  return { b: backend({ baseUrl: s.url }), s };
}

const calendarRequests = (s: MockServer) => s.requests.filter((r) => r.path === "/api/v1/calendar/trading").map((r) => r.search);

beforeEach(() => {
  calendarFetch.hold = null;
  __reset();
  __resetLoggerForTests();
  __resetTradingCalendarCacheForTests();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("useTradingCalendar", () => {
  it("never asks the per-year route for an overnight calendar: only bundles describe one (2026-10-24)", async () => {
    const { b, s } = await serve();
    const cme = makeWidget({ exchange: "CMES", params: [{ paramName: "d", type: "date" }] });
    const { result } = renderHook(() => useTradingCalendar(cme, { d: "T-1bd(XPAR)" }, b, undefined, NOW));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).every((q) => q.startsWith("?exchange=XPAR&"))).toBe(true);
    expect(calendarRequests(s).length).toBeGreaterThan(0);
    expect(result.current.calendars.CMES).toBeUndefined();
  });

  it("fetches the current and previous year up front for every exchange the card's period params use, and is pending until the year its resolution consulted lands", async () => {
    const { b, s } = await serve();
    // T-1bd consults 2026 on both exchanges; a bare T consults no calendar at all.
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T-1bd", l: "T-1bd" }, b, undefined, NOW));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).sort()).toEqual([
      "?exchange=XLON&year=2025",
      "?exchange=XLON&year=2026",
      "?exchange=XNYS&year=2025",
      "?exchange=XNYS&year=2026",
    ]);
    const xnys = result.current.calendars.XNYS;
    expect(xnys.source).toBe("backend");
    expect(xnys.years).toEqual([2025, 2026]);
    expect(xnys.holidays["2026-08-25"]?.holiday).toBe("Fixture Day");
    // XLON answered 404 twice: no entry, so the resolver uses the weekday table.
    expect(result.current.calendars.XLON).toBeUndefined();
  });

  it("remembers a 404 for the session: a second card asks nothing more", async () => {
    const { b, s } = await serve();
    // T-1bd, not a bare T: `pending` only waits on a year a resolution consulted.
    const first = renderHook(() => useTradingCalendar(widget, { d: "T-1bd", l: "T-1bd" }, b, undefined, NOW));
    await waitFor(() => expect(first.result.current.pending).toBe(false));
    const before = calendarRequests(s).length;
    const second = renderHook(() => useTradingCalendar(widget, { d: "T-1bd", l: "T-1bd" }, b, undefined, NOW));
    expect(second.result.current.pending).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calendarRequests(s).length).toBe(before);
  });

  it("fetches a year the resolution consulted beyond the two up front, waiting for it", async () => {
    const { b, s } = await serve();
    // T+4y-1bd on 14 Sep 2026 steps a day inside 2030, which is neither of the two years fetched first.
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T+4y-1bd" }, b, undefined, NOW));
    await waitFor(() => expect(calendarRequests(s)).toContain("?exchange=XNYS&year=2030"));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.calendars.XNYS.years).toEqual([2025, 2026, 2030]);
  });

  it("never asks for a year outside 1990–2040", async () => {
    const { b, s } = await serve();
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T+20y-1bd" }, b, undefined, NOW));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).some((q) => q.includes("year=2046"))).toBe(false);
  });

  it("keeps its identity while the loaded calendars do not change", async () => {
    const { b } = await serve();
    const { result, rerender } = renderHook(
      ({ values }: { values: Record<string, string> }) => useTradingCalendar(widget, values, b, undefined, NOW),
      { initialProps: { values: { d: "T", symbol: "AAPL" } } },
    );
    await waitFor(() => expect(result.current.pending).toBe(false));
    const settled = result.current;
    rerender({ values: { d: "T", symbol: "MSFT" } });
    expect(result.current).toBe(settled);
    expect(result.current.calendars).toBe(settled.calendars);
  });

  it("answers the bundled NYSE file with nothing pending when there is no backend, and no entry for another MIC", async () => {
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T", l: "T" }, undefined, undefined, NOW));
    expect(result.current.pending).toBe(false);
    expect(result.current.calendars.XNYS.source).toBe("bundled");
    expect(result.current.calendars.XLON).toBeUndefined();
  });

  it("has no calendars and nothing pending for a widget with no period param", async () => {
    const { b, s } = await serve();
    const plain = makeWidget({ id: "plain", params: [{ paramName: "symbol", type: "text" }] });
    const { result } = renderHook(() => useTradingCalendar(plain, { symbol: "AAPL" }, b, undefined, NOW));
    expect(result.current).toEqual({ calendars: {}, pending: false, key: "", loading: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calendarRequests(s)).toEqual([]);
  });

  it("never waits on the up-front years for a card whose values consult no calendar (a literal date)", async () => {
    const { b, s } = await serve((url) => ({ ...(calendarFor(url) as object), __delayMs: 300 }));
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "2026-01-02" }, b, undefined, NOW));
    expect(result.current.pending).toBe(false);
    // The up-front years are still asked for; they just never hold the card.
    await waitFor(() => expect(calendarRequests(s)).toHaveLength(4));
    expect(result.current.pending).toBe(false);
    await waitFor(() => expect(result.current.calendars.XNYS.source).toBe("backend"));
    expect(result.current.pending).toBe(false);
  });

  it("waits on the year a T-1bd resolution consulted, not on the up-front previous year", async () => {
    // 2025 is held open; T-1bd on Mon 14 Sep 2026 is Fri 11 Sep, which consults 2026 alone.
    const { b } = await serve((url) =>
      url.searchParams.get("year") === "2025" ? { ...(calendarFor(url) as object), __delayMs: 600 } : calendarFor(url),
    );
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T-1bd" }, b, undefined, NOW));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    // Released by 2026 alone: 2025 is still in flight.
    expect(result.current.calendars.XNYS.years).toEqual([2026]);
    await waitFor(() => expect(result.current.calendars.XNYS.years).toEqual([2025, 2026]), { timeout: 3000 });
  });

  it("stops waiting when the consulted year's fetch fails", async () => {
    const { b } = await serve((url) => {
      if (url.searchParams.get("year") === "2026") return { __status: 500 };
      return { ...(calendarFor(url) as object), __delayMs: 600 };
    });
    const { result } = renderHook(() => useTradingCalendar(widget, { d: "T-1bd" }, b, undefined, NOW));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    // 2026 was refused and 2025 has not answered: the bundled file, not a wait.
    expect(result.current.calendars.XNYS.source).toBe("bundled");
    await waitFor(() => expect(result.current.calendars.XNYS.years).toEqual([2025]), { timeout: 3000 });
  });

  it("releases a card whose consulted year landed between its render and its effect", async () => {
    // Card A's fetch is in flight when card B renders, so B's memo computes
    // `pending`. The fetch lands after B commits but before B's passive
    // effect runs; that effect then finds the year cached, has nothing to
    // join, and — without the fix — never re-renders B, so B stays pending.
    let land!: () => void;
    const gate = new Promise<void>((resolve) => (land = resolve));
    // null is a remembered refusal: enough, on its own, to end a wait.
    calendarFetch.hold = () => gate.then(() => null);
    const b = backend({ baseUrl: "http://calendar.invalid" });
    const values = { d: "T-1bd" };
    const a = renderHook(() => useTradingCalendar(widget, values, b, undefined, NOW));
    expect(a.result.current.pending).toBe(true);

    // B renders outside act, as the app renders: its passive effect then runs
    // in a later task than its commit, and its layout effect lands A's fetch
    // in the gap, whose microtasks write the cache before that task.
    const actEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
    actEnv.IS_REACT_ACT_ENVIRONMENT = false;
    const seen: TradingCalendars[] = [];
    function CardB() {
      seen.push(useTradingCalendar(widget, values, b, undefined, NOW));
      useLayoutEffect(() => land(), []);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    root.render(<CardB />);
    try {
      await waitFor(() => expect(a.result.current.pending).toBe(false));
      expect(seen[0]?.pending).toBe(true);
      await waitFor(() => expect(seen[seen.length - 1]?.pending).toBe(false));
    } finally {
      root.unmount();
      actEnv.IS_REACT_ACT_ENVIRONMENT = wasActEnv;
    }
  });

  it("loads a calendar for the Date expression card, whose expr param is text/number, not a period type (#148)", async () => {
    const { b, s } = await serve();
    const dateProbe = BUILTIN_WIDGETS.find((w) => w.id === "date_probe")!;
    // Wed 26 Aug 2026: one business day back is Tue 25 Aug, the fixture's
    // holiday, so a calendar-aware step lands on Mon 24 Aug instead (PR
    // #145's rule: a bd step always lands on a session, never a holiday).
    const probeNow = new Date(2026, 7, 26, 9, 30, 0);
    const values = { expr: "T-1bd", fy_end: "12" };
    const { result } = renderHook(() => useTradingCalendar(dateProbe, values, b, undefined, probeNow));
    await waitFor(() => expect(calendarRequests(s)).toContain("?exchange=XNYS&year=2026"));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.calendars.XNYS?.source).toBe("backend");

    render(<DateProbeRenderer params={values} now={probeNow} calendars={result.current.calendars} exchange="XNYS" />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent(/served by this card's backend/i);
    expect(screen.queryByTestId("probe-fallback")).toBeNull();
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-08-24");
  });

  it("loads the dashboard's exchange for a param and widget that name none (v5.4.0)", async () => {
    const { b, s } = await serve();
    const w = makeWidget({ id: "dx", params: [{ paramName: "d", type: "date" }] });
    const { result } = renderHook(() => useTradingCalendar(w, { d: "T-1bd" }, b, undefined, NOW, "XLON"));
    await waitFor(() => expect(calendarRequests(s)).toContain("?exchange=XLON&year=2026"));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).some((q) => q.includes("exchange=XNYS"))).toBe(false);
  });

  it("asks for the calendars a value names by (MIC) and by symbol, and never one outside the nine (review focus 2)", async () => {
    const { b, s } = await serve();
    const w = makeWidget({ exchange: "XNAS", params: [{ paramName: "symbol", type: "text" }, { paramName: "d", type: "date" }] });
    const { result } = renderHook(() => useTradingCalendar(w, { symbol: "VOD.L", d: "T-1bd(XTKS)" }, b, undefined, NOW));
    await waitFor(() => expect(result.current.pending).toBe(false));
    const asked = new Set(calendarRequests(s).map((search) => new URLSearchParams(search).get("exchange")));
    expect([...asked].sort()).toEqual(["XLON", "XTKS"]);
  });

  it("never asks for a widget exchange outside the nine; T-1bd on it reads Unknown calendar (review focus 2)", async () => {
    const { b, s } = await serve();
    // `e` names XTKS, which sorts after XNAS: its requests go out after any XNAS one would, so once they have
    // arrived an XNAS request would have too.
    const w = makeWidget({
      exchange: "XNAS",
      params: [{ paramName: "d", type: "date" }, { paramName: "e", type: "date", exchange: "XTKS" }],
    });
    const values = { d: "T-1bd", e: "T-1bd" };
    const { result } = renderHook(() => useTradingCalendar(w, values, b, undefined, NOW));
    await waitFor(() => expect(calendarRequests(s)).toHaveLength(2));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).map((q) => new URLSearchParams(q).get("exchange"))).toEqual(["XTKS", "XTKS"]);
    const ctx = fieldContext(w, w.params[0], { calendars: result.current.calendars }, values);
    expect(previewExpression("date", "T-1bd", { now: NOW, ...ctx })?.error).toBe("Unknown calendar XNAS");
  });
});

it("loads a form date field's (MIC) calendar on a card that does not otherwise use it, and POSTs its date (final rereview I-A)", async () => {
  // London closed Monday 31 Aug 2026; weekdays alone would POST that Monday.
  const { b, s } = await serve((url) =>
    url.searchParams.get("exchange") !== "XLON"
      ? { __status: 404 }
      : {
          data: {
            Name: "Mock LSE",
            Timezone: "Europe/London",
            TradingHours: { Open: "08:00:00", Close: "16:30:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
            ExchangeHolidays: { "2026-08-31": { Holiday: "Summer Bank Holiday", Type: "Official" } },
          },
        },
  );
  const go = { paramName: "go", type: "button" as const, label: "Go" };
  const form = { endpoint: "x", inputs: [{ paramName: "d", type: "date" as const }, go] };
  const w = makeWidget({ id: "f", params: [{ paramName: "symbol", type: "text" }, { paramName: "f", type: "form", form }] });
  const values = { symbol: "AAPL", "f.d": "T-1bd(XLON)" };
  const now = new Date(2026, 8, 1, 12, 0, 0);
  const { result } = renderHook(() => useTradingCalendar(w, values, b, undefined, now));
  await waitFor(() => expect(result.current.calendars.XLON?.source).toBe("backend"));
  expect(calendarRequests(s)).toContain("?exchange=XLON&year=2026");
  expect(formSubmitBody("f", form, values, go, { now, calendars: result.current.calendars, widget: w })).toEqual({ d: "2026-08-28", go: true });
});

describe("a legacy card's form date fields (final rereview 2, ruling RF5)", () => {
  const go = { paramName: "go", type: "button" as const, label: "Go" };
  const form = { endpoint: "post", inputs: [{ paramName: "d", type: "date" as const }, go] };
  const w = makeWidget({ id: "f", params: [{ paramName: "symbol", type: "text" }, { paramName: "f", type: "form", form }] });
  const JAN = new Date(2026, 0, 15, 12, 0, 0);
  /** London closed on 1 Jan, 25 and 26 Dec of every year, and nothing else. */
  const london = (url: URL) => {
    if (url.searchParams.get("exchange") !== "XLON") return { __status: 404 };
    const y = url.searchParams.get("year");
    const official = { Holiday: "Fixture", Type: "Official" };
    return {
      data: {
        Name: "Mock LSE",
        Timezone: "Europe/London",
        TradingHours: { Open: "08:00:00", Close: "16:30:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
        ExchangeHolidays: { [`${y}-01-01`]: official, [`${y}-12-25`]: official, [`${y}-12-26`]: official },
      },
    };
  };

  async function serveWithForm(answer: (url: URL) => unknown) {
    const s = await startMockServer({ "/api/v1/calendar/trading": answer, "/post": {} });
    servers.push(s);
    return { b: backend({ baseUrl: s.url }), s };
  }

  /** The card's form, plus what its calendar hook is still fetching, so a test can wait for that to settle. */
  function Card({ b, value }: { b: BackendConfig; value: string }) {
    const values = { symbol: "AAPL", "f.d": value };
    const t = useTradingCalendar(w, values, b, undefined, JAN);
    return (
      <>
        <span data-testid="loading">{t.loading?.join(",")}</span>
        <WidgetFormPanel
          formParamName="f"
          form={form}
          values={values}
          card={makeCard()}
          groups={undefined}
          groupsDisabled={false}
          query={{}}
          backend={b}
          wire={{ widget: w, calendars: t.calendars, loading: t.loading, now: JAN }}
          onEdit={() => {}}
          onSubmitted={() => {}}
        />
      </>
    );
  }

  const posts = (s: MockServer) => s.requests.filter((r) => r.path === "/post");
  // Clicked once, outside waitFor: a click inside it changes the form's status line, which re-fires waitFor's
  // observer, which clicks again -- a loop that starves the timers the fetches need.
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Go" }));
  const settled = () => waitFor(() => expect(screen.getByTestId("loading").textContent).toBe(""));

  it("(a) fetches the older years T-400bd(XLON) reaches and POSTs London's date", async () => {
    const { b, s } = await serveWithForm(london);
    render(<Card b={b} value="T-400bd(XLON)" />);
    await waitFor(() => expect(calendarRequests(s)).toContain("?exchange=XLON&year=2024"));
    await settled();
    submit();
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    // Weekdays alone would give 2024-07-04; London's six closures in the span move it to 2024-06-26.
    expect(JSON.parse(posts(s)[0].body)).toEqual({ d: "2024-06-26", go: true });
  });

  it("(b) refuses visibly, with no POST, when the backend refuses the calendar", async () => {
    const { b, s } = await serveWithForm(() => ({ __status: 404 }));
    render(<Card b={b} value="T-1bd(XLON)" />);
    await waitFor(() => expect(calendarRequests(s)).toContain("?exchange=XLON&year=2026"));
    await settled();
    submit();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("d: XLON calendar not loaded"));
    expect(posts(s)).toHaveLength(0);
  });

  it("(c) refuses a submit before the calendar lands as still loading, then POSTs once it has", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, s } = await serveWithForm(london);
    const real = (await vi.importActual<typeof import("../lib/dataClient")>("../lib/dataClient")).fetchTradingCalendar;
    // Every calendar answer waits for the release, then comes from the real fetch (and the mock server).
    calendarFetch.hold = (...args: never[]) => gate.then(() => real(...(args as unknown as Parameters<typeof real>)));
    render(<Card b={b} value="T-1bd(XLON)" />);
    submit();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("d: XLON calendar still loading"));
    expect(posts(s)).toHaveLength(0);
    release();
    await settled();
    submit();
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(JSON.parse(posts(s)[0].body)).toEqual({ d: "2026-01-14", go: true });
  });
});
