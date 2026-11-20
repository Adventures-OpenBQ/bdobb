// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from '@playwright/test';
import { metricReceipt, metricRows } from '../src/test/fixtures/metricEvidence';
import { KPI_GAUGE_MIN_DRAW_WIDTH } from '../src/lib/widgetData/kpi/build';
import type { LinkedKpiOptions } from '../src/lib/widgetData/kpi/types';

async function draw(page: Page, value: number, min: number, max: number, target?: number, width = 420) {
  await page.goto('/');
  const result = await page.evaluate(async ({ rows, receipt, min, max, target, width }) => {
    const fileModule = '/src/lib/localTableData.ts';
    const workerModule = '/src/lib/widgetData/kpi/workerClient.ts';
    const plotModule = '/src/lib/plotly.ts';
    const { datasetFromBytes } = await import(fileModule) as typeof import('../src/lib/localTableData');
    const { createKpiWorker } = await import(workerModule) as typeof import('../src/lib/widgetData/kpi/workerClient');
    const { renderPlot } = await import(plotModule) as typeof import('../src/lib/plotly');
    const body = { rows, completeness: 'complete', chart_sources: { version: 1, receipts: [receipt] } };
    const dataset = await datasetFromBytes('kpi.json', new TextEncoder().encode(JSON.stringify(body)), 'kpi', 1);
    const options: LinkedKpiOptions = {
      version: 1, metric: 'eps_ttm', valueField: 'eps_ttm', observation: { mode: 'latest' },
      view: 'gauge', range: { min, max, label: '<b>Planning</b>' },
      ...(target === undefined ? {} : { reference: { kind: 'user-target', value: target } }),
    };
    const worker = createKpiWorker();
    try {
      const result = await worker.run(dataset, options, new AbortController().signal);
      if (!result.ok || !result.gauge) return result;
      const node = document.createElement('div');
      node.id = 'kpi-geometry';
      node.style.cssText = 'position: fixed; top: 16px; left: 16px; height: 240px; z-index: 10000';
      node.style.width = width + 'px';
      document.body.append(node);
      await renderPlot(node, result.gauge, result.revision);
      return result;
    } finally {
      worker.dispose();
    }
  }, { rows: [{ ...metricRows[0], eps_ttm: value }, metricRows[1]], receipt: metricReceipt, min, max, target, width });
  const graph = page.locator('#kpi-geometry');
  async function geometry() {
    return graph.evaluate(node => {
      const trace = (node as HTMLElement & { _fullData: { gauge: { axis: { range: number[] } } }[] })._fullData[0];
      const outline = node.querySelector<SVGRectElement>('.gauge-outline rect')!;
      const bar = node.querySelector<SVGRectElement>('.value-bullet rect')!;
      const target = node.querySelector<SVGLineElement>('.threshold-bullet line');
      const labels = [...node.querySelectorAll('.annotation-text')].slice(1);
      const plot = node.getBoundingClientRect();
      return {
        range: trace.gauge.axis.range, outline: outline.getBBox().width, bar: bar.getBBox().width,
        threshold: target === null ? null : Number(target.getAttribute('x1')),
        labels: labels.map(label => label.textContent),
        labelBounds: labels.map(label => {
          const bounds = label.getBoundingClientRect();
          return { left: bounds.left - plot.left, right: bounds.right - plot.left, top: bounds.top - plot.top, bottom: bounds.bottom - plot.top };
        }),
        plotWidth: plot.width,
      };
    });
  }
  return { result, graph, geometry };
}

test('installed indicator renders the set bounds, proportional bar/target, and actual original-value hover', async ({ page }) => {
  const { result, graph, geometry } = await draw(page, 40, 0, 100, 60);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const svg = await geometry();
  expect(svg.range).toEqual([0, 1]);
  expect(svg.labels).toEqual(['0 USD per share', '100 USD per share']);
  expect(svg.outline).toBeGreaterThan(200);
  expect(svg.bar / svg.outline).toBeCloseTo(.4, 6);
  expect(svg.threshold! / svg.outline).toBeCloseTo(.6, 6);
  await graph.locator('.annotation-text').first().hover();
  const hover = graph.locator('.hoverlayer');
  await expect(hover).toContainText('Original value');
  await expect(hover).toContainText('40 USD per share');
  await expect(hover).toContainText('<b>Planning</b>');
  await expect(hover).toContainText('User target (assumption)');
  await test.info().attach('ordinary-gauge-svg-and-hover', {
    body: JSON.stringify({ ...svg, hover: await hover.textContent() }), contentType: 'application/json',
  });
});

