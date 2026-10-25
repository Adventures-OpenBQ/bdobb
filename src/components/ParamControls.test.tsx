// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The endpoint-param tests below fetch their option lists over genuine HTTP
// from src/test/mockServer.ts, as useWidgetData.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import { __resetParamOptionsCacheForTests } from "../hooks/useParamOptions";
import { startMockServer, type MockServer } from "../test/mockServer";
import type { ParamEdit } from "../lib/paramGroups";
import type { BackendConfig, DashboardCard, ParamGroup, ParamOption, WidgetDef, WidgetParam } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { bundledCalendar } from "../lib/calendar";
import { bundleCalendar } from "../lib/calendars/resolver";
import type { CalendarBundle } from "../lib/calendars/contracts";
import xnysYearEnd from "../lib/calendars/vendor/conformance/XNYS-2026-12.json";
import { monthLabel } from "../lib/periods";
import { fiscalReason } from "../lib/fiscalChain";
import { ParamControls } from "./ParamControls";

const widget: WidgetDef = makeWidget({
  id: "w1",
  category: "",
  gridData: { w: 1, h: 1 },
  params: [
    { paramName: "symbol", label: "Symbol", type: "text" },
    { paramName: "start", label: "Start", type: "date" },
    { paramName: "limit", label: "Limit", type: "number" },
    { paramName: "cache", label: "Use cache", type: "boolean" },
    { paramName: "period", label: "Period", options: [{ label: "Daily", value: "d" }] },
    { paramName: "provider", value: "fmp", show: false },
    { paramName: "layout", type: "form" },
  ],
});

const card: DashboardCard = makeCard({
  id: "c1",
  widgetId: "w1",
  params: { symbol: "AAPL", provider: "fmp" },
  layout: { x: 0, y: 0, w: 1, h: 1 },
});

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetParamOptionsCacheForTests();
});

