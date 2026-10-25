// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchOmniData = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchOmniData: (...args: unknown[]) => fetchOmniData(...args),
}));

import { OmniRenderer } from "./OmniRenderer";
import xlon from "../../lib/calendars/vendor/conformance/XLON.json";
import { weekdayCalendar, type ExchangeCalendar } from "../../lib/calendar";
import { clearCalendarBundles, loadWidgetCalendars } from "../../lib/calendars/bundles";
import { previewExpression } from "../../lib/dateExpressions";
import { fieldContext } from "../../lib/params";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { installVirtualizerDom } from "../../test/virtualizer";
import { startMockServer } from "../../test/mockServer";

vi.stubGlobal("crypto", webcrypto);

// The table branch renders a virtualized TableRenderer, which needs layout
// stubs to produce body rows under jsdom.
installVirtualizerDom();

const widget = { id: "o", type: "omni", endpoint: "omni-widget" } as unknown as WidgetDef;
const backend = { baseUrl: "http://h" } as BackendConfig;
const omni = (parseAs: string, content: unknown) => ({
  content,
  data_format: { data_type: "object", parse_as: parseAs },
  extra_citations: [],
  citable: false,
});

afterEach(() => fetchOmniData.mockReset());

function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/enter a prompt/i), { target: { value: text } });
}

describe("OmniRenderer code-executing widgets", () => {
  // The backend's server decides which code languages run (an openbq-docker
  // setting). The client sends the request like any other omni request and
  // shows the server's refusal through the ordinary error path.
  const coding = (language: string) =>
    ({
      id: language,
      type: "omni",
      endpoint: `omni-${language}-widget`,
      params: [{ paramName: "prompt", type: "text", language }],
    }) as unknown as WidgetDef;

  it("offers the prompt and sends a code widget's request to its backend", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "ran"));
    render(<OmniRenderer widget={coding("python")} backend={backend} params={{}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    type("print(1)");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("ran")).toBeInTheDocument());
    expect(fetchOmniData).toHaveBeenCalledWith(backend, coding("python"), { prompt: "print(1)" });
  });

  // The decided openbq-docker contract, used only as a concrete fixture: the
  // client depends on neither the env var name nor the wording, and adds no
  // gate of its own. The request goes through the REAL fetchOmniData and
  // request(), so the card shows exactly what the existing omni error path
  // makes of a 403 {detail} body (describeHttpError).
  it("shows the server's refusal as the card's error", async () => {
    const detail = "Omni code execution in 'sql' is not allowed on this backend (OPENBQ_OMNI_EXEC_ALLOWED).";
    const server = await startMockServer({ "/omni-sql-widget": { __status: 403, __body: { detail } } });
    try {
      const real = (await vi.importActual<typeof import("../../lib/dataClient")>("../../lib/dataClient")).fetchOmniData;
      fetchOmniData.mockImplementationOnce(real);
      const live = { ...backend, baseUrl: server.url } as BackendConfig;
      render(<OmniRenderer widget={coding("sql")} backend={live} params={{}} />);
      type("select 1");
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("HTTP 403");
      expect(alert).toHaveTextContent(detail);
    } finally {
      await server.close();
    }
  });
});

