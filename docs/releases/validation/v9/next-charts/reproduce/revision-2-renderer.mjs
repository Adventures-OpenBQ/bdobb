// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const captureDir = process.env.CAPTURE_DIR ?? tmpdir();
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const file = JSON.parse(await readFile(new URL('../../../../../../src/test/fixtures/estimateVintageSnapshot.json', import.meta.url)));
const receipt = file.chart_sources.receipts[0];
const alpha = receipt.issuers[0], beta = receipt.issuers[1];
const gamma = { ...alpha, issuer: 'GAMMA.US', entity_ref: 'example/entity/GAMMA.US', currency: 'EUR',
  basis_ref: 'example/current-shares/GAMMA.US' };
const app = process.env.PROBE_URL ?? 'http://127.0.0.1:4718';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

function snapshot(issuers, values, patch = {}) {
  const members = issuers.map(issuer => issuer.issuer);
  const { vintages = receipt.vintages, universe = { ...receipt.universe, members } } = patch;
  const rows = vintages.flatMap((vintage, i) => issuers.map((issuer, j) => ({
    ...issuer, batch: vintage.batch, vintage: vintage.id, observed_at: vintage.observed_at,
    input_ref: receipt.inputs.find(input => input.batch === vintage.batch).reference,
    source_contract: 'independently-recorded-consensus-mean', metric: 'eps',
    target_start: receipt.target.start, target_end: receipt.target.end, target_kind: receipt.target.kind,
    value: values[j][i],
  })));
  const counts = { raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length };
  const coordinates = rows.map(({ issuer, vintage }) => ({ issuer, vintage }));
  return { ...file, rows, chart_sources: { version: 1, receipts: [{
    ...receipt, ...counts, issuers, vintages, universe, coordinates, inputs: receipt.inputs.map(input => ({ ...input, members })),
  }] } };
}

const scope = defaultVintages => [...defaultVintages].reverse();
async function draw(input, { view, width = 640, height = 420, theme = 'light', reuse = false }) {
  const vintages = scope(view === 'slope' ? ['snap-a', 'snap-c'] : ['snap-a', 'snap-b', 'snap-c']);
  const options = { version: 1, kind: 'estimate-revisions', metric: 'eps', view, vintages, target: receipt.target,
    fields: { issuer: 'issuer', vintage: 'vintage', targetStart: 'target_start', targetEnd: 'target_end', targetKind: 'target_kind', value: 'value' } };
  return page.evaluate(async ({ input, options, width, height, theme, reuse }) => {
    const { datasetFromBytes } = await import('/src/lib/localTableData.ts');
    const { createRecipeWorker } = await import('/src/lib/widgetData/chartRecipes/workerClient.ts');
    const { renderPlot, purgePlot, resizePlot } = await import('/src/lib/plotly.ts');
    const previous = document.querySelector('#revision-report-plot');
    if (previous && !reuse) { purgePlot(previous); previous.remove(); }
    const dataset = await datasetFromBytes('recorded.json', new TextEncoder().encode(JSON.stringify(input)), 'revision-probe', 1);
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(dataset, options, {
        theme, maxDecimals: 2, today: '2026-11-20', viewportWidth: width, viewportHeight: height,
      }, new AbortController().signal);
      if (!result.ok) return result;
      const node = reuse ? previous : document.createElement('div');
      node.id = 'revision-report-plot';
      node.style.cssText = `position:fixed; left:20px; top:20px; width:${width}px; height:${height}px; z-index:10000; background:${theme === 'dark' ? '#20242d' : 'white'}`;
      if (!reuse) document.body.append(node);
      await renderPlot(node, result.figure, result.revision);
      if (reuse) resizePlot(node);
      return result;
    } finally {
      worker.dispose();
    }
  }, { input, options, width, height, theme, reuse });
}

async function inspect() {
  return page.locator('#revision-report-plot').evaluate(node => {
    const box = node.getBoundingClientRect();
    function descriptor(element) {
      const b = element.getBoundingClientRect();
      return { text: element.textContent, x: b.left - box.left, y: b.top - box.top, width: b.width, height: b.height };
    }
    const full = node._fullLayout;
    const axes = {};
    for (const id of ['x', 'y']) {
      const ax = full[id + 'axis'];
      axes[id] = { type: ax.type, range: ax.range, title: descriptor(node.querySelector('.' + id + 'title')),
        ticks: [...node.querySelectorAll('.' + id + 'tick text')].map(descriptor) };
    }
    const traces = [...node.querySelectorAll('.scatterlayer .trace')].map(trace => ({
      points: [...trace.querySelectorAll('.point')].map(point => {
        const b = point.getBoundingClientRect();
        return { x: point.__data__.x, y: point.__data__.y, transform: point.getAttribute('transform'),
          screenX: (b.left + b.right) / 2, screenY: (b.top + b.bottom) / 2 };
      }),
      paths: [...trace.querySelectorAll('.js-line')].map(path => path.getAttribute('d')),
    }));
    return { axes, traces, title: descriptor(node.querySelector('.gtitle')),
      legend: [...node.querySelectorAll('.legendtext')].map(descriptor),
      legendScrollbarHeight: Number(node.querySelector('.infolayer .legend .scrollbar')?.getAttribute('height')),
      box: { width: box.width, height: box.height } };
  });
}