test('installed indicator renders a finite 75% bar on an overflowing raw span without losing the original values', async ({ page }) => {
  const max = Number.MAX_VALUE;
  const { result, graph, geometry } = await draw(page, max / 2, -max, max, undefined, KPI_GAUGE_MIN_DRAW_WIDTH);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const svg = await geometry();
  expect(svg.range).toEqual([0, 1]);
  await test.info().attach('extreme-gauge-label-bounds', { body: JSON.stringify(svg), contentType: 'application/json' });
  expect(svg.labels).toEqual(['-1.7976931348623157e+308 USD per share', '1.7976931348623157e+308 USD per share']);
  expect(svg.outline).toBeGreaterThan(200);
  expect(svg.bar / svg.outline).toBeCloseTo(.75, 6);
  expect(svg.threshold).toBeNull();
  expect(svg.labelBounds[0].left).toBeGreaterThanOrEqual(0);
  expect(svg.labelBounds[1].right).toBeLessThanOrEqual(svg.plotWidth);
  expect(svg.labelBounds[0].bottom).toBeLessThan(svg.labelBounds[1].top);
  await graph.locator('.annotation-text').first().hover();
  const hover = graph.locator('.hoverlayer');
  await expect(hover).toContainText('8.988465674311579e+307 USD per share');
  await expect(hover).toContainText('-1.7976931348623157e+308 USD per share to 1.7976931348623157e+308 USD per share');
  await test.info().attach('extreme-gauge-svg-and-hover', {
    body: JSON.stringify({ ...svg, hover: await hover.textContent() }), contentType: 'application/json',
  });
});

test('the real worker produces no gauge for a 120 outside 0 to 100 or a collapsed positive position', async ({ page }) => {
  const exceeded = await draw(page, 120, 0, 100);
  expect(exceeded.result).toMatchObject({ ok: true, snapshot: { value: 120, outOfRange: true } });
  await expect(exceeded.graph).toHaveCount(0);
  const collapsed = await draw(page, Number.MIN_VALUE, 0, 100);
  expect(collapsed.result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry/i) });
  await expect(collapsed.graph).toHaveCount(0);
});

test('installed indicator draws distinct bar and threshold coordinates just above one step at 296 pixels', async ({ page }) => {
  const { result, geometry } = await draw(page, .0037, 0, 100, .0074, KPI_GAUGE_MIN_DRAW_WIDTH);
  expect(result).toMatchObject({ ok: true, snapshot: { value: .0037 } });
  const svg = await geometry();
  expect(svg.plotWidth).toBe(296);
  expect(svg.outline).toBe(272);
  expect(svg.bar).toBeCloseTo(.01, 8);
  expect(svg.threshold).toBe(.02);
  await test.info().attach('minimum-width-coordinate-steps', { body: JSON.stringify(svg), contentType: 'application/json' });
});

test('the real worker refuses a positive bar that the indicator would round to zero', async ({ page }) => {
  const { result, graph, geometry } = await draw(page, .000001, 0, 100);
  if (result.ok && result.gauge) {
    const svg = await geometry();
    await test.info().attach('rounded-positive-bar', { body: JSON.stringify(svg), contentType: 'application/json' });
  }
  expect(result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry/i) });
  await expect(graph).toHaveCount(0);
});

test('the real worker refuses a distinct target that the indicator would draw at the bar endpoint', async ({ page }) => {
  const { result, graph, geometry } = await draw(page, 25, -25, 75, 25.000001);
  if (result.ok && result.gauge) {
    const svg = await geometry();
    await test.info().attach('coincident-bar-and-target', { body: JSON.stringify(svg), contentType: 'application/json' });
  }
  expect(result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry/i) });
  await expect(graph).toHaveCount(0);
});
