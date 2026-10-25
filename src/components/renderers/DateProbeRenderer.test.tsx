// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bundledCalendar } from "../../lib/calendar";
import type { CalendarBundle } from "../../lib/calendars/contracts";
import { bundleCalendar } from "../../lib/calendars/resolver";
import xlon from "../../lib/calendars/vendor/conformance/XLON.json";
import { DateProbeRenderer } from "./DateProbeRenderer";

// Fixed, so the assertions are about the grammar rather than about today.
// A Monday: T-1bd is the Friday before, T-1d is the Sunday.
const now = new Date("2026-09-14T13:00:00Z");
const cal = { XNYS: bundledCalendar("XNYS")! };

const probe = (expr: string, extra: Record<string, string> = {}) => (
  <DateProbeRenderer
    params={{ expr, ...extra }}
    now={now}
    zone="America/New_York"
    calendars={cal}
    exchange="XNYS"
  />
);

describe("DateProbeRenderer", () => {
  it("renders an @ expression, whose date projection cannot resolve, without throwing (review I1)", () => {
    render(probe("T-1bd@close"));
    expect(screen.getByLabelText("datetime")).toHaveTextContent("2026-09-11T16:00:00-04:00");
  });

  it("shows both projections of one expression at once", () => {
    // The whole point of the card: the same expression answers differently
    // depending on the param type it lands in, and that is invisible
    // anywhere else in the app.
    render(probe("T"));
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-14");
    expect(screen.getByLabelText("datetime")).toHaveTextContent("2026-09-14T09:00:00-04:00");
  });

  it("evaluates the expression from As of, and shows it", () => {
    // Monday 2026-09-07 is Labor Day; T-1bd from Tuesday the 8th is Friday the 4th.
    render(probe("T-1bd", { as_of: "2026-09-08T14:00:00Z" }));
    expect(screen.getByLabelText("as of")).toHaveTextContent("2026-09-08T14:00:00Z");
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-04");
  });

  it("re-reads an As of of T as the current time on every render", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-14T13:00:00Z"));
      const at = (expr: string) => <DateProbeRenderer params={{ expr, as_of: "T" }} zone="America/New_York" calendars={cal} exchange="XNYS" />;
      const { rerender } = render(at("T"));
      expect(screen.getByLabelText("as of")).toHaveTextContent("2026-09-14T09:00:00-04:00");
      vi.setSystemTime(new Date("2026-09-15T13:00:00Z"));
      rerender(at("T-1bd"));
      expect(screen.getByLabelText("as of")).toHaveTextContent("2026-09-15T09:00:00-04:00");
      expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-14");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts business days on the exchange's calendar, not on weekdays alone", () => {
    // 2026-09-07 is Labor Day in the bundled file, so five sessions back
    // from Monday the 14th is Friday the 4th -- not the 7th.
    render(probe("T-5bd"));
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-04");
  });

  it("separates a calendar-day step from a business-day one", () => {
    const { rerender } = render(probe("T-5"));
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-09");
    rerender(probe("T-5bd"));
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-04");
  });

  it("says when a value is a literal rather than an expression", () => {
    // `TSLA` and `Today` both look like they might parse and do not. The app
    // sends them as-is, and a user staring at an unchanged value deserves to
    // be told that is what happened rather than guessing at a bug.
    render(probe("TSLA"));
    expect(screen.getByTestId("probe-parse")).toHaveTextContent(/literal/i);
    expect(screen.getByLabelText("date")).toHaveTextContent("TSLA");
  });

  it("calls a real expression an expression", () => {
    render(probe("Q-4"));
    expect(screen.getByTestId("probe-parse")).toHaveTextContent(/expression/i);
    expect(screen.getByTestId("probe-parse")).not.toHaveTextContent(/literal/i);
  });

  it("resolves the fiscal anchors on the year end it is given", () => {
    // FY0 under a September year end starts in the previous October.
    render(probe("FY0", { fy_end: "9" }));
    expect(screen.getByLabelText("date")).toHaveTextContent("2025-10-01");
    // And under the default December it is January.
    render(probe("FY0"));
    expect(screen.getAllByLabelText("date")[1]).toHaveTextContent("2026-01-01");
  });

  it("warns only when the calendar is really degraded, not merely bundled", () => {
    // The bundled NYSE file carries real holidays and early closes. The app's
    // trace calls it a fallback (it is not the backend's), but warning about
    // it on every XNYS card would be noise -- so the card names the source
    // without alarm.
    const { rerender } = render(probe("T-1bd"));
    expect(screen.queryByTestId("probe-fallback")).toBeNull();
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent(/bundled/i);

    // XLON has no calendar loaded: weekday hours answer, with no holidays at
    // all, and THAT the card must say out loud.
    rerender(
      <DateProbeRenderer params={{ expr: "T-1bd" }} now={now} zone="America/New_York" calendars={cal} exchange="XLON" />,
    );
    expect(screen.getByTestId("probe-fallback")).toHaveTextContent(/XLON/);
  });

  it("finds its calendar when the dashboard names no exchange", () => {
    // Most dashboards store no exchange, so WidgetCard hands over none.
    // useTradingCalendar files the calendar under calendarOf's default (XNYS)
    // in that case, and the card must look there too: it used to look under
    // "" and resolve on plain weekdays with a calendar sitting loaded.
    render(<DateProbeRenderer params={{ expr: "T-5bd" }} now={now} zone="America/New_York" calendars={cal} />);
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-04");
    expect(screen.queryByTestId("probe-fallback")).toBeNull();
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent(/XNYS.*bundled/i);
  });

  it("shows nothing to resolve when the expression is empty", () => {
    render(probe(""));
    expect(screen.getByTestId("probe-empty")).toBeInTheDocument();
    expect(screen.queryByLabelText("date")).toBeNull();
  });
});

