// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Use the Vite browser test server specified by ETF_PROBE_URL.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(e));
  await page.goto(process.env.PROBE_URL ?? 'http://127.0.0.1:4718');
  const result = await page.evaluate(async () => {
    const { local, rows } = await import('/src/test/fixtures/etfHierarchyEvidence.ts');
    const { datasetFromBytes } = await import('/src/lib/localTableData.ts');
    const { createRecipeWorker } = await import('/src/lib/widgetData/chartRecipes/workerClient.ts');
    const makeInput = async holdings => {
      const receipt = { ...local, raw_count: holdings.length, normalized_count: holdings.length,
        delivered_count: holdings.length, holding_keys: holdings.map(row => row.symbol) };
      const snapshot = { rows: holdings, completeness: 'partial', chart_sources: { version: 1, receipts: [receipt] } };
      return datasetFromBytes('holdings.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'holdings', 1);
    };
    const options = { version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth: 2, snapshot: 'latest',
      fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } };
    const context = { theme: 'light', maxDecimals: 2, today: '2026-11-20', viewportWidth: 600, viewportHeight: 460 };
    const full = await makeInput(Array.from({ length: 3452 }, (_, i) => ({
      ...rows[0], symbol: 'H' + i + '.US', weight: .95 / 3452, sector: 'Sector ' + i % 11,
    })));
    const script = new URL('/src/lib/widgetData/chartRecipes/recipe.worker.ts', location.href).href;
    // Wrap only this diagnostic worker to count the browser's actual native calls.
    const workerURL = URL.createObjectURL(new Blob([`
      let queries=0, hitMillis=0;
      const original=OffscreenCanvasRenderingContext2D.prototype.isPointInPath;
      OffscreenCanvasRenderingContext2D.prototype.isPointInPath=function(...args) {
        queries++; const start=performance.now();
        try { return original.apply(this,args); }
        finally { hitMillis+=performance.now()-start; }
      };
      await import(${JSON.stringify(script)});
      const run=self.onmessage;
      self.onmessage=event=>{
        queries=0; hitMillis=0; const start=performance.now(); run(event);
        self.postMessage({diagnostic:true, queries, hitMillis, workerMillis:performance.now()-start});
      };
      self.postMessage('ready');
    `], { type: 'text/javascript' }));
    const native = new Worker(workerURL, { type: 'module' });
    const ready = port => new Promise((resolve,reject) => {
      port.addEventListener('message', resolve, {once:true});
      port.addEventListener('error', reject, {once:true});
    });
    await ready(native);
    const worker = createRecipeWorker(() => native);
    const timings = [];
    const signal = AbortSignal.timeout(20000);
    try {
      for (let i = 0; i < 4; i++) {
        const diagnostic = new Promise(resolve => {
          function onmessage({ data }) {
            if (data.diagnostic) { native.removeEventListener('message', onmessage); resolve(data); }
          }
          native.addEventListener('message', onmessage);
        });
        const start = performance.now();
        const output = await worker.run(full, options, context, signal);
        if (!output.ok) throw Error(JSON.stringify(output));
        timings.push({ tripMillis: performance.now() - start, ...await diagnostic });
      }
    } finally { worker.dispose(); URL.revokeObjectURL(workerURL); }
    const noPathURL = URL.createObjectURL(new Blob([
      'self.Path2D=undefined; await import(' + JSON.stringify(script) + '); self.postMessage("ready");',
    ], { type: 'text/javascript' }));
    const noPath = new Worker(noPathURL, { type: 'module' });
    await ready(noPath);
    const missing = createRecipeWorker(() => noPath);
    try {
      const split = await makeInput(rows);
      const one = await makeInput(rows.map(row => ({ ...row, sector: rows[0].sector })));
      const splitResult = await missing.run(split, options, context, signal);
      const oneResult = await missing.run(one, options, context, signal);
      const repair = await missing.run(one, { ...options, depth: 1 }, context, signal);
      return { timings, missingPath2D: { split:splitResult.ok ? true : splitResult,
        one:oneResult.ok ? true : oneResult, repairedValues:repair.ok && repair.etfHierarchy.holdings.map(h => h.value) } };
    } finally { missing.dispose(); URL.revokeObjectURL(noPathURL); }
  });
  console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
