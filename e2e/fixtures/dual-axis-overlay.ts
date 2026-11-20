// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type overlaySnapshots from '../../src/test/fixtures/overlaySnapshots.json';
import type { DualAxisOverlayOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dashboardSeed, isDiscoveryRequest, seedApp } from '../fixtures';
import { card } from './chart-recipes';
import { dropFile } from './return-summary';

export const workspace = 'Overlay fixtures';
export const tab = 'Historical overlays';
export const chartName = 'Historical comparison';
export const placeholder = 'Overlay snapshot source';
export const sampleName = 'prepared.json';

export const priceRecipe: DualAxisOverlayOptions = {
  kind: 'dual-axis-overlay', version: 1, recipe: 'price-eps',
  fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at', targetStart: 'target_start', targetEnd: 'target_end' },
};
export const macroRecipe: DualAxisOverlayOptions = {
  kind: 'dual-axis-overlay', version: 1, recipe: 'cpi-ten-year',
  fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at' },
};
export const prepared = JSON.parse(readFileSync(new URL('../../src/test/fixtures/overlaySnapshots.json', import.meta.url), 'utf8')) as typeof overlaySnapshots;

export async function seedOverlay(page: Page, options?: DualAxisOverlayOptions, empty = false) {
  const cards = [
    { id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', title: chartName, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: 'source' },
      linkedChart: { type: options?.kind ?? 'column', recipe: options, measures: [], display: 'grouped' },
      layout: { x: 0, y: 0, w: 36, h: 32 } },
    { id: 'source', widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder,
      layout: { x: 0, y: 32, w: 36, h: 12 } },
  ];
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: tab, id: 't1', cards }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify([]);
  await seedApp(page, seed);
}

export function dataRequests(page: Page, appURL: string) {
  const origin = new URL(appURL).origin;
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const wasm = url.origin === origin && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(url.pathname);
    if (!wasm && (url.origin !== origin || url.pathname.startsWith('/api/')
      || ['xhr', 'fetch'].includes(request.resourceType())) && !isDiscoveryRequest(request.url())) requests.push(url.href);
  });
  return requests;
}

export async function chooseOverlaySource(page: Page, name: string) {
  await page.mouse.move(360, 200);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  await card(page, chartName).getByRole('button', { name: 'Choose source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: name + ' — ' + tab });
  await dialog.getByRole('button', { name: 'Choose source', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function attachOverlay(page: Page, content: unknown, name = sampleName) {
  await dropFile(page, name, JSON.stringify(content));
  await expect(card(page, name)).toBeVisible();
  await chooseOverlaySource(page, name);
}
