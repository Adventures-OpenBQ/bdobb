// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from '@playwright/test';
import { seedCards, read } from './fixtures';
const file = '00000000-0000-0000-0000-000000000099.csv';
const source = { id: 'root', widgetId: 'local_table', backendId: 'builtin', params: { file }, layout: { x: 0, y: 0, w: 40, h: 20 } };
const csv = { [`files/${file}`]: 'region,team,revenue,date\nA,Alpha,10,2026-01-01\nA,Beta,20,2026-01-02\nB,Beta,90,2026-01-03\n' };
const model = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
test('ordinary text counts reach actual worker linked chart as numeric measures', async ({ page }) => {
  await seedCards(page, [{ ...source, table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'n', sourceFieldId: 'team', aggregation: 'count' }, { id: 'u', sourceFieldId: 'team', aggregation: 'uniqueCount' }] } } }], csv);
  const root = page.locator('.widget-card').first();
  await expect(root.locator('tfoot')).toContainText('3');
  await root.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Create linked chart', exact: true }).click();
  const chart = page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category', { exact: true }).selectOption({ label: 'region' });
  await chart.getByRole('checkbox', { name: 'team — Count', exact: true }).check();
  await chart.getByRole('checkbox', { name: 'team — Unique Count', exact: true }).check();
  await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
  await expect.poll(() => chart.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: { y: number[] }[] }).data.map(t => t.y))).toEqual([[2, 1], [2, 1]]);
});
test('cold future model can be inspected and explicitly repaired before actual worker publication', async ({ page }) => {
  await page.addInitScript(()=>{const Original=window.Worker;const rows:{values:Record<string,unknown>}[]=[];Object.assign(window,{coldRepairWorkerRows:rows});window.Worker=class extends Original{constructor(...args:ConstructorParameters<typeof Original>){super(...args);this.addEventListener('message',event=>{const response=event.data as {kind:string;rows?:{values:Record<string,unknown>}[]};if(response.kind==='rows')rows.push(...response.rows??[]);});}};});
  await seedCards(page, [{ ...source, tableDefinition: { search: '', table: {}, analytical: { schemaVersion: 99, intent: 'retained' } } }], csv);
  const root = page.locator('.widget-card');
  await expect(root).toContainText('Invalid analytical model');
  await expect(root.locator('tbody')).toHaveCount(0);
  await root.getByRole('button', { name: 'Pivot', exact: true }).click();
  await root.getByRole('tab', { name: 'Saved', exact: true }).click();
  await root.getByText('Advanced repair', { exact: true }).click();
  const draft = root.getByLabel('Model repair draft');
  await expect(draft).toContainText('retained');
  await draft.fill(JSON.stringify(model));
  await root.getByRole('button', { name: 'Close pivot drawer' }).click();
  await root.getByRole('button', { name: 'Pivot', exact: true }).click();
  await root.getByRole('tab', { name: 'Saved', exact: true }).click();
  await expect(draft).toHaveValue(JSON.stringify(model));
  await root.getByRole('button', { name: 'Save repaired model' }).click();
  await expect.poll(async()=>JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical).toEqual(model);
  // Inspect fills the card. Wait for its settled visibility before testing worker output.
  await expect(root.locator('.table-execution-layout')).toHaveAttribute('hidden', '');
  // Hidden tables virtualize their DOM; verify actual worker delivery separately.
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {coldRepairWorkerRows:{values:Record<string,unknown>}[]}).coldRepairWorkerRows.some(row=>row.values.revenue===90))).toBe(true);
  await root.getByRole('button', { name: 'Close pivot drawer' }).click();
  await expect(root.getByRole('cell', { name: '90', exact: true })).toBeVisible();
  expect(JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical).toEqual(model);
});
test('report activation and repeated Hide keep private fields out of actual worker linked output', async ({ page }) => {
  // Exercise the retained activation handler only in this test; production keeps it hidden.
  await page.route('**/src/lib/reportModelActivation.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const REPORT_MODEL_ACTIVATION_VISIBLE = true;' }));
  await seedCards(page, [{ ...source, table: { hidden: ['date'], columnOrder: ['revenue', 'region', 'team'] } }], csv);
  const root = page.locator('.widget-card').first();
  await root.getByRole('button', { name: 'Pivot', exact: true }).click();
  await root.getByRole('button', { name: 'Enable report model' }).click();
  await expect(root.getByRole('button', { name: 'Enable report model' })).toHaveCount(0);
  await root.getByRole('button', { name: 'Done', exact: true }).click();
  const headers = root.locator('th[data-field]');
  await expect(headers.first()).toHaveAttribute('data-field', 'revenue');
  await root.locator('th[data-field="revenue"]').dragTo(root.locator('th[data-field="team"]'));
  await expect.poll(async () => headers.evaluateAll(els => els.map(el => el.getAttribute('data-field')))).toEqual(['region', 'team', 'revenue']);
  await root.locator('th[data-field="revenue"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
  await expect(root.locator('th[data-field="revenue"]')).toHaveCount(0);
  await expect(root.locator('th[data-field="date"]')).toHaveCount(0);
  await root.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Create linked table', exact: true }).click();
  const child = page.locator('.widget-card').filter({ hasText: 'Linked table' });
  await expect(child.locator('th[data-field]')).toHaveCount(2);
  expect(await child.locator('th[data-field]').evaluateAll(els => els.map(el => el.getAttribute('data-field')))).toEqual(['region', 'team']);
});
