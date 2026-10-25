// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
/* global window */
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
const base = 'http://127.0.0.1:7780';
const ids = ['markdown_widget_with_short_refetch_interval', 'markdown_widget_with_run_button'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const counts = Object.fromEntries(ids.map(id => [id, 0]));
  const completed = Object.fromEntries(ids.map(id => [id, 0]));
  page.on('request', request => {
    const id = new URL(request.url()).pathname.slice(1);
    if (Object.hasOwn(counts, id)) counts[id]++;
  });
  page.on('response', response => {
    const id = new URL(response.url()).pathname.slice(1);
    if (Object.hasOwn(completed, id) && response.ok()) completed[id]++;
  });
  await page.route(`${base}/**`, async route => {
    try {
      const response = await route.fetch();
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin':'*'}});
    } catch {
      // StrictMode can cancel startup fetches. Failed transport still cannot
      // pass the successful-response assertions below.
      await route.abort().catch(() => {});
    }
  });
  const files = {
    'settings.json': '{}',
    'backends.json': JSON.stringify([{id:'reference', name:'Reference', baseUrl:base, authLocation:'header', validateWidgets:true}]),
    'dashboards/controls.json': JSON.stringify({id:'controls', name:'Reference controls', tabs:[{id:'main', name:'Main', cards:ids.map((widgetId, index) => ({id:`card-${index}`, widgetId, backendId:'reference', params:{}, layout:{x:index*20,y:0,w:20,h:12}}))}]}),
  };
  await page.addInitScript(seed => {window.__bdobbSeed = seed;}, files);
  await page.goto(`http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}/`);
  for (const id of ids) await expect.poll(() => completed[id]).toBeGreaterThanOrEqual(1);
  // Browser-mode development mounts may issue initial requests twice under StrictMode.
  // Measure polling only after startup discovery and responses have settled.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  const initial = {...counts};
  const initialCompleted = {...completed};
  await page.waitForTimeout(6500);
  expect(counts[ids[0]]).toBeGreaterThan(initial[ids[0]]);
  await expect.poll(() => completed[ids[0]]).toBeGreaterThan(initialCompleted[ids[0]]);
  expect(counts[ids[1]]).toBe(initial[ids[1]]);
  await page.getByRole('button', {name:'Run', exact:true}).click();
  await expect.poll(() => counts[ids[1]]).toBe(initial[ids[1]] + 1);
  await expect.poll(() => completed[ids[1]]).toBeGreaterThan(initialCompleted[ids[1]]);
  fs.mkdirSync('e2e-results', {recursive:true});
  fs.writeFileSync('e2e-results/reference-controls.json', JSON.stringify({numericRefreshMs:5000, initial, after:counts, initialCompleted, completed, runDoesNotPoll:true, cron:'deferred'}, null, 2));
  await page.unrouteAll({behavior:'ignoreErrors'});
  console.log('PASS reference numeric refresh and Run request gating', counts);
} finally {
  await browser.close();
}