function inspectGeometry(info, dates) {
  const axisElements = [info.title, info.axes.x.title, info.axes.y.title, ...info.axes.x.ticks, ...info.axes.y.ticks, ...info.legend];
  for (const element of axisElements)
    assert(element.x >= 0 && element.y >= 0 && element.x + element.width <= info.box.width && element.y + element.height <= info.box.height,
      JSON.stringify({ element, box: info.box }));
  assert.match(info.title.text, /FQ 2027-01-01 to 2027-03-31/);
  assert.match(info.axes.x.title.text, /equally spaced/);
  assert(info.axes.y.ticks.length >= 2, JSON.stringify(info.axes.y));
  assert.deepEqual(info.axes.x.ticks.map(tick => tick.text.replace(/\s/g, '')), dates);
  for (let i = 1; i < info.axes.x.ticks.length; i++)
    assert(info.axes.x.ticks[i - 1].x + info.axes.x.ticks[i - 1].width < info.axes.x.ticks[i].x);
  for (const trace of info.traces) {
    assert(trace.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && !/NaN|Infinity/.test(point.transform)));
    assert(trace.paths.every(path => !/NaN|Infinity/.test(path)));
  }
}

async function hoverAt(point) {
  await page.mouse.move(point.screenX, point.screenY);
  const layer = page.locator('#revision-report-plot .hoverlayer');
  const tooltip = layer.locator('.hovertext, .legend').first();
  await tooltip.waitFor();
  const hoverBox = await tooltip.boundingBox(), plotBox = await page.locator('#revision-report-plot').boundingBox();
  assert(hoverBox && plotBox && hoverBox.x >= plotBox.x - 1 && hoverBox.y >= plotBox.y - 1
    && hoverBox.x + hoverBox.width <= plotBox.x + plotBox.width + 1 && hoverBox.y + hoverBox.height <= plotBox.y + plotBox.height + 1,
  JSON.stringify({ hoverBox, plotBox }));
  return layer.textContent();
}

async function capture(name) {
  await page.mouse.move(850, 600);
  await page.locator('#revision-report-plot .hoverlayer').locator('.hovertext, .legend').first().waitFor({ state: 'hidden' });
  await page.locator('#revision-report-plot').screenshot({ path: join(captureDir, 'bdobb-revisions-t2-' + name + '.png') });
}
async function hoverBounds() {
  const node = page.locator('#revision-report-plot');
  const tooltip = node.locator('.hoverlayer .legend');
  await tooltip.waitFor();
  return { box: await tooltip.boundingBox(), plot: await node.boundingBox(), text: await tooltip.textContent() };
}

async function verifyDenseTicks() {
  const denseInput = snapshot([alpha], [[1e200, 1.0000000002e200, 1.0000000005e200]]);
  const small = await draw(denseInput, { view: 'path', width: 320, height: 230 });
  if (small.ok) {
    const drawn = await inspect();
    const lastTick = Math.max(...drawn.axes.x.ticks.map(tick => tick.y + tick.height));
    console.error(JSON.stringify({ denseAt320: { lastTick, captionStart: drawn.axes.x.title.y } }));
  }
  assert(!small.ok && small.estimateRevisionsSurface, JSON.stringify(small));
  const size = small.estimateRevisionsSurface;
  assert(size.width > 320 && size.height === 230);
  const full = await draw(denseInput, { view: 'path', ...size });
  assert(full.ok, JSON.stringify(full));
  assert.deepEqual(full.estimateRevisionsSurface, size);
  const rendered = await inspect();
  inspectGeometry(rendered, stamps);
  const bottom = Math.max(...rendered.axes.x.ticks.map(tick => tick.y + tick.height));
  assert(bottom + 3 < rendered.axes.x.title.y, JSON.stringify({ bottom, title: rendered.axes.x.title }));
  assert.deepEqual(rendered.traces[0].points.map(p => p.y), [1e200, 1.0000000002e200, 1.0000000005e200]);
  await capture('dense-ticks-fit');
  return { size, rendered, bottom };
}

