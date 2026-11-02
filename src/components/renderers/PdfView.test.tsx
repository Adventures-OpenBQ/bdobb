// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * pdfjs-dist is mocked at the module boundary, and it HAS to be: it reads
 * DOMMatrix while it evaluates (src/display/canvas.js) and jsdom defines
 * none, so the real module cannot even be imported here. PdfView reaches its
 * legacy build through `await import("pdfjs-dist/legacy/build/pdf.mjs")`,
 * which this mock replaces exactly as it would a static import.
 *
 * vi.hoisted, because vi.mock's factory is hoisted above the file's own
 * consts and would otherwise hit them in the temporal dead zone.
 */
const pdf = vi.hoisted(() => {
  const destroy = vi.fn(() => Promise.resolve());
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 3 }),
    destroy,
  }));
  // Stateful, and it records every assignment: pointing pdf.js at the worker
  // file is global setup that must happen once however many documents open.
  const workerSrcSets: string[] = [];
  let workerSrc = "";
  const GlobalWorkerOptions = {
    get workerSrc() {
      return workerSrc;
    },
    set workerSrc(value: string) {
      workerSrc = value;
      workerSrcSets.push(value);
    },
  };
  return { destroy, getDocument, GlobalWorkerOptions, workerSrcSets };
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: pdf.getDocument,
  // A plain object stands in for the real static-accessor class; PdfView only
  // ever reads and writes workerSrc on it.
  GlobalWorkerOptions: pdf.GlobalWorkerOptions,
  // Verbatim from build/pdf.mjs:48-65, which is where PdfView now reads them.
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
  AnnotationEditorType: { DISABLE: -1, NONE: 0 },
}));

/**
 * The viewer components, faked. The real PDFViewer builds a ResizeObserver in
 * its constructor and refuses a container that is not absolutely positioned,
 * neither of which jsdom can satisfy — and the point of these tests is the
 * WIRING, not pdf.js. `log` records the construction/teardown sequence in
 * order; `emit` fires a bus event the way pdf.js would; `sent` holds only what
 * PdfView itself dispatched.
 */
const vw = vi.hoisted(() => {
  const log: string[] = [];
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  const listeners = new Map<string, Array<(evt: unknown) => void>>();
  const state = {
    scaleValue: "",
    pageNumber: 1,
    pageScale: 2,
    viewerOptions: {} as Record<string, unknown>,
    linkOptions: {} as Record<string, unknown>,
    findOptions: {} as Record<string, unknown>,
  };

  class EventBus {
    on(name: string, listener: (evt: unknown) => void): void {
      const list = listeners.get(name);
      if (list) list.push(listener);
      else listeners.set(name, [listener]);
    }
    off(): void {}
    dispatch(name: string, data: Record<string, unknown>): void {
      sent.push({ name, data });
      for (const listener of [...(listeners.get(name) ?? [])]) listener(data);
    }
  }

  class PDFLinkService {
    constructor(options: Record<string, unknown>) {
      state.linkOptions = options;
      log.push("linkService:new");
    }
    setViewer(): void {
      log.push("linkService:setViewer");
    }
    setDocument(doc: unknown): void {
      log.push(doc ? "linkService:setDocument" : "linkService:clear");
    }
  }

  class PDFFindController {
    constructor(options: Record<string, unknown>) {
      state.findOptions = options;
      log.push("findController:new");
    }
    // Present so that a call would be RECORDED rather than throwing: the test
    // that pdf.js owns the find controller's document has to be able to fail.
    setDocument(doc: unknown): void {
      log.push(doc ? "findController:setDocument" : "findController:clear");
    }
  }

  class PDFViewer {
    constructor(options: Record<string, unknown>) {
      state.viewerOptions = options;
      log.push("viewer:new");
    }
    setDocument(doc: unknown): void {
      log.push(doc ? "viewer:setDocument" : "viewer:clear");
    }
    getPageView(index: number) {
      const container = state.viewerOptions.container as HTMLElement;
      let div = container.querySelector<HTMLDivElement>(`[data-page="${index + 1}"]`);
      if (!div) {
        div = document.createElement("div");
        div.dataset.page = String(index + 1);
        container.append(div);
      }
      return { div, viewport: { scale: state.pageScale } };
    }
    get currentScaleValue(): string {
      return state.scaleValue;
    }
    set currentScaleValue(value: string) {
      state.scaleValue = value;
      log.push(`scale:${value}`);
    }
    get currentPageNumber(): number {
      return state.pageNumber;
    }
    set currentPageNumber(value: number) {
      state.pageNumber = value;
      log.push(`page:${value}`);
    }
  }

  const emit = (name: string, data: Record<string, unknown>) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(data);
  };

  const reset = () => {
    log.length = 0;
    sent.length = 0;
    listeners.clear();
    state.scaleValue = "";
    state.pageNumber = 1;
    state.pageScale = 2;
  };

  return { log, sent, state, emit, reset, EventBus, PDFLinkService, PDFFindController, PDFViewer };
});

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => {
  // The ORDERING guard, which is the one thing this fake cannot otherwise
  // stand in for: the real bundle destructures the whole API off
  // `globalThis.pdfjsLib` while it evaluates, so importing it before
  // loadPdfjs() has installed that global throws at import time. This factory
  // runs at the same moment the real module would evaluate, so it fails here
  // for exactly the reason production would. Vitest replaces this message with
  // its own generic "error when mocking a module" text, so the readable
  // statement of the invariant is the assertion in the workerSrc test below;
  // this throw is what makes the whole file red when the order slips.
  if (!(globalThis as typeof globalThis & { pdfjsLib?: unknown }).pdfjsLib) {
    throw new Error("viewer imported before globalThis.pdfjsLib");
  }
  return {
    EventBus: vw.EventBus,
    PDFLinkService: vw.PDFLinkService,
    PDFFindController: vw.PDFFindController,
    PDFViewer: vw.PDFViewer,
    // Verbatim from web/pdf_viewer.mjs:649-654 and :1479-1485, which is where
    // PdfView now reads them.
    FindState: { FOUND: 0, NOT_FOUND: 1, WRAPPED: 2, PENDING: 3 },
    LinkTarget: { NONE: 0, SELF: 1, BLANK: 2, PARENT: 3, TOP: 4 },
  };
});

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