describe("ParamControls", () => {
  function renderStrip(over: Partial<Parameters<typeof ParamControls>[0]> = {}) {
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={widget}
        card={card}
        groups={undefined}
        groupsDisabled={false}
        effective={{ symbol: "AAPL", provider: "fmp" }}
        backend={undefined}
        onApply={onApply}
        {...over}
      />,
    );
    return onApply;
  }

  it("renders a stored value that cannot resolve instead of throwing (review I1)", () => {
    for (const start of ["T(XNYZ)", "T@14:00"]) {
      const { unmount } = render(
        <ParamControls
          widget={widget}
          card={card}
          groups={undefined}
          groupsDisabled={false}
          effective={{ symbol: "AAPL", provider: "fmp", start }}
          backend={undefined}
          onApply={vi.fn()}
        />,
      );
      expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
      unmount();
    }
  });

  it("renders a control per visible param and none for the hidden ones", () => {
    renderStrip();
    expect(screen.getByLabelText("Symbol")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByLabelText("Limit")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Use cache")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("Period").tagName).toBe("SELECT");
    expect(screen.queryByLabelText("provider")).not.toBeInTheDocument();
  });

  it("idPrefix prefixes the field id, and the label still resolves via getByLabelText", () => {
    renderStrip({ idPrefix: "x-" });
    const symbol = screen.getByLabelText("Symbol");
    expect(symbol).toHaveAttribute("id", "x-c1-symbol");
  });

  it("commits a typed field on blur, through the split edit, and only when it changed", async () => {
    const onApply = renderStrip();
    const symbol = screen.getByLabelText("Symbol");
    await userEvent.clear(symbol);
    await userEvent.type(symbol, "TSLA");
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ symbol: "TSLA" }),
      groupEdits: [],
    });
    // Typed back to what it was: leaving the field writes nothing.
    await userEvent.clear(symbol);
    await userEvent.type(symbol, "AAPL");
    await userEvent.tab();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("commits a typed field on Enter", async () => {
    const onApply = renderStrip();
    await userEvent.type(screen.getByLabelText("Limit"), "5{Enter}");
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ limit: "5" }),
      groupEdits: [],
    });
  });

  // Enter that confirms an IME composition belongs to the IME, not the field.
  it("does not commit on an Enter that ends an IME composition", async () => {
    const onApply = renderStrip();
    const limit = screen.getByLabelText("Limit");
    await userEvent.type(limit, "5");
    fireEvent.keyDown(limit, { key: "Enter", isComposing: true });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("commits a select and a checkbox on change", async () => {
    const onApply = renderStrip();
    await userEvent.selectOptions(screen.getByLabelText("Period"), "d");
    expect(onApply).toHaveBeenLastCalledWith({
      cardParams: expect.objectContaining({ period: "d" }),
      groupEdits: [],
    });
    await userEvent.click(screen.getByLabelText("Use cache"));
    expect(onApply).toHaveBeenLastCalledWith({
      cardParams: expect.objectContaining({ cache: "true" }),
      groupEdits: [],
    });
  });

  it("writes an unseeded boolean on check and again on uncheck, never on its own", async () => {
    // The commits have to flow back as the next `effective` for the box to
    // stay checked: React restores a controlled checkbox that no re-render
    // moved, so against an inert mock the second click would be another CHECK
    // and the uncheck half of this test would never run.
    const onApply = vi.fn();
    function Row() {
      const [params, setParams] = useState<Record<string, string>>({
        symbol: "AAPL",
        provider: "fmp",
      });
      return (
        <ParamControls
          widget={widget}
          card={{ ...card, params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={undefined}
          onApply={(edit) => {
            onApply(edit);
            setParams(edit.cardParams);
          }}
        />
      );
    }
    render(<Row />);

    const box = screen.getByLabelText("Use cache");
    // "cache" has no seeded default, so it is absent and displays as "". What
    // must NOT happen is a write of "false" onto a card that never had the
    // param when nothing was clicked.
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(box);
    await userEvent.click(box);
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenNthCalledWith(1, {
      cardParams: expect.objectContaining({ cache: "true" }),
      groupEdits: [],
    });
    expect(onApply).toHaveBeenNthCalledWith(2, {
      cardParams: expect.objectContaining({ cache: "false" }),
      groupEdits: [],
    });
  });

  it("keeps the control's accessible name to its label; the badge is a separate button", () => {
    const grouped: DashboardCard = { ...card, bindings: [{ groupId: "g1", paramName: "symbol" }] };
    const groups: ParamGroup[] = [
      { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
    ];
    renderStrip({ card: grouped, groups, effective: { symbol: "MSFT" } });
    expect(screen.getByLabelText("Symbol")).toHaveValue("MSFT");
    expect(screen.queryByLabelText("Symbol (shared)")).not.toBeInTheDocument();
  });

  it("shows a date control the stored token, with what it resolves to underneath", () => {
    // v5.4.x reverses what the BOX shows. It used to hold the resolved date
    // while the card stored the token, which meant typing an expression
    // resolved it away as you typed. The token now stays in the box and its
    // resolution reads beneath, so the stored value is visible and editable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      renderStrip({ effective: { start: "$currentDate" } });
      expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("$currentDate");
      expect(screen.getByTestId("param-resolved")).toHaveTextContent("2026-08-23");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves T only in a period param: a date shows today, a text param keeps AT&T's ticker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      renderStrip({ effective: { start: "T", symbol: "T" } });
      // The date param keeps its token in the box and resolves beneath it;
      // the text param keeps AT&T's ticker, resolving nothing at all.
      expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("T");
      expect(screen.getByTestId("param-resolved")).toHaveTextContent("2026-08-23");
      expect(screen.getByLabelText("Symbol")).toHaveValue("T");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not burn a $currentDate token when today's date is re-picked", async () => {
    // shouldAdvanceTime: the clock is pinned for $currentDate, but timers
    // still run. With a fully frozen clock the first click into the day
    // segment never resolves, user-event's advanceTimers hook or not.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onApply = renderStrip({ effective: { start: "$currentDate" } });
      const group = screen.getByRole("group", { name: "Start" });
      // Leaves the control the way a user does: Tab until focus is outside
      // the whole group (past the segments and the calendar button). The
      // DatePicker's blur is focus-WITHIN, so a blur event on one segment
      // alone would never report it.
      const leave = async () => {
        while (group.contains(document.activeElement)) await user.tab();
      };
      // Was an arrow-key edit of the day segment; the box is free text now.
      // Typed away and typed back: leaving must write nothing, since the
      // value is what the token already resolves to.
      const box = () => screen.getByRole("textbox", { name: "Start" });
      await user.clear(box());
      await user.type(box(), "2026-08-22");
      await user.clear(box());
      await user.type(box(), "2026-08-23");
      await leave();
      expect(onApply).not.toHaveBeenCalled();
      // A real change, left the same way, is written.
      await user.clear(box());
      await user.type(box(), "2026-08-22");
      await leave();
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith({
        cardParams: expect.objectContaining({ start: "2026-08-22" }),
        groupEdits: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a stored T in a datetime param resolved, and a popover pick commits it at once", async () => {
    // Design §10: a stored expression displays resolved. shouldAdvanceTime
    // for the same reason as the $currentDate test above: user-event's
    // clicks wait on timers that a fully frozen clock never runs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 14, 9, 30, 15));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const asOf = makeWidget({
        ...widget,
        params: [{ paramName: "asof", label: "As of", type: "datetime", granularity: "second" }],
      });
      const onApply = renderStrip({ widget: asOf, effective: { asof: "T" } });
      const trigger = screen.getByRole("button", { name: "As of" });
      expect(trigger.textContent).toMatch(/^2026-09-14 09:30:15 /);
      await user.click(trigger);
      await screen.findByRole("dialog", { name: "As of" });
      // A pick commits through onApply straight away, like a select: no blur,
      // no Enter, and the time of day T resolved to is kept.
      await user.click(screen.getByRole("button", { name: /September 3, 2026/ }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith({
        cardParams: expect.objectContaining({ asof: expect.stringMatching(/^2026-09-03T09:30:15[+-]\d{2}:\d{2}$/) }),
        groupEdits: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("displays a quarter under its own year end and commits a popover pick at once", async () => {
    const fiscal: WidgetDef = {
      ...widget,
      params: [{ paramName: "quarter", label: "Quarter", type: "quarter" }],
    };
    const onApply = renderStrip({
      widget: fiscal,
      card: { ...card, params: { quarter: "2026-Q3" } },
      effective: { quarter: "2026-Q3" },
      fiscalYearEnd: { quarter: 9 },
    });
    expect(screen.getByRole("button", { name: "Quarter" })).toHaveTextContent("FY2026-Q3");
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByRole("dialog", { name: "Quarter" });
    await userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));
    await userEvent.click(screen.getByRole("button", { name: "FY2027-Q1 (Oct–Dec 2026)" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ quarter: "2027-Q1" }),
      groupEdits: [],
    });
  });

  it("shows a stored T in a quarter or week param resolved, each in its own vocabulary", () => {
    // Design §10. Frozen at midday, so the expectation is a day-level one
    // that no clock movement within the test can cross. 14 Sep 2026 is a
    // Monday: ISO week 38 starts that day. Under a September year end it is
    // the last month of FY2026, so Q4; under December it is calendar Q3.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
    try {
      const periods: WidgetDef = {
        ...widget,
        params: [
          { paramName: "quarter", label: "Quarter", type: "quarter" },
          { paramName: "calQuarter", label: "Calendar quarter", type: "quarter" },
          { paramName: "week", label: "Week", type: "week" },
        ],
      };
      renderStrip({
        widget: periods,
        effective: { quarter: "T", calQuarter: "T", week: "T" },
        fiscalYearEnd: { quarter: 9 },
      });
      expect(screen.getByRole("button", { name: "Quarter" })).toHaveTextContent("FY2026-Q4");
      expect(screen.getByRole("button", { name: "Calendar quarter" })).toHaveTextContent("FY2026-Q3");
      expect(screen.getByRole("button", { name: "Week" })).toHaveTextContent("W38 2026 · Sep 14–20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a bound control's edit to its group and shows the badge", async () => {
    const grouped: DashboardCard = { ...card, bindings: [{ groupId: "g1", paramName: "symbol" }] };
    const groups: ParamGroup[] = [
      { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
    ];
    const onApply = renderStrip({ card: grouped, groups, effective: { symbol: "MSFT" } });
    expect(
      screen.getByRole("button", { name: "Group 1: Ticker — shared across grouped cards" }),
    ).toBeInTheDocument();
    const symbol = screen.getByLabelText("Symbol");
    await userEvent.clear(symbol);
    await userEvent.type(symbol, "TSLA");
    await userEvent.tab();
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ symbol: "AAPL" }),
      groupEdits: [{ groupId: "g1", value: "TSLA" }],
    });
  });

  it("shows a select's stored value honestly when it is absent from options", () => {
    renderStrip({ effective: { symbol: "AAPL", provider: "fmp", period: "w" } });
    expect(screen.getByLabelText("Period")).toHaveValue("w");
  });

  it("leaves a static select with nothing stored showing its first option", () => {
    // "period" is absent from `effective`, so it displays as "". A static
    // select has no fetched list behind it and no "" to represent — it must
    // read exactly as it did before endpoint options existed: the first
    // option, no blank row.
    renderStrip();
    const period = screen.getByLabelText("Period") as HTMLSelectElement;
    expect(Array.from(period.options).map((o) => o.textContent)).toEqual(["Daily"]);
    expect(period).toHaveValue("d");
  });

  it("shows an optional static select with nothing stored as blank, not its first option", () => {
    // Nothing stored means nothing sent: the request carries no filter, so
    // the select must not read as though its first option were applied.
    const optionalWidget = makeWidget({
      ...widget,
      params: [
        {
          paramName: "security_type",
          label: "Security Type",
          optional: true,
          options: [
            { label: "bill", value: "bill" },
            { label: "note", value: "note" },
          ],
        },
      ],
    });
    renderStrip({ widget: optionalWidget, effective: {} });
    const select = screen.getByLabelText("Security Type") as HTMLSelectElement;
    expect(select).toHaveValue("");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["bill", "note", ""]);
  });

  describe("expressions (v5.3.0)", () => {
    const periodWidget: WidgetDef = makeWidget({
      id: "w2",
      params: [
        { paramName: "symbol", label: "Symbol", type: "text" },
        { paramName: "start", label: "Start", type: "date" },
        { paramName: "quarter", label: "Quarter", type: "quarter" },
        { paramName: "range", label: "Range", type: "date_range", rangeEnd: "end" },
      ],
    });
    const periodCard: DashboardCard = makeCard({ id: "c2", widgetId: "w2", params: { symbol: "AAPL", start: "T-1bd", quarter: "2026-Q3", range: "T-7d/T" } });

    function renderPeriod(over: Partial<Parameters<typeof ParamControls>[0]> = {}) {
      const onApply = vi.fn();
      const onSavePreset = vi.fn();
      const onDeletePreset = vi.fn();
      render(
        <ParamControls
          widget={periodWidget}
          card={periodCard}
          groups={undefined}
          groupsDisabled={false}
          effective={{ ...periodCard.params }}
          backend={undefined}
          calendars={{ XNYS: bundledCalendar("XNYS")! }}
          presets={[{ name: "Two weeks", expr: "T-2w" }]}
          onSavePreset={onSavePreset}
          onDeletePreset={onDeletePreset}
          onApply={onApply}
          {...over}
        />,
      );
      return { onApply, onSavePreset, onDeletePreset };
    }

    it("puts an unknown calendar on the ⚠ badge, as an error, not a fallback", () => {
      renderPeriod({ effective: { ...periodCard.params, start: "T-1bd(XNYZ)" } });
      const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
      expect(start.querySelector(".param-badge-warn")).toHaveAttribute("aria-label", "Calendar error: Unknown calendar XNYZ");
    });

    it("announces a calendar error through a status region", () => {
      renderPeriod({ effective: { ...periodCard.params, start: "T-1bd(XNYZ)" } });
      const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
      expect(within(start as HTMLElement).getByRole("status")).toHaveTextContent("Calendar error: Unknown calendar XNYZ");
      expect(start.querySelector(".param-badge-warn")).toHaveAttribute("tabindex", "0");
    });

    it("shows no Provisional badge under operational-v1, nor under planning-v1 with no provisional day", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-29T15:00:00Z"));
      try {
        const single = { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" } as const;
        const plain = structuredClone(xnysYearEnd) as CalendarBundle;
        const marked = structuredClone(xnysYearEnd) as CalendarBundle;
        marked.days.find((d: { date: string }) => d.date === "2026-12-28")!.evidenceStatus = "provisional";
        for (const [bundle, policy] of [[marked, "operational-v1"], [plain, "planning-v1"]] as const) {
          const { unmount } = render(
            <ParamControls
              widget={periodWidget}
              card={periodCard}
              groups={undefined}
              groupsDisabled={false}
              effective={{ ...periodCard.params }}
              backend={undefined}
              calendars={{ XNYS: bundleCalendar([bundle], single, policy) }}
              presets={[]}
              onApply={vi.fn()}
            />,
          );
          expect(document.querySelector(".param-badge-provisional")).toBeNull();
          unmount();
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("puts an @ on a date parameter on the ⚠ badge", () => {
      renderPeriod({ effective: { ...periodCard.params, start: "T@close" } });
      const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
      expect(start.querySelector(".param-badge-warn")).toHaveAttribute("aria-label", "Calendar error: @ needs a date-and-time parameter");
    });

    it("shows a Provisional badge when planning-v1 accepted a provisional day", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-29T15:00:00Z"));
      try {
        const bundle = structuredClone(xnysYearEnd) as CalendarBundle;
        bundle.days.find((d: { date: string }) => d.date === "2026-12-28")!.evidenceStatus = "provisional";
        const xnys = bundleCalendar([bundle], { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, "planning-v1");
        renderPeriod({ calendars: { XNYS: xnys } });
        const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
        expect(start.querySelector(".param-badge-provisional")).toHaveTextContent("Provisional");
      } finally {
        vi.useRealTimers();
      }
    });

    it("marks a control holding an expression with ◷, and one that used a fallback calendar with ⚠ naming the reason", () => {
      renderPeriod();
      const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
      // Ruling 2 (task-11 review): the accessible name IS the tooltip text —
      // a screen reader only gets `title` as the description, and a
      // non-focusable badge can't be reached to hear it at all. `aria-label`
      // and `title` must therefore be the same string on both badges.
      const exprBadge = start.querySelector(".param-badge-expr");
      expect(exprBadge?.getAttribute("aria-label")).toMatch(
        /^Expression T-1bd, resolves now to \d{4}-\d{2}-\d{2}, updates when the card refreshes$/,
      );
      expect(exprBadge?.getAttribute("title")).toBe(exprBadge?.getAttribute("aria-label"));
      const warnBadge = start.querySelector(".param-badge-warn");
      expect(warnBadge).toHaveAttribute(
        "aria-label",
        "Fallback calendar: No trading calendar for XNYS on this backend; using the bundled NYSE calendar",
      );
      expect(warnBadge?.getAttribute("title")).toBe(warnBadge?.getAttribute("aria-label"));
      const quarter = screen.getByRole("button", { name: "Quarter" }).closest(".param-field")!;
      expect(quarter.querySelector(".param-badge-expr")).toBeNull();
      expect(quarter.querySelector(".param-badge-warn")).toBeNull();
      const range = screen.getByRole("button", { name: "Range" }).closest(".param-field")!;
      const rangeBadge = range.querySelector(".param-badge-expr");
      expect(rangeBadge?.getAttribute("aria-label")).toMatch(
        /^Expression T-7d\/T, resolves now to \d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}, updates when the card refreshes$/,
      );
      expect(rangeBadge?.getAttribute("title")).toBe(rangeBadge?.getAttribute("aria-label"));
      expect(range.querySelector(".param-badge-warn")).toBeNull();
    });

    it("applies an expression from a popover's Relative tab through the split edit, and lands on Relative for a stored one", async () => {
      const { onApply } = renderPeriod();
      await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
      await screen.findByRole("dialog", { name: "Quarter" });
      expect(screen.getByRole("tab", { name: "Absolute" })).toHaveAttribute("aria-selected", "true");
      await userEvent.click(screen.getByRole("tab", { name: "Relative" }));
      await userEvent.click(screen.getByRole("button", { name: "Fiscal YoY" }));
      expect(screen.getByText(/^resolves now to \d{4}-Q[1-4]$/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.quarter).toBe("FQ-4");
      await userEvent.click(screen.getByRole("button", { name: "Range" }));
      await screen.findByRole("dialog", { name: "Range" });
      expect(screen.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
    });

    it("commits an expression from the day picker's calendar at once", async () => {
      const { onApply } = renderPeriod();
      await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("button", { name: "Prior session" }));
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.start).toBe("prev_trade_date");
    });

    it("drops a half-typed date when the day picker's calendar applies an expression: one write, the expression", async () => {
      // The calendar's close reports a blur, which commits a pending segment
      // draft. Applying an expression must not let the abandoned literal be
      // written first — that would refetch the card for a value nobody wants.
      const { onApply } = renderPeriod();
      const half = screen.getByRole("textbox", { name: "Start" });
      await userEvent.clear(half);
      await userEvent.type(half, "2026-08-22");
      expect(onApply).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("tab", { name: "Relative" }));
      await userEvent.click(screen.getByRole("button", { name: "Prior session" }));
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.start).toBe("prev_trade_date");
    });

    it("hands the dashboard's presets to the tab, filtered per type, and routes save and delete to the callbacks", async () => {
      const { onSavePreset, onDeletePreset } = renderPeriod();
      // `T-2w` is a single atom: the date control's rows can express it, a
      // range's cannot, so the chip is on Start's tab and not on Range's.
      await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
      await screen.findByRole("dialog");
      expect(screen.getByRole("button", { name: "Two weeks" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Delete preset Two weeks" }));
      expect(onDeletePreset).toHaveBeenCalledWith("Two weeks");
      await userEvent.click(screen.getByRole("button", { name: "Save as preset" }));
      await userEvent.type(screen.getByLabelText("Preset name"), "Bd{Enter}");
      expect(onSavePreset).toHaveBeenCalledWith("Bd", "T-1bd");
      await userEvent.keyboard("{Escape}");
      await userEvent.click(screen.getByRole("button", { name: "Range" }));
      await screen.findByRole("dialog", { name: "Range" });
      expect(screen.queryByRole("button", { name: "Two weeks" })).not.toBeInTheDocument();
    });
  });
});

const CHAMBERS: ParamOption[] = [
  { label: "House", value: "house" },
  { label: "Senate", value: "senate" },
];
const HOUSE: ParamOption[] = [
  { label: "Ways and Means", value: "wm" },
  { label: "Financial Services", value: "fs" },
];
const SENATE: ParamOption[] = [
  { label: "Finance", value: "fin" },
  { label: "Banking", value: "bank" },
];
const PORTS: ParamOption[] = [
  { label: "Alpha", value: "a" },
  { label: "Bravo", value: "b" },
  { label: "Charlie", value: "c" },
];

/** A switch, not an index lookup: an index would also answer for inherited keys. */
function committeesFor(url: URL): ParamOption[] {
  switch (url.searchParams.get("chamber")) {
    case "house":
      return HOUSE;
    case "senate":
      return SENATE;
    default:
      return [];
  }
}

const cascadeWidget: WidgetDef = {
  ...widget,
  id: "congress",
  params: [
    {
      paramName: "chamber",
      label: "Chamber",
      type: "endpoint",
      optionsEndpoint: "chambers",
      description: "Which chamber",
    },
    {
      paramName: "committee",
      label: "Committee",
      type: "endpoint",
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
  ],
};

/**
 * Two dependents of one upstream. Both ask the SAME question of the same
 * endpoint, so they share one request and one response — which is what puts
 * both of their clears in a single cascade pass, the case the single-write
 * test below is about.
 */
const twoDownstreamWidget: WidgetDef = {
  ...widget,
  id: "congress-two",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
    {
      paramName: "committee",
      label: "Committee",
      type: "endpoint",
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
    {
      paramName: "cochair",
      label: "Cochair",
      type: "endpoint",
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
  ],
};

const hiddenParamWidget: WidgetDef = {
  ...widget,
  id: "with-file",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
    // Out of scope at this version, and show:false in the live manifest.
    { paramName: "file", roles: ["fileSelector"], optionsEndpoint: "files", show: false },
  ],
};

const multiCascadeWidget: WidgetDef = {
  ...widget,
  id: "ports-cascade",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
    {
      paramName: "ports",
      label: "Ports",
      multiSelect: true,
      optionsEndpoint: "ports",
      optionsParams: { chamber: "$chamber" },
    },
  ],
};

/**
 * A `multiple` field (`note`) sharing an upstream with a plain select
 * (`committee`): both consult `committees` keyed on `chamber`, so a chamber
 * change clears `committee` but must leave `note`'s typed value alone
 * (ruling 17) — the same cascade pass the plain-select tests above pin.
 */
const multipleCascadeWidget: WidgetDef = {
  ...widget,
  id: "congress-multiple",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
    {
      paramName: "committee",
      label: "Committee",
      type: "endpoint",
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
    {
      paramName: "note",
      label: "Note",
      multiple: true,
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
  ],
};

const multiEndpointWidget: WidgetDef = {
  ...widget,
  id: "ports",
  params: [{ paramName: "ports", label: "Ports", multiSelect: true, optionsEndpoint: "ports" }],
};

const multiStaticWidget: WidgetDef = {
  ...widget,
  id: "ports-static",
  params: [{ paramName: "ports", label: "Ports", multiSelect: true, options: PORTS }],
};

const servers: MockServer[] = [];

async function serveOptions(over: Record<string, unknown> = {}) {
  const s = await startMockServer({
    "/chambers": CHAMBERS,
    "/committees": (url: URL) => committeesFor(url),
    "/ports": PORTS,
    ...over,
  });
  servers.push(s);
  return backend({ baseUrl: s.url });
}

const lastServer = () => servers[servers.length - 1];
const searches = (path: string) =>
  lastServer()
    .requests.filter((r) => r.path === path)
    .map((r) => r.search);
const labelsOf = (select: HTMLElement) =>
  Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("ParamControls with optionsEndpoint params", () => {
  /**
   * The row commits to the card as it goes, and a committed upstream value is
   * what makes a downstream list refetch — so the mock that records the writes
   * has to feed them back as the next `effective`, exactly as the store does.
   * Without that loop nothing would cascade: `onApply` alone changes nothing.
   */
  function renderCascade(
    initial: Record<string, string>,
    backend: BackendConfig | undefined,
    applied: ParamEdit[] = [],
  ) {
    const onApply = vi.fn((edit: ParamEdit) => applied.push(edit));
    function Row() {
      const [params, setParams] = useState<Record<string, string>>(initial);
      return (
        <ParamControls
          widget={cascadeWidget}
          card={{ ...card, id: "cc", widgetId: "congress", params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={backend}
          onApply={(edit) => {
            onApply(edit);
            setParams(edit.cardParams);
          }}
        />
      );
    }
    render(<Row />);
    return onApply;
  }

  it("renders an endpoint param as a select of the fetched options", async () => {
    const backend = await serveOptions();
    renderCascade({ chamber: "house", committee: "wm" }, backend);

    await waitFor(() => expect(labelsOf(screen.getByLabelText("Chamber"))).toEqual(["House", "Senate"]));
    expect(screen.getByLabelText("Chamber").tagName).toBe("SELECT");
    await waitFor(() => expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
      "Ways and Means",
      "Financial Services",
    ]));
    expect(searches("/committees")).toEqual(["?chamber=house"]);
  });

  it("disables an endpoint select while its list loads, showing the stored value", async () => {
    const backend = await serveOptions();
    renderCascade({ chamber: "house" }, backend);

    // Before any response: nothing to choose from yet, so the control cannot
    // be operated — but it displays what the card stores rather than a blank
    // or a phantom first option.
    expect(screen.getByLabelText("Chamber")).toBeDisabled();
    expect(screen.getByLabelText("Chamber")).toHaveValue("house");
    await waitFor(() => expect(screen.getByLabelText("Chamber")).toBeEnabled());
  });

  it("refetches a dependent param when its upstream changes, and clears a value the new list no longer offers", async () => {
    const backend = await serveOptions();
    const onApply = renderCascade({ chamber: "house", committee: "wm" }, backend);

    // Gated on the House list being ON SCREEN. A pending control already
    // shows its stored value, so `toHaveValue("wm")` would pass before any
    // response and let the chamber switch race the first fetch.
    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    await waitFor(() =>
      // The trailing blank is the cleared value's own option: a single select
      // can only report "" if an option with that value is selected (React
      // otherwise force-selects the first option), so "nothing chosen" has to
      // be a row of its own.
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", ""]),
    );
    // "wm" is a House committee; the Senate list does not offer it, so the
    // cleared value is written to the card in its turn.
    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    expect(searches("/committees")).toEqual(["?chamber=house", "?chamber=senate"]);

    // The pick IS the write; there is no Apply to batch it with the cleared
    // downstream, so the committee's clearing is a second write of its own —
    // and the first write still carries the value the new list withdrew.
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenNthCalledWith(1, {
      cardParams: expect.objectContaining({ chamber: "senate", committee: "wm" }),
      groupEdits: [],
    });
    expect(onApply).toHaveBeenNthCalledWith(2, {
      cardParams: expect.objectContaining({ chamber: "senate", committee: "" }),
      groupEdits: [],
    });
  });

  it("clears two downstream params in ONE write, so neither undoes the other", async () => {
    // Every write carries a full cardParams built from the same card prop, so
    // two writes out of one cascade pass would see the second put back the
    // first's pre-clear value — and clearedForKey has already stamped both
    // names, so nothing would ever clear it again.
    const backend = await serveOptions();
    const onApply = vi.fn();
    function Row() {
      const [params, setParams] = useState<Record<string, string>>({
        chamber: "house",
        committee: "wm",
        cochair: "fs",
      });
      return (
        <ParamControls
          widget={twoDownstreamWidget}
          card={{ ...card, id: "c2", widgetId: "congress-two", params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={backend}
          onApply={(edit) => {
            onApply(edit);
            setParams(edit.cardParams);
          }}
        />
      );
    }
    render(<Row />);

    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );
    expect(screen.getByLabelText("Cochair")).toHaveValue("fs");

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    // Both House committees are gone from the Senate list.
    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    expect(screen.getByLabelText("Cochair")).toHaveValue("");

    // The chamber pick, then exactly one write clearing both.
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenNthCalledWith(2, {
      cardParams: expect.objectContaining({ chamber: "senate", committee: "", cochair: "" }),
      groupEdits: [],
    });
  });

  it("keeps a downstream value the new list still offers", async () => {
    const backend = await serveOptions({
      "/committees": (url: URL) =>
        url.searchParams.get("chamber") === "house"
          ? HOUSE
          : [{ label: "Ways and Means", value: "wm" }, { label: "Finance", value: "fin" }],
    });
    const onApply = renderCascade({ chamber: "house", committee: "wm" }, backend);
    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    await waitFor(() => expect(searches("/committees")).toHaveLength(2));
    await settle();
    expect(screen.getByLabelText("Committee")).toHaveValue("wm");
    // Nothing cleared, so the chamber pick is the only write.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ chamber: "senate", committee: "wm" }),
      groupEdits: [],
    });
  });

  it("never clears a stored value on the first result after the row opens, even one the list does not offer", async () => {
    const backend = await serveOptions();
    const onApply = renderCascade({ chamber: "senate", committee: "wm" }, backend);

    // The Senate list does not offer "wm", but merely opening the row must
    // not rewrite the card: the value is shown honestly and nothing commits.
    await waitFor(() => expect(searches("/committees")).toEqual(["?chamber=senate"]));
    await settle();
    expect(screen.getByLabelText("Committee")).toHaveValue("wm");
    expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", "wm"]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not clear a downstream value when an unrelated edit leaves its key alone", async () => {
    const backend = await serveOptions();
    const onApply = renderCascade({ chamber: "senate", committee: "wm" }, backend);
    await waitFor(() => expect(labelsOf(screen.getByLabelText("Chamber"))).toEqual(["House", "Senate"]));
    expect(searches("/committees")).toHaveLength(1);

    // Re-picking the value the chamber select already shows is not a change,
    // so nothing is written and no key moves; the committee value survives.
    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    await settle();
    expect(onApply).not.toHaveBeenCalled();
    expect(searches("/committees")).toHaveLength(1);
    expect(screen.getByLabelText("Committee")).toHaveValue("wm");
  });

  it("falls back to a text input carrying the fetch error as its title", async () => {
    const backend = await serveOptions({
      "/chambers": { __status: 500, __body: { detail: "choices unavailable" } },
    });
    renderCascade({ chamber: "house" }, backend);

    await waitFor(() =>
      expect(screen.getByLabelText("Chamber")).toHaveAttribute("type", "text"),
    );
    expect(screen.getByLabelText("Chamber")).toHaveValue("house");
    // The row is a titlebar with no space for a hint line, so the message
    // takes the description's place as the control's own tooltip.
    expect(screen.getByLabelText("Chamber")).toHaveAttribute(
      "title",
      "HTTP 500: choices unavailable",
    );
    expect(screen.queryByText("Which chamber")).not.toBeInTheDocument();
  });

  it("reports every endpoint param as an error when there is no backend", async () => {
    renderCascade({ chamber: "house" }, undefined);

    await waitFor(() =>
      expect(screen.getByLabelText("Chamber")).toHaveAttribute("type", "text"),
    );
    expect(screen.getByLabelText("Chamber")).toHaveAttribute("title", "Backend not configured");
    expect(screen.getByLabelText("Committee")).toHaveAttribute("title", "Backend not configured");
  });

  it("commits an errored param's typed value on blur", async () => {
    // The fallback input is a typed field like any other: it drafts while the
    // user types and writes when focus leaves. On hiddenParamWidget, whose
    // chamber has no dependent param, so typing moves no request key.
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={hiddenParamWidget}
        card={{ ...card, id: "cf", widgetId: "with-file", params: { chamber: "house" } }}
        groups={undefined}
        groupsDisabled={false}
        effective={{ chamber: "house" }}
        backend={undefined}
        onApply={onApply}
      />,
    );
    const chamber = await waitFor(() => {
      const el = screen.getByLabelText("Chamber");
      expect(el).toHaveAttribute("type", "text");
      return el;
    });

    await userEvent.clear(chamber);
    await userEvent.type(chamber, "senate");
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ chamber: "senate" }),
      groupEdits: [],
    });
  });

  it("clears a downstream value when the upstream changes while its first list is still in flight", async () => {
    // The House list never arrives before the switch, so the Senate list IS
    // the first list this param ever shows. It is still not the list the
    // row opened on — its key says so — and "wm" must clear all the same.
    const backend = await serveOptions({
      "/committees": (url: URL) =>
        url.searchParams.get("chamber") === "house"
          ? { __delayMs: 200, __status: 200, __body: HOUSE }
          : SENATE,
    });
    const onApply = renderCascade({ chamber: "house", committee: "wm" }, backend);

    await waitFor(() => expect(labelsOf(screen.getByLabelText("Chamber"))).toEqual(["House", "Senate"]));
    // Pins the race this test is about: the House request is still open.
    expect(screen.getByLabelText("Committee")).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));

    // The House answer is still on its way. Let it land here, inside act, so
    // it cannot arrive during teardown as an unwrapped update — and assert
    // what it must NOT do: it belongs to the chamber the row has left, so
    // neither its list nor the cleared value may come back.
    await act(() => settle());
    expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", ""]);
    expect(screen.getByLabelText("Committee")).toHaveValue("");

    // The chamber pick was written first, still carrying the old committee —
    // the list that withdraws it had not arrived. The clearing write corrects
    // it.
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenNthCalledWith(1, {
      cardParams: expect.objectContaining({ chamber: "senate", committee: "wm" }),
      groupEdits: [],
    });
    expect(onApply).toHaveBeenNthCalledWith(2, {
      cardParams: expect.objectContaining({ chamber: "senate", committee: "" }),
      groupEdits: [],
    });
  });

  it("drops a draft the cascade cleared, so the typed value cannot shadow the write", async () => {
    // The committee list 500s for House, so that control falls back to a text
    // input and what is typed into it is held as a draft. An upstream change
    // from OUTSIDE the row — a group edit on another card, which moves no
    // focus and so commits no draft — then lands a list the draft is not in.
    // The clear is committed; the draft has to go with it, or the control
    // would keep showing a value the card no longer holds.
    const backend = await serveOptions({
      "/committees": (url: URL) =>
        url.searchParams.get("chamber") === "house"
          ? { __status: 500, __body: { detail: "choices unavailable" } }
          : SENATE,
    });
    const onApply = vi.fn();
    function Row({ chamber }: { chamber: string }) {
      const [written, setWritten] = useState<Record<string, string>>({
        chamber: "house",
        committee: "wm",
      });
      const params = { ...written, chamber };
      return (
        <ParamControls
          widget={cascadeWidget}
          card={{ ...card, id: "cc", widgetId: "congress", params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={backend}
          onApply={(edit) => {
            onApply(edit);
            setWritten(edit.cardParams);
          }}
        />
      );
    }
    const { rerender } = render(<Row chamber="house" />);

    await waitFor(() =>
      expect(screen.getByLabelText("Committee")).toHaveAttribute("type", "text"),
    );
    await userEvent.clear(screen.getByLabelText("Committee"));
    await userEvent.type(screen.getByLabelText("Committee"), "zzz");
    expect(screen.getByLabelText("Committee")).toHaveValue("zzz");

    rerender(<Row chamber="senate" />);

    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ chamber: "senate", committee: "" }),
      groupEdits: [],
    });
  });

  it("clears again when the upstream returns to the value the row opened on", async () => {
    // The row stays mounted across a commit, so the key a param "opened on"
    // has to move with the card. Otherwise a return to the original chamber
    // looks like the opening result and the stale committee survives.
    const backend = await serveOptions();
    const applied: ParamEdit[] = [];
    renderCascade({ chamber: "house", committee: "wm" }, backend, applied);

    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");
    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    await userEvent.selectOptions(screen.getByLabelText("Committee"), "fin");
    expect(applied[applied.length - 1].cardParams).toMatchObject({
      chamber: "senate",
      committee: "fin",
    });

    // Back to House, with the card now holding a Senate committee.
    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "house");

    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    expect(applied[applied.length - 1].cardParams).toMatchObject({
      chamber: "house",
      committee: "",
    });
  });

  it("still clears when a commit lands while the new list is in flight", async () => {
    // The upstream write lands between the pick and the answer. The key the
    // answer will arrive under is NOT what this param opened on — it is still
    // loading — so re-seeding must not adopt it, or the answer looks like an
    // opening result and the stale committee survives.
    const backend = await serveOptions({
      "/committees": (url: URL) =>
        url.searchParams.get("chamber") === "house"
          ? HOUSE
          : { __delayMs: 200, __status: 200, __body: SENATE },
    });
    const applied: ParamEdit[] = [];
    renderCascade({ chamber: "house", committee: "wm" }, backend, applied);

    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");
    // Written with the Senate list still on its way, carrying the old value.
    expect(applied).toHaveLength(1);
    expect(applied[0].cardParams).toMatchObject({ chamber: "senate", committee: "wm" });

    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));
    expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", ""]);
    expect(applied).toHaveLength(2);
    expect(applied[1].cardParams).toMatchObject({ chamber: "senate", committee: "" });
  });

  it("keeps a stored value when a backend appears while the row is open", async () => {
    // An error state names no list and, with no backend, no real key either:
    // adopting it as the key this param opened on would make the FIRST real
    // list look like a cascade and wipe a value the user never touched.
    const backend = await serveOptions();
    const onApply = vi.fn();
    const props = {
      card: { ...card, id: "cc", widgetId: "congress", params: { chamber: "senate", committee: "wm" } },
      effective: { chamber: "senate", committee: "wm" },
    };
    const { rerender } = render(
      <ParamControls
        widget={cascadeWidget}
        card={props.card}
        groups={undefined}
        groupsDisabled={false}
        effective={props.effective}
        backend={undefined}
        onApply={onApply}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Chamber")).toHaveAttribute("title", "Backend not configured"),
    );

    rerender(
      <ParamControls
        widget={cascadeWidget}
        card={props.card}
        groups={undefined}
        groupsDisabled={false}
        effective={props.effective}
        backend={backend}
        onApply={onApply}
      />,
    );

    // The Senate list does not offer "wm", and that is exactly the value that
    // must survive: this is the first list the row has ever seen.
    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", "wm"]),
    );
    await settle();
    expect(screen.getByLabelText("Committee")).toHaveValue("wm");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("fetches nothing for a hidden param", async () => {
    // A show:false param has no control, so a request for its options buys
    // nothing — and the live manifest's fileSelector params are all hidden.
    const backend = await serveOptions({ "/files": [{ label: "A", value: "a" }] });
    render(
      <ParamControls
        widget={hiddenParamWidget}
        card={{ ...card, id: "cf", widgetId: "with-file", params: { chamber: "house" } }}
        groups={undefined}
        groupsDisabled={false}
        effective={{ chamber: "house" }}
        backend={backend}
        onApply={vi.fn()}
      />,
    );

    // The row did fetch — for the visible param only.
    await waitFor(() => expect(labelsOf(screen.getByLabelText("Chamber"))).toEqual(["House", "Senate"]));
    await settle();
    expect(searches("/files")).toEqual([]);
  });
});

