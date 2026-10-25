// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, dashboardSeed, seedApp } from "./fixtures";

/** Every POST the page made to the multi-file endpoint, as its raw JSON body. */
function trackDocumentPosts(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/documents" && req.method() === "POST") {
      bodies.push(req.postData() ?? "");
    }
  });
  return bodies;
}

const seedWithDocumentCards = () =>
  dashboardSeed([
    ...DEFAULT_CARDS,
    { id: "c-pdf", widgetId: "usda_report", backendId: "b1", params: {}, layout: { x: 0, y: 12, w: 20, h: 16 } },
    { id: "c-files", widgetId: "filings", backendId: "b1", params: {}, layout: { x: 20, y: 12, w: 20, h: 16 } },
    { id: "c-pdf2", widgetId: "two_page_report", backendId: "b1", params: {}, layout: { x: 0, y: 28, w: 20, h: 16 } },
  ]);

test("a pdf card renders its document through the bundled pdf.js worker", async ({ page }) => {
  await seedApp(page, seedWithDocumentCards());
  const card = page.locator(".widget-card").filter({ hasText: "USDA Report" });

  await expect(card.locator(".pdf-page-input")).toHaveValue("1");
  await expect(card.locator(".pdf-page-count")).toHaveText("/ 1");
  await expect(card.locator(".pdf-filename")).toHaveText("psd.pdf");

  // A canvas with real pixels in it: the whole point of bundling pdf.js is
  // that the worker loads with no network and actually paints. pdf.js's own
  // canvases are unclassed, inside .page > .canvasWrapper.
  const canvas = card.locator(".pdf-body canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // No table/chart/raw toggle on a document card.
  await expect(card.getByRole("combobox", { name: "View" })).toHaveCount(0);
});

test("the multi-file card opens the files checked in its hover rail, in one POST", async ({
  page,
}) => {
  const posts = trackDocumentPosts(page);
  await seedApp(page, seedWithDocumentCards());
  const card = page.locator(".widget-card").filter({ hasText: "Filing Documents" });

  // Nothing is fetched for this card until the reader asks for something.
  await expect(card.getByText("Choose documents in the rail.")).toBeVisible();
  expect(posts).toEqual([]);

  // The rail is 28px wide at rest and its list is display:none until it
  // expands, exactly as the app's left rail behaves.
  await card.locator(".file-rail").hover();
  await card.locator(".file-rail[data-expanded='true']").waitFor();

  await card.getByRole("checkbox", { name: "Report A" }).check();
  await card.getByRole("checkbox", { name: "Report B" }).check();
  await card.getByRole("button", { name: "Open" }).click();

  await expect(card.locator(".multi-file-position")).toHaveText("1 / 2");
  await expect(card.locator(".pdf-filename")).toHaveText("a.pdf");

  // Open leaves the rail open on purpose: comparing the next pair of filings
  // should not cost another hover.
  await expect(card.locator(".file-rail")).toHaveAttribute("data-expanded", "true");

  // The pointer leaving is the one thing that collapses it -- and it has to,
  // because the expanded rail lies over the paging controls. Real Chromium
  // enforces that as a pointer-event-interception failure on the click below;
  // jsdom cannot (css: false, and no :focus-within in matches()).
  const viewer = (await card.locator(".multi-file-viewer").boundingBox())!;
  await page.mouse.move(viewer.x + viewer.width * 0.75, viewer.y + viewer.height / 2);
  await expect(card.locator(".file-rail")).toHaveAttribute("data-expanded", "false");

  await card.getByRole("button", { name: "Next document" }).click();
  await expect(card.locator(".multi-file-position")).toHaveText("2 / 2");
  await expect(card.locator(".pdf-filename")).toHaveText("b.pdf");

  // Exactly one request, carrying both URLs under the selector's param name.
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0])).toEqual({
    files: ["https://files.example/a.pdf", "https://files.example/b.pdf"],
  });
});