/**
 * jsdom implements no ResizeObserver; PdfView observes its own container. Each
 * instance is recorded so a test can fire the callback itself and see which
 * node is actually being watched.
 */
type FakeObserver = { fire: () => void; target: Element | null; disconnected: boolean };
const observers: FakeObserver[] = [];

class ResizeObserverStub {
  private readonly record: FakeObserver;

  constructor(callback: () => void) {
    this.record = { fire: callback, target: null, disconnected: false };
    observers.push(this.record);
  }

  observe(target: Element): void {
    this.record.target = target;
  }

  unobserve(): void {}

  disconnect(): void {
    this.record.disconnected = true;
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

import { PdfView, boxRect } from "./PdfView";

const bytes = new Uint8Array([1, 2, 3]);

/**
 * A bus event as pdf.js would fire it. Wrapped in act(), because these
 * listeners set React state and nothing else is driving a render here.
 */
const emit = (name: string, data: Record<string, unknown>) => {
  act(() => {
    vw.emit(name, data);
  });
};

/** Rendered, with pdf.js's pages ready and a known scale on the clock. */
async function open(props: { bytes?: Uint8Array; filename?: string } = {}) {
  const result = render(
    <PdfView bytes={props.bytes ?? bytes} filename={props.filename ?? "report.pdf"} />,
  );
  await screen.findByText("/ 3");
  emit("pagesinit", {});
  emit("scalechanging", { scale: 1 });
  return result;
}

beforeEach(() => {
  pdf.destroy.mockClear();
  pdf.getDocument.mockClear();
  openUrl.mockClear();
  vw.reset();
  observers.length = 0;
});

describe("PdfView", () => {
  it("builds pdf.js's viewer components in order and gives the document to the viewer and the link service", async () => {
    const { container } = await open();

    expect(vw.log).toEqual([
      "linkService:new",
      "findController:new",
      "viewer:new",
      "linkService:setViewer",
      "viewer:setDocument",
      "linkService:setDocument",
      "scale:page-width",
    ]);
    // The container pdf.js is given, and the div it appends pages into.
    const body = container.querySelector(".pdf-body");
    expect(vw.state.viewerOptions.container).toBe(body);
    expect(body?.firstElementChild).toHaveClass("pdfViewer");
    // TextLayerMode.ENABLE and AnnotationMode.ENABLE -- links and selectable
    // text, but not editable form widgets.
    expect(vw.state.viewerOptions.textLayerMode).toBe(1);
    expect(vw.state.viewerOptions.annotationMode).toBe(1);
    // AnnotationEditorType.DISABLE: no editor UI manager, no document-level
    // drop/keydown listeners.
    expect(vw.state.viewerOptions.annotationEditorMode).toBe(-1);
    // LinkTarget.NONE: no `target` attribute on any anchor pdf.js builds.
    expect(vw.state.linkOptions.externalLinkTarget).toBe(0);
    expect(vw.state.findOptions.linkService).toBe(vw.state.viewerOptions.linkService);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("leaves the find controller's document to pdf.js, which sets and clears it itself", async () => {
    // PDFViewer.setDocument does `findController?.setDocument(pdfDocument)` on
    // the first page render and `setDocument(null)` in its teardown branch.
    // Doing it here too would reset a controller mid-query.
    const { unmount } = await open();
    unmount();

    await waitFor(() => expect(vw.log).toContain("viewer:clear"));
    expect(vw.log.filter((entry) => entry.startsWith("findController:setDocument"))).toEqual([]);
    expect(vw.log.filter((entry) => entry === "findController:clear")).toEqual([]);
  });

  it("points pdf.js at the bundled standard fonts, so base-14 glyphs are not guessed", async () => {
    // Without standardFontDataUrl pdf.js logs "Ensure that the
    // standardFontDataUrl API parameter is provided" for every document that
    // leans on a base-14 font (Helvetica, Times, Courier, Symbol, ZapfDingbats)
    // and substitutes whatever the system offers, at the wrong metrics. The
    // URL has to end in a SLASH: pdf.js concatenates the bare filename onto it.
    await open();
    const options = (pdf.getDocument.mock.calls as unknown as [{ standardFontDataUrl: string }][])[0][0];
    expect(options.standardFontDataUrl).toMatch(/\/standard_fonts\/$/);
  });

  it("fits to the card's width only once pdf.js says its pages exist", async () => {
    render(<PdfView bytes={bytes} filename="report.pdf" />);
    await screen.findByText("/ 3");

    // "page-width" returns early before the first page view exists, so pdf.js's
    // own pagesinit is the only safe moment to ask for the fit.
    expect(vw.log).not.toContain("scale:page-width");
    emit("pagesinit", {});
    expect(vw.state.scaleValue).toBe("page-width");
  });

  it("clears pdf.js's document and destroys the loading task on unmount", async () => {
    // destroy() lives on the LOADING TASK in pdfjs-dist v6 --
    // PDFDocumentProxy has none -- so the task is what PdfView holds on to.
    const { unmount } = await open();

    unmount();

    await waitFor(() => expect(pdf.destroy).toHaveBeenCalled());
    expect(vw.log).toContain("viewer:clear");
    expect(vw.log).toContain("linkService:clear");
  });

  it("tears the old document down before the new one is set when the bytes change", async () => {
    const { rerender } = await open({ filename: "a.pdf" });
    const before = vw.log.length;

    rerender(<PdfView bytes={new Uint8Array([9, 9])} filename="b.pdf" />);
    await waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(vw.log).toContain("viewer:setDocument"));

    const after = vw.log.slice(before);
    expect(after.indexOf("viewer:clear")).toBeGreaterThanOrEqual(0);
    expect(after.indexOf("viewer:clear")).toBeLessThan(after.indexOf("viewer:new"));
    expect(pdf.destroy).toHaveBeenCalled();
  });

  it("gives each viewer its own abort signal, and aborts it when the document changes and on unmount", async () => {
    // In pdf.js 5 the constructor's `abortSignal` is the ONLY thing that
    // disconnects the viewer's ResizeObserver and removes its scroll listener
    // (web/pdf_viewer.mjs:13548-13557); setDocument(null) does neither. Without
    // it every document paged through leaves a dead viewer firing on .pdf-body.
    const { rerender, unmount } = await open({ filename: "a.pdf" });
    const first = vw.state.viewerOptions.abortSignal as AbortSignal | undefined;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(first?.aborted).toBe(false);

    rerender(<PdfView bytes={new Uint8Array([9, 9])} filename="b.pdf" />);
    await waitFor(() => expect(vw.state.viewerOptions.abortSignal).not.toBe(first));
    const second = vw.state.viewerOptions.abortSignal as AbortSignal;
    expect(first?.aborted).toBe(true);
    expect(second.aborted).toBe(false);

    unmount();
    expect(second.aborted).toBe(true);
  });

  it("keeps the open document, and the reader's page, when a refetch brings byte-identical content", async () => {
    // Every fetch -- an auto-refresh tick, Command-R -- decodes a NEW array,
    // even when the PDF on the server has not changed. Reloading on identity
    // alone would send the reader back to page 1, fit width and no find.
    const { rerender } = await open({ bytes: new Uint8Array([1, 2, 3]) });
    emit("pagechanging", { pageNumber: 3 });

    rerender(<PdfView bytes={new Uint8Array([1, 2, 3])} filename="report.pdf" />);
    await act(async () => {});

    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
    expect(vw.log).not.toContain("viewer:clear");
    expect(screen.getByLabelText("Page")).toHaveValue("3");

    // Different content is a different document, and is loaded as one.
    rerender(<PdfView bytes={new Uint8Array([1, 2, 4])} filename="report.pdf" />);
    await waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
    expect(vw.log).toContain("viewer:clear");
  });

  it("hands pdf.js a copy, so the caller's array survives a remount on the same bytes", async () => {
    // pdf.js TAKES OWNERSHIP of the TypedArray it is handed and transfers it to
    // the worker, detaching the caller's view. StrictMode's double-mount and the
    // file rail both re-render with the very same instance, so the array PdfView
    // passes must be its own copy or the second open reads an empty buffer.
    const shared = new Uint8Array([1, 2, 3]);

    const { unmount } = await open({ bytes: shared });
    unmount();
    await open({ bytes: shared });

    expect(pdf.getDocument).toHaveBeenCalledTimes(2);
    const calls = pdf.getDocument.mock.calls as unknown as Array<[{ data: Uint8Array }]>;
    for (const [options] of calls) {
      expect(options.data).not.toBe(shared);
      expect(options.data).toEqual(shared);
    }
    expect(shared.byteLength).toBe(3);
  });

  it("points pdf.js at the bundled worker file, once across two mounts", async () => {
    // A URL, never a Worker instance: pdf.js caches one PDFWorker per port and
    // destroys it with the loading task, so a shared port makes the SECOND
    // document opened throw "the worker is being destroyed". From a URL it
    // spawns -- and terminates -- one worker per document.
    pdf.GlobalWorkerOptions.workerSrc = "";
    pdf.workerSrcSets.length = 0;

    const first = await open({ filename: "a.pdf" });
    first.unmount();
    await open({ bytes: new Uint8Array([9, 9]), filename: "b.pdf" });

    expect(pdf.workerSrcSets).toHaveLength(1);
    expect(pdf.workerSrcSets[0]).toMatch(/pdf\.worker\.min\.mjs$/);
    // The other half of the same global setup: the viewer bundle reads the API
    // off this global as it evaluates, and loadPdfjs is what puts it there.
    expect((globalThis as typeof globalThis & { pdfjsLib?: unknown }).pdfjsLib).toBeDefined();
  });

  it("shows pdf.js' own message, and no viewer, when the document will not open", async () => {
    pdf.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Invalid PDF structure.")),
      destroy: pdf.destroy,
    } as unknown as ReturnType<typeof pdf.getDocument>);

    const { container } = render(<PdfView bytes={bytes} filename="broken.pdf" />);

    expect(await screen.findByText("broken.pdf: Invalid PDF structure.")).toBeInTheDocument();
    expect(container.querySelector(".pdf-body")).toBeNull();
    expect(vw.log).not.toContain("viewer:new");
  });

  it("destroys the loading task when the document fails to open, so no worker survives a corrupt PDF", async () => {
    pdf.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Invalid PDF structure.")),
      destroy: pdf.destroy,
    } as unknown as ReturnType<typeof pdf.getDocument>);

    render(<PdfView bytes={bytes} filename="broken.pdf" />);

    await screen.findByText("broken.pdf: Invalid PDF structure.");
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds against the container the error render replaced, not the detached one", async () => {
    // The error state swaps .pdf-body out for a message, so the node pdf.js was
    // given on the first mount is detached by the time a document does open.
    // The container is held as state precisely so the effect re-runs on the
    // node that replaces it.
    pdf.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Invalid PDF structure.")),
      destroy: pdf.destroy,
    } as unknown as ReturnType<typeof pdf.getDocument>);