async function verifySixMemberHover() {
  const cohort = Array.from({ length: 6 }, (_, i) => {
    const issuer = `RANK00${i}.US`;
    return { ...alpha, issuer, entity_ref: 'recorded/entity/' + issuer, basis_ref: 'recorded/shares/' + issuer };
  });
  const input = snapshot(cohort, cohort.map((_, i) => [10 + i, 3 * (10 + i), 2 * (10 + i)]));
  const small = await draw(input, { view: 'bump', width: 320, height: 230 });
  if (small.ok) {
    const point = (await inspect()).traces[0].points[2];
    await page.mouse.move(point.screenX, point.screenY);
    const clipped = await hoverBounds();
    console.error(JSON.stringify({ sixAt320: { tooltip: clipped.box, plot: clipped.plot } }));
  }
  assert(!small.ok && small.estimateRevisionsSurface, JSON.stringify(small));
  const size = small.estimateRevisionsSurface;
  assert(size.width === 320 && size.height > 302, JSON.stringify(size));
  const full = await draw(input, { view: 'bump', ...size });
  assert(full.ok, JSON.stringify(full));
  assert.deepEqual(full.estimateRevisionsSurface, size);
  const rendered = await inspect();
  inspectGeometry(rendered, stamps);
  const endpoints = rendered.traces.map(trace => trace.points[2]);
  assert.deepEqual(endpoints.map(point => point.y), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(endpoints.map(point => point.transform)).size, 1);
  const text = await hoverAt(endpoints[0]);
  for (const [i, issuer] of cohort.entries()) {
    assert(text.includes(issuer.issuer + ' · rank 1 of 6'));
    assert(text.includes('Consensus ' + (20 + 2 * i) + ' USD/share'));
  }
  assert.match(text, /2026-11-13T16:00:00\.123456Z/);
  const hover = await hoverBounds();
  await page.locator('#revision-report-plot').screenshot({ path: join(captureDir, 'bdobb-revisions-t2-six-member-hover-fit.png') });
  return { size, rendered, hover };
}