test("paging back and forth keeps rendering, one pdf.js worker per document", async ({ page }) => {
  // The regression this guards: pdf.js caches one PDFWorker per workerPort, and
  // PDFDocumentLoadingTask.destroy() terminates it. Handing pdf.js a shared
  // Worker meant the SECOND document opened threw "PDFWorker.create - the
  // worker is being destroyed", so a reader who paged › and back saw an error
  // where the page should be. Only a real browser can catch it: jsdom has no
  // Worker, so the unit tests mock pdf.js away entirely.
  await seedApp(page, seedWithDocumentCards());
  const card = page.locator(".widget-card").filter({ hasText: "Filing Documents" });

  await card.locator(".file-rail").hover();
  await card.locator(".file-rail[data-expanded='true']").waitFor();
  await card.getByRole("checkbox", { name: "Report A" }).check();
  await card.getByRole("checkbox", { name: "Report B" }).check();
  await card.getByRole("button", { name: "Open" }).click();
  await expect(card.locator(".pdf-filename")).toHaveText("a.pdf");

  // The expanded rail lies over the paging controls; the pointer has to leave.
  const viewer = (await card.locator(".multi-file-viewer").boundingBox())!;
  await page.mouse.move(viewer.x + viewer.width * 0.75, viewer.y + viewer.height / 2);
  await expect(card.locator(".file-rail")).toHaveAttribute("data-expanded", "false");

  /** A document is on screen: a painted canvas, and no message in its place. */
  const expectRendered = async (filename: string) => {
    await expect(card.locator(".pdf-filename")).toHaveText(filename);
    const canvas = card.locator(".pdf-body canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    await expect(card.locator(".multi-file-viewer .empty-state")).toHaveCount(0);
    await expect(card.getByText(/worker is being destroyed/i)).toHaveCount(0);
  };

  // ›, ‹, › again: mount, destroy, mount is the sequence that killed the shared
  // worker, and the second mount is where it surfaced.
  await card.getByRole("button", { name: "Next document" }).click();
  await expectRendered("b.pdf");

  await card.getByRole("button", { name: "Previous document" }).click();
  await expectRendered("a.pdf");

  await card.getByRole("button", { name: "Next document" }).click();
  await expectRendered("b.pdf");
});

/**
 * A dashboard tall enough to scroll, with the pdf card at the bottom of it --
 * which is the only way to reach a card that far down, and so the state a
 * reader is actually in when they maximize one.
 */
function seedWithScrollableDashboard() {
  const fillers = Array.from({ length: 6 }, (_, i) => ({
    id: `c-fill-${i}`,
    widgetId: "quote",
    backendId: "b1",
    params: { symbol: "AAPL" },
    layout: { x: 0, y: 12 + i * 9, w: 40, h: 9 },
  }));
  return dashboardSeed([
    ...DEFAULT_CARDS,
    ...fillers,
    { id: "c-pdf", widgetId: "usda_report", backendId: "b1", params: {}, layout: { x: 0, y: 66, w: 20, h: 16 } },
  ]);
}

test("a maximized pdf card can still be scrolled back to the top of its document", async ({
  page,
}) => {
  await seedApp(page, seedWithScrollableDashboard());
  const card = page.locator(".widget-card").filter({ hasText: "USDA Report" });
  await expect(card.locator(".pdf-page-input")).toHaveValue("1");
  await expect(card.locator(".pdf-page-count")).toHaveText("/ 1");
  await expect(card.locator(".pdf-body canvas").first()).toBeVisible();

  // Scrolled down to the card, and THEN a window resize -- the tab bar's
  // ResizeObserver is what publishes --dashboard-top, and it fires on any
  // resize, including one that lands while the dashboard is scrolled.
  const areaScrollTop = () =>
    page.evaluate(() => (document.querySelector(".dashboard-area") as HTMLElement).scrollTop);
  await page.evaluate(() => {
    (document.querySelector(".dashboard-area") as HTMLElement).scrollTop = 1e6;
  });
  await expect.poll(areaScrollTop).toBeGreaterThan(200);
  await page.setViewportSize({ width: 1180, height: 720 });

  await card.getByRole("button", { name: "Maximize" }).click();
  await expect(page.locator(".card-maximized")).toHaveCount(1);

  // The card fills the dashboard area and nothing more. One whose top edge is
  // above the window takes its header and the first screenful of its viewer
  // with it, and nothing can scroll either back into view.
  const box = await page.evaluate(() => {
    const item = document.querySelector(".card-maximized") as HTMLElement;
    const header = document.querySelector(".card-maximized .card-header") as HTMLElement;
    // pdf.js's own scroll container: `.pdf-frame` is the flex child and
    // `.pdf-body` is what fills it absolutely and scrolls (styles.css).
    const viewer = document.querySelector(".pdf-body") as HTMLElement;
    return {
      top: item.getBoundingClientRect().top,
      bottom: item.getBoundingClientRect().bottom,
      headerTop: header.getBoundingClientRect().top,
      viewerTop: viewer.getBoundingClientRect().top,
      windowHeight: window.innerHeight,
    };
  });
  expect(box.top, "the maximized card's top edge is on screen").toBeGreaterThanOrEqual(0);
  expect(box.bottom, "the maximized card ends at the window's bottom").toBeLessThanOrEqual(
    box.windowHeight + 1,
  );
  expect(box.headerTop, "the maximized card's header is on screen").toBeGreaterThanOrEqual(0);
  expect(box.viewerTop, "the viewer's own top edge is on screen").toBeGreaterThanOrEqual(0);

  // The page is re-rasterised to the maximized card's width on a debounce, and
  // it is that redraw that makes the document overflow the viewer at all.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector(".pdf-body") as HTMLElement;
        return el.scrollHeight - el.clientHeight;
      }),
    )
    .toBeGreaterThan(0);

  // Down to the end of the document and all the way back up, with the top of
  // page one on screen where it lands.
  const trip = await page.evaluate(() => {
    const el = document.querySelector(".pdf-body") as HTMLElement;
    el.scrollTop = el.scrollHeight;
    const bottom = el.scrollTop;
    el.scrollTop = 0;
    // pdf.js's canvases are unclassed, inside .page > .canvasWrapper.
    const page1 = document.querySelector(".pdf-body canvas") as HTMLElement;
    return { bottom, top: el.scrollTop, page1Top: page1.getBoundingClientRect().top };
  });
  expect(trip.bottom, "the maximized document overflows its viewer").toBeGreaterThan(0);
  expect(trip.top).toBe(0);
  expect(trip.page1Top, "the top of page one is on screen").toBeGreaterThanOrEqual(0);
});