    const { container, rerender } = render(<PdfView bytes={bytes} filename="broken.pdf" />);
    await screen.findByText("broken.pdf: Invalid PDF structure.");

    rerender(<PdfView bytes={new Uint8Array([9, 9])} filename="good.pdf" />);
    await screen.findByText("/ 3");

    const body = container.querySelector(".pdf-body");
    expect(body).not.toBeNull();
    expect(vw.state.viewerOptions.container).toBe(body);
    expect(observers[observers.length - 1].target).toBe(body);
  });

  it("moves to the page typed into the page box, clamping it into the document", async () => {
    await open();
    const box = screen.getByLabelText("Page");
    expect(box).toHaveValue("1");

    await userEvent.clear(box);
    await userEvent.type(box, "2{Enter}");
    expect(vw.state.pageNumber).toBe(2);

    // Clamped BEFORE the assignment: pdf.js logs a console.error for a page
    // outside the document and throws outright for a non-integer.
    await userEvent.clear(box);
    await userEvent.type(box, "0{Enter}");
    expect(vw.state.pageNumber).toBe(1);
    expect(box).toHaveValue("1");

    await userEvent.clear(box);
    await userEvent.type(box, "999{Enter}");
    expect(vw.state.pageNumber).toBe(3);
    expect(box).toHaveValue("3");
  });

  it("restores the current page when the box holds something that is not a page", async () => {
    await open();
    emit("pagechanging", { pageNumber: 2 });
    const box = screen.getByLabelText("Page");

    await userEvent.clear(box);
    await userEvent.type(box, "abc{Enter}");

    expect(box).toHaveValue("2");
    expect(vw.state.pageNumber).toBe(1);
  });

  it("follows pdf.js's own page changes in the page box", async () => {
    await open();

    emit("pagechanging", { pageNumber: 3 });

    expect(screen.getByLabelText("Page")).toHaveValue("3");
  });

  it("leaves a half-typed page number alone when pdf.js reports a page change, and Enter still commits it", async () => {
    await open();
    const box = screen.getByLabelText("Page");

    await userEvent.clear(box);
    await userEvent.type(box, "2");
    emit("pagechanging", { pageNumber: 3 });

    expect(box).toHaveValue("2");

    // The half-typed value is still the one Enter means, not the page pdf.js
    // scrolled to behind it.
    await userEvent.type(box, "{Enter}");
    expect(vw.state.pageNumber).toBe(2);
  });

  it("follows pdf.js's page changes in a focused but untouched box, and commits nothing on blur", async () => {
    await open();
    const box = screen.getByLabelText("Page");

    // Clicked into but never typed in: the box is not the reader's draft, so
    // pdf.js's own page changes still belong in it.
    await userEvent.click(box);
    emit("pagechanging", { pageNumber: 3 });
    expect(box).toHaveValue("3");

    // And blurring an untouched box must not send the viewer back to whatever
    // the box happened to read when it was clicked.
    fireEvent.blur(box);
    expect(box).toHaveValue("3");
    expect(vw.log.filter((entry) => entry.startsWith("page:"))).toEqual([]);
  });

  it("steps zoom onto the 25% grid in the direction of travel, and clamps it to 50-300", async () => {
    await open();
    expect(screen.getByText("100%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(vw.state.scaleValue).toBe("1.25");

    // pdf.js reports the scale it actually applied; the label and the next step
    // both follow that, not a number this component kept for itself.
    emit("scalechanging", { scale: 1.25 });
    expect(screen.getByText("125%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(vw.state.scaleValue).toBe("1");

    // An off-grid fit scale snaps onto the grid rather than staying off it.
    emit("scalechanging", { scale: 1.43 });
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(vw.state.scaleValue).toBe("1.25");

    emit("scalechanging", { scale: 0.5 });
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(vw.state.scaleValue).toBe("0.5");

    emit("scalechanging", { scale: 3 });
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(vw.state.scaleValue).toBe("3");
  });

  it("re-fits on a resize only while the zoom mode is fit, and drops the pending timer on unmount", async () => {
    const { unmount } = await open();
    const observer = observers[observers.length - 1];
    expect(observer.target).toBe(document.querySelector(".pdf-body"));

    vw.reset();
    for (let i = 0; i < 5; i += 1) observer.fire();
    // ONE re-fit, not five: the observer is debounced.
    await waitFor(() => expect(vw.log).toEqual(["scale:page-width"]));

    await userEvent.click(screen.getByRole("button", { name: "Fit" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    vw.reset();
    observer.fire();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(vw.log).toEqual([]);

    // And the debounce must not outlive the component that scheduled it.
    await userEvent.click(screen.getByRole("button", { name: "Fit" }));
    vi.useFakeTimers();
    try {
      observer.fire();
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens an external link in the system browser and never lets the webview navigate", async () => {
    const { container } = await open();
    const body = container.querySelector(".pdf-body") as HTMLDivElement;
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://example.com/report");
    anchor.textContent = "link";
    body.appendChild(anchor);

    const clicked = fireEvent.click(anchor);

    // fireEvent returns false when a handler called preventDefault.
    expect(clicked).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/report");
  });

  it("refuses a href safeUrl will not have, and still swallows the navigation", async () => {
    const { container } = await open();
    const body = container.querySelector(".pdf-body") as HTMLDivElement;
    // An internal /GoTo destination, which pdf.js has already handled by the
    // time the click bubbles here -- and which resolves to an http:// URL if
    // the .href PROPERTY is read instead of the attribute.
    const internal = document.createElement("a");
    internal.setAttribute("href", "#nameddest=chapter");
    body.appendChild(internal);
    const script = document.createElement("a");
    script.setAttribute("href", "javascript:alert(1)");
    body.appendChild(script);

    expect(fireEvent.click(internal)).toBe(false);
    expect(fireEvent.click(script)).toBe(false);

    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("PdfView find bar", () => {
  /** Open a document and its find bar, and hand back the bar's input. */
  async function openFind() {
    const view = await open();
    await userEvent.click(screen.getByRole("button", { name: "Find" }));
    return { ...view, input: screen.getByLabelText("Find in document") };
  }

  /** Only what PdfView dispatched on the bus, newest last. */
  const finds = () => vw.sent.filter((entry) => entry.name === "find").map((entry) => entry.data);

  it("opens from the toolbar button with the input focused and any existing query selected", async () => {
    const { input } = await openFind();
    expect(input).toHaveFocus();

    await userEvent.type(input, "Omega");
    await userEvent.click(screen.getByRole("button", { name: "Close find" }));
    await userEvent.click(screen.getByRole("button", { name: "Find" }));

    const reopened = screen.getByLabelText("Find in document") as HTMLInputElement;
    expect(reopened).toHaveValue("Omega");
    expect(reopened).toHaveFocus();
    expect(reopened.selectionStart).toBe(0);
    expect(reopened.selectionEnd).toBe(5);
  });

  it("drops the old query, not just the bar, when the bytes change to a new document", async () => {
    const { rerender, input } = await openFind();
    await userEvent.type(input, "Omega");

    rerender(<PdfView bytes={new Uint8Array([9, 9])} filename="b.pdf" />);
    await userEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(screen.getByLabelText("Find in document")).toHaveValue("");
  });

  it("dispatches a fresh search on every keystroke, with highlightAll and no type", async () => {
    const { input } = await openFind();

    await userEvent.type(input, "Om");

    // pdf.js debounces an untyped `find` itself (250 ms), so there is no
    // debounce here -- one dispatch per keystroke is the contract.
    expect(finds()).toEqual([
      {
        type: "",
        query: "O",
        caseSensitive: false,
        entireWord: false,
        matchDiacritics: false,
        highlightAll: true,
        findPrevious: false,
      },
      {
        type: "",
        query: "Om",
        caseSensitive: false,
        entireWord: false,
        matchDiacritics: false,
        highlightAll: true,
        findPrevious: false,
      },
    ]);
  });

  it("walks the matches with Enter, Shift+Enter and the two arrows", async () => {
    const { input } = await openFind();
    await userEvent.type(input, "Omega");
    vw.sent.length = 0;

    await userEvent.type(input, "{Enter}");
    await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
    await userEvent.click(screen.getByRole("button", { name: "Next match" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous match" }));

    expect(finds().map((data) => [data.type, data.query, data.findPrevious])).toEqual([
      ["again", "Omega", false],
      ["again", "Omega", true],
      ["again", "Omega", false],
      ["again", "Omega", true],
    ]);
  });

  it("shows the count pdf.js reports, and nothing at all when there is no match to point at", async () => {
    await openFind();

    emit("updatefindmatchescount", { matchesCount: { current: 3, total: 12 } });
    expect(screen.getByText("3 of 12")).toBeInTheDocument();

    // #requestMatchesCount collapses "no selected match" to { 0, 0 }.
    emit("updatefindmatchescount", { matchesCount: { current: 0, total: 0 } });
    expect(screen.queryByText(/of/)).toBeNull();
  });

  it("says so when the phrase is not in the document, and says nothing while pdf.js is still looking", async () => {
    const { container } = await openFind();
    const count = () => container.querySelector(".pdf-find-count")?.textContent;

    emit("updatefindcontrolstate", { state: 1, matchesCount: { current: 0, total: 0 } });
    expect(count()).toBe("No matches");

    // PENDING is the "still searching" tick: it must not blank the last answer.
    emit("updatefindcontrolstate", { state: 3, matchesCount: { current: 0, total: 0 } });
    expect(count()).toBe("No matches");

    // WRAPPED carries a real count and is shown as one.
    emit("updatefindcontrolstate", { state: 2, matchesCount: { current: 1, total: 4 } });
    expect(count()).toBe("1 of 4");
  });

  it("clears pdf.js's highlights and unmounts the bar when it is closed", async () => {
    const { container, input } = await openFind();
    await userEvent.type(input, "Omega");
    emit("updatefindmatchescount", { matchesCount: { current: 1, total: 1 } });
    vw.sent.length = 0;

    await userEvent.click(screen.getByRole("button", { name: "Close find" }));

    // findbarclose, not an empty "find": pdf.js clears the pending debounce
    // and drops highlights immediately instead of waiting out its own 250 ms.
    expect(vw.sent).toEqual([{ name: "findbarclose", data: {} }]);
    expect(screen.queryByLabelText("Find in document")).toBeNull();
    expect(container.querySelector(".pdf-find-count")).toBeNull();
    expect(container.querySelector(".pdf-view")).toHaveFocus();
  });

  it("takes Escape on the capture phase, so nothing underneath it also sees the press", async () => {
    // The RowContextMenu invariant: a bubble-phase window listener registered
    // BEFORE the bar opened must not be reached, or one press would close the
    // find bar and restore a maximized card at the same time.
    const underneath = vi.fn();
    window.addEventListener("keydown", underneath);
    try {
      await openFind();

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByLabelText("Find in document")).toBeNull();
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", underneath);
    }
  });

  it("leaves Escape outside the card alone, so an open bar does not hijack every dialog", async () => {
    // The listener is on the .pdf-view root, not the window: a press that
    // originated somewhere else in the app never reaches it, and the app's own
    // Escape consumers still see it.
    const elsewhere = vi.fn();
    window.addEventListener("keydown", elsewhere);
    try {
      await openFind();

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(screen.getByLabelText("Find in document")).toBeInTheDocument();
      expect(elsewhere).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", elsewhere);
    }
  });

  it("leaves Command+F to a text field elsewhere in the app, even while the card is hovered", async () => {
    const { container } = await open();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    root.matches = (selector: string) => selector === ":hover";
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    try {
      outside.focus();

      expect(fireEvent.keyDown(outside, { code: "KeyF", metaKey: true })).toBe(true);
      expect(screen.queryByLabelText("Find in document")).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("re-focuses and selects the find input when Command+F arrives with the bar already open", async () => {
    const { container, input } = await openFind();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    root.matches = (selector: string) => selector === ":hover";
    await userEvent.type(input, "Omega");
    // A typing target, but one the card contains -- the guard above must not
    // swallow this press.
    const box = screen.getByLabelText("Page");
    box.focus();

    fireEvent.keyDown(box, { code: "KeyF", metaKey: true });

    const bar = screen.getByLabelText("Find in document") as HTMLInputElement;
    expect(bar).toHaveFocus();
    expect(bar.selectionStart).toBe(0);
    expect(bar.selectionEnd).toBe(5);
  });

  it("says whether the bar is open, and announces the count politely", async () => {
    const { container } = await open();
    const toggle = screen.getByRole("button", { name: "Find" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".pdf-find-count")).toHaveAttribute("aria-live", "polite");
  });

  it("opens on Command+F while the card is hovered, and swallows the browser's own find", async () => {
    const { container } = await open();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    // jsdom lays nothing out, so :hover has to be planted. PdfView reads it off
    // the nearest .widget-card, falling back to its own root when there is none.
    root.matches = (selector: string) => selector === ":hover";

    const handled = fireEvent.keyDown(window, { code: "KeyF", metaKey: true });

    expect(handled).toBe(false);
    expect(screen.getByLabelText("Find in document")).toHaveFocus();
  });

  it("opens on Control+F too, and leaves a press that is neither alone", async () => {
    const { container } = await open();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    root.matches = (selector: string) => selector === ":hover";

    // Both modifiers at once is nobody's find shortcut.
    expect(fireEvent.keyDown(window, { code: "KeyF", metaKey: true, ctrlKey: true })).toBe(true);
    expect(screen.queryByLabelText("Find in document")).toBeNull();
    // As is Command+Shift+F.
    expect(fireEvent.keyDown(window, { code: "KeyF", metaKey: true, shiftKey: true })).toBe(true);
    expect(screen.queryByLabelText("Find in document")).toBeNull();

    expect(fireEvent.keyDown(window, { code: "KeyF", ctrlKey: true })).toBe(false);
    expect(screen.getByLabelText("Find in document")).toBeInTheDocument();
  });

  it("opens on Command+F when focus is inside the card rather than the pointer", async () => {
    const { container } = await open();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    root.matches = () => false;
    root.focus();

    fireEvent.keyDown(window, { code: "KeyF", metaKey: true });

    expect(screen.getByLabelText("Find in document")).toBeInTheDocument();
  });

  it("ignores Command+F for a card that is neither hovered nor focused, and one another card already claimed", async () => {
    const { container } = await open();
    const root = container.querySelector(".pdf-view") as HTMLElement;
    root.matches = () => false;
    document.body.focus();

    expect(fireEvent.keyDown(window, { code: "KeyF", metaKey: true })).toBe(true);
    expect(screen.queryByLabelText("Find in document")).toBeNull();

    // Hovered, but a listener registered earlier already handled the press --
    // with two PDF cards, the first preventDefault wins and the second returns.
    root.matches = (selector: string) => selector === ":hover";
    const claim = (event: Event) => event.preventDefault();
    window.addEventListener("keydown", claim, { capture: true });
    try {
      fireEvent.keyDown(window, { code: "KeyF", metaKey: true });
      expect(screen.queryByLabelText("Find in document")).toBeNull();
    } finally {
      window.removeEventListener("keydown", claim, { capture: true });
    }
  });
});

describe("PdfView highlights", () => {
  const box = { text: "q", page: 2, x0: 10, top: 20, x1: 30, bottom: 25 };
  const rect = () => {
    const el = document.querySelector<HTMLElement>(".pdf-highlight");
    return el && [el.style.left, el.style.top, el.style.width, el.style.height];
  };

  it("scales PDF points by the page view's scale", () => {
    expect(boxRect({ text: "", page: 1, x0: 72, top: 92, x1: 255, bottom: 104 }, 1.5)).toEqual({ left: 108, top: 138, width: 274.5, height: 18 });
  });

  it("opens the cited page and draws its boxes there", async () => {
    render(<PdfView bytes={bytes} filename="report.pdf" highlight={{ page: 2, boxes: [box] }} />);
    await screen.findByText("/ 3");
    expect(vw.state.pageNumber).toBe(2);
    expect(rect()).toEqual(["20px", "40px", "40px", "10px"]);
  });

  it("redraws after pdf.js re-renders the page at a new scale, and clears when the highlight goes", async () => {
    const { rerender } = render(<PdfView bytes={bytes} filename="report.pdf" highlight={{ page: 2, boxes: [box] }} />);
    await screen.findByText("/ 3");
    // What pdf.js's PDFPageView.reset does to a page on zoom: it empties the div.
    document.querySelectorAll(".pdf-highlight").forEach((n) => n.remove());
    vw.state.pageScale = 3;
    emit("pagerendered", { pageNumber: 2 });
    expect(rect()).toEqual(["30px", "60px", "60px", "15px"]);
    rerender(<PdfView bytes={bytes} filename="report.pdf" highlight={null} />);
    expect(document.querySelector(".pdf-highlight")).toBeNull();
  });
});
