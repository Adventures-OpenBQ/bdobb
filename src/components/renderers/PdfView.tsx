// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { isTypingTarget } from "../../hooks/useDashboardShortcuts";
import { installAbortSignalAny } from "../../lib/abortSignalAny";
import type { BoundingBox } from "../../lib/agent/types";
import { openLinkExternally } from "./openLinkExternally";
// pdf.js's own page, text-layer and annotation-layer stylesheet. vitest runs
// with `css: false` (vite.config.ts), so under jsdom this resolves to an empty
// module and no test is affected by it.
import "pdfjs-dist/legacy/web/pdf_viewer.css";

/** Absolute zoom, as pdf.js means it: 100 % is the page's natural size. */
const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;
/** One re-fit per settled drag, not one per animation frame. */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * pdf.js's `TextLayerMode` is the one enum here that is NOT exported — it is
 * module-local to web/pdf_viewer.mjs (DISABLE 0, ENABLE 1, ENABLE_PERMISSIONS
 * 2 — web/pdf_viewer.mjs:185-189) — so this value stays inlined. The other
 * four (`AnnotationMode` and `AnnotationEditorType` from `pdfjs-dist`,
 * `LinkTarget` and `FindState` from the viewer bundle) are read off the
 * lazily imported modules below, which is also the only place they may be
 * read from: nothing at module scope here can touch either module.
 */
const TEXT_LAYER_ENABLE = 1;

type ViewerModule = typeof import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
type Viewer = InstanceType<ViewerModule["PDFViewer"]>;
type Bus = InstanceType<ViewerModule["EventBus"]>;
type LinkService = InstanceType<ViewerModule["PDFLinkService"]>;

/** "fit" follows the card's width; "explicit" holds the percentage set by ± . */
type ZoomMode = "fit" | "explicit";

/**
 * pdf.js is loaded on FIRST USE, not at module scope: pdfjs-dist
 * reads DOMMatrix while it evaluates (src/display/canvas.js) and jsdom defines
 * none, so a static import would make every test file that reaches WidgetCard
 * fail to COLLECT with "ReferenceError: DOMMatrix is not defined", not just the
 * ones that render a PDF. web/pdf_viewer.mjs is loaded the same way and for the
 * same reason, and it keeps the viewer components in the pdf.js chunk.
 *
 * pdf.js is pointed at the worker FILE (workerSrc), and must not be handed a
 * Worker instance (workerPort). pdf.js caches one PDFWorker per port
 * (PDFWorker.#workerPorts) and `PDFDocumentLoadingTask.destroy()` terminates
 * that worker and flags it `_pendingDestroy`, so with a single app-lifetime
 * port the SECOND document opened hits `PDFWorker.create` on the dying cached
 * instance and dies with "the worker is being destroyed. Please remember to
 * await `PDFDocumentLoadingTask.destroy()`-calls." — which is exactly what
 * paging through a multi-file card did. From a URL, pdf.js spawns its own
 * module worker per document and terminates it with that document's task.
 *
 * Vite rewrites `new URL(..., import.meta.url)` into a reference to an asset it
 * emits, so the worker still ships inside the app — there is no CDN, and Tauri
 * has no network by default.
 */
async function loadPdfjs() {
  // Before the import, not after: see src/lib/abortSignalAny.ts. The legacy
  // build fills pdf.js's other post-16.4 gaps itself.
  installAbortSignalAny();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Once, and idempotent: the setting is global to pdf.js, so the second card
  // to open a document finds it already pointing at the bundled file.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  // web/pdf_viewer.mjs is pdf.js's "viewer components" build: it does not
  // import the API, it DESTRUCTURES the whole of it off `globalThis.pdfjsLib`
  // while it evaluates (web/pdf_viewer.mjs:29-92). The global therefore has to
  // be in place before that module is imported, or every name it needs is
  // undefined and it throws "Cannot destructure property 'AbortException' of
  // 'globalThis.pdfjsLib'" at import time. Idempotent, like workerSrc above.
  // The intersection cast is only to name a property `globalThis` has no
  // declaration for; pdf.js sets exactly this global in its own viewer.
  const globalWithPdfjs = globalThis as typeof globalThis & { pdfjsLib?: unknown };
  globalWithPdfjs.pdfjsLib ??= pdfjs;
  return pdfjs;
}

