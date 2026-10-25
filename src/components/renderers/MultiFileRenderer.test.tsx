// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Choices and documents are fetched over genuine HTTP from
// src/test/mockServer.ts, exactly as ParamControls.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
// PdfView is stubbed: its behaviour has its own test file, and stubbing it
// keeps pdfjs-dist (unimportable under jsdom) out of this module graph.
vi.mock("./PdfView", () => ({
  PdfView: ({ bytes, filename }: { bytes: Uint8Array; filename: string }) => (
    <div data-testid="pdf-view">{`${filename} (${bytes.length} bytes)`}</div>
  ),
}));

import { __read, __reset } from "../../test/memfs";
import { __resetLoggerForTests } from "../../lib/logger";
import { __resetParamOptionsCacheForTests } from "../../hooks/useParamOptions";
import { startMockServer, type MockServer } from "../../test/mockServer";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { backend, widget as baseWidget } from "../../test/fixtures";
import { fileRailBadge, MultiFileRenderer } from "./MultiFileRenderer";

const HI = "aGk=";
const A = "https://files.example/a.pdf";
const B = "https://files.example/b.pdf";

const CHOICES = [
  { label: "Report A", value: A },
  { label: "Report B", value: B },
];
const TWO_PDFS = [
  { content: HI, data_format: { data_type: "pdf", filename: "a.pdf" } },
  { content: HI, data_format: { data_type: "pdf", filename: "b.pdf" } },
];

const widget = (over: Partial<WidgetDef> = {}): WidgetDef =>
  baseWidget({
    id: "filings",
    name: "Filings",
    type: "multi_file_viewer",
    category: "",
    endpoint: "documents",
    gridData: { w: 20, h: 16 },
    params: [
      {
        paramName: "files",
        label: "Files",
        type: "endpoint",
        multiSelect: true,
        show: false,
        roles: ["fileSelector"],
        optionsEndpoint: "file_choices",
        optionsParams: { chamber: "$chamber" },
      },
      { paramName: "chamber", label: "Chamber", value: "house" },
    ],
    ...over,
  });

const servers: MockServer[] = [];

async function serve(over: Record<string, unknown> = {}): Promise<BackendConfig> {
  const s = await startMockServer({
    "/file_choices": CHOICES,
    "/documents": TWO_PDFS,
    ...over,
  });
  servers.push(s);
  return backend({ baseUrl: s.url });
}

