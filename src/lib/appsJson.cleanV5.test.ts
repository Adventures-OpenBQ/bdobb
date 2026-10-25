// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { exportCompatibleApp, importApps } from './appsJson';
import { card } from '../test/fixtures';
import { migratePivot } from './tableModel/migration';
import type { Dashboard } from './types';
import { fixture as templateFixture } from './statementModel/compileFixtures';
function fixture(): Dashboard {
  return { id: 'd', name: 'Statements', tabs: [{ id: 'one', name: 'One', cards: [card({ id: 'statement', widgetId: 'cash', view: 'statement', statement: { collapsed: ['Investing'] }, paramsOpen: true, tableDefinition: { table: {}, search: '', analytical: migratePivot({ enabled: false, grouping: ['region'], split: [] }) } })] }] };
}
it('exports a v5 profile and restores Statement folds with the underlying v4 model intact', () => {
  const result = exportCompatibleApp(fixture());
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.issue.message);
  expect(result.value.extensions?.bdobb.profile).toBe('v5');
  const imported = importApps([result.value], []).dashboards[0].tabs[0].cards[0];
  expect(imported).toMatchObject({ view: 'statement', statement: { collapsed: ['Investing'] }, paramsOpen: true, tableDefinition: { analytical: { enabled: false, schemaVersion: 1 } } });
  expect(imported.id).not.toBe('statement');
});
it('refuses unknown Statement state instead of silently dropping it', () => {
  const result = exportCompatibleApp(fixture());
  if (!result.ok) throw new Error(result.issue.message);
  const app = JSON.parse(JSON.stringify(result.value));
  app.extensions.bdobb.cards[0].statement.futureState = true;
  expect(() => importApps([app], [])).toThrow(/Unknown v5|Invalid Statement/);
});
it('refuses duplicate portable Statement slots and future base profiles', () => {
  const result = exportCompatibleApp(fixture()); if (!result.ok) throw new Error(result.issue.message);
  const app = JSON.parse(JSON.stringify(result.value));
  app.extensions.bdobb.cards.push(app.extensions.bdobb.cards[0]);
  expect(() => importApps([app], [])).toThrow(/duplicate/i);
  const future = JSON.parse(JSON.stringify(result.value)); future.extensions.bdobb.base.profile = 'v6';
  expect(() => importApps([future], [])).toThrow(/UNSUPPORTED_EXTENSION/);
});
it('imports the published synthetic Q3/TTM Statement demo through the actual compatible codec', async () => {
  const { readFileSync } = await import('node:fs');
  const apps = JSON.parse(readFileSync(`${process.cwd()}/docs/examples/v5-financial-demo/apps.json`, 'utf8'));
  const { dashboards } = importApps(apps, []);
  expect(dashboards[0].tabs[0].cards[0]).toMatchObject({ widgetId: 'synthetic_cash_flow', view: 'statement', statement: { collapsed: [] } });
  const rows = JSON.parse(readFileSync(`${process.cwd()}/docs/examples/v5-financial-demo/cash-flow.json`, 'utf8'));
  const { statementRows } = await import('./statementRows');
  expect(statementRows(rows)?.rows).toEqual(expect.arrayContaining([expect.objectContaining({ 'Line item': 'Capital Expenditure', 'FY2026-TTM': -18 })]));
});

it('round-trips pinned v4 templates and stable v5 folds together, remapping linked card identities', () => {
  const f = templateFixture();
  const section = f.statement.template.sections[0];
  const producer = card({ id: 'private-template-source', widgetId: 'prices', params: {}, view: 'statement',
    statement: { collapsed: [section.id] }, tableDefinition: { table: {}, search: '', analytical: f.statement } });
  const child = card({ id: 'private-template-child', widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: producer.id }, view: 'statement' });
  const dashboard: Dashboard = { id: 'private-template-dashboard', name: 'Pinned Statements', tabs: [{ id: 'main', name: 'Main', cards: [producer, child] }] };
  const exported = exportCompatibleApp(dashboard);
  expect(exported.ok).toBe(true); if (!exported.ok) throw new Error(exported.issue.message);
  const text = JSON.stringify(exported.value);
  expect(text).not.toContain('private-template-source');
  expect(text).not.toContain('private-template-child');
  const imported = importApps(JSON.parse(`[${text}]`), []).dashboards[0].tabs[0].cards;
  expect(imported[0].tableDefinition?.analytical).toEqual(f.statement);
  expect(imported[0].statement).toEqual({ collapsed: [section.id] });
  expect(imported[1].linkedSource?.sourceWidgetId).toBe(imported[0].id);
  expect(imported[1].view).toBe('statement');
});

it('refuses declared v5 fold accessors without invoking them', () => {
  const result = exportCompatibleApp(fixture()); if (!result.ok) throw new Error(result.issue.message);
  const app = JSON.parse(JSON.stringify(result.value));
  let calls = 0;
  Object.defineProperty(app.extensions.bdobb.cards[0].statement, 'collapsed', {
    enumerable: true, get() { calls++; throw new Error('Accessor executed'); },
  });
  expect(() => importApps([app], [])).toThrow(/Invalid v5 accessor/);
  expect(calls).toBe(0);
});