describe("the calendar footer (spec)", () => {
  const xlonCal = bundleCalendar([xlon as CalendarBundle], { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, "operational-v1");
  const at = new Date("2026-12-29T12:00:00Z");

  it("names the expression's own calendar and where it came from", () => {
    render(<DateProbeRenderer params={{ expr: "T-1bd(XLON)" }} now={at} zone="UTC" calendars={{ XLON: xlonCal, ...cal }} />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("Calendar: XLON (from the expression) — served by this card's backend");
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-12-24");
  });

  it("says Default (XNYS) only when nothing else applies", () => {
    render(<DateProbeRenderer params={{ expr: "T" }} now={now} zone="America/New_York" calendars={cal} />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("Calendar: Default (XNYS)");
    render(probe("T"));
    expect(screen.getAllByTestId("probe-calendar")[1]).toHaveTextContent("Calendar: XNYS (from the dashboard)");
  });

  it("names both calendars of a mixed range", () => {
    render(<DateProbeRenderer params={{ expr: "T-3bd(XLON)..T" }} now={at} zone="UTC" calendars={{ XLON: xlonCal, ...cal }} exchange="XNYS" />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XNYS (from the dashboard)");
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XLON (from the expression)");
  });

  it("shows an unknown calendar as an error", () => {
    render(<DateProbeRenderer params={{ expr: "T(XNYZ)" }} now={now} zone="UTC" calendars={cal} />);
    expect(screen.getByTestId("probe-error")).toHaveTextContent("⚠ Unknown calendar XNYZ");
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XNYZ (from the expression) — unknown calendar");
  });

  it("fills both rows for an @ expression, with no warning (R13a)", () => {
    const tokyo = new Date("2026-09-14T03:00:00Z");
    const { unmount } = render(<DateProbeRenderer params={{ expr: "T@09:30(XTKS)" }} now={tokyo} zone="UTC" calendars={cal} />);
    expect(screen.getByLabelText("datetime")).toHaveTextContent("2026-09-14T09:30:00+09:00");
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-14");
    expect(screen.queryByTestId("probe-error")).toBeNull();
    unmount();
    render(probe("T-1bd@close(XNYS)"));
    expect(screen.getByLabelText("datetime")).toHaveTextContent("2026-09-11T16:00:00-04:00");
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-09-11");
    expect(screen.queryByTestId("probe-error")).toBeNull();
  });
});
