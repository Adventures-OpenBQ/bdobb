// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import type { ReturnSummaryOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';

export const returnChart = 'Return summaries example';
export const placeholder = 'Daily price snapshot';
export const sampleName = 'observed-prices.json';
export const workspace = 'Return summary fixtures';
const chartLayout = { x: 0, y: 0, w: 40, h: 29 };
export const returnRecipe: ReturnSummaryOptions = {
  version: 1, kind: 'return-summary', view: 'box', window: { mode: 'own' }, symbols: ['ZZZ.US', 'AAA.US'],
  fields: { date: 'date', price: 'adjusted_close', symbol: 'symbol' },
};

export const closes = (scale: number) => Array.from({ length: 20 }, (_, i) => (i % 5) * scale)
  .reduce((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);

export function returnSnapshot(histories: Record<string, number[]>) {
  const rows = Object.entries(histories).flatMap(([symbol, prices]) => prices.map((adjusted_close, i) => ({
    date: '2026-01-' + String(i + 1).padStart(2, '0'), adjusted_close, symbol,
  })));
  return JSON.stringify({ rows, completeness: 'bounded',
    receipt: { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' } });
}

export async function dropFile(page: Page, filename: string, text: string) {
  const transfer = await page.evaluateHandle(([name, body]) => {
    const data = new DataTransfer();
    data.items.add(new File([body], name, { type: 'application/json' }));
    return data;
  }, [filename, text]);
  await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

export async function chooseReturnSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, returnChart), name + ' — ' + 'Returns');
}

export async function prepareReturns(page: Page, snapshot?: string, options = returnRecipe, height = chartLayout.h) {
  const source = { id: 'placeholder', widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder,
    layout: { x: 0, y: height, w: 40, h: 12 } };
  const chart = { id: 'returns', widgetId: 'linked_chart', backendId: 'builtin', title: returnChart, params: {},
    linkedSource: { kind: 'widget', sourceWidgetId: 'placeholder' },
    linkedChart: { type: 'return-summary', recipe: options, measures: [], display: 'grouped' },
    layout: { ...chartLayout, h: height } };
  const seed = dashboardSeed([], { name: workspace, tabs: [{ name: 'Returns', id: 't1', cards: [chart, source] }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = '[]';
  await seedApp(page, seed);
  if (snapshot) {
    await dropFile(page, sampleName, snapshot);
    await expect(card(page, sampleName)).toBeVisible();
    await chooseReturnSource(page, sampleName);
  }
}
