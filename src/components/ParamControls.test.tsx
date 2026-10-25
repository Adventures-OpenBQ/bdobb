// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import type { BackendConfig, DashboardCard, ParamGroup, ParamOption, WidgetDef } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
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

  it("renders a control per visible param and none for the hidden ones", () => {
    renderStrip();
    expect(screen.getByLabelText("Symbol")).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Limit")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Use cache")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("Period").tagName).toBe("SELECT");
    expect(screen.queryByLabelText("provider")).not.toBeInTheDocument();
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

  it("shows a date control the resolved date while the card still stores the token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      renderStrip({ effective: { start: "$currentDate" } });
      expect(screen.getByLabelText("Start")).toHaveValue("2026-08-23");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not burn a $currentDate token when today's date is re-picked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      const onApply = renderStrip({ effective: { start: "$currentDate" } });
      const start = screen.getByLabelText("Start");
      fireEvent.change(start, { target: { value: "2026-08-23" } });
      fireEvent.blur(start);
      expect(onApply).not.toHaveBeenCalled();
      fireEvent.change(start, { target: { value: "2026-08-22" } });
      fireEvent.blur(start);
      expect(onApply).toHaveBeenCalledWith({
        cardParams: expect.objectContaining({ start: "2026-08-22" }),
        groupEdits: [],
      });
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
    expect(labelsOf(screen.getByLabelText("Committee"))).toEqual([
      "Ways and Means",
      "Financial Services",
    ]);
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