type MatchesCount = { current: number; total: number };

/** "3 of 12" while there is a match to point at, and nothing at all when not. */
const matchText = ({ current, total }: MatchesCount) =>
  total === 0 ? "" : `${current} of ${total}`;

/** Digits only, so "12abc" is garbage rather than page 12. */
const PAGE_INPUT = /^\s*\d+\s*$/;

/** Content, not identity: the same length and every byte the same. */
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((value, i) => value === b[i]);

type Props = { bytes: Uint8Array; filename: string; highlight?: Highlight | null };

/** A cited quote on one page: what Sources opened. */
type Highlight = { page: number; boxes: BoundingBox[] };

/** A quote box in CSS pixels: PDF points (top-left origin) times the page view's viewport scale. */
export function boxRect(box: BoundingBox, scale: number) {
  return { left: box.x0 * scale, top: box.top * scale, width: (box.x1 - box.x0) * scale, height: (box.bottom - box.top) * scale };
}

/**
 * Replaces the overlays: removes every one in this viewer, then draws `h`'s boxes
 * into its page's div. pdf.js empties that div whenever it re-renders the page
 * (PDFPageView.reset, on zoom or scroll-back), so `pagerendered` calls this again.
 * ponytail: ignores page rotation; add viewport.convertToViewportRectangle if a rotated PDF ever matters.
 */
function drawHighlights(viewer: Viewer, body: HTMLElement, h: Highlight | null) {
  body.querySelectorAll(".pdf-highlight").forEach((n) => n.remove());
  if (!h) return;
  const view = viewer.getPageView(h.page - 1) as { div: HTMLDivElement; viewport: { scale: number } } | undefined;
  if (!view) return;
  for (const box of h.boxes) {
    const r = boxRect(box, view.viewport.scale);
    const el = document.createElement("div");
    el.className = "pdf-highlight";
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    view.div.append(el);
  }
}

/**
 * One document, rendered by pdf.js's own viewer components: page virtualisation,
 * a text layer you can select and copy from, link annotations, and the find
 * controller behind the find bar. No print, no download, no thumbnails, no
 * outline: a card is for reading a report, not for editing one.
 */