describe("ParamControls multi-select params", () => {
  function renderMulti(w: WidgetDef, value: string, backend: BackendConfig | undefined) {
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={w}
        card={{ ...card, id: "cp", widgetId: w.id, params: { ports: value } }}
        groups={undefined}
        groupsDisabled={false}
        effective={{ ports: value }}
        backend={backend}
        onApply={onApply}
      />,
    );
    return onApply;
  }

  it("splits a comma-joined value across the selection and joins it back on change", async () => {
    const backend = await serveOptions();
    const onApply = renderMulti(multiEndpointWidget, "a,b", backend);

    const select = (await waitFor(() => {
      const s = screen.getByLabelText("Ports") as HTMLSelectElement;
      expect(s.options).toHaveLength(3);
      return s;
    })) as HTMLSelectElement;
    expect(select.multiple).toBe(true);
    expect(Array.from(select.selectedOptions).map((o) => o.value)).toEqual(["a", "b"]);

    await userEvent.selectOptions(select, "c");
    // Joined in document order, which is the option order the backend gave.
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ ports: "a,b,c" }),
      groupEdits: [],
    });
  });

  it("drops a deselected member from the joined value", async () => {
    const backend = await serveOptions();
    const onApply = renderMulti(multiEndpointWidget, "a,b", backend);
    const select = await waitFor(() => {
      const s = screen.getByLabelText("Ports") as HTMLSelectElement;
      expect(s.options).toHaveLength(3);
      return s;
    });

    await userEvent.deselectOptions(select, "b");
    expect(onApply).toHaveBeenCalledWith({
      cardParams: expect.objectContaining({ ports: "a" }),
      groupEdits: [],
    });
  });

  it("drops the members a cascade's new list no longer offers, keeping the rest", async () => {
    const backend = await serveOptions({
      "/ports": (url: URL) =>
        url.searchParams.get("chamber") === "house" ? PORTS : [{ label: "Alpha", value: "a" }],
    });
    const onApply = vi.fn();
    function Row() {
      const [params, setParams] = useState<Record<string, string>>({
        chamber: "house",
        ports: "a,b",
      });
      return (
        <ParamControls
          widget={multiCascadeWidget}
          card={{ ...card, id: "pc", widgetId: "ports-cascade", params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={backend}
          onApply={(edit) => {
            onApply(edit);
            setParams(edit.cardParams);
          }}
        />
      );
    }
    render(<Row />);

    const select = await waitFor(() => {
      const s = screen.getByLabelText("Ports") as HTMLSelectElement;
      expect(s.options).toHaveLength(3);
      return s;
    });
    expect(Array.from(select.selectedOptions).map((o) => o.value)).toEqual(["a", "b"]);

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    // "b" is gone from the new list; "a" is still offered and stays selected.
    await waitFor(() =>
      expect(
        Array.from((screen.getByLabelText("Ports") as HTMLSelectElement).selectedOptions).map(
          (o) => o.value,
        ),
      ).toEqual(["a"]),
    );
    expect(onApply).toHaveBeenLastCalledWith({
      cardParams: expect.objectContaining({ chamber: "senate", ports: "a" }),
      groupEdits: [],
    });
  });

  it("shows its stored members selected while the list is still loading", async () => {
    const backend = await serveOptions();
    renderMulti(multiEndpointWidget, "a,b", backend);

    // Same rule as the single select: pending means disabled, not amnesiac.
    const select = screen.getByLabelText("Ports") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(Array.from(select.selectedOptions).map((o) => o.value)).toEqual(["a", "b"]);

    await waitFor(() => expect(screen.getByLabelText("Ports")).toBeEnabled());
  });

  it("uses the static list, and issues no request, for a multi param with no endpoint", async () => {
    const backend = await serveOptions();
    renderMulti(multiStaticWidget, "a", backend);

    const select = screen.getByLabelText("Ports") as HTMLSelectElement;
    // Never disabled waiting on a fetch that will never happen.
    expect(select).toBeEnabled();
    expect(labelsOf(select)).toEqual(["Alpha", "Bravo", "Charlie"]);
    await settle();
    expect(lastServer().requests).toHaveLength(0);
  });
});

