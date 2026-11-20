// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Replays the fixed round-2 sample coordinates. Run from the BDOBB worktree.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';

const { pathAnnulus } = createRequire(import.meta.url)('plotly.js/src/lib/angles.js');
const turn = 2 * Math.PI;
let rng = 183327;
function rand() {
  rng = (rng * 1664525 + 1013904223) >>> 0;
  return rng / 2 ** 32;
}

function strictRoundedMidpoint({ from, to, cx, cy, inner, outer }) {
  const point = (r, a) => [Math.fround(cx + r * Math.cos(a)), Math.fround(cy - r * Math.sin(a))];
  const innerStart = point(inner, from), innerEnd = point(inner, to);
  const outerStart = point(outer, from), outerEnd = point(outer, to);
  const a = (from + to) / 2;
  const [x, y] = point((inner + outer) / 2, a);
  const forward = ([x0, y0], [x1, y1]) =>
    (x1 - x0) * -Math.sin(a) + (y1 - y0) * -Math.cos(a) > 0;
  const inside = ([x0, y0], [x1, y1]) =>
    (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) < 0;
  return forward(innerStart, innerEnd) && forward(outerStart, outerEnd)
    && inside(innerStart, outerStart) && inside(outerEnd, innerEnd);
}

const samples = [];
for (let i = 0; i < 12000; i++) {
  const angle = 10 ** (-9 + rand() * 4);
  const from = rand() * (turn - angle), to = from + angle;
  if (i % 3 !== 0 || i % 2 !== 1) continue; // 600 × 460, holding-level radii 128/192.
  const sample = { i, from, to, cx: 300, cy: 256, inner: 128, outer: 192 };
  if (!strictRoundedMidpoint(sample)) continue;
  const weights = [from / turn * .35, angle / turn * .35, (turn - to) / turn * .35];
  samples.push({
    ...sample, angle: to - from, weights,
    d: pathAnnulus(sample.inner, sample.outer, from, to, sample.cx, sample.cy),
  });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<svg width="600" height="460"><path/></svg>');
  const failures = await page.evaluate(samples => {
    const path = document.querySelector('path');
    return samples.filter(({ d, inner, outer, from, to, cx, cy }) => {
      const r = (inner + outer) / 2, a = (from + to) / 2;
      path.setAttribute('d', d);
      return !path.isPointInFill(new DOMPoint(cx + r * Math.cos(a), cy - r * Math.sin(a)));
    });
  }, samples);
  const sourceBound = [];
  if (process.env.ETF_ROUNDED_PROBE_URL) {
    for (const { i, weights } of failures) {
      await page.goto(process.env.ETF_ROUNDED_PROBE_URL);
      const output = await page.evaluate(async weights => {
        const { local, rows } = await import('/src/test/fixtures/etfHierarchyEvidence.ts');
        const { datasetFromBytes } = await import('/src/lib/localTableData.ts');
        const { createRecipeWorker } = await import('/src/lib/widgetData/chartRecipes/workerClient.ts');
        const { renderPlot } = await import('/src/lib/plotly.ts');
        const holdings = weights.map((weight, index) => ({ ...rows[0], symbol: ['FIRST.US', 'MIDDLE.US', 'LAST.US'][index], weight }));
        const source = { ...local, raw_count: 3, normalized_count: 3, delivered_count: 3, holding_keys: holdings.map(row => row.symbol) };
        const bytes = new TextEncoder().encode(JSON.stringify({ rows: holdings, completeness: 'partial',
          chart_sources: { version: 1, receipts: [source] } }));
        const dataset = await datasetFromBytes('holdings.json', bytes, 'holdings', 1);
        const options = { version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth: 2, snapshot: 'latest',
          fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } };
        const worker = createRecipeWorker();
        try {
          const result = await worker.run(dataset, options, {
            theme: 'light', maxDecimals: 2, today: '2026-11-20', viewportWidth: 600, viewportHeight: 460,
          }, new AbortController().signal);
          if (!result.ok) return result;
          const graph = document.createElement('div');
          graph.style.cssText = 'position:fixed;left:12px;top:12px;width:600px;height:460px';
          document.body.append(graph);
          await renderPlot(graph, result.figure, result.revision);
          const { cx, cy } = graph.calcdata[0][0];
          const path = Array.from(graph.querySelectorAll('.sunburstlayer path.surface'))
            .find(path => path.__data__.data.data.label === 'MIDDLE.US');
          const { x0, x1, rpx0, rpx1 } = path.__data__;
          const hit = (radial, angular) => {
            const r = rpx0 + (rpx1 - rpx0) * radial, a = x0 + (x1 - x0) * angular;
            return path.isPointInFill(new DOMPoint(cx + r * Math.cos(a), cy - r * Math.sin(a)));
          };
          let filledInterior = 0;
          for (let ri = 1; ri < 32; ri++) {
            for (let ai = 1; ai < 32; ai++) {
              if (hit(ri / 32, ai / 32)) filledInterior++;
            }
          }
          return { ok: true, accepted: result.etfHierarchy.holdings.map(holding => holding.value),
            from: x0, angle: x1 - x0, radii: [rpx0, rpx1], midpoint: hit(.5, .5), filledInterior, samples: 961 };
        } finally { worker.dispose(); }
      }, weights);
      sourceBound.push({ i, weights, output });
    }
  }
  console.log(JSON.stringify({ admittedSamples: samples.length, falseAccepts: failures, sourceBound }, null, 2));
} finally {
  await browser.close();
}
