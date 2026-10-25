// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDiscoveryRequest, MOCK_URL, read, seedApp, seedCards } from './fixtures';

test('file pivot duplicate measures survive linked table chart and reopening saved files', async ({ page, context }) => {
  await seedCards(page, []);
  await page.locator('.dashboard-grid').waitFor();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Region,Volume\nA,10\nA,20\nB,90\n'], 'volume.csv', { type: 'text/plain' }));
    const area = document.querySelector('main.dashboard-area')!;
    area.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  const source = page.locator('.widget-card').filter({ hasText: 'volume.csv' });
  await expect(source.getByRole('cell', { name: '90', exact: true })).toBeVisible();
  await source.getByRole('button', { name: 'Pivot', exact: true }).click();
  // A raw file table opens on the four-list chooser; the first arrangement edit saves the report model.
  const list = (name: string) => source.locator(`[data-list="${name}"]`);
  await list('available').getByRole('button', { name: 'Region', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to Row Groups' }).click();
  await expect(list('rows').getByRole('button', { name: 'Region', exact: true })).toBeVisible();
  // Only chosen measures: Data Columns starts empty, and a new data column has no
  // aggregation and renders blank (never #ERROR) until one is chosen.
  await expect(list('values').getByRole('button')).toHaveCount(0);
  await list('available').getByRole('button', { name: 'Volume', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to Data Columns' }).click();
  await expect(list('values').getByRole('button', { name: 'Volume', exact: true })).toContainText('Choose aggregation');
  await expect(list('values').getByRole('button')).toHaveCount(1);
  await expect(source.locator('[data-error-code]')).toHaveCount(0);
  await list('values').getByRole('button', { name: 'Volume', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Aggregation', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Average', exact: true }).click();
  await list('values').getByRole('button', { name: 'Volume — Average', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate Volume — Average', exact: true }).click();
  await list('values').getByRole('button', { name: 'Volume — Average (2)', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Aggregation', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Total', exact: true }).click();
  await source.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(source.getByRole('columnheader', { name: /Volume — Total/ })).toBeVisible();
  await expect(source.locator('tfoot')).toContainText('120');
  await expect(source.locator('tfoot')).toContainText('40');
  await source.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Create linked table', exact: true }).click();
  const linked = page.locator('.widget-card').filter({ hasText: 'Linked table' });
  await expect(linked.getByRole('columnheader', { name: /Volume — Average/ })).toBeVisible();
  await expect(linked.getByRole('columnheader', { name: /Volume — Total/ })).toBeVisible();
  await source.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Create linked chart', exact: true }).click();
  const chart = page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category', { exact: true }).selectOption({ label: 'Region' });
  await chart.getByRole('checkbox', { name: 'Volume — Average', exact: true }).check();
  await chart.getByRole('checkbox', { name: 'Volume — Total', exact: true }).check();
  await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
  await expect.poll(() => chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { name: string; y: number[] }[] }).data.map(t => ({ name: t.name, y: t.y })))).toEqual([
    { name: 'Volume — Average', y: [15, 90] }, { name: 'Volume — Total', y: [30, 90] },
  ]);
  const saved = JSON.parse((await read(page, 'dashboards/d1.json'))!);
  const instances = saved.tabs[0].cards[0].tableDefinition.analytical.measures;
  expect(instances.map((m: { aggregation: string }) => m.aggregation)).toEqual(['mean', 'sum']);
  expect(new Set(instances.map((m: { id: string }) => m.id)).size).toBe(2);
  const files = await page.evaluate(() => Object.fromEntries(window.__bdobb!.list!().map(path => [path, window.__bdobb!.read!(path)!])));
  const storedPath = `files/${saved.tabs[0].cards[0].params.file}`;
  files[storedPath] = await page.evaluate(async path => {
    const modulePath = '/src/test/memfs.ts';
    const memory = await import(modulePath);
    return new TextDecoder().decode(memory.__readBytes(path));
  }, storedPath);
  expect(files[storedPath]).toBe('Region,Volume\nA,10\nA,20\nB,90\n');
  // Reopen actual written state and CSV bytes in a fresh page, rather than
  // navigating the original page whose init seed would erase the saves.
  const sourceCard = saved.tabs[0].cards[0];
  saved.tabs = [{ id: 't1', name: 'Linked', cards: saved.tabs[0].cards.slice(1) }, { id: 'source-tab', name: 'Source', cards: [sourceCard] }];
  files['dashboards/d1.json'] = JSON.stringify(saved);
  const reopened = await context.newPage();
  await seedApp(reopened, files);
  await expect(reopened.locator('.linked-chart-renderer .js-plotly-plot')).toHaveCount(1);
  await reopened.getByRole('tab', { name: 'Source', exact: true }).click();
  await expect(reopened.locator('.widget-card').filter({ hasText: 'volume.csv' }).getByRole('columnheader', { name: /Volume — Total/ })).toBeVisible();
  const restored = JSON.parse((await read(reopened, 'dashboards/d1.json'))!);
  expect(restored.tabs[1].cards[0].tableDefinition.analytical.measures).toEqual(instances);
  expect(restored.tabs[0].cards.find((c: { linkedChart?: unknown }) => c.linkedChart).linkedChart.measures).toEqual(instances.map((m: { id: string }) => m.id));
  await reopened.locator('.widget-card').getByRole('button', { name: 'Remove card', exact: true }).click();
  await reopened.getByRole('tab', { name: 'Linked', exact: true }).click();
  await expect(reopened.locator('.widget-card').filter({ hasText: 'Linked table' })).toContainText(/Source unavailable/);
  await reopened.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(reopened.locator('.linked-chart-renderer .js-plotly-plot')).toHaveCount(1);
});


test('actual local workers match pure executor semantics across shuffled bounded deliveries', async ({ page }) => {
  await seedCards(page, []);
  const result = await page.evaluate(async () => {
    const contractPath = '/src/lib/tableExecution/testContract.ts';
    const workerPath = '/src/lib/tableExecution/workerClient.ts';
    const { runExecutorContract, createPureExecutor } = await import(contractPath);
    const { createWorkerExecutor } = await import(workerPath);
    return { actual: await runExecutorContract(() => createWorkerExecutor('source')), expected: await runExecutorContract(createPureExecutor) };
  });
  expect(result.actual).toEqual(result.expected);
});

for (const theme of ['dark', 'light']) {
  test(`XLS importer creates local linked subset and chart in ${theme} compact viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 720 });
    const acquisitionRequests: string[] = [];
    page.on('request', request => { if (request.url().startsWith(MOCK_URL) && !isDiscoveryRequest(request.url())) acquisitionRequests.push(request.url()); });
    // Exercise the retained activation handler only in this test; production keeps it hidden.
  await page.route('**/src/lib/reportModelActivation.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const REPORT_MODEL_ACTIVATION_VISIBLE = true;' }));
  await seedCards(page, [], { 'settings.json': JSON.stringify({ theme }) });
    await page.locator('.dashboard-grid').waitFor();
    // Measure file acquisition after ordinary startup Apps/key discovery settles.
    await page.waitForLoadState('networkidle');
    acquisitionRequests.length = 0;
    const bytes = [...readFileSync('src/test/fixtures/table-execution.xls')];
    await page.evaluate(bytes => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'table-execution.xls', { type: 'application/vnd.ms-excel' }));
      const area = document.querySelector('main.dashboard-area')!;
      area.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    const source = page.locator('.widget-card').filter({ hasText: 'table-execution.xls' });
    await expect(source.getByRole('cell', { name: '80', exact: true })).toBeVisible();
    await source.getByRole('checkbox', { name: 'Select all rows', exact: true }).click();
    await expect(source.getByRole('checkbox', { name: 'Select all rows', exact: true })).toBeChecked();
    await source.getByRole('button', { name: 'Card menu' }).click();
    await page.getByRole('menuitem', { name: 'Create linked table', exact: true }).click();
    const linked = page.locator('.widget-card').filter({ hasText: 'Linked table' });
    await expect(linked.getByRole('cell', { name: '80', exact: true })).toBeVisible();
    await linked.getByRole('button', { name: 'Card menu' }).click();
    await page.getByRole('menuitem', { name: 'Create linked chart', exact: true }).click();
    const chart = page.locator('.linked-chart-renderer');
    await chart.getByLabel('Category', { exact: true }).selectOption({ label: 'Sector' });
    await chart.getByRole('checkbox', { name: 'Revenue', exact: true }).check();
    await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
    await expect.poll(() => chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { y: number[] }[] }).data[0].y)).toEqual([80, 20, 40, 70, 35]);
    expect(acquisitionRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`xls-${theme}-compact.png`), fullPage: true });
    if (theme === 'dark') {
      const saved = JSON.parse((await read(page, 'dashboards/d1.json'))!);
      const files = await page.evaluate(async () => {
        const memoryPath = '/src/test/memfs.ts';
        const memory = await import(memoryPath);
        return Object.fromEntries(window.__bdobb!.list!().map(path => [path, [...(memory.__readBytes(path) ?? new TextEncoder().encode(window.__bdobb!.read!(path)!))]]));
      });
      const storedPath = `files/${saved.tabs[0].cards[0].params.file}`;
      files[storedPath] = await page.evaluate(async path => { const modulePath = '/src/test/memfs.ts'; const memory = await import(modulePath); return [...memory.__readBytes(path)]; }, storedPath);
      expect(files[storedPath]).toEqual(bytes);
      const root = testInfo.outputPath('native-import-handoff');
      for (const [path, content] of Object.entries(files)) { const destination = join(root, path); mkdirSync(join(destination, '..'), { recursive: true }); writeFileSync(destination, Buffer.from(content as number[])); }
      expect(saved.tabs[0].cards).toHaveLength(3);
    }
    await source.getByRole('button', { name: 'Pivot', exact: true }).click();
    await source.getByRole('button', { name: 'Enable report model', exact: true }).click();
    await source.getByRole('tab', { name: 'Categories', exact: true }).click();
    await source.getByRole('textbox', { name: 'Category name', exact: true }).fill('Fiscal year');
    await source.getByRole('combobox', { name: 'Source field', exact: true }).selectOption('Date');
    await source.getByRole('combobox', { name: 'Transformation', exact: true }).selectOption('FY');
    for (const [name, field] of [['Company field', 'Company'], ['Fiscal year field', 'FiscalYear'], ['Period start field', 'PeriodStart'], ['Period end field', 'PeriodEnd']]) {
      await source.getByRole('combobox', { name, exact: true }).selectOption(field);
    }
    await source.getByRole('combobox', { name: 'Bound period kind', exact: true }).selectOption('FY');
    await source.getByRole('combobox', { name: 'Position', exact: true }).selectOption('rows');
    await source.getByRole('button', { name: 'Save category', exact: true }).click();
    await source.getByRole('tab', { name: 'Measures', exact: true }).click();
    // Enable report model adds no measures. Add Revenue (Total) and Cost, left without an
    // aggregation: Cost's footer cell is blank, not a missing-aggregation error.
    for (const field of ['Revenue', 'Cost']) {
      await source.getByRole('combobox', { name: 'Measure source', exact: true }).selectOption(field);
      await source.getByRole('button', { name: 'Add measure', exact: true }).click();
    }
    await source.getByRole('combobox', { name: 'Aggregation for Revenue', exact: true }).selectOption('sum');
    await expect(source.getByRole('combobox', { name: 'Aggregation for Cost', exact: true })).toHaveValue('');
    await source.getByRole('button', { name: 'Done', exact: true }).click();
    const costTotal = source.getByRole('cell', { name: 'Cost total', exact: true }).first();
    await expect(costTotal).toHaveText('—'); // the blank-value glyph, not #ERROR
    await expect(costTotal).not.toHaveAttribute('title', /.+/);
    await expect(source.locator('tfoot td[aria-label*="missing-aggregation"]')).toHaveCount(0);
    await source.getByRole('button', { name: 'Maximize', exact: true }).click();
    await source.getByRole('button', { name: 'Pivot', exact: true }).click();
    await source.getByRole('tab', { name: 'Saved', exact: true }).click();
    await source.getByRole('button', { name: /^Warnings \(/ }).click();
    const warningRow = source.locator('.table-model-inspection li').filter({ hasText: 'Fiscal periods do not align across companies' });
    await warningRow.scrollIntoViewIfNeeded();
    await expect(warningRow).toBeInViewport();
    await expect(warningRow).toContainText('different date ranges');
    await page.screenshot({ path: testInfo.outputPath(`fiscal-warning-${theme}-compact.png`), fullPage: true });
    await source.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(source.getByRole('button', { name: 'Expand FY2025', exact: true })).toBeVisible();

    await expect(source.getByRole('button', { name: 'Expand FY2025', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`fiscal-report-${theme}-compact.png`), fullPage: true });
  });
}

test('records representative actual-worker transfer and renderer responsiveness without a size cap', async ({ page }, testInfo) => {
  await seedCards(page, []);
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const browserSession = await page.context().browser()!.newBrowserCDPSession();
  await page.exposeFunction('measureWorkerHeap', async () => {
    const targets = await browserSession.send('Target.getTargets');
    const worker = targets.targetInfos.find(target => target.type === 'worker' && target.url.includes('/src/lib/tableExecution/table.worker.ts'));
    if (!worker) throw new Error('CDP Target.getTargets did not find the representative table worker');
    const attached = await browserSession.send('Target.attachToTarget', { targetId: worker.targetId, flatten: false });
    try {
      return await new Promise<{ usedSize: number; totalSize: number }>((resolve, reject) => {
        const timer = setTimeout(() => { browserSession.off('Target.receivedMessageFromTarget', received); reject(new Error('CDP Runtime.getHeapUsage response timed out')); }, 5000);
        const received = (event: { sessionId: string; message: string }) => {
          if (event.sessionId !== attached.sessionId) return;
          const response = JSON.parse(event.message);
          if (response.id !== 1) return;
          clearTimeout(timer); browserSession.off('Target.receivedMessageFromTarget', received);
          if (response.error) reject(new Error(JSON.stringify(response.error))); else resolve(response.result);
        };
        browserSession.on('Target.receivedMessageFromTarget', received);
        void browserSession.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }) }).catch(error => { clearTimeout(timer); browserSession.off('Target.receivedMessageFromTarget', received); reject(error); });
      });
    } finally { await browserSession.send('Target.detachFromTarget', { sessionId: attached.sessionId }); }
  });
  const before = await session.send('Performance.getMetrics');
  const measurements = await page.evaluate(async () => {
    const workerPath = '/src/lib/tableExecution/workerClient.ts';
    const { createWorkerExecutor } = await import(workerPath);
    const results = [];
    for (const count of [10_000, 50_000]) {
      let responseJSONBytes = 0;
      let maxTickGapMs = 0;
      let last = performance.now();
      const timer = setInterval(() => { const now = performance.now(); maxTickGapMs = Math.max(maxTickGapMs, now - last); last = now; }, 10);
      const executor = createWorkerExecutor('measured', () => {
        const worker = new Worker('/src/lib/tableExecution/table.worker.ts', { type: 'module' });
        worker.addEventListener('message', event => { responseJSONBytes += new TextEncoder().encode(JSON.stringify(event.data)).byteLength; });
        return worker;
      });
      const signal = new AbortController().signal;
      const bytes = new TextEncoder().encode('Sector,Revenue,Cost\n' + Array.from({ length: count }, (_, i) => `S${i % 10},${i},${i / 2}`).join('\n'));
      const start = performance.now();
      await executor.importFile('representative.csv', bytes, 1, signal);
      const importedMs = performance.now() - start;
      const measureHeap = (window as unknown as { measureWorkerHeap: () => Promise<{ usedSize: number; totalSize: number }> }).measureWorkerHeap;
      const workerHeapAfterImport = await measureHeap();
      const revision = { widgetId: 'measured', input: 1, model: 1, output: 1 };
      const calculated = performance.now();
      await executor.applyModel({ table: {}, search: '' }, { kind: 'allMatching', excludedIds: [] }, revision, signal);
      const calculatedMs = performance.now() - calculated;
      const workerHeapAfterModel = await measureHeap();
      let deliveredRows = 0; let rowIDJSONBytes = 0;
      for await (const batch of executor.presented(revision, signal)) { deliveredRows += batch.rows.length; rowIDJSONBytes += new TextEncoder().encode(JSON.stringify(batch.rows.map((row: { id: string }) => row.id))).byteLength; }
      const tail = await executor.rows(revision, { groupPath: [], offset: count - 1, limit: 1 }, signal);
      const proofStart = performance.now();
      await executor.identityWitness(revision, [{ table: {}, search: '' }, { table: {}, search: '' }], [tail.rows[0].id], signal);
      const identityProofMs = performance.now() - proofStart;
      const workerHeapAfterTransferAndIdentity = await measureHeap();
      clearInterval(timer); executor.dispose();
      results.push({ count, inputBytes: bytes.byteLength, responseJSONBytes, rowIDJSONBytes, importedMs, calculatedMs, identityProofMs, elapsedMs: performance.now() - start, maxTickGapMs, deliveredRows, workerHeapAfterImport, workerHeapAfterModel, workerHeapAfterTransferAndIdentity });
    }
    return results;
  });
  const after = await session.send('Performance.getMetrics');
  const heap = (metrics: typeof before) => metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
  const evidence = { measurements, rendererHeapBefore: heap(before), rendererHeapAfter: heap(after), limits: 'CDP renderer heap excludes worker private state; attached worker Runtime.getHeapUsage separately samples its isolate usedSize/totalSize after import/model/transfer+identity. Samples are not peak memory, OS RSS, retained allocation ownership, or a native measure; no forced GC. JSON UTF-8 bytes approximate cloned response payload, not wire/heap allocation. IDs include row-value identity costs. Timers sample renderer gaps, not native responsiveness.' };
  await testInfo.attach('representative-worker-measurements', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  writeFileSync(testInfo.outputPath('measurements.json'), JSON.stringify(evidence, null, 2));
  expect(measurements.map(result => result.deliveredRows)).toEqual([10_000, 50_000]);
  for (const measurement of measurements) expect(measurement.workerHeapAfterModel.usedSize).toBeGreaterThan(0);
  await browserSession.detach();
});

test('report Year Quarter page and level filters recompute ratio totals while Budget can be excluded and restored', async ({ page }) => {
  await seedCards(page, []);
  const fixture = await page.evaluate(async () => {
    const path = '/src/lib/tableExecution/testContract.ts';
    const { contractCases } = await import(path);
    return contractCases.find((fixture: { name: string }) => fixture.name === 'scoped-result-filters');
  });
  const csv = 'date,scenario,revenue,cost\n' + fixture.data.rows.map((row: { values: Record<string, unknown> }) => [row.values.date, row.values.scenario, row.values.revenue, row.values.cost].join(',')).join('\n');
  await seedCards(page, [{ id: 'report', widgetId: 'local_table', backendId: 'builtin', params: { file: '00000000-0000-0000-0000-000000000001.csv' }, layout: { x: 0, y: 0, w: 40, h: 20 }, tableDefinition: fixture.definition }], { 'files/00000000-0000-0000-0000-000000000001.csv': csv });
  const report = page.locator('.widget-card');
  await expect(report.locator('tfoot')).toContainText('0.75');
  await expect(report.locator('tfoot')).toContainText('70');
  await report.getByRole('button', { name: 'Pivot', exact: true }).click();
  await report.getByRole('tab', { name: 'Pages', exact: true }).click();
  await expect(report.getByRole('combobox', { name: 'Page member', exact: true })).toHaveValue('["string","Actual"]');
  await report.getByRole('tab', { name: 'Category filters', exact: true }).click();
  await report.getByRole('combobox', { name: 'Checklist category', exact: true }).selectOption('scenarioCategory');
  await report.getByRole('checkbox', { name: /Budget \(/ }).uncheck();
  await report.getByRole('button', { name: 'Apply checklist', exact: true }).click();
  await expect(report.locator('tfoot')).toContainText('#ERROR');
  await report.getByRole('button', { name: 'Remove checklist', exact: true }).click();
  await expect(report.locator('tfoot')).toContainText('70');
  await expect(report.locator('tfoot')).not.toContainText('#ERROR');
  await report.getByRole('tab', { name: 'Formulas', exact: true }).click();
  await report.getByRole('button', { name: 'New formula', exact: true }).click();
  await report.getByRole('textbox', { name: 'Formula name', exact: true }).fill('Profit');
  await report.getByRole('textbox', { name: 'Expression', exact: true }).fill('[revenue] - [cost]');
  await report.getByRole('button', { name: 'Save formula', exact: true }).click();
  await report.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await report.locator('[data-list="available"]').getByRole('button', { name: 'Profit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to Data Columns', exact: true }).click();
  await expect.poll(async () => {
    const saved = JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical;
    return saved.layout.values.includes(saved.formulas.find((formula: { name: string }) => formula.name === 'Profit')?.id);
  }).toBe(true);
  await report.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(report.getByRole('columnheader', { name: 'Profit', exact: true })).toBeVisible();
  await report.getByRole('button', { name: 'Pivot', exact: true }).click();
  await report.getByRole('tab', { name: 'Formulas', exact: true }).click();
  await report.getByRole('button', { name: 'Margin', exact: true }).click();
  await report.getByRole('textbox', { name: 'Expression', exact: true }).fill('[Profit] / [revenue]');
  await report.getByRole('button', { name: 'Save formula', exact: true }).click();
  await expect(report.locator('tfoot')).toContainText('0.75');
  await report.getByRole('tab', { name: 'Result filters', exact: true }).click();
  await report.getByRole('button', { name: 'Remove result filter', exact: true }).last().click();
  await expect(report.getByRole('button', { name: 'Remove result filter', exact: true })).toHaveCount(1);
  await report.getByRole('combobox', { name: 'Filter level', exact: true }).selectOption('quarter');
  await report.getByRole('combobox', { name: 'Calculation', exact: true }).selectOption(JSON.stringify(['measure', 'revenueSum']));
  await report.getByRole('combobox', { name: 'Operator', exact: true }).selectOption('gt');
  await report.getByRole('textbox', { name: 'Comparison value', exact: true }).fill('50');
  await report.getByRole('button', { name: 'Add result filter', exact: true }).click();
  await expect(report.getByRole('button', { name: 'Remove result filter', exact: true })).toHaveCount(2);
  await report.getByRole('button', { name: 'Done', exact: true }).click();
  await report.getByRole('checkbox', { name: /^Select row / }).first().click();
  await expect(report.getByRole('checkbox', { name: /^Select row / }).first()).toBeChecked();
  await report.getByRole('button', { name: 'Expand 2025', exact: true }).click();
  await expect(report.getByRole('checkbox', { name: /^Select row / })).toHaveCount(2);
  await report.getByRole('checkbox', { name: /^Select row / }).nth(1).click();
  await expect(report).toContainText('1 selected');
  await report.getByRole('button', { name: 'Collapse 2025', exact: true }).click();
  await report.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Create linked chart', exact: true }).click();
  const chart = page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category', { exact: true }).selectOption({ label: 'Year › Quarter' });
  await chart.getByRole('checkbox', { name: 'Margin', exact: true }).check();
  await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
  await expect.poll(() => chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { y: number[] }[] }).data[0].y)).toEqual([0.75]);
  const model = JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical;
  expect(model.resultFilters).toHaveLength(2);
  expect(model.layout.page).toEqual({ categoryId: 'scenarioCategory', memberKeys: ['["string","Actual"]'] });
});

test('unloaded Select all feeds complete chart output through the library source dialog', async ({ page }) => {
  await seedCards(page, []);
  await page.locator('.dashboard-grid').waitFor();
  const csv = 'Sector,Revenue\n' + Array.from({ length: 1200 }, (_, i) => `S${i % 4},${i}`).join('\n');
  await page.evaluate(csv => {
    const transfer = new DataTransfer(); transfer.items.add(new File([csv], 'unloaded.csv', { type: 'text/plain' }));
    const area = document.querySelector('main.dashboard-area')!;
    area.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, csv);
  const source = page.locator('.widget-card').filter({ hasText: 'unloaded.csv' });
  await expect(source.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  expect(await source.locator('tbody tr[data-index]').count()).toBeLessThan(1200);
  await source.getByRole('checkbox', { name: 'Select all rows', exact: true }).click();
  await expect(source.getByRole('checkbox', { name: 'Select all rows', exact: true })).toBeChecked();
  await expect(source).toContainText('1200 selected');
  await page.keyboard.press('Meta+k');
  await page.getByRole('button', { name: 'Add Linked chart', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create linked chart', exact: true });
  const savedSourceId = JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[0].id;
  await dialog.getByRole('combobox', { name: 'Source table', exact: true }).selectOption(savedSourceId);
  await dialog.getByRole('button', { name: 'Create linked chart', exact: true }).click();
  await page.keyboard.press('Escape');
  const chart = page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category', { exact: true }).selectOption({ label: 'Sector' });
  await chart.getByRole('checkbox', { name: 'Revenue', exact: true }).check();
  await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
  await expect.poll(() => chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { y: number[] }[] }).data[0].y.length)).toBe(1200);
  expect(await chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { y: number[] }[] }).data[0].y.at(-1))).toBe(1199);
});

test('actual worker pivot off preserves source constraints and dormant report intent',async({page})=>{
 await seedCards(page,[]);
 const result=await page.evaluate(async()=>{
  const contractPath='/src/lib/tableExecution/testContract.ts',workerPath='/src/lib/tableExecution/workerClient.ts';
  const {pivotOffData,pivotOffDefinition}=await import(contractPath);const {createWorkerExecutor}=await import(workerPath);
  const executor=createWorkerExecutor('off');const signal=new AbortController().signal,revision={widgetId:'off',input:1,model:1,output:1};
  try{await executor.registerInput(pivotOffData,1,signal);const ready=await executor.applyModel(pivotOffDefinition,{kind:'explicit',ids:['keep']},revision,signal);const rows=await executor.rows(revision,{groupPath:[],offset:0,limit:10},signal);const totals=await executor.totals(revision,signal);const chart=await executor.chartData(revision,['sourceComputed'],signal);return {ready,rows,totals,chart};}finally{executor.dispose();}
 });
 expect(result.ready.topLevelCount).toBe(1);expect(result.rows.rows.map((r:{id:string})=>r.id)).toEqual(['keep']);
 expect(result.rows.rows[0].values.sourceComputed).toBe(15);expect(result.rows.rows[0].cellErrors?.sourceError.code).toBe('division-by-zero');
 expect(result.rows.groups).toEqual([]);expect(result.totals.values).toEqual({});expect(result.ready.columns.map((c:{id:string})=>c.id)).not.toContain('secret');
});
