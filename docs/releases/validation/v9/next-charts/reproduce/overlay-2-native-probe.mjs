// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const captureDir = process.env.CAPTURE_DIR ?? tmpdir();
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const snapshots = JSON.parse(await readFile(new URL('../../../../../../src/test/fixtures/overlaySnapshots.json', import.meta.url)));
const app = process.env.PROBE_URL ?? 'http://127.0.0.1:4718';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1040, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

function pair(file, rows) {
  const receipt = file.chart_sources.receipts[0];
  const counts = { raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length };
  const coordinates = Object.fromEntries(Object.entries(receipt.series).map(([side, series]) => [side,
    rows.filter(row => row.series === series.id).map(row => series.coordinate === 'availability-date' ? row.available_at : row.date),
  ]));
  return { ...file, rows, chart_sources: { version: 1, receipts: [{ ...receipt, ...counts, coordinates }] } };
}

async function draw(file, width, height, theme) {
  const recipe = file.chart_sources.receipts[0].recipe;
  return page.evaluate(async ({ file, recipe, width, height, theme }) => {
    const { datasetFromBytes } = await import('/src/lib/localTableData.ts');
    const { createRecipeWorker } = await import('/src/lib/widgetData/chartRecipes/workerClient.ts');
    const { renderPlot, purgePlot } = await import('/src/lib/plotly.ts');
    const previous = document.querySelector('#report-plot');
    if (previous) { purgePlot(previous); previous.remove(); }
    const input = await datasetFromBytes('prepared.json', new TextEncoder().encode(JSON.stringify(file)), 'overlay-check', 1);
    const options = {
      version: 1, kind: 'dual-axis-overlay', recipe,
      fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at',
        ...(recipe === 'price-eps' ? { targetStart: 'target_start', targetEnd: 'target_end' } : {}) },
    };
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(input, options, {
        theme, maxDecimals: 2, today: '2026-11-19', viewportWidth: width, viewportHeight: height,
      }, new AbortController().signal);
      if (!result.ok) return result;
      const node = document.createElement('div');
      node.id = 'report-plot';
      node.style.cssText = `position:fixed; left:14px; top:14px; width:${width}px; height:${height}px; z-index:10000; background:${theme === 'dark' ? '#20242d' : 'white'}`;
      document.body.append(node);
      const stops = Array.from({ length: 15 }, (_, decimals) => ({
        dtickrange: [decimals === 14 ? null : 10 ** (-2 - decimals), decimals === 0 ? null : 10 ** (-1 - decimals)],
        value: '.' + decimals + '%',
      }));
      const defaults = { ...result.figure.layout };
      for (const axis of ['yaxis', 'yaxis2']) {
        defaults[axis] = { ...defaults[axis], tickmode: 'auto', nticks: 5, exponentformat: 'e', showexponent: 'all',
          ...(axis === 'yaxis2' && recipe === 'cpi-ten-year' ? { tickformatstops: stops } : {}) };
        delete defaults[axis].tickvals;
        delete defaults[axis].ticktext;
      }
      await renderPlot(node, { ...result.figure, layout: defaults }, result.revision);
      return result;
    } finally {
      worker.dispose();
    }
  }, { file, recipe, width, height, theme });
}

async function inspect() {
  return page.locator('#report-plot').evaluate(node => {
    const box = node.getBoundingClientRect();
    const full = node._fullLayout;
    const axes = {};
    for (const id of ['x', 'y', 'y2']) {
      const ax = full[{ x: 'xaxis', y: 'yaxis', y2: 'yaxis2' }[id]];
      const title = node.querySelector('.' + id + 'title');
      const titleBox = title.getBoundingClientRect();
      const ticks = [...node.querySelectorAll('.' + id + 'tick text')].map(tick => tick.textContent);
      axes[id] = { range: ax.range, type: ax.type, length: ax._length, ticks,
        title: title.textContent, titleBox: { x: titleBox.left - box.left, y: titleBox.top - box.top, width: titleBox.width, height: titleBox.height } };
    }
    const traces = [...node.querySelectorAll('.scatterlayer .trace')].map(trace => ({
      points: [...trace.querySelectorAll('.point')].map(point => {
        const box = point.getBoundingClientRect();
        const datum = point.__data__;
        return { x: datum.x, y: datum.y, transform: point.getAttribute('transform'), screenX: (box.left + box.right) / 2, screenY: (box.top + box.bottom) / 2 };
      }),
      paths: [...trace.querySelectorAll('.js-line')].map(path => path.getAttribute('d')),
    }));
    return { axes, traces, box: { width: box.width, height: box.height } };
  });
}

function realChart(info) {
  assert.equal(info.axes.x.type, 'date');
  assert.equal(info.axes.y.type, 'linear');
  assert.equal(info.axes.y2.type, 'linear');
  for (const axis of Object.values(info.axes)) {
    const b = axis.titleBox;
    assert(b.x >= 0 && b.y >= 0 && b.x + b.width <= info.box.width && b.y + b.height <= info.box.height, JSON.stringify({ axis, box: info.box }));
    assert(axis.ticks.length >= (axis.type === 'date' ? 1 : 2), JSON.stringify(axis));
    if (axis.type === 'linear') assert.equal(new Set(axis.ticks).size, axis.ticks.length);
  }
  for (const trace of info.traces) {
    assert(trace.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && !/NaN|Infinity/.test(point.transform)));
    assert.equal(new Set(trace.points.map(point => point.transform)).size, trace.points.length);
    assert(trace.paths.every(path => !/NaN|Infinity/.test(path)));
  }
}

