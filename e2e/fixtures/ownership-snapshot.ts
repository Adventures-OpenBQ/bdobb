// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { acquiredOwnershipPartition, acquiredOwnershipRows, liveOwnershipReceipt, liveOwnershipRows } from '../../src/test/fixtures/ownershipEvidence';
import type { OwnershipSnapshotOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dashboardSeed, seedApp } from '../fixtures';
import { card } from './chart-recipes';
import { dropFile } from './return-summary';

export const chartName = 'Ownership snapshot example';
export const workspace = 'Ownership snapshot fixtures';
export const tab = 'Ownership';
export const placeholder = 'Ownership snapshot source';
export const sampleName = 'ownership-register.json';
export const backendTable = 'Fictional ShareStatistics';
export const backendOrigin = 'http://127.0.0.1:17915';
export const backendPath = '/api/v1/eodhd/equity/ownership/share_statistics';
const backendId = 'ownership-fixtures';
const backendWidget = 'ownership_share_statistics_fixture';
const params = { chart_source: 'true', symbol: 'AAPL.US' };

export const waffle: OwnershipSnapshotOptions = {
  kind: 'ownership-snapshot', version: 1, issuer: 'EXAMPLE.US', view: 'waffle', fields: { bucket: 'bucket_id', share: 'reported_share' },
};
export const bars: OwnershipSnapshotOptions = {
  kind: 'ownership-snapshot', version: 1, issuer: 'AAPL.US', view: 'bars',
  fields: { ...liveOwnershipReceipt.field_origins },
};

// Both the provider-like reply and the local register are fictional acceptance fixtures.
export function backendPayload() {
  return { results: liveOwnershipRows.map(row => ({ ...row })), extra: { results_metadata: {
    chart_sources: { version: 1, receipts: [{ ...liveOwnershipReceipt, retrieved_at: liveOwnershipReceipt.retrieved_at as string }] },
  } } };
}

export function partition(issuer = 'EXAMPLE.US') {
  const bucket_keys = ['control', 'employees', 'public', 'treasury'];
  const source = { ...acquiredOwnershipPartition, issuer, raw_count: 4, normalized_count: 4, delivered_count: 4, bucket_keys };
  const rows = [33.3, 33.3, 33.39, .01].map((reported_share, i) =>
    ({ ...acquiredOwnershipRows[0], symbol: issuer, bucket_id: bucket_keys[i], reported_share }));
  return { rows, completeness: 'complete', chart_sources: { version: 1, receipts: [source] } };
}

const builtInSource = { id: 'source', widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder };
const fixtureSource = { id: 'source', widgetId: backendWidget, backendId, params, title: backendTable };

export async function chooseOwnershipSource(page: Page, name: string) {
  await page.mouse.move(360, 200);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  await card(page, chartName).getByRole('button', { name: 'Choose source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: name + ' — ' + tab });
  await dialog.getByRole('button', { name: 'Choose source', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function prepareOwnership(page: Page, {
  source = 'local', options, height = 30, response = backendPayload, empty = false,
}: { source?: 'local' | 'backend'; options?: OwnershipSnapshotOptions; height?: number; response?: () => unknown; empty?: boolean } = {}) {
  const acquisitions: URL[] = [];
  if (source === 'backend') await page.route(backendOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    const isSource = url.pathname === backendPath;
    if (isSource) acquisitions.push(url);
    const payload = isSource ? await response() : url.pathname === '/widgets.json' ? {
      [backendWidget]: {
        name: backendTable, description: 'Fictional browser acceptance reply', type: 'table', endpoint: backendPath,
        params: Object.entries(params).map(([paramName, value]) => ({ paramName, label: paramName, value, type: 'text' })),
        data: { dataKey: 'results' }, refetchInterval: false,
      },
    } : {};
    await route.fulfill({
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      status: payload instanceof Error ? 500 : 200,
      json: payload instanceof Error ? { detail: payload.message } : payload,
    });
  });
  const activeSource = { ...(source === 'local' ? builtInSource : fixtureSource), layout: { x: 0, y: height, w: 40, h: 11 } };
  const chart = { id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', title: chartName, params: {},
    linkedSource: { kind: 'widget', sourceWidgetId: 'source' },
    linkedChart: options ? { type: options.kind, recipe: options, measures: [], display: 'grouped' }
      : { type: 'column', category: 'symbol', measures: ['percent_insiders'], display: 'grouped' },
    layout: { x: 0, y: 0, w: 40, h: height } };
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: tab, id: 't1', cards: [chart, activeSource] }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify(source === 'local' ? [] : [
    { id: backendId, name: 'Fictional ownership fixtures', baseUrl: backendOrigin, authLocation: 'header', validateWidgets: false },
  ]);
  await seedApp(page, seed);
  return acquisitions;
}

export async function attachPartition(page: Page, sample = sampleName, snapshot = partition()) {
  await dropFile(page, sample, JSON.stringify(snapshot));
  await expect(card(page, sample)).toBeVisible();
  await chooseOwnershipSource(page, sample);
}
