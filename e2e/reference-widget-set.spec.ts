// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Full per-widget render diagnostics. Interaction/persistence gates remain separate.
import {readFileSync} from "node:fs";
import {expect, test} from "@playwright/test";
import {normalizeWidgets} from "../src/lib/widgetsJson";
import {seedParams} from "../src/lib/params";
import {seedApp} from "./fixtures";
const reference = process.env.OPENBQ_REFERENCE_URL;
const path = process.env.OPENBQ_REFERENCE_MANIFEST;
const corpus = path ? normalizeWidgets(JSON.parse(readFileSync(path, "utf8")), "reference") : {widgets: [], issues: []};
test.skip(!reference || !path, "Requires pinned reference backend and its downloaded manifest");
for (const widget of corpus.widgets) {
  test(`reference render ${widget.id} (${widget.type})`, async ({page}) => {
    test.setTimeout(20_000);
    await page.route(`${reference}/**`, async route => {
      const response = await route.fetch();
      await route.fulfill({response, headers: {...response.headers(), "access-control-allow-origin": "*"}});
    });
    await seedApp(page, {
      "settings.json": JSON.stringify({collapseWidgetControls: false}),
      "backends.json": JSON.stringify([{id: "reference", name: "Reference", baseUrl: reference, authLocation: "header", validateWidgets: true}]),
      "dashboards/reference.json": JSON.stringify({id: "reference", name: "Reference", tabs: [{id: "t-reference", name: "Reference", cards: [{id: "reference-card", widgetId: widget.id, backendId: "reference", params: seedParams(widget), layout: {x: 0, y: 0, w: 40, h: 24}}]}]}),
    });
    const card = page.locator(".widget-card");
    await expect(card.locator(".card-title")).toHaveText(widget.name);
    if (widget.runButton) await card.getByRole("button", {name: "Run", exact: true}).click();
    if (widget.id === "markdown_widget_with_error_handling") {
      await expect(card.getByRole("alert")).toContainText("Error that just occurred");
      await expect(card.getByRole("button", {name: "Retry", exact: true})).toBeVisible();
      await page.unrouteAll({behavior: "ignoreErrors"});
      return; // Deliberate negative control, never counted as returned data.
    }
    const body = card.locator(".card-body, .card-render").last();
    switch (widget.type) {
      case "table": await expect(body.locator("tbody tr[data-index]").first()).toBeVisible({timeout: 12_000}); break;
      case "metric": await expect(body.locator(".metric-value")).not.toHaveText(""); break;
      case "markdown":
        if (widget.id.includes("image")) {
          const image = body.locator(".markdown-body img");
          await expect(image).toBeVisible();
          await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
        } else await expect(body.locator(".markdown-body")).not.toHaveText("", {timeout: 12_000});
        break;
      case "chart": case "chart-highcharts": case "chart-vegalite": await expect(body.locator(".chart-plot .main-svg").first()).toBeVisible({timeout: 12_000}); break;
      case "newsfeed": await expect(body.locator(".newsfeed li").first()).toBeVisible(); break;
      case "pdf": await expect(body.locator(".pdfViewer .page canvas").first()).toBeVisible({timeout: 12_000}); break;
      case "multi_file_viewer": {
        await card.getByLabel("Documents", {exact: true}).focus();
        const first = card.locator('.file-rail input[type="checkbox"]').first();
        await first.check();
        await card.getByRole("button", {name: /Open/}).click();
        await expect(body.locator(".pdfViewer .page canvas").first()).toBeVisible({timeout: 12_000}); break;
      }
      case "html": await expect(body.locator("iframe")).toHaveAttribute("srcdoc", /\S/); break;
      case "youtube": await expect(body.locator("iframe")).toHaveAttribute("src", /youtube.*\/embed\//); break;
      case "advanced_charting": await expect(body.locator(".tv-chart-plot canvas").first()).toBeVisible({timeout: 12_000}); break;
      case "live_grid": await expect(body.locator("tbody tr[data-index]").first()).toBeVisible({timeout: 12_000}); break;
      case "omni": {
        const prompt = widget.id.includes("sql") ? "SELECT * FROM DATA LIMIT 5" : widget.id.includes("python") ? "fig = go.Figure(data=[go.Bar(x=['A', 'B'], y=[2, 3])])" : "Show reference data";
        await body.getByRole("textbox").fill(prompt);
        await body.getByRole("button", {name: "Submit", exact: true}).click();
        if (widget.id.includes("sql")) await expect(body.locator(".omni-result tbody tr[data-index]").first()).toBeVisible({timeout: 12_000});
        else if (widget.id.includes("python")) await expect(body.locator(".omni-result .chart-plot .main-svg").first()).toBeVisible({timeout: 12_000});
        else await expect(body.locator(".omni-result")).toContainText("Show reference data");
        break;
      }
      default: throw new Error(`No positive content assertion defined for ${widget.type}`);
    }
    await expect(card.locator(".error-state, .omni-error")).toHaveCount(0);
    await page.unrouteAll({behavior: "ignoreErrors"});
  });
}
