// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect, test} from '@playwright/test';
import {seedCards} from './fixtures';

// Engine/layout proof only; actual hardware remains a separate release gate.
// Run with TAURI_ENV_PLATFORM=ios so this exercises the native build branch.
test.use({browserName: 'webkit', viewport: {width: 1024, height: 768}, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 27_2 like Mac OS X) AppleWebKit/605.1.15 Version/27.2 Mobile/15E148 Safari/604.1'});
test.skip(process.env.TAURI_ENV_PLATFORM !== 'ios', 'Native build branch: run with TAURI_ENV_PLATFORM=ios.');
test('native iPad wraps row-zero fields without horizontal overflow and opens its picker', async ({page}) => {
  await seedCards(page, [{id:'ipad-header',widgetId:'calendar_table',backendId:'b1',params:{symbol:'AAPL',trade:'T-1bd'},layout:{x:0,y:0,w:20,h:12}}]);
  const card=page.locator('.widget-card').first();
  await expect(card).toHaveAttribute('data-parameter-layout','wrap');
  const chips=card.locator('.card-chips');
  await expect(chips.locator('.param-field')).toHaveCount(2);
  const tops=await chips.locator('.param-field').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  expect(tops[1]!-tops[0]!).toBeGreaterThan(10);
  expect(await chips.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(card.locator('.card-title')).toBeVisible();
  await expect(card.getByRole('button',{name:'Refresh',exact:true})).toBeVisible();
  await chips.getByRole('button',{name:'Calendar',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
