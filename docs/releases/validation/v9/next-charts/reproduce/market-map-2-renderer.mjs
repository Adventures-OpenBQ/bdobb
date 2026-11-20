// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const app = process.env.PROBE_URL ?? 'http://127.0.0.1:4718';
const directory = new URL('../../../../../../src/test/fixtures/', import.meta.url);
const cap = JSON.parse(await readFile(new URL('marketMapCap.json', directory)));
const index = JSON.parse(await readFile(new URL('marketMapIndex.json', directory)));
const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks'] });
const page = await browser.newPage({ viewport: { width: 850, height: 700 } });
page.setDefaultTimeout(6000);
const errors = [];
const diagnostics = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', item => {
  if (item.type() === 'warning' || item.type() === 'error') diagnostics.push(item.text());
});
page.on('requestfailed', request => diagnostics.push(request.url() + ' ' + request.failure()?.errorText));
await page.route('**/__market-map-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="UTF-8"><title>Market map probe</title>' }));
await page.goto(app + '/__market-map-probe');

function snapshot(observations) {
  return { ...cap, rows: observations.map(([sector, area, change], i) => ({ ...cap.rows[i], sector, area, change })) };
}

async function draw(file, { width = 320, height = 260, theme = 'light' } = {}) {
  return page.evaluate(async ({ file, width, height, theme }) => {
    const { datasetFromBytes } = await import('/src/lib/localTableData.ts');
    const { createRecipeWorker } = await import('/src/lib/widgetData/chartRecipes/workerClient.ts');
    const { renderPlot, purgePlot } = await import('/src/lib/plotly.ts');
    const previous = document.querySelector('#market-plot');
    if (previous) { purgePlot(previous); previous.remove(); }
    const dataset = await datasetFromBytes('market.json', new TextEncoder().encode(JSON.stringify(file)), 'market-source', 1);
    const { mode, universe } = file.chart_sources.receipts[0];
    const options = { kind: 'market-map', version: 1, mode, universe, session: 'latest',
      fields: { listing: 'listing', sector: 'sector', area: 'area', change: 'change', session: 'session' } };
    const context = { theme, maxDecimals: 2, today: '2026-11-20', viewportWidth: width, viewportHeight: height };
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(dataset, options, context, new AbortController().signal);
      if (!result.ok) return result;
      const node = document.createElement('div');
      node.id = 'market-plot';
      node.style.cssText = `position:fixed; left:20px; top:20px; width:${width}px; height:${height}px; background:${theme === 'dark' ? '#20242d' : '#fff'}`;
      document.body.append(node);
      await renderPlot(node, result.figure, result.revision);
      window.probePlot = node;
      return result;
    } finally {
      worker.dispose();
    }
  }, { file, width, height, theme });
}

