// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { defaultSeed, openRail, seedApp } from '../fixtures';

export const example = readFileSync('docs/examples/v9-chart-expansion.apps.json', 'utf8');
const origin = 'http://127.0.0.1:17909';
export const names = ['Drawdown', 'Yield curve', 'Monthly returns', 'Daily return correlation', 'Estimate ranges', 'Earnings versus estimates', 'Income statement bridge'];

export function fixture(name: string) {
  return readFileSync('docs/examples/v9-chart-expansion/' + name + '.json', 'utf8');
}
export const card = (page: Page, name: string) => page.locator('.widget-card').filter({ has: page.locator('.card-title', { hasText: name }) });
export const plot = (page: Page, name: string) => card(page, name).locator('.js-plotly-plot');

export async function openParameters(widget: Locator) {
  const show = widget.getByRole('button', { name: 'Show parameters', exact: true });
  if (await show.isVisible()) await show.click();
  const panel = widget.getByRole('region', { name: 'Parameters', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

export async function chooseLinkedSource(page: Page, widget: Locator, label: string) {
  await page.mouse.move(360, 200);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  const closed = await widget.getByRole('button', { name: 'Show parameters', exact: true }).isVisible();
  const parameters = await openParameters(widget);
  await parameters.getByRole('button', { name: 'Choose source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label });
  await dialog.getByRole('button', { name: 'Choose source', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  if (closed) await widget.getByRole('button', { name: 'Hide parameters', exact: true }).click();
}

export async function captureParameters(widget: Locator, field: string, outputPath: (filename: string) => string) {
  const graph = widget.locator('.card-body .js-plotly-plot');
  await expect(graph).toBeVisible();
  await expect(widget.getByRole('region', { name: 'Parameters' })).toHaveCount(0);
  const control = (scope: Locator) => scope.getByRole('combobox', { name: field, exact: true })
    .or(scope.getByRole('spinbutton', { name: field, exact: true }));
  await expect(control(widget)).toBeHidden();
  await widget.screenshot({ path: outputPath('parameters-closed.png') });
  const panel = await openParameters(widget);
  await expect(panel.getByRole('button', { name: 'Choose source', exact: true })).toBeFocused();
  await expect(control(panel)).toBeVisible();
  await expect(graph).toBeVisible();
  await widget.screenshot({ path: outputPath('parameters-open.png') });
  await widget.getByRole('button', { name: 'Hide parameters', exact: true }).click();
  await expect(graph).toBeVisible();
}

export async function refuseQueuedChartApplyAfterResize(page: Page, widget: Locator, probe: Locator) {
  const apply = widget.getByRole('button', { name: 'Apply chart settings', exact: true });
  await expect(apply).toBeEnabled();
  const width = (await probe.boundingBox())!.width;
  const initial = page.viewportSize()!;
  type Gate = Window & { releaseChartSave?: () => void };
  await page.evaluate(async (storePath) => {
    const { useDashboardStore }: typeof import('../../src/stores/dashboardStore') = await import(storePath);
    const commit = useDashboardStore.getState().commitLinkedChartSettings;
    const gate = window as Gate;
    const pending = new Promise<void>(resolve => { gate.releaseChartSave = resolve; });
    useDashboardStore.setState({
      commitLinkedChartSettings: async (...args) => {
        useDashboardStore.setState({ commitLinkedChartSettings: commit });
        await pending;
        return commit(...args);
      },
    });
  }, '/src/stores/dashboardStore.ts');
  try {
    await apply.click();
    await expect(apply).toBeDisabled();
    await page.setViewportSize({ width: initial.width - 120, height: initial.height });
    await expect.poll(async () => (await probe.boundingBox())!.width).toBeLessThan(width);
    await page.evaluate(() => (window as Gate).releaseChartSave?.());
    await expect(widget.getByRole('alert')).toContainText('source or drawing size changed');
  } finally {
    await page.evaluate(() => {
      const gate = window as Gate;
      gate.releaseChartSave?.();
      delete gate.releaseChartSave;
    });
    await page.setViewportSize(initial);
  }
  await expect.poll(async () => (await probe.boundingBox())!.width).toBe(width);
  await expect(apply).toBeEnabled();
}

export async function importExample(page: Page, manifest = example) {
  const overrides = new Map<string, { body: string; status?: number; }>();
  await page.route(origin + '/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const override = overrides.get(path);
    const name = /^(widgets|prices|curves|estimates|income)\.json$/.exec(path)?.[1];
    return route.fulfill({
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: override?.body ?? (name ? fixture(name) : '{}'), status: override?.status ?? (name || !path ? 200 : 404),
    });
  });
  const seed = defaultSeed();
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify([{ id: 'demo', name: 'Chart examples', baseUrl: origin, authLocation: 'header', validateWidgets: false }]);
  seed['imports/apps.json'] = manifest;
  await seedApp(page, seed);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    const file = await page.evaluateHandle(text => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'charts.apps.json', { type: 'application/json' }));
      return transfer;
    }, manifest);
    await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: file });
    await file.dispose();
  } else {
    await openRail(page);
    await page.locator('[data-testid="rail-section-label"]', { hasText: 'My Dashboards' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Import apps.json…' }).click();
  }
  await expect(page.getByRole('tab', { name: 'Charts and sources' })).toBeVisible();
  await page.mouse.move(740, 360);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  return overrides;
}