/** The two-page card, once pdf.js has opened its document. */
async function twoPageCard(page: Page) {
  const card = page.locator(".widget-card").filter({ hasText: "Two Page Report" });
  await expect(card.locator(".pdf-page-count")).toHaveText("/ 2");
  return card;
}

test("the text layer carries the document's own words", async ({ page }) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);

  // pdf.js's transparent text spans -- what makes a document selectable,
  // copyable and searchable. The canvas alone carries no text at all, which is
  // exactly what the previous canvas-only viewer could not offer.
  // One text layer per rendered page, so this is page 1's.
  await expect(card.locator(".textLayer").first()).toContainText("Alpha report");
  await expect(card.locator(".pdf-page-input")).toHaveValue("1");
});

test("the find bar finds a phrase on the second page, highlights it and follows it there", async ({
  page,
}) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);

  await card.getByRole("button", { name: "Find" }).click();
  await card.getByLabel("Find in document").fill("Omega");

  await expect(card.locator(".pdf-find-count")).toHaveText("1 of 1");
  await expect(card.locator(".textLayer .highlight")).not.toHaveCount(0);
  // The find controller scrolled the match into view, and the viewer's own
  // scroll handler reported the page that put it there.
  await expect(card.locator(".pdf-page-input")).toHaveValue("2");
});

test("the page box goes where it is told, and clamps what it is given", async ({ page }) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);
  const box = card.locator(".pdf-page-input");

  await box.fill("2");
  await box.press("Enter");
  await expect(box).toHaveValue("2");

  await box.fill("1");
  await box.press("Enter");
  await expect(box).toHaveValue("1");

  // Clamped before it reaches pdf.js, whose own setter would log a
  // console.error and refuse to move. Asked for from page ONE, so the clamp is
  // visible: landing on 2 can only be the clamp, not a box that never moved.
  await box.fill("9");
  await box.press("Enter");
  await expect(box).toHaveValue("2");
});

test("a /GoTo link annotation jumps to the page it points at", async ({ page }) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);

  // pdf.js's link service handles this one itself; the app's delegated handler
  // only swallows the hash navigation that would otherwise follow.
  await card.locator(".annotationLayer .linkAnnotation a").first().click();

  await expect(card.locator(".pdf-page-input")).toHaveValue("2");
});

test("Command-F opens the find bar over the card the pointer is on, and Escape closes it", async ({
  page,
}) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);
  const other = page.locator(".widget-card").filter({ hasText: "USDA Report" });

  await card.hover();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(card.getByLabel("Find in document")).toBeFocused();
  // Scoped to the hovered card: the other PDF card on this dashboard never
  // opened one.
  await expect(other.getByLabel("Find in document")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(card.getByLabel("Find in document")).toHaveCount(0);
});

test("Escape out of the find bar closes only the bar, leaving the card maximized", async ({
  page,
}) => {
  await seedApp(page, seedWithDocumentCards());
  const card = await twoPageCard(page);

  await card.getByRole("button", { name: "Maximize" }).click();
  await expect(page.locator(".card-maximized")).toHaveCount(1);

  await card.getByRole("button", { name: "Find" }).click();
  await expect(card.getByLabel("Find in document")).toBeFocused();

  // One Escape does one thing. The find bar's listener is capture-phase but
  // bound to the VIEWER ROOT, not the window, so it runs ahead of WidgetCard's
  // bubble-phase window listener for a press that started inside this card --
  // and stops there.
  await page.keyboard.press("Escape");
  await expect(card.getByLabel("Find in document")).toHaveCount(0);
  await expect(page.locator(".card-maximized")).toHaveCount(1);

  // With the bar gone its listener is gone with it, so the next press is the
  // restore.
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-maximized")).toHaveCount(0);
});