const lastServer = () => servers[servers.length - 1];
const posts = () => lastServer().requests.filter((r) => r.method === "POST");
/** Long enough for a request that should never have been issued to arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetParamOptionsCacheForTests();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("MultiFileRenderer", () => {
  it("says so when the widget declares no file selector", async () => {
    const backend = await serve();
    render(
      <MultiFileRenderer
        widget={widget({ params: [{ paramName: "chamber", label: "Chamber" }] })}
        backend={backend}
        params={{ chamber: "house" }}
        refreshKey={0}
      />,
    );

    expect(screen.getByText("This widget declares no file selector.")).toBeInTheDocument();
  });

  it("lists the selector's choices and issues no POST until Open", async () => {
    const backend = await serve();
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    expect(await screen.findByRole("checkbox", { name: "Report A" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Report B" })).toBeInTheDocument();
    expect(screen.getByText("Choose documents in the rail.")).toBeInTheDocument();

    // The choices came from the templated options endpoint, and nothing else
    // was requested: a card must not pull 600 KB of documents on mount.
    await settle();
    expect(lastServer().requests.map((r) => `${r.method} ${r.path}${r.search}`)).toEqual([
      "GET /file_choices?chamber=house",
    ]);
  });

  it("expands the rail on hover and collapses it again after the pointer leaves", async () => {
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    const rail = container.querySelector(".file-rail") as HTMLElement;
    expect(rail).toHaveAttribute("data-expanded", "false");

    await userEvent.hover(rail);
    expect(rail).toHaveAttribute("data-expanded", "true");

    // mouseOut, not mouseLeave: React synthesizes onMouseLeave from the
    // bubbling mouseout, and fireEvent.mouseLeave would not reach it.
    vi.useFakeTimers();
    try {
      fireEvent.mouseOut(rail, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(300));
      expect(rail).toHaveAttribute("data-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the rail on the tab order and reveals it to focus, not only to hover", async () => {
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    await screen.findByRole("checkbox", { name: "Report A" });
    const rail = container.querySelector(".file-rail") as HTMLElement;

    // The collapsed strip is itself a tab stop; without one, focus can never
    // get inside a panel whose expanded half is display:none.
    await userEvent.tab();
    expect(rail).toHaveFocus();

    // And Tab from there walks into the choices rather than past the panel,
    // so focus is INSIDE .file-rail -- which is what the stylesheet's
    // `.file-rail:focus-within .file-rail-expanded` rule reveals on. The rule
    // itself is not asserted: vitest runs with css: false, and jsdom does not
    // implement :focus-within in matches() either (it does implement :focus),
    // so the tab stop and the focus path are the parts a test can prove.
    await userEvent.tab();
    expect(screen.getByRole("checkbox", { name: "Report A" })).toHaveFocus();
    expect(rail.contains(document.activeElement)).toBe(true);
  });

  it("drops focus out of the rail as the pointer leaves, so a ticked checkbox cannot hold it open", async () => {
    // Reproduced in WKWebView: tick a box, move the pointer away, and the rail
    // stayed expanded. data-expanded had gone false, but the checkbox still
    // held focus and `.file-rail:focus-within` paints the expanded rules
    // regardless of it.
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    const rail = container.querySelector(".file-rail") as HTMLElement;
    const a = await screen.findByRole("checkbox", { name: "Report A" });

    await userEvent.hover(rail);
    await userEvent.click(a);
    expect(a).toHaveFocus();

    vi.useFakeTimers();
    try {
      fireEvent.mouseOut(rail, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(300));
      expect(rail).toHaveAttribute("data-expanded", "false");
      // Both halves of "collapsed" must be true: the attribute the hover rules
      // key on, and the focus the :focus-within rules key on.
      expect(rail.contains(document.activeElement)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a keyboard user's focus inside the rail, since no pointer ever leaves it", async () => {
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    const rail = container.querySelector(".file-rail") as HTMLElement;
    await screen.findByRole("checkbox", { name: "Report A" });

    await userEvent.tab();
    await userEvent.tab();
    // Space ticks the box with no pointer involved, so nothing fires
    // mouseleave and :focus-within is the only thing holding the rail open.
    await userEvent.keyboard(" ");

    expect(screen.getByRole("checkbox", { name: "Report A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Report A" })).toHaveFocus();
    expect(rail.contains(document.activeElement)).toBe(true);
  });

  it("Open sends one POST whose body carries both checked URLs, and pages between the documents", async () => {
    const backend = await serve();
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Report B" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-view")).toHaveTextContent("a.pdf (2 bytes)");

    await userEvent.click(screen.getByRole("button", { name: "Next document" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-view")).toHaveTextContent("b.pdf (2 bytes)");

    // One request, both URLs, under the selector's own param name — and the
    // sibling param still on the query string.
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0].body)).toEqual({ files: [A, B] });
    expect(posts()[0].search).toBe("?chamber=house");
  });

  it("leaves the rail open when Open is clicked, and collapses it only when the pointer leaves", async () => {
    // The reader's call: picking documents is often several Opens in a row, so
    // Open must not shut the rail under the pointer. Leaving the rail is the
    // one thing that closes it -- and that path also has to drop the focus
    // Open is still holding, or :focus-within would keep the expanded rules
    // painted over the paging controls in a real browser.
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    const rail = container.querySelector(".file-rail") as HTMLElement;

    await userEvent.hover(rail);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Report B" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();

    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(rail.contains(document.activeElement)).toBe(true);

    vi.useFakeTimers();
    try {
      fireEvent.mouseOut(rail, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(300));
      expect(rail).toHaveAttribute("data-expanded", "false");
      expect(rail.contains(document.activeElement)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-issues the last Open when the card is refreshed", async () => {
    // A multi_file_viewer fetches nothing through useWidgetData, so the card's
    // Refresh has no request of its own to repeat. Repeating the last Open is
    // the only thing it can usefully mean.
    const backend = await serve();
    const w = widget();
    const { rerender } = render(
      <MultiFileRenderer widget={w} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(posts()).toHaveLength(1);

    rerender(
      <MultiFileRenderer widget={w} backend={backend} params={{ chamber: "house" }} refreshKey={1} />,
    );

    await waitFor(() => expect(posts()).toHaveLength(2));
    // The same selection, not whatever happens to be ticked now.
    expect(JSON.parse(posts()[1].body)).toEqual({ files: [A] });
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    // The choices are deliberately NOT refetched: their cache is app-lifetime.
    expect(lastServer().requests.filter((r) => r.path === "/file_choices")).toHaveLength(1);
  });

  it("refreshing before anything was opened requests nothing", async () => {
    const backend = await serve();
    const w = widget();
    const { rerender } = render(
      <MultiFileRenderer widget={w} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    await screen.findByRole("checkbox", { name: "Report A" });

    rerender(
      <MultiFileRenderer widget={w} backend={backend} params={{ chamber: "house" }} refreshKey={1} />,
    );

    await settle();
    expect(posts()).toHaveLength(0);
    expect(screen.getByText("Choose documents in the rail.")).toBeInTheDocument();
  });

  it("keeps Open inert while nothing is checked", async () => {
    const backend = await serve();
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);
    await screen.findByRole("checkbox", { name: "Report A" });

    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("Clear unchecks everything without issuing a request", async () => {
    const backend = await serve();
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("checkbox", { name: "Report A" })).not.toBeChecked();
    expect(posts()).toHaveLength(0);
  });

  it("names a document type it cannot display instead of mounting an empty viewer", async () => {
    const backend = await serve({
      "/documents": [{ content: HI, data_format: { data_type: "xlsx", filename: "book.xlsx" } }],
    });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(
      await screen.findByText("book.xlsx: xlsx files are not displayable in this version."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-view")).not.toBeInTheDocument();
  });

  it("shows a file the backend could not serve as its error, and still opens the rest", async () => {
    const backend = await serve({
      "/documents": [
        { error_type: "not_found", content: "PDF 'Report A' not found" },
        { content: HI, data_format: { data_type: "pdf", filename: "b.pdf" } },
      ],
    });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Report B" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("document 1: PDF 'Report A' not found")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a 204 as an empty answer, not a malformed one", async () => {
    // openbb-api answers an EmptyDataError with 204, which sendJson resolves
    // as null. That is "there is nothing here", not a failure: it must not
    // reach parseDocuments, raise an alert, or write a failure to the log.
    const backend = await serve({ "/documents": { __status: 204 } });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("No documents came back.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await settle();
    expect(__read("logs/bdobb.log") ?? "").not.toContain("documents fetch failed");
  });

  it("keeps the documents already open when a later Open fails, and logs the failure without the URLs", async () => {
    // A failed request must not take away what the reader was reading. A
    // function route flipped by a local, rather than restarting the server on
    // the same port, which races the OS releasing it.
    let failNext = false;
    const backend = await serve({
      "/documents": () => (failNext ? { __status: 500, __body: { detail: "boom" } } : TWO_PDFS),
    });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();

    failNext = true;
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500: boom");
    // Still showing document 1 of the previous set.
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    await waitFor(() =>
      expect(__read("logs/bdobb.log") ?? "").toContain(
        "widget filings documents fetch failed: HTTP 500: boom",
      ),
    );
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).not.toContain(A);
    expect(log).not.toContain(B);
  });

  it("retries the same POST from the error state", async () => {
    const backend = await serve({ "/documents": { __status: 500, __body: { detail: "boom" } } });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500: boom");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(posts()[1].body)).toEqual({ files: [A] });
  });

  it("clears the checked set when the choices change under it", async () => {
    // A URL offered for one chamber is not offered for another; carrying the
    // tick over would let Open post a URL the current list never showed.
    const backend = await serve({
      "/file_choices": (url: URL) =>
        url.searchParams.get("chamber") === "house"
          ? CHOICES
          : [{ label: "Report C", value: "https://files.example/c.pdf" }],
    });
    const { rerender } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );

    await userEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
    expect(screen.getByRole("checkbox", { name: "Report A" })).toBeChecked();

    rerender(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "senate" }} refreshKey={0} />,
    );

    expect(await screen.findByRole("checkbox", { name: "Report C" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("reports an empty choice list rather than an empty rail", async () => {
    const backend = await serve({ "/file_choices": [] });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    // Both halves say it: the rail, and the viewer that would otherwise send
    // the reader to a rail with nothing in it.
    await waitFor(() =>
      expect(screen.getAllByText("No documents for these parameters.")).toHaveLength(2),
    );
  });

  it("shows the choices error in the rail when there is no backend", async () => {
    render(<MultiFileRenderer widget={widget()} backend={undefined} params={{}} refreshKey={0} />);

    expect(await screen.findByText("Backend not configured")).toBeInTheDocument();
  });

  it("the collapsed badge counts the documents the current parameters offer", async () => {
    const backend = await serve();
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );
    const badge = () => container.querySelector(".file-rail-count") as HTMLElement;

    // Loading: the rail has no number to show yet, and 0 would be a lie.
    expect(badge()).toHaveTextContent("…");

    // Ready with nothing ticked: what Apply left to choose from, which is the
    // whole point -- the reader must not have to hover to learn the filter
    // matched nothing.
    await screen.findByRole("checkbox", { name: "Report A" });
    expect(badge()).toHaveTextContent("2");

    await userEvent.click(screen.getByRole("checkbox", { name: "Report A" }));
    expect(badge()).toHaveTextContent("1/2");
  });

  it("the collapsed badge shows 0 when the parameters match no documents", async () => {
    const backend = await serve({ "/file_choices": [] });
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />,
    );

    await waitFor(() =>
      expect(container.querySelector(".file-rail-count")).toHaveTextContent("0"),
    );
  });

  it("the collapsed badge marks a choices failure and names it in the tooltip", async () => {
    const { container } = render(
      <MultiFileRenderer widget={widget()} backend={undefined} params={{}} refreshKey={0} />,
    );

    const badge = await waitFor(() => {
      const el = container.querySelector(".file-rail-count") as HTMLElement;
      expect(el).toHaveTextContent("!");
      return el;
    });
    expect(badge).toHaveAttribute("title", "Backend not configured");
  });

  it("sends the reader to the rail only when there is something in it", async () => {
    const backend = await serve({ "/file_choices": [] });
    render(<MultiFileRenderer widget={widget()} backend={backend} params={{ chamber: "house" }} refreshKey={0} />);

    await waitFor(() =>
      expect(screen.getAllByText("No documents for these parameters.")).toHaveLength(2),
    );
    expect(screen.queryByText("Choose documents in the rail.")).not.toBeInTheDocument();
  });

  it("substitutes a referenced date param's WIRE value in the selector's options request, not the stored expression (v5.4.0)", async () => {
    // Mirrors ParamControls.test.tsx's "options templating (v5.4.0)" test:
    // same pinned instant, same T-1w -> 2026-08-19 resolution, applied here
    // to the file selector's own optionsParams instead of a regular param's.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    try {
      const backend = await serve();
      const w = widget({
        params: [
          {
            paramName: "files",
            label: "Files",
            type: "endpoint",
            multiSelect: true,
            show: false,
            roles: ["fileSelector"],
            optionsEndpoint: "file_choices",
            optionsParams: { since: "$since" },
          },
          { paramName: "since", label: "Since", type: "date" },
        ],
      });
      render(<MultiFileRenderer widget={w} backend={backend} params={{ since: "T-1w" }} refreshKey={0} />);

      await waitFor(() =>
        expect(lastServer().requests.map((r) => `${r.method} ${r.path}${r.search}`)).toContain(
          "GET /file_choices?since=2026-08-19",
        ),
      );
      expect(lastServer().requests.some((r) => r.search.includes("T-1w"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves the options request and the documents POST under the dashboard's exchange (v5.4.0 §5)", async () => {
    // trade_date reads the exchange's own session close. At 16:00 UTC on
    // Wed 2026-08-26 London (16:30 BST = 15:30 UTC) has closed and New York
    // (16:00 EDT = 20:00 UTC) has not, so XLON answers 2026-08-26 where
    // XNYS — what this renderer resolved on before — answers 2026-08-25.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 26, 16, 0, 0)));
    try {
      const backend = await serve();
      const w = widget({
        params: [
          {
            paramName: "files",
            label: "Files",
            type: "endpoint",
            multiSelect: true,
            show: false,
            roles: ["fileSelector"],
            optionsEndpoint: "file_choices",
            optionsParams: { since: "$since" },
          },
          { paramName: "since", label: "Since", type: "date" },
        ],
      });
      render(
        <MultiFileRenderer widget={w} backend={backend} params={{ since: "trade_date" }} exchange="XLON" refreshKey={0} />,
      );

      await waitFor(() =>
        expect(lastServer().requests.map((r) => `${r.method} ${r.path}${r.search}`)).toContain(
          "GET /file_choices?since=2026-08-26",
        ),
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: "Report A" }));
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0].search).toBe("?since=2026-08-26");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Only what the rendered rail above cannot reach: every other badge state —
 * loading, the available count, checked/available, and the error marker with
 * its tooltip — is asserted through the component.
 */
describe("fileRailBadge", () => {
  const ready = (n: number) => ({
    status: "ready" as const,
    key: "k",
    options: Array.from({ length: n }, (_, i) => ({ label: `d${i}`, value: `u${i}` })),
  });

  it("keeps a stale list out of the badge while the next one loads", () => {
    // useParamOptions carries the previous options through a reload; showing
    // their count would state the OLD filter's answer as the current one.
    expect(fileRailBadge({ status: "loading", key: "k", options: ready(7).options }, 2)).toEqual({
      text: "…",
    });
  });

  it("never shows more checked than available", () => {
    // ready→ready from the options cache skips the loading render, and the
    // checked reset is an effect: one frame can still hold the old selection.
    expect(fileRailBadge(ready(2), 3)).toEqual({ text: "2/2" });
    expect(fileRailBadge(ready(0), 3)).toEqual({ text: "0" });
  });
});