describe("OmniRenderer", () => {
  it("shows a placeholder and does not fetch until submit", () => {
    render(<OmniRenderer widget={widget} backend={backend} params={{ type: "markdown" }} />);
    expect(screen.getByText(/enter a prompt/i)).toBeInTheDocument();
    expect(fetchOmniData).not.toHaveBeenCalled();
  });

  it("shows a value that cannot resolve as the error and does not POST (review I3)", async () => {
    const dated = { ...widget, params: [{ paramName: "d", type: "date" }] } as unknown as WidgetDef;
    render(<OmniRenderer widget={dated} backend={backend} params={{ d: "T(XNYZ)" }} />);
    type("hello");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/d: Unknown calendar XNYZ/)).toBeInTheDocument());
    expect(fetchOmniData).not.toHaveBeenCalled();
  });

  it("does not fetch on an empty prompt", () => {
    render(<OmniRenderer widget={widget} backend={backend} params={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(fetchOmniData).not.toHaveBeenCalled();
  });

  it("POSTs the prompt with the params and renders a text response as markdown", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "# Hi"));
    render(<OmniRenderer widget={widget} backend={backend} params={{ type: "markdown" }} />);
    type("hello");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());
    expect(fetchOmniData).toHaveBeenCalledWith(backend, widget, { type: "markdown", prompt: "hello" });
  });

  it("renders a table response as a table", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("table", [{ symbol: "AAPL" }]));
    render(<OmniRenderer widget={widget} backend={backend} params={{}} />);
    type("rows");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
  });

  it("renders an error-markdown response as markdown (the SQL/Python error path)", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "### SQL Query Error"));
    render(<OmniRenderer widget={widget} backend={backend} params={{}} />);
    type("bad sql");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("SQL Query Error")).toBeInTheDocument());
  });

  it("resolves param tokens in the POST body, like the GET path, but leaves the prompt literal", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "ok"));
    render(<OmniRenderer widget={widget} backend={backend} params={{ asof: "$currentDate" }} />);
    type("q");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(fetchOmniData).toHaveBeenCalled());
    const body = fetchOmniData.mock.calls[0][2] as Record<string, string>;
    expect(body.asof).not.toBe("$currentDate");
    expect(body.asof).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.prompt).toBe("q");
  });

  it("clears a prior result when a later submit fails", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("table", [{ symbol: "AAPL" }]));
    render(<OmniRenderer widget={widget} backend={backend} params={{}} />);
    type("good");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    fetchOmniData.mockRejectedValueOnce(new Error("boom"));
    type("bad");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("shows an error status when the fetch fails", async () => {
    fetchOmniData.mockRejectedValueOnce(new Error("boom"));
    render(<OmniRenderer widget={widget} backend={backend} params={{}} />);
    type("x");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});

describe("OmniRenderer resolves on the card's calendars (final review I-A)", () => {
  const tokyo: ExchangeCalendar = {
    ...weekdayCalendar("XTKS"),
    holidays: {
      "2026-09-21": { holiday: "Respect for the Aged Day", type: "Official" },
      "2026-09-22": { holiday: "Citizens' Holiday", type: "Official" },
      "2026-09-23": { holiday: "Autumnal Equinox Day", type: "Official" },
    },
    years: [2026],
    source: "backend",
  };

  it("POSTs a legacy XTKS card's T-1bd as the date its preview shows", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "ok"));
    const w = { ...widget, params: [{ paramName: "symbol", type: "text" }, { paramName: "d", type: "date" }] } as unknown as WidgetDef;
    const values = { symbol: "7203.T", d: "T-1bd" };
    const now = new Date("2026-09-24T06:00:00Z");
    const calendars = { XTKS: tokyo };
    const shown = previewExpression("date", "T-1bd", { now, ...fieldContext(w, w.params[1], { calendars }, values) })?.text;
    expect(shown).toBe("2026-09-18");
    render(<OmniRenderer widget={w} backend={backend} params={values} context={{ now, calendars }} />);
    type("q");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(fetchOmniData).toHaveBeenCalledWith(backend, w, { symbol: "7203.T", d: shown, prompt: "q" }));
  });

  it("sends a bound card's bd value from its bundle calendars", async () => {
    fetchOmniData.mockResolvedValueOnce(omni("text", "ok"));
    const w = {
      ...widget,
      calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" },
      params: [{ paramName: "d", type: "date" }],
    } as unknown as WidgetDef;
    const values = { d: "T-1bd" };
    const now = new Date("2026-12-29T12:00:00Z");
    clearCalendarBundles();
    const { calendars } = await loadWidgetCalendars(backend, w, values, undefined, now, async () => xlon, new AbortController().signal);
    render(<OmniRenderer widget={w} backend={backend} params={values} context={{ now, calendars }} />);
    type("q");
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(fetchOmniData).toHaveBeenCalledWith(backend, w, { d: "2026-12-24", prompt: "q" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
