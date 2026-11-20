// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { liveMetricReceipt, liveMetricRows, metricReceipt, metricRows } from '../../src/test/fixtures/metricEvidence';
import type { LinkedKpiOptions } from '../../src/lib/widgetData/kpi/types';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';
import { dropFile } from './return-summary';

export const workspace = 'KPI fixtures';
export const pageTab = 'KPI';
export const metricName = 'KPI example';
export const placeholder = 'KPI snapshot source';
export const liveTable = 'Fictional Key Metrics';
export const filename = 'kpi-observations.json';
export const backendOrigin = 'http://127.0.0.1:17923';
export const backendPath = '/api/v1/eodhd/equity/fundamental/metrics';
const backendId = 'kpi-fixtures';
const backendWidget = 'kpi_metrics_fixture';
const params = { chart_source: 'true', symbol: 'AAPL.US' };

export const yieldCard: LinkedKpiOptions = {
  version: 1, metric: 'dividend_yield', valueField: 'dividend_yield', observation: { mode: 'latest' }, view: 'card',
};
export const epsGauge: LinkedKpiOptions = {
  version: 1, metric: 'eps_ttm', valueField: 'eps_ttm', observation: { mode: 'pinned', id: 'revised-report' },
  view: 'gauge', range: { min: -100, max: 100, label: 'Planning range' },
  reference: { kind: 'observation', id: 'first-report' },
};

// The response mimics the opt-in contract. The financial values are fictional.
export function fictionalResponse() {
  return { results: structuredClone(liveMetricRows), extra: { results_metadata: {
    chart_sources: { version: 1, receipts: [structuredClone(liveMetricReceipt)] },
  } } };
}

export function epsFile(value = 12.345, omitPin = false) {
  const receipt = structuredClone(metricReceipt);
  if (omitPin) {
    receipt.metrics.eps_ttm.additional_observations = [];
    receipt.raw_count = receipt.normalized_count = receipt.delivered_count = 1;
  }
  return { rows: omitPin ? [metricRows[1]] : [{ ...metricRows[0], eps_ttm: value }, metricRows[1]],
    completeness: 'complete', chart_sources: { version: 1, receipts: [receipt] } };
}

export async function prepareKpi(page: Page, {
  backend = false, options, response = fictionalResponse, empty = false,
}: { backend?: boolean; options?: LinkedKpiOptions; response?: () => unknown; empty?: boolean } = {}) {
  const acquisitions: URL[] = [];
  if (backend) await page.route(backendOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    const isSource = url.pathname === backendPath;
    if (isSource) acquisitions.push(url);
    const payload = isSource ? await response() : url.pathname === '/widgets.json' ? {
      [backendWidget]: {
        name: liveTable, description: 'Fictional browser acceptance reply', type: 'table', endpoint: backendPath,
        params: Object.entries(params).map(([paramName, value]) => ({ paramName, label: paramName, value, type: 'text' })),
        data: { dataKey: 'results' }, refetchInterval: false,
      },
    } : {};
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      status: payload instanceof Error ? 500 : 200, json: payload instanceof Error ? { detail: payload.message } : payload });
  });
  const source = backend
    ? { widgetId: backendWidget, backendId, params, title: liveTable }
    : { widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder };
  const cards = [
    { id: 'kpi', widgetId: 'linked_metric', backendId: 'builtin', title: metricName, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: 'source' }, ...(options && { linkedMetric: options }),
      layout: { x: 0, y: 0, w: 35, h: 26 } },
    { ...source, id: 'source', layout: { x: 0, y: 26, w: 35, h: 12 } },
  ];
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: pageTab, id: 't1', cards }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify(backend ? [
    { id: backendId, name: 'Fictional KPI fixtures', baseUrl: backendOrigin, authLocation: 'header', validateWidgets: false },
  ] : []);
  await seedApp(page, seed);
  return acquisitions;
}

export async function chooseKpiSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, metricName), name + ' — ' + pageTab);
}

export async function attachEps(page: Page, name = filename, snapshot = epsFile()) {
  await dropFile(page, name, JSON.stringify(snapshot));
  await expect(card(page, name)).toBeVisible();
  await chooseKpiSource(page, name);
}