describe("ParamControls quarter ranges (v5.4.0)", () => {
  it("draws a quarter_range as the two-grid picker and commits a pick through the split edit", async () => {
    const w = makeWidget({ id: "wr", params: [{ paramName: "span", label: "Span", type: "quarter_range", rangeEnd: "span_end" }] });
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cr", widgetId: "wr", params: { span: "2026-Q1/2026-Q2" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ span: "2026-Q1/2026-Q2" }}
        backend={undefined}
        onApply={onApply}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Span" });
    expect(trigger).toHaveTextContent("FY2026-Q1 – FY2026-Q2");
    await userEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Span" });
    await userEvent.click(within(screen.getByRole("group", { name: "Span start" })).getByRole("button", { name: "FY2026-Q2 (Apr–Jun 2026)" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Span end" })).getByRole("button", { name: "FY2026-Q3 (Jul–Sep 2026)" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.span).toBe("2026-Q2/2026-Q3");
  });
});

describe("ParamControls fiscal year ends (v5.4.0)", () => {
  const quarterWidget = makeWidget({
    id: "wq",
    params: [
      { paramName: "symbol", label: "Symbol", type: "text" },
      { paramName: "start", label: "Start", type: "date" },
      { paramName: "q", label: "Quarter", type: "quarter" },
    ],
  });
  const quarterCard = makeCard({ id: "cq", widgetId: "wq", params: { symbol: "AAPL", start: "T-1bd", q: "2026-Q3" } });

  function renderFiscal(over: Partial<Parameters<typeof ParamControls>[0]> = {}) {
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={quarterWidget}
        card={quarterCard}
        groups={undefined}
        groupsDisabled={false}
        effective={{ ...quarterCard.params }}
        backend={undefined}
        onApply={onApply}
        {...over}
      />,
    );
    return onApply;
  }

  it("shows the FY ends control with the resolution in its Automatic option, and reports a month or Automatic", async () => {
    const onChange = vi.fn();
    renderFiscal({ fiscalControl: { month: 9, source: "lookup", ticker: "AAPL", onChange } });
    const fy = screen.getByLabelText("FY ends") as HTMLSelectElement;
    expect(fy.value).toBe("");
    expect(fy.selectedOptions[0].textContent).toBe(`Automatic (${monthLabel(9)} · AAPL)`);
    expect([...fy.options].map((o) => o.value)).toEqual(["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(fy.options[6].textContent).toBe(monthLabel(6));
    await userEvent.selectOptions(fy, "6");
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("shows the override selected, plain Automatic first, and Automatic clears it", async () => {
    const onChange = vi.fn();
    renderFiscal({ fiscalControl: { month: 9, source: "lookup", ticker: "AAPL", override: 6, onChange } });
    const fy = screen.getByLabelText("FY ends") as HTMLSelectElement;
    expect(fy.value).toBe("6");
    expect(fy.options[0].textContent).toBe("Automatic");
    await userEvent.selectOptions(fy, "");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("has no FY ends control without one", () => {
    renderFiscal();
    expect(screen.queryByLabelText("FY ends")).not.toBeInTheDocument();
  });

  it("joins a fiscal reason to a calendar one on one ⚠, and shows a fiscal reason alone", () => {
    renderFiscal({
      calendars: { XNYS: bundledCalendar("XNYS")! },
      fiscalReasons: { start: fiscalReason("AAPL"), q: fiscalReason("AAPL") },
    });
    const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
    const joined = start.querySelectorAll(".param-badge-warn");
    expect(joined).toHaveLength(1);
    expect(joined[0]).toHaveAttribute(
      "aria-label",
      "Fallback calendar: No trading calendar for XNYS on this backend; using the bundled NYSE calendar; Fiscal year end: no fiscal data for AAPL on this backend; using December",
    );
    expect(joined[0].getAttribute("title")).toBe(joined[0].getAttribute("aria-label"));
    const quarter = screen.getByRole("button", { name: "Quarter" }).closest(".param-field")!;
    expect(quarter.querySelector(".param-badge-warn")).toHaveAttribute(
      "aria-label",
      "Fiscal year end: no fiscal data for AAPL on this backend; using December",
    );
  });

  it("draws a month control as a dropdown of locale abbreviations, keeping each option's value, and commits at once", async () => {
    const monthWidget = makeWidget({
      id: "wy",
      params: [
        { paramName: "year_end", label: "Year end", options: [{ label: "December", value: "December" }, { label: "June", value: "June" }] },
        { paramName: "bare_end", label: "Bare end", type: "text" },
        { paramName: "q", label: "Quarter", type: "quarter", fiscalYearEndParam: "year_end" },
        { paramName: "q2", label: "Quarter two", type: "quarter", fiscalYearEndParam: "bare_end" },
      ],
    });
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={monthWidget}
        card={makeCard({ id: "cy", widgetId: "wy", params: { year_end: "December", bare_end: "12" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ year_end: "December", bare_end: "12", q: "2026-Q3", q2: "2026-Q3" }}
        backend={undefined}
        onApply={onApply}
      />,
    );
    const named = screen.getByLabelText("Year end") as HTMLSelectElement;
    expect(labelsOf(named)).toEqual([monthLabel(12), monthLabel(6)]);
    expect([...named.options].map((o) => o.value)).toEqual(["December", "June"]);
    const bare = screen.getByLabelText("Bare end") as HTMLSelectElement;
    expect(bare.tagName).toBe("SELECT");
    expect([...bare.options].map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(labelsOf(bare)[8]).toBe(monthLabel(9));
    await userEvent.selectOptions(bare, "9");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.bare_end).toBe("9");
  });
});

describe("ParamControls options templating (v5.4.0)", () => {
  it("sends a referenced date's wire value to the options endpoint, so T-1w arrives as a date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    try {
      const s = await startMockServer({ "/since_choices": [{ label: "One", value: "1" }] });
      servers.push(s);
      const w = makeWidget({
        id: "ws",
        params: [
          { paramName: "start", label: "Start", type: "date" },
          { paramName: "pick", label: "Pick", optionsEndpoint: "since_choices", optionsParams: { since: "$start" } },
        ],
      });
      render(
        <ParamControls
          widget={w}
          card={makeCard({ id: "cs", widgetId: "ws", params: { start: "T-1w" } })}
          groups={undefined}
          groupsDisabled={false}
          effective={{ start: "T-1w" }}
          backend={backend({ baseUrl: s.url })}
          onApply={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(s.requests.filter((r) => r.path === "/since_choices").map((r) => r.search)).toContain("?since=2026-08-19"),
      );
      expect(s.requests.some((r) => r.search.includes("T-1w"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ParamControls groupable: false (v5.4.0)", () => {
  it("draws no chain link for such a param, and one for the rest", () => {
    const w = makeWidget({
      id: "wg",
      params: [
        { paramName: "symbol", label: "Symbol", type: "text", groupable: false },
        { paramName: "limit", label: "Limit", type: "number" },
      ],
    });
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cg", widgetId: "wg", params: { symbol: "AAPL", limit: "5" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ symbol: "AAPL", limit: "5" }}
        backend={undefined}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Group Symbol" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group Limit" })).toBeInTheDocument();
  });
});

describe("ParamControls multiple and popupWidth (v5.4.0)", () => {
  it("draws a multiple dropdown as a text field suggesting its options, and commits a typed value on blur", async () => {
    const w = makeWidget({
      id: "wm",
      params: [{ paramName: "tag", label: "Tag", multiple: true, options: [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }] }],
    });
    const onApply = vi.fn();
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cm", widgetId: "wm", params: { tag: "a" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ tag: "a" }}
        backend={undefined}
        onApply={onApply}
      />,
    );
    const input = screen.getByLabelText("Tag") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    const list = document.getElementById(input.getAttribute("list")!)!;
    expect(list.tagName).toBe("DATALIST");
    expect([...list.querySelectorAll("option")].map((o) => o.value)).toEqual(["a", "b"]);
    await userEvent.clear(input);
    await userEvent.type(input, "zeta");
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.tab();
    expect((onApply.mock.calls[0][0] as ParamEdit).cardParams.tag).toBe("zeta");
  });

  it("keeps a multiple field's typed value through a cascade that clears a sibling select (ruling 17)", async () => {
    const backend = await serveOptions();
    const onApply = vi.fn();
    function Row() {
      const [params, setParams] = useState<Record<string, string>>({
        chamber: "house",
        committee: "wm",
        note: "",
      });
      return (
        <ParamControls
          widget={multipleCascadeWidget}
          card={{ ...card, id: "cn", widgetId: "congress-multiple", params }}
          groups={undefined}
          groupsDisabled={false}
          effective={params}
          backend={backend}
          onApply={(edit) => {
            onApply(edit);
            setParams(edit.cardParams);
          }}
        />
      );
    }
    render(<Row />);

    // Gated on the House list being on screen, as the plain-select cascade
    // tests above do, so the chamber switch below cannot race the first fetch.
    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
        "Ways and Means",
        "Financial Services",
      ]),
    );

    const note = screen.getByLabelText("Note") as HTMLInputElement;
    await userEvent.clear(note);
    await userEvent.type(note, "zeta");
    await userEvent.tab();
    await waitFor(() => expect(onApply.mock.calls.at(-1)?.[0].cardParams.note).toBe("zeta"));

    await userEvent.selectOptions(screen.getByLabelText("Chamber"), "senate");

    // The contrast case: committee shares the same options fetch and IS
    // cleared, proving the cascade actually ran.
    await waitFor(() =>
      expect(labelsOf(screen.getByLabelText("Committee"))).toEqual(["Finance", "Banking", ""]),
    );
    await waitFor(() => expect(screen.getByLabelText("Committee")).toHaveValue(""));

    // note is a `multiple` field (control kind "suggest") — skipped by
    // cascade clearing, so its typed value must survive the same pass that
    // just wiped committee.
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("zeta");
    expect(onApply.mock.calls.map((c) => (c[0] as ParamEdit).cardParams.note)).not.toContain("");
  });

  it("sizes a period popover by the param's popupWidth", async () => {
    const w = makeWidget({ id: "wp", params: [{ paramName: "q", label: "Quarter", type: "quarter", popupWidth: 640 }] });
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cp", widgetId: "wp", params: { q: "2026-Q3" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ q: "2026-Q3" }}
        backend={undefined}
        onApply={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    const dialog = await screen.findByRole("dialog", { name: "Quarter" });
    expect((dialog.closest(".react-aria-Popover") as HTMLElement).style.width).toBe("640px");
  });
});

describe("chips", () => {
  // Adapts the brief's renderControls({ params, values }) shorthand to this
  // file's render pattern (see "sizes a period popover" above): a one-off
  // widget/card carrying just the params under test, `values` doubling as
  // both the card's stored params and `effective` (there is no group/preset
  // machinery in play here to make the two diverge).
  function renderControls({ params, values }: { params: WidgetParam[]; values: Record<string, string> }) {
    const w = makeWidget({ id: "wc", params });
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cc", widgetId: "wc", params: values })}
        groups={undefined}
        groupsDisabled={false}
        effective={values}
        backend={undefined}
        onApply={vi.fn()}
      />,
    );
  }

  it("hides the label visually for a select and keeps it as the accessible name", () => {
    renderControls({ params: [{ paramName: "chamber", type: "text", label: "Chamber", options: [{ label: "House", value: "house" }] }], values: { chamber: "house" } });
    const field = screen.getByLabelText("Chamber").closest(".param-field")!;
    expect(field).toHaveAttribute("data-chip", "");
    expect(field.querySelector(".param-label")).toHaveClass("param-label-hidden");
    expect(field).toHaveAttribute("title", "Chamber");
  });

  it("keeps the label visible for a text field", () => {
    renderControls({ params: [{ paramName: "symbol", type: "text", label: "Symbol" }], values: { symbol: "AAPL" } });
    const field = screen.getByLabelText("Symbol").closest(".param-field")!;
    expect(field).not.toHaveAttribute("data-chip");
    expect(field.querySelector(".param-label")).not.toHaveClass("param-label-hidden");
  });

  // getAllByLabelText, not getByLabelText: since 5.3.2 the date control is an
  // expression field, so the label names BOTH the role="group" wrapper and the
  // input inside it. They sit in the same .param-field, which is what these two
  // assert on, so the first match is as good as either.
  it("puts the resolved date in the chip's tooltip for a date expression, and leaves the ◷ badge's text alone", () => {
    renderControls({ params: [{ paramName: "start", type: "date", label: "Start" }], values: { start: "T-1bd" } });
    const field = screen.getAllByLabelText("Start")[0].closest(".param-field")!;
    const badge = screen.getByRole("img", { name: /^Expression T-1bd, resolves now to \d{4}-\d{2}-\d{2}, updates when the card refreshes$/ });
    expect(field).toHaveAttribute("title", badge.getAttribute("aria-label"));
  });

  it("uses the label as the tooltip for a literal date", () => {
    renderControls({ params: [{ paramName: "start", type: "date", label: "Start" }], values: { start: "2026-09-19" } });
    expect(screen.getAllByLabelText("Start")[0].closest(".param-field")).toHaveAttribute("title", "Start");
  });

  it("chips the FY ends select like the rest of the row", () => {
    const w = makeWidget({ id: "wfy", params: [{ paramName: "q", label: "Quarter", type: "quarter" }] });
    render(
      <ParamControls
        widget={w}
        card={makeCard({ id: "cfy", widgetId: "wfy", params: { q: "2026-Q3" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ q: "2026-Q3" }}
        backend={undefined}
        onApply={vi.fn()}
        fiscalControl={{ month: 9, source: "lookup", ticker: "AAPL", onChange: vi.fn() }}
      />,
    );
    const field = screen.getByLabelText("FY ends").closest(".param-field")!;
    expect(field).toHaveAttribute("data-chip", "");
    expect(field).toHaveAttribute("data-kind", "select");
    expect(field).toHaveAttribute("title", "FY ends");
    const label = field.querySelector(".param-label")!;
    expect(label).toHaveClass("param-label-hidden");
  });
});

describe("ParamControls statement period names (fiscal period labels)", () => {
  function renderPeriod(options: string[], value: string) {
    const params: WidgetParam[] = [{ paramName: "period", type: "text", label: "Period", options: options.map((v) => ({ label: v, value: v })) }];
    render(
      <ParamControls
        widget={makeWidget({ id: "wp", params })}
        card={makeCard({ id: "cp", widgetId: "wp", params: { period: value } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ period: value }}
        backend={undefined}
        onApply={vi.fn()}
      />,
    );
    return screen.getByRole("combobox", { name: /period/i });
  }

  it("names a statement period's choices FY / FQ and keeps the values", () => {
    const select = renderPeriod(["annual", "quarter"], "quarter");
    expect(within(select).getByRole("option", { name: "FY" })).toHaveValue("annual");
    expect(within(select).getByRole("option", { name: "FQ" })).toHaveValue("quarter");
    expect(select).toHaveValue("quarter");
  });

  it("shows the stored form selected when a provider offers both quarter and quarterly", () => {
    const select = renderPeriod(["annual", "quarterly", "ttm", "quarter"], "quarterly");
    expect(within(select).getAllByRole("option").map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ["FY", "annual"], ["FQ", "quarterly"], ["TTM", "ttm"],
    ]);
    expect(select).toHaveValue("quarterly");
  });

  it("leaves a calendar frequency's choices alone", () => {
    const params: WidgetParam[] = [{ paramName: "frequency", type: "text", label: "Frequency", options: ["annual", "quarter"].map((v) => ({ label: v, value: v })) }];
    render(
      <ParamControls
        widget={makeWidget({ id: "wf", params })}
        card={makeCard({ id: "cf", widgetId: "wf", params: { frequency: "annual" } })}
        groups={undefined}
        groupsDisabled={false}
        effective={{ frequency: "annual" }}
        backend={undefined}
        onApply={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: /frequency/i });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["annual", "quarter"]);
  });
});