export function PdfView({ bytes, filename, highlight = null }: Props) {
  /**
   * The scroll container, held as STATE rather than a ref: the error branch
   * swaps `.pdf-body` out for a message, so a ref alone would leave the viewer
   * bound to a detached node. As state it is a dependency, and the effects below
   * re-run against whichever node is actually in the document.
   */
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const busRef = useRef<Bus | null>(null);
  const linkServiceRef = useRef<LinkService | null>(null);
  /**
   * The LOADING TASK, not the document: destroy() lives on the task in
   * pdfjs-dist v6 (PDFDocumentProxy has none), and it is what releases the
   * worker-side document.
   */
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read by the resize observer, which must not be rebuilt on a mode change. */
  const modeRef = useRef<ZoomMode>("fit");

  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageValue, setPageValue] = useState("1");
  const [zoomPct, setZoomPct] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  /** "3 of 12", "No matches", or "" while there is nothing to report. */
  const [findCount, setFindCount] = useState("");
  const findInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The page box holds a HALF-TYPED number, not merely a focused one. Focus is
   * the wrong test: clicking into the box and then scrolling would leave it
   * showing the page it was clicked on, and the blur that follows would commit
   * that stale number and scroll the document back. Set in the input's
   * onChange, cleared by commitPage -- which is also what makes a blur with
   * nothing typed a no-op.
   */
  const pageDirtyRef = useRef(false);
  const highlightRef = useRef<Highlight | null>(highlight);

  /**
   * The bytes as last LOADED, which is not always the latest `bytes` prop:
   * every fetch -- an auto-refresh tick, Command-R -- decodes a new array even
   * when the PDF on the server has not changed, and the load effect below is
   * keyed on identity. A byte-identical array keeps the loaded one, and with
   * it the reader's page, zoom and find; only new content reloads. `seen` is
   * the last prop compared, so re-renders on the same array do not re-scan a
   * multi-megabyte buffer. Set during render, React's pattern for state
   * derived from a previous render's props: it re-renders before committing.
   */
  const [loaded, setLoaded] = useState({ seen: bytes, doc: bytes });
  if (loaded.seen !== bytes) {
    setLoaded({ seen: bytes, doc: sameBytes(loaded.doc, bytes) ? loaded.doc : bytes });
  }
  const docBytes = loaded.doc;

  /**
   * Cleared here rather than inside the load effect below, which cannot run
   * while `body` is null -- and `body` is null exactly while the error branch
   * has `.pdf-body` swapped out for a message. Clearing it there would deadlock:
   * no container, so no load; no load, so no clear; so no container.
   */
  useEffect(() => {
    setError(null);
  }, [docBytes]);

  useEffect(() => {
    if (!body) return;
    let cancelled = false;
    setPageCount(0);
    setCurrentPage(1);
    setPageValue("1");
    pageDirtyRef.current = false;
    modeRef.current = "fit";
    // A new document has none of the old one's matches, and its highlights are
    // gone with its pages.
    setFindOpen(false);
    setFindQuery("");
    setFindCount("");

    // One per load, handed to the PDFViewer below. In pdf.js 5 this signal is
    // the ONLY thing that disconnects the viewer's own ResizeObserver and
    // removes its scroll listener (web/pdf_viewer.mjs:13548-13557) --
    // setDocument(null) does neither -- so without it every document paged
    // through leaves a dead viewer firing on the same `.pdf-body`.
    const controller = new AbortController();
    // Hoisted above the try so the catch branch can destroy it too: a task
    // that failed to open still spawned a worker, and only destroy() stops it.
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        // Strictly in this order, never Promise.all: loadPdfjs installs
        // `globalThis.pdfjsLib`, which the viewer module reads as it evaluates.
        const pdfjs = await loadPdfjs();
        const viewerModule = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
        if (cancelled) return;
        const { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } =
          viewerModule;
        // ENABLE draws link annotations and read-only widgets; ENABLE_FORMS,
        // pdf.js's default, would make form fields editable and is
        // deliberately not used. Without AnnotationEditorType.DISABLE pdf.js
        // builds an AnnotationEditorUIManager with document-level
        // drop/keydown listeners per card; editing is out of scope here.
        const { AnnotationMode, AnnotationEditorType } = pdfjs;

        // A COPY: pdf.js takes ownership of the TypedArray and transfers it to
        // the worker, detaching it. StrictMode's double-mount and the file rail
        // both re-render with the caller's same instance.
        task = pdfjs.getDocument({
          data: new Uint8Array(docBytes),
          // The 14 base-14 substitute faces, emitted unhashed at this exact
          // path by the pdfStandardFonts plugin in vite.config.ts. pdf.js
          // appends a bare filename to this string, so the TRAILING SLASH is
          // load-bearing. Resolved against document.baseURI rather than
          // import.meta.url: the fonts sit at the app root, not next to this
          // module's emitted chunk, and baseURI follows Vite's `base` and the
          // tauri:// origin without either being spelled out here.
          standardFontDataUrl: new URL("standard_fonts/", document.baseURI).toString(),
        });
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy().catch(() => {});
          return;
        }

        const eventBus = new EventBus();
        const linkService = new PDFLinkService({
          eventBus,
          externalLinkTarget: LinkTarget.NONE,
        });
        const findController = new PDFFindController({ eventBus, linkService });
        // pdf.js reads `abortSignal` off these options (web/pdf_viewer.mjs:13546-
        // 13550) but its .d.ts leaves it out of PDFViewerOptions
        // (types/web/pdf_viewer.d.ts:11). The intersection only names that one
        // property; every other field is still checked against pdf.js's type.
        const viewerOptions: ConstructorParameters<typeof PDFViewer>[0] & {
          abortSignal: AbortSignal;
        } = {
          container: body,
          eventBus,
          linkService,
          findController,
          textLayerMode: TEXT_LAYER_ENABLE,
          annotationMode: AnnotationMode.ENABLE,
          annotationEditorMode: AnnotationEditorType.DISABLE,
          abortSignal: controller.signal,
        };
        const viewer = new PDFViewer(viewerOptions);
        linkService.setViewer(viewer);

        // pdf.js leaves _currentScaleValue null until someone sets it, and the
        // pages are built at scale 1 (web/pdf_viewer.mjs:8351). "page-width"
        // also returns early before the first page exists (:8778-8781), so the
        // fit has to be asked for on `pagesinit` — exactly as pdf.js's own
        // viewer application does.
        eventBus.on("pagesinit", () => {
          if (cancelled) return;
          viewer.currentScaleValue = "page-width";
        });
        eventBus.on("pagechanging", (evt: { pageNumber: number }) => {
          if (cancelled) return;
          setCurrentPage(evt.pageNumber);
          // A half-typed page number is the reader's, not pdf.js's to overwrite
          // mid-keystroke -- Enter (commitPage) or a blur is what replaces it.
          // An untouched box, focused or not, still follows the document.
          if (!pageDirtyRef.current) setPageValue(String(evt.pageNumber));
        });
        eventBus.on("scalechanging", (evt: { scale: number }) => {
          if (cancelled) return;
          setZoomPct(Math.round(evt.scale * 100));
        });
        eventBus.on("pagerendered", (evt: { pageNumber: number }) => {
          if (!cancelled && evt.pageNumber === highlightRef.current?.page) drawHighlights(viewer, body, highlightRef.current);
        });
        // { source, matchesCount: { current, total } } (web/pdf_viewer.mjs:1453-1458).
        eventBus.on("updatefindmatchescount", (evt: { matchesCount: MatchesCount }) => {
          if (cancelled) return;
          setFindCount(matchText(evt.matchesCount));
        });
        // { source, state, previous, entireWord, matchesCount, rawQuery }
        // (web/pdf_viewer.mjs:1459-1470).
        eventBus.on(
          "updatefindcontrolstate",
          (evt: { state: number; matchesCount: MatchesCount }) => {
            if (cancelled) return;
            // WRAPPED carries a real count and is shown as one; PENDING is
            // the "still searching" tick and leaves the previous text alone.
            if (evt.state === FindState.NOT_FOUND) setFindCount("No matches");
            else if (evt.state !== FindState.PENDING) setFindCount(matchText(evt.matchesCount));
          },
        );

        // The viewer sets the find controller's document itself, on the first
        // page render (web/pdf_viewer.mjs:8414), and clears it again inside
        // setDocument(null) (:8253). Setting it here as well would reset the
        // controller a second time and drop an in-flight query, so it is not
        // set here and not torn down here. The link service is ours: nothing
        // else ever gives it a document.
        viewer.setDocument(doc);
        linkService.setDocument(doc);

        taskRef.current = task;
        viewerRef.current = viewer;
        busRef.current = eventBus;
        linkServiceRef.current = linkService;
        setPageCount(doc.numPages);
      } catch (err) {
        // A failed getDocument() still leaves a worker running; only
        // destroy() stops it. Outside the cancelled guard below, which is
        // about STATE updates, not this cleanup.
        if (task) void task.destroy().catch(() => {});
        // A viewer built before the failure is never stored in viewerRef, so
        // the cleanup below would not reach it; its observers go here.
        controller.abort();
        if (cancelled) return;
        // pdf.js' own message ("Invalid PDF structure."). It names no URL and
        // carries nothing from the request that fetched the bytes.
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      const linkService = linkServiceRef.current;
      const task = taskRef.current;
      viewerRef.current = null;
      linkServiceRef.current = null;
      busRef.current = null;
      taskRef.current = null;
      // `setDocument(null)` is pdf.js's own teardown — its body reads
      // `if (this.pdfDocument) { ...reset... } this.pdfDocument = pdfDocument;
      // if (!pdfDocument) return;` (web/pdf_viewer.mjs:8246-8263) — but its
      // .d.ts types the parameter as a non-nullable PDFDocumentProxy
      // (types/web/pdf_viewer.d.ts:365). The cast is confined to this line.
      viewer?.setDocument(null as unknown as PDFDocumentProxy);
      linkService?.setDocument(null);
      // After setDocument(null), which still needs a live viewer: this is what
      // actually retires it (see the controller above).
      controller.abort();
      // Destroyed on unmount AND on every bytes change, so paging through the
      // file rail does not leak a worker-side document per document opened.
      if (task) void task.destroy().catch(() => {});
    };
  }, [docBytes, body]);

  useEffect(() => {
    // jsdom defines no ResizeObserver, and PdfView must still mount there.
    if (!body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      // Debounced: dragging a card's corner fires this every frame, and each
      // width change re-rasterises every visible page.
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null;
        // At an explicit percentage a resize leaves the scale alone: the reader
        // asked for that size, not for whatever the card is now wide enough for.
        if (modeRef.current !== "fit") return;
        const viewer = viewerRef.current;
        if (viewer) viewer.currentScaleValue = "page-width";
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(body);
    return () => {
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      observer.disconnect();
    };
  }, [body]);

  // A highlight opens its page and draws now; the pagerendered listener above
  // redraws it each time pdf.js re-renders that page (zoom included).
  useEffect(() => {
    highlightRef.current = highlight;
    const viewer = viewerRef.current;
    if (!body || !viewer || pageCount === 0) return;
    if (highlight) viewer.currentPageNumber = Math.min(Math.max(highlight.page, 1), pageCount);
    drawHighlights(viewer, body, highlight);
  }, [highlight, pageCount, body]);

  const commitPage = () => {
    // Nothing was typed, so there is nothing to commit: a blur out of an
    // untouched box must leave the viewer exactly where it is.
    if (!pageDirtyRef.current) return;
    pageDirtyRef.current = false;
    const viewer = viewerRef.current;
    if (!viewer || pageCount === 0 || !PAGE_INPUT.test(pageValue)) {
      setPageValue(String(currentPage));
      return;
    }
    const clamped = Math.min(Math.max(Number.parseInt(pageValue, 10), 1), pageCount);
    setPageValue(String(clamped));
    // Clamped BEFORE the assignment: pdf.js's setter logs a console.error for a
    // page outside the document (web/pdf_viewer.mjs:7988) and throws outright
    // for a non-integer (:7978).
    viewer.currentPageNumber = clamped;
  };

  const stepZoom = (direction: 1 | -1) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // Snapped to the 25 % grid in the direction of travel, because the fit
    // scale pdf.js computes is an arbitrary percentage (143 %, say) and a
    // plain ±25 from there would keep the whole band off the grid.
    const next =
      direction > 0
        ? Math.floor(zoomPct / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP
        : Math.ceil(zoomPct / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP;
    modeRef.current = "explicit";
    viewer.currentScaleValue = String(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) / 100);
  };

  const fitWidth = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    modeRef.current = "fit";
    viewer.currentScaleValue = "page-width";
  };

  /**
   * The find controller listens on the bus for "find" and reads exactly these
   * fields off the payload (web/pdf_viewer.mjs:864, 893-941, 1005-1032,
   * 1130-1145, 1219). Dispatching is the whole integration: pdf.js debounces an
   * empty `type` itself (250 ms, :920-923), so there is no debounce here.
   */
  const dispatchFind = (type: "" | "again", query: string, findPrevious: boolean) => {
    busRef.current?.dispatch("find", {
      type,
      query,
      caseSensitive: false,
      entireWord: false,
      matchDiacritics: false,
      highlightAll: true,
      findPrevious,
    });
  };

  const openFind = useCallback(() => {
    setFindOpen(true);
    // Already open: the state set is a no-op, so the effect below will not
    // re-run and a second Command+F would do nothing. Null while the bar is
    // closed, which is exactly when that effect does the focusing instead.
    const input = findInputRef.current;
    input?.focus();
    input?.select();
  }, []);

  const closeFind = useCallback(() => {
    // pdf.js's own close signal (web/pdf_viewer.mjs): clears any pending
    // debounced "find" and drops highlights immediately, unlike dispatching
    // an empty "find" which only schedules that after its own 250 ms debounce.
    busRef.current?.dispatch("findbarclose", {});
    setFindCount("");
    setFindOpen(false);
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!findOpen) return;
    const input = findInputRef.current;
    input?.focus();
    input?.select();
  }, [findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    const root = rootRef.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase + stopImmediatePropagation is the RowContextMenu idiom
      // (src/components/RowContextMenu.tsx), but bound to THIS CARD'S ROOT
      // rather than the window. On the window it would be app-wide: an open
      // find bar in one card would swallow the Escape meant for any dialog,
      // menu or InlineRename anywhere, and steal focus back to the card. On
      // the root, capture still runs before React's delegated handlers and
      // before every bubble-phase window listener -- but only for a press that
      // originated inside the card, so one press closes the find bar WITHOUT
      // also restoring a maximized card underneath it.
      event.preventDefault();
      event.stopImmediatePropagation();
      closeFind();
    };
    root.addEventListener("keydown", onKey, { capture: true });
    return () => root.removeEventListener("keydown", onKey, { capture: true });
  }, [findOpen, closeFind]);

  useEffect(() => {
    // Only once there is a document to search.
    if (pageCount === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyF" || event.altKey || event.shiftKey) return;
      // Exactly one of Command/Control: ⌘F on macOS, Ctrl+F elsewhere. No
      // platform sniff -- the pair is unambiguous, and ⌘⌃F is neither.
      if (event.metaKey === event.ctrlKey) return;
      // A second PDF card whose listener already claimed this press.
      if (event.defaultPrevented) return;
      const root = rootRef.current;
      if (!root) return;
      // The card, so a click anywhere in it (the text layer included) keeps
      // this card the target after the pointer leaves.
      const target = root.closest(".widget-card") ?? root;
      // A press aimed at a text field the card does not contain belongs to
      // that field -- merely hovering the card is not enough to take it. The
      // card's own page and find inputs are typing targets too, and those it
      // does contain.
      const from = event.target instanceof HTMLElement ? event.target : null;
      if (from !== null && isTypingTarget(from) && !target.contains(from)) return;
      const hovered = typeof target.matches === "function" && target.matches(":hover");
      if (!hovered && !target.contains(document.activeElement)) return;
      // In browser mode this is what stops Chromium's own find bar.
      event.preventDefault();
      openFind();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFind, pageCount]);

  // An internal /GoTo link has already been handled by pdf.js's own onclick,
  // which scrolled the viewer and returned false (build/pdf.mjs:18259-18268);
  // openLinkExternally's preventDefault only stops the hash navigation that
  // would otherwise follow.
  const onBodyClick = openLinkExternally;

  if (error !== null) return <p className="empty-state">{`${filename}: ${error}`}</p>;

  return (
    <div
      className="pdf-view"
      ref={rootRef}
      // Focusable so a clicked card stays the Command-F target after the
      // pointer leaves it; a press that lands on a real control is left alone.
      tabIndex={-1}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("input, button, a[href]")) return;
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div className="pdf-toolbar">
        <span className="pdf-filename" title={filename}>
          {filename}
        </span>
        <input
          className="pdf-page-input"
          type="text"
          inputMode="numeric"
          aria-label="Page"
          value={pageValue}
          onChange={(event) => {
            pageDirtyRef.current = true;
            setPageValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitPage();
          }}
          onBlur={commitPage}
        />
        <span className="pdf-page-count">{pageCount === 0 ? "/ …" : `/ ${pageCount}`}</span>
        <span className="pdf-zoom">{`${zoomPct}%`}</span>
        <button type="button" aria-label="Zoom out" onClick={() => stepZoom(-1)}>
          −
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => stepZoom(1)}>
          +
        </button>
        <button type="button" onClick={fitWidth}>
          Fit
        </button>
        <button
          type="button"
          className="pdf-find-toggle"
          aria-label="Find"
          aria-expanded={findOpen}
          onClick={() => (findOpen ? closeFind() : openFind())}
        >
          🔍
        </button>
      </div>
      {findOpen ? (
        <div className="pdf-findbar">
          <input
            className="pdf-find-input"
            type="text"
            aria-label="Find in document"
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => {
              setFindQuery(event.target.value);
              dispatchFind("", event.target.value, false);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              dispatchFind("again", findQuery, event.shiftKey);
            }}
          />
          {/* Polite, not assertive: the count changes on every keystroke. */}
          <span className="pdf-find-count" aria-live="polite">
            {findCount}
          </span>
          <button
            type="button"
            aria-label="Previous match"
            onClick={() => dispatchFind("again", findQuery, true)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next match"
            onClick={() => dispatchFind("again", findQuery, false)}
          >
            ›
          </button>
          <button type="button" aria-label="Close find" onClick={closeFind}>
            ⨯
          </button>
        </div>
      ) : null}
      {/*
        pdf.js refuses a container that is not absolutely positioned
        (web/pdf_viewer.mjs:7860-7862) and takes its page host from the
        container's first element child (:7857), so the scroll box cannot be the
        flex child itself. `.pdf-frame` is the flex child; `.pdf-body` fills it
        absolutely; `.pdfViewer` is the div pdf.js appends pages into and React
        never gives it children of its own.
      */}
      <div className="pdf-frame">
        <div className="pdf-body" ref={setBody} onClick={onBodyClick}>
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