async function tooltip(point) {
  await page.mouse.move(point.screenX, point.screenY);
  const hover = page.locator('#report-plot .hoverlayer');
  await hover.locator('.hovertext').waitFor();
  return hover.textContent();
}

try {
  await page.goto(app);
  const evidence = {};
  const macro = snapshots['cpi-ten-year'];
  const equity = snapshots['price-eps'];
  const ordinary = await draw(macro, 600, 460, 'light');
  assert(ordinary.ok, JSON.stringify(ordinary));
  const macroInfo = await inspect();
  realChart(macroInfo);
  assert.equal(macroInfo.axes.y.title, 'US CPI-U (1982–84 = 100)');
  assert.equal(macroInfo.axes.y2.title, '10-year yield (%)');
  assert.deepEqual(macroInfo.traces[0].points.map(p => p.y), [336.298, 337.476]);
  assert.deepEqual(macroInfo.traces[1].points.map(p => p.y), [.0512, .0507]);
  assert(macroInfo.traces[1].paths.every(path => !path.includes('L')), JSON.stringify(macroInfo.traces[1].paths));
  const macroHover = await tooltip(macroInfo.traces[1].points[0]);
  assert.match(macroHover, /5\.12%.*original fraction 0\.0512/);
  evidence.ordinaryMacro = { ...macroInfo, hover: macroHover };

  const narrow = await draw(macro, 320, 260, 'dark');
  assert(narrow.ok, JSON.stringify(narrow));
  assert.equal(narrow.revision, ordinary.revision);
  const narrowInfo = await inspect();
  realChart(narrowInfo);
  assert.equal(narrowInfo.axes.y.title, macroInfo.axes.y.title);
  assert.equal(narrowInfo.axes.y2.title, macroInfo.axes.y2.title);
  evidence.narrowMacro = narrowInfo;
  await page.locator('#report-plot').screenshot({ path: join(captureDir, 'bdobb-overlay-t2-native-macro-narrow-dark.png') });

  const earnings = await draw(equity, 320, 260, 'light');
  assert(earnings.ok, JSON.stringify(earnings));
  const earningsInfo = await inspect();
  realChart(earningsInfo);
  assert.equal(earningsInfo.axes.y.title, 'Adjusted close (USD/share)');
  assert.equal(earningsInfo.axes.y2.title, 'Diluted FQ EPS (USD/share)');
  assert.deepEqual(earningsInfo.traces[1].paths, []);
  assert(earningsInfo.traces[1].points[0].x > earningsInfo.traces[0].points[0].x);
  const epsHover = await tooltip(earningsInfo.traces[1].points[0]);
  assert.match(epsHover, /1\.98765 USD\/share/);
  assert.match(epsHover, /2026-11-02T21:02:01\.123456Z/);
  assert.match(epsHover, /2026-07-01 to 2026-09-30/);
  assert.match(epsHover, /Currently restated; not historical as-known/);
  evidence.narrowEquity = { ...earningsInfo, hover: epsHover };
  await page.locator('#report-plot').screenshot({ path: join(captureDir, 'bdobb-overlay-t2-native-equity-narrow-light.png') });

  const extremeRows = macro.rows.map((row, i) => i < 2 ? { ...row, value: 1e200 * (i + 1), source_value: 1e200 * (i + 1) } : row);
  const extreme = await draw({ ...macro, rows: extremeRows }, 320, 260, 'light');
  assert(extreme.ok, JSON.stringify(extreme));
  const extremeInfo = await inspect();
  realChart(extremeInfo);
  assert.deepEqual(extremeInfo.traces[0].points.map(p => p.y), [1e200, 2e200]);
  assert(Math.min(...extremeInfo.axes.y.range) < 1e200);
  assert(Math.max(...extremeInfo.axes.y.range) > 2e200);
  assert(extremeInfo.axes.y2.range.every(value => value < 0.1));
  assert.match(await tooltip(extremeInfo.traces[0].points[0]), /1e\+200/);
  evidence.extremeMacro = extremeInfo;
  await page.locator('#report-plot').screenshot({ path: join(captureDir, 'bdobb-overlay-t2-native-extreme-narrow.png') });

  const clippedRows = extremeRows.map((row, i) => i === 1 ? { ...row, value: Number.MAX_VALUE, source_value: Number.MAX_VALUE } : row);
  const clipped = await draw({ ...macro, rows: clippedRows }, 320, 260, 'light');
  assert(!clipped.ok && /linear scale.*faithfully/.test(clipped.message), JSON.stringify(clipped));

  const eps = equity.rows[1];
  const microseconds = await draw(pair(equity, [equity.rows[0], eps, { ...eps, date: '2026-06-30', target_end: '2026-06-30',
    target_start: '2026-04-01', available_at: '2026-11-02T21:02:01.123457Z', value: 2.25, source_value: 2.25 }]), 600, 460, 'light');
  assert(!microseconds.ok && /distinct.*availability coordinates/i.test(microseconds.message), JSON.stringify(microseconds));

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...evidence, clipped, microseconds }, null, 2));
} finally {
  await browser.close();
}