async function inspect() {
  return page.locator('#market-plot').evaluate(node => {
    const frame = node.getBoundingClientRect();
    const measure = element => {
      const box = element.getBoundingClientRect();
      return { text: element.textContent, x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height };
    };
    const slices = [...node.querySelectorAll('.treemaplayer g.slice')].map(slice => {
      const path = slice.querySelector('path.surface'), datum = slice.__data__.data.data;
      const box = path.getBBox();
      return { id: datum.id, value: datum.v, fill: getComputedStyle(path).fill, path: path.getAttribute('d'),
        box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    });
    return {
      width: frame.width, height: frame.height, slices, title: measure(node.querySelector('.gtitle')),
      ticks: [...node.querySelectorAll('.colorbar .cbaxis text')].map(measure),
      legend: [...node.querySelectorAll('.annotation-text')].map(measure),
      pathbar: [...node.querySelectorAll('.treemaplayer .pathbar')].map(measure),
      fullSize: node._fullLayout._size, level: node._fullData[0].level,
    };
  });
}
const inside = (box, frame) => box.x >= -.2 && box.y >= -.2
  && box.x + box.width <= frame.width + .2 && box.y + box.height <= frame.height + .2;
const find = (result, id) => result.slices.find(slice => slice.id === id);
const close = (a, b, tolerance = 1e-4) => Math.abs(a / b - 1) <= tolerance;
function verify(info) {
  for (const box of [info.title, ...info.ticks, ...info.legend, ...info.pathbar])
    assert(inside(box, info), JSON.stringify({ box, info }));
  for (let i = 1; i < info.ticks.length; i++)
    assert(info.ticks[i - 1].x + info.ticks[i - 1].width < info.ticks[i].x, JSON.stringify(info.ticks));
  for (const slice of info.slices) assert(slice.box.width > 0 && slice.box.height > 0
    && inside(slice.box, info) && !/NaN|Infinity/.test(slice.path), JSON.stringify(slice));
}
async function hoverAt(x, y) {
  await page.mouse.move(20 + x, 20 + y);
  const loc = page.locator('#market-plot .hoverlayer .hovertext');
  await loc.waitFor({ state: 'visible' });
  return loc.evaluate(element => {
    const frame = document.querySelector('#market-plot').getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { text: element.textContent, x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height };
  });
}

try {
  const ordinary = await draw(snapshot([['Technology', 100, 0], [null, 200, null]]));
  assert(ordinary.ok, JSON.stringify(ordinary));
  const normal = await inspect();
  assert.equal(normal.slices.length, 5);
  const [alfa, beta] = ordinary.marketMap.listings;
  const [tech] = ordinary.marketMap.sectors;
  const zero = find(normal, alfa.id), missing = find(normal, beta.id), structure = find(normal, tech.id);
  assert.equal(zero.fill, 'rgb(240, 230, 217)');
  assert.equal(missing.fill, 'rgb(138, 164, 187)');
  assert.equal(structure.fill, 'rgb(216, 208, 228)');
  assert.deepEqual(normal.ticks.map(tick => tick.text.replace('−', '-')), ['-1%', '0%', '1%']);
  assert(close(zero.box.width * zero.box.height * 2, missing.box.width * missing.box.height));
  verify(normal);
  const zeroHover = await hoverAt(zero.box.x + zero.box.width / 2, zero.box.y + 10);
  assert.match(zeroHover.text, /100 USD.*0%.*Completed session 2026-11-13.*Capitalization retrieved/);
  assert(inside(zeroHover, normal), JSON.stringify(zeroHover));
  const missingHover = await hoverAt(missing.box.x + missing.box.width / 2, missing.box.y + 10);
  assert.match(missingHover.text, /200 USD.*Return unavailable/);
  assert(inside(missingHover, normal), JSON.stringify(missingHover));
  console.log('320 × 260 ordinary, mixed fill, color ticks, leaf areas and hover', JSON.stringify(normal));

  await page.mouse.click(20 + structure.box.x + structure.box.width / 2, 20 + structure.box.y + 7);
  await page.waitForFunction(id => window.probePlot._fullData[0].level === id && !window.probePlot._transitioning, tech.id);
  const drill = await inspect();
  assert.equal(drill.slices.length, 2);
  assert.notEqual(find(drill, alfa.id).box.width, zero.box.width);
  verify(drill);
  const breadcrumb = drill.pathbar[0];
  assert(breadcrumb && breadcrumb.width > 0 && breadcrumb.height > 0, JSON.stringify(drill));
  await page.mouse.click(20 + breadcrumb.x + breadcrumb.width / 2, 20 + breadcrumb.y + breadcrumb.height / 2);
  await page.waitForFunction(id => window.probePlot._fullData[0].level === id && !window.probePlot._transitioning, ordinary.marketMap.root.id);
  assert.equal((await inspect()).slices.length, 5);
  console.log('Real sector drill and native breadcrumb restored root', JSON.stringify(drill));

  const three = { ...cap, rows: [{ ...cap.rows[0], area: 100 }, { ...cap.rows[0], listing: 'DELTA.US', area: 200 },
    { ...cap.rows[1], area: 300 }], chart_sources: { version: 1, receipts: [{ ...cap.chart_sources.receipts[0],
      raw_count: 3, normalized_count: 3, delivered_count: 3, listing_keys: ['ALFA.US', 'DELTA.US', 'BETA.US'] }] } };
  const nested = await draw(three);
  assert(nested.ok);
  assert.deepEqual(nested.marketMap.sectors.map(sector => sector.value), [300, 300]);
  const nestedInfo = await inspect();
  verify(nestedInfo);
  const nestedAreas = Object.fromEntries(nested.marketMap.listings.map(listing => {
    const box = find(nestedInfo, listing.id).box;
    return [listing.listing, box.width * box.height];
  }));
  assert(close(nestedAreas['ALFA.US'] * 2, nestedAreas['DELTA.US']));
  assert(close(nestedAreas['ALFA.US'] + nestedAreas['DELTA.US'], nestedAreas['BETA.US']));
  console.log('Nested listing rectangles conserve areas across two equally weighted sectors', JSON.stringify(nestedAreas));

  const tinyInput = snapshot([['Technology', .0001, .0000001], [null, 1000, -.1]]);
  const tiny = await draw(tinyInput, { theme: 'dark' });
  assert(tiny.ok, JSON.stringify(tiny));
  const tinyInfo = await inspect();
  verify(tinyInfo);
  assert.equal(tiny.marketMap.listings[0].value, .0001);
  assert.equal(tiny.marketMap.listings[0].change, .0000001);
  assert(find(tinyInfo, alfa.id).box.width < .001);
  assert.equal(find(tinyInfo, beta.id).fill, 'rgb(165, 35, 67)');
  console.log('320 × 260 dark tiny finite tile', JSON.stringify(find(tinyInfo, alfa.id)));

  const extremes = await draw(snapshot([['Technology', 1e308, Number.MAX_VALUE], [null, 4e307, -.02]]));
  assert(extremes.ok, JSON.stringify(extremes));
  const extremeInfo = await inspect();
  verify(extremeInfo);
  assert.equal(extremes.marketMap.root.value, 1.4e308);
  assert.equal(find(extremeInfo, alfa.id).fill, 'rgb(0, 118, 95)');
  const extremeHover = await hoverAt(50, 130);
  assert.match(extremeHover.text, /1e\+308 USD.*E310%/);
  assert(inside(extremeHover, extremeInfo), JSON.stringify(extremeHover));
  console.log('320 × 260 extreme finite raw caps and return', JSON.stringify({ info: extremeInfo, hover: extremeHover }));

  const allMissing = await draw(snapshot([['Technology', 55, null], [null, 60, null]]));
  assert(allMissing.ok);
  const noColor = await inspect();
  verify(noColor);
  assert.equal(noColor.ticks.length, 0);
  assert.equal(find(noColor, alfa.id).fill, missing.fill);
  console.log('All missing, no numeric legend', JSON.stringify(noColor.legend));

  const named = await draw(index);
  assert(named.ok);
  const namedInfo = await inspect();
  verify(namedInfo);
  const weight = find(namedInfo, alfa.id);
  const indexHover = await hoverAt(weight.box.x + 20, weight.box.y + 10);
  assert.match(indexHover.text, /60%.*fraction 0.6.*Completed session 2026-11-13.*Membership and weights as of 2026-11-12/);
  assert(inside(indexHover, namedInfo), JSON.stringify(indexHover));
  console.log('Named index has complete-scope title and separately dated index membership', JSON.stringify({ title: namedInfo.title, hover: indexHover }));

  const indexArea = 1.2345678901234568e-128;
  const tinyIndex = await draw({ ...index, completeness: 'partial', rows: index.rows.map(row => ({ ...row, area: indexArea })),
    chart_sources: { version: 1, receipts: [{ ...index.chart_sources.receipts[0], coverage: 'partial' }] } });
  assert(tinyIndex.ok && tinyIndex.marketMap.scope === 'delivered');
  const tinyIndexInfo = await inspect();
  verify(tinyIndexInfo);
  const [indexListing] = tinyIndex.marketMap.listings;
  const [indexSector] = tinyIndex.marketMap.sectors;
  const indexRoot = tinyIndex.marketMap.root;
  const indexTooltipBounds = [];
  for (const item of [indexListing, indexSector, indexRoot]) {
    const slice = find(tinyIndexInfo, item.id);
    const tooltip = await hoverAt(slice.box.x + 20, slice.box.y + 8);
    const expectedPercent = item === indexRoot ? '2.4691357802469136E-126%' : '1.2345678901234568E-126%';
    assert(tooltip.text.startsWith(item.label), JSON.stringify({ item, tooltip }));
    assert(tooltip.text.includes(expectedPercent) && tooltip.text.includes(`fraction ${item.value}`), JSON.stringify(tooltip));
    assert(inside(tooltip, tinyIndexInfo) && tooltip.width > 0 && tooltip.height > 0, JSON.stringify({ kind: item.kind, tooltip }));
    indexTooltipBounds.push({ kind: item.kind, tooltip });
  }
  console.log('320 × 260 tiny index tooltip containment for actual listing, sector and root hover', JSON.stringify(indexTooltipBounds));

  const longUniverse = 'W'.repeat(256);
  const longNamed = await draw({ ...index, rows: index.rows.map(row => ({ ...row, universe: longUniverse, sector: 'W'.repeat(128) })),
    chart_sources: { version: 1, receipts: [{ ...index.chart_sources.receipts[0], universe: longUniverse }] } });
  assert(longNamed.ok && longNamed.marketMap.universe === longUniverse);
  verify(await inspect());
  const normalWide = await draw(cap, { width: 640, height: 420 });
  assert(normalWide.ok);
  verify(await inspect());
  console.log('Long labels at 320 × 260 and stable positioning at 640 × 420');

  const collapsed = await draw(snapshot([['Technology', 1, 0], [null, Number.MIN_VALUE, null]]));
  assert(!collapsed.ok && /geometry.*BETA.US/.test(collapsed.message), JSON.stringify(collapsed));
  const unavailable = await draw(snapshot([['Technology', 1e308, 0], [null, 1e308, null]]));
  assert(!unavailable.ok && /sum.*represent/.test(unavailable.message), JSON.stringify(unavailable));
  console.log('Worker refused collapsed positive path and unrepresentable cap sum', [collapsed.message, unavailable.message]);
  assert.deepEqual(errors, []);
  assert.deepEqual(diagnostics, []);
} finally {
  if (errors.length || diagnostics.length) console.error({ errors, diagnostics });
  await browser.close();
}