const stamps = receipt.vintages.map(v => v.observed_at.replace('T', ''));
const report = {};
try {
  await page.goto(app);
  const ordinary = snapshot([alpha], [[10, 11, 12]]);
  const slope = await draw(ordinary, { view: 'slope' });
  assert(slope.ok, JSON.stringify(slope));
  const slopeInfo = await inspect();
  inspectGeometry(slopeInfo, [stamps[0], stamps[2]]);
  assert.match(slopeInfo.axes.y.title.text, /Consensus EPS \(USD\/share\)/);
  assert.deepEqual(slopeInfo.traces[0].points.map(p => p.y), [10, 12]);
  assert(slopeInfo.traces[0].points[0].screenY > slopeInfo.traces[0].points[1].screenY);
  assert(slopeInfo.traces[0].paths[0].includes('L'));
  const slopeHover = await hoverAt(slopeInfo.traces[0].points[1]);
  assert.match(slopeHover, /2026-11-13T16:00:00\.123456Z/);
  assert.match(slopeHover, /snap-c.*batch-c.*Consensus 12 USD\/share.*\+2 USD\/share.*\+20% \(fraction 0\.2\)/);
  report.slope = { ...slopeInfo, hover: slopeHover };
  await capture('slope');

  const microVintages = receipt.vintages.map((v, i) => ({ ...v, observed_at: [
    '2026-11-11T16:00:00.123455Z', '2026-11-11T16:00:00.123456Z', '2026-11-13T18:41:03.100002Z',
  ][i] }));
  const path = await draw(snapshot([alpha], [[1, null, 2]], { vintages: microVintages }),
    { view: 'path', width: 320, height: 230, theme: 'dark' });
  assert(path.ok, JSON.stringify(path));
  const pathInfo = await inspect();
  inspectGeometry(pathInfo, microVintages.map(v => v.observed_at.replace('T', '')));
  assert.deepEqual(pathInfo.traces[0].points.map(p => p.x), [0, 2]);
  assert(pathInfo.traces[0].paths.every(p => !p.includes('L')), JSON.stringify(pathInfo));
  const pathWithAll = await draw(snapshot([alpha], [[1, 1.45, 2]], { vintages: microVintages }),
    { view: 'path', width: 320, height: 230, theme: 'dark', reuse: true });
  assert(pathWithAll.ok, JSON.stringify(pathWithAll));
  assert.equal(pathWithAll.revision, path.revision);
  const allPathInfo = await inspect();
  inspectGeometry(allPathInfo, microVintages.map(v => v.observed_at.replace('T', '')));
  assert.deepEqual(allPathInfo.traces[0].points.map(p => p.x), [0, 1, 2]);
  const x = allPathInfo.traces[0].points.map(p => p.screenX);
  assert(Math.abs((x[1] - x[0]) - (x[2] - x[1])) < .02);
  assert.match(await hoverAt(allPathInfo.traces[0].points[1]), /2026-11-11T16:00:00\.123456Z/);
  report.path = { missing: pathInfo, complete: allPathInfo };
  await capture('microsecond-path-narrow');

  const bumpInput = snapshot([alpha, beta, gamma], [[10, 8, 12], [20, 22, 24], [30, 60, 33]]);
  const bump = await draw(bumpInput, { view: 'bump', width: 320, height: 230 });
  assert(bump.ok, JSON.stringify(bump));
  const bumpInfo = await inspect();
  inspectGeometry(bumpInfo, stamps);
  assert.match(bumpInfo.axes.y.title.text, /Percentage revision rank/);
  assert.deepEqual(bumpInfo.legend.map(entry => entry.text), ['ALFA.US', 'BETA.CA', 'GAMMA.US']);
  assert.equal(bumpInfo.legendScrollbarHeight, 0, 'The full three-issuer legend should be readable at the minimum surface');
  assert.deepEqual(bumpInfo.traces.map(t => t.points.map(p => p.y)), [[1, 3, 1], [1, 2, 1], [1, 1, 3]]);
  assert(bumpInfo.traces[0].points[1].screenY > bumpInfo.traces[2].points[1].screenY);
  assert(bumpInfo.traces[0].points[2].screenY < bumpInfo.traces[2].points[2].screenY);
  assert.equal(bumpInfo.traces[0].points[2].transform, bumpInfo.traces[1].points[2].transform);
  assert(bumpInfo.traces.every(t => (t.paths[0].match(/L/g) ?? []).length === 2));
  const bumpHover = await hoverAt(bumpInfo.traces[0].points[2]);
  assert.match(bumpHover, /ALFA\.US.*12 USD\/share/);
  assert.match(bumpHover, /BETA\.CA.*24 CAD\/share/);
  assert.match(bumpHover, /GAMMA\.US.*33 EUR\/share/);
  report.bump = { ...bumpInfo, hover: bumpHover };
  await capture('bump-narrow');

  const gap = await draw(snapshot([alpha, beta, gamma], [[10, 8, 12], [20, 22, 24], [30, null, 33]]), { view: 'bump' });
  assert(gap.ok, JSON.stringify(gap));
  const gapInfo = await inspect();
  inspectGeometry(gapInfo, stamps);
  assert(gapInfo.traces.every(t => t.points.map(p => p.x).join() === '0,2' && t.paths.every(p => !p.includes('L'))));
  assert.match(gap.notes.join(' '), /Whole rank columns unavailable at snap-b/);
  report.bumpGap = gapInfo;

  const extreme = await draw(snapshot([alpha], [[1e200, 1.5e200, 2e200]]),
    { view: 'path', width: 320, height: 230 });
  assert(extreme.ok, JSON.stringify(extreme));
  const extremeInfo = await inspect();
  inspectGeometry(extremeInfo, stamps);
  assert.deepEqual(extremeInfo.traces[0].points.map(p => p.y), [1e200, 1.5e200, 2e200]);
  assert(extremeInfo.axes.y.range[0] < 1e200 && extremeInfo.axes.y.range[1] > 2e200);
  assert(extremeInfo.axes.y.ticks.every(t => /E200/i.test(t.text)));
  assert.match(await hoverAt(extremeInfo.traces[0].points[1]), /1\.5e\+200 USD\/share/);
  report.extreme = extremeInfo;
  await capture('extreme-path-narrow');

  const full = await draw(snapshot([alpha], [[Number.MAX_VALUE, 0, -Number.MAX_VALUE]]), { view: 'path' });
  assert(!full.ok && /linear scale.*faithfully/.test(full.message), JSON.stringify(full));
  const tooSmall = await draw(ordinary, { view: 'path', width: 319, height: 230 });
  assert(!tooSmall.ok && /320 × 230/.test(tooSmall.message), JSON.stringify(tooSmall));
  const failures = [];
  for (const [name, verify] of Object.entries({ denseTicks: verifyDenseTicks, sixMemberHover: verifySixMemberHover })) {
    try { report[name] = await verify(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Revision drawing-space regressions');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...report, full, tooSmall }, null, 2));
} catch (error) {
  console.log(JSON.stringify(report, null, 2));
  console.error(JSON.stringify(await inspect().catch(() => null)));
  throw error;
} finally {
  await browser.close();
}
