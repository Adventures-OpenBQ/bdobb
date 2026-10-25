// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { exportCompatibleApp, importApps } from './appsJson';
import { card } from '../test/fixtures';
import { migratePivot } from './tableModel/migration';
import type { Dashboard } from './types';
it('v4 portable exports retain analytical definitions, links and fiscal/dock/calendar choices with fresh card identities', () => {
  const analytical = migratePivot({ enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } });
  const producer = card({ id: 'private-source', widgetId: 'prices', tableDefinition: { table: {}, search: '', analytical }, tableSelection: { kind: 'allMatching', excludedIds: [] }, fiscalYearEnd: 9, hideTitleParams: true, paramsOpen: true, calendar: { mode: 'paged', cursor: '2026-10-06' } });
  const linked = card({ id: 'private-child', widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: producer.id } });
  const dashboard: Dashboard = { id: 'private-dashboard', name: 'Portable', tabs: [{ id: 't', name: 'Main', cards: [producer, linked] }] };
  const result = exportCompatibleApp(dashboard);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issue.message);
  const text = JSON.stringify(result.value);
  expect(text).not.toContain('private-source');
  expect(text).not.toContain('private-child');
  const reopened = importApps(JSON.parse(`[${text}]`), []).dashboards[0];
  const [source, child] = reopened.tabs[0].cards;
  expect(source.id).not.toBe(producer.id);
  expect(source).toMatchObject({ tableDefinition: producer.tableDefinition, tableSelection: producer.tableSelection, fiscalYearEnd: 9, hideTitleParams: true, paramsOpen: true, calendar: producer.calendar });
  expect(child.linkedSource?.sourceWidgetId).toBe(source.id);
});
it('the v4 import boundary refuses unknown profiles before producing a write plan', () => {
  expect(() => importApps([{ name: 'Bad', tabs: { t: { name: 'Main', layout: [] } }, extensions: { bdobb: { schemaVersion: 1, profile: 'v999' } } }], [])).toThrow(/UNSUPPORTED_EXTENSION/);
});

it('v4 rejects missing/duplicate portable identities and unknown card state', () => {
  const dashboard: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ paramsOpen: true })] }] };
  const exported = exportCompatibleApp(dashboard);
  if (!exported.ok) throw new Error(exported.issue.message);
  const bad = JSON.parse(JSON.stringify(exported.value));
  bad.extensions.bdobb.cards.push(bad.extensions.bdobb.cards[0]);
  expect(() => importApps([bad], [])).toThrow(/duplicate card reference/i);
  const unknown = JSON.parse(JSON.stringify(exported.value));
  unknown.extensions.bdobb.cards[0].extras.futureSecret = 'no';
  expect(() => importApps([unknown], [])).toThrow(/Unknown v4/);
});
it('v4 refuses a foreign linked source rather than export an unrepairable relationship', () => {
  const d: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ linkedSource: { kind: 'widget', sourceWidgetId: 'foreign' } })] }] };
  const result = exportCompatibleApp(d);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issue.message).toMatch(/outside this dashboard/);
});
it('reference pivot-v1 layout overlays import as the in-thread pivot their backend table runs (D-007)', () => {
  // User-approved assertion change 2026-10-08 (D-007): this asserted a worker
  // tableDefinition.analytical, which a backend table never executes.
  const imported = importApps([{ name: 'Reference', tabs: { t: { name: 'T', layout: [{ i: 'prices', x: 0, y: 0, w: 10, h: 8, extensions: { bdobb: { version: 1, profile: 'pivot-v1', pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } } } } }] } } }], []).dashboards[0];
  expect(imported.tabs[0].cards[0].table?.pivot).toEqual({ enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } });
  expect(imported.tabs[0].cards[0].tableDefinition?.analytical).toBeUndefined();
});

it('v4 accepts omitted optional chart fields and refuses malformed chart/calendar settings', () => {
  const d: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ linkedChart: { type: 'line', display: 'grouped', category: undefined, measures: ['revenue'] }, paramsOpen: true })] }] };
  const exported = exportCompatibleApp(d);
  expect(exported.ok).toBe(true);
  if (!exported.ok) throw new Error(exported.issue.message);
  for (const invalid of [{ linkedChart: { type: 'unknown', display: 'grouped', measures: [] } }, { calendar: { businessDays: [0, 8] } }, { calendar: { cursor: 'not-a-date' } }, { calendar: { mode: 'future' } }, { calendar: { future: true } }]) {
    const bad = structuredClone(exported.value);
    Object.assign((bad.extensions!.bdobb as { cards: Array<{ extras: object }> }).cards[0].extras, invalid);
    expect(() => importApps([bad], [])).toThrow(/Invalid|Unknown/);
  }
});
it('links across tabs with repeated widget ids retain their exact portable source', () => {
  const a = card({ id: 'a', widgetId: 'prices', paramsOpen: true });
  const b = card({ id: 'b', widgetId: 'prices' });
  const child = card({ id: 'child', widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: b.id } });
  const d: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 'one', name: 'One', cards: [a] }, { id: 'two', name: 'Two', cards: [b, child] }] };
  const exported = exportCompatibleApp(d);
  if (!exported.ok) throw new Error(exported.issue.message);
  const reopened = importApps([exported.value], []).dashboards[0];
  expect(reopened.tabs[1].cards[1].linkedSource?.sourceWidgetId).toBe(reopened.tabs[1].cards[0].id);
  expect(reopened.tabs[1].cards[1].linkedSource?.sourceWidgetId).not.toBe(reopened.tabs[0].cards[0].id);
});

it('v4 refuses a future analytical schema before import allocation', () => {
  const d: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ tableDefinition: { table: {}, search: '', analytical: migratePivot({ enabled: true, grouping: [], split: [] }) } })] }] };
  const exported = exportCompatibleApp(d);
  if (!exported.ok) throw new Error(exported.issue.message);
  const bad = JSON.parse(JSON.stringify(exported.value));
  bad.extensions.bdobb.cards[0].extras.tableDefinition.analytical.schemaVersion = 44;
  expect(() => importApps([bad], [])).toThrow(/Unsupported analytical schema/);
});

it('V4-004: a linked table whose source is a backend card survives compatible export and re-import with the identity remapped', async () => {
  const { createTableExecutionStore } = await import('../stores/tableExecutionStore');
  const backend = card({ id: 'backend-root', widgetId: 'income', backendId: 'b1' });
  const linked = card({ id: 'linked-child', widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: backend.id } });
  const result = exportCompatibleApp({ id: 'd', name: 'V4-004', tabs: [{ id: 't', name: 'Main', cards: [backend, linked] }] });
  if (!result.ok) throw new Error(result.issue.message);
  expect(result.value.extensions?.bdobb.profile).toBe('v4');
  expect(JSON.stringify(result.value)).not.toContain('backend-root');
  const reopened = importApps(JSON.parse(JSON.stringify([result.value])), []).dashboards[0];
  const [source, child] = reopened.tabs[0].cards;
  expect(source.widgetId).toBe('income');
  expect(source.id).not.toBe(backend.id);
  expect(child.linkedSource).toEqual({ kind: 'widget', sourceWidgetId: source.id });
  // The remapped link resolves to the imported card: not "Unknown source" (#21).
  const store = createTableExecutionStore({ executor: () => { throw Error(); }, source: () => undefined });
  store.syncDashboard(reopened);
  store.ensureTable(reopened.id, child.id);
  expect(store.readView(reopened.id, child.id).error).toContain(`Card ${source.id} cannot feed a linked table`);
});
it('managed source references and linked definitions round trip without transient provider state',()=>{
 const source=card({id:'managed-root',widgetId:'managed',managedSource:{sourceId:'durable-source',version:1,kind:'upload'},tableDefinition:{table:{},search:'saved'},tableSelection:{kind:'allMatching',excludedIds:['r204']}});
 const child=card({id:'child',widgetId:'linked_table',linkedSource:{kind:'widget',sourceWidgetId:source.id}});
 const exported=exportCompatibleApp({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[source,child]}]});
 expect(exported.ok).toBe(true);if(!exported.ok)throw new Error(exported.issue.message);
 const [a,b]=importApps([exported.value],[]).dashboards[0].tabs[0].cards;
 expect(a.managedSource).toEqual(source.managedSource);expect(a.tableDefinition).toEqual(source.tableDefinition);expect(b.linkedSource?.sourceWidgetId).toBe(a.id);
 const malformed=structuredClone(exported.value);
 Object.assign((malformed.extensions!.bdobb as {cards:Array<{extras:Record<string,unknown>}>}).cards[0].extras,{managedSource:{...source.managedSource,sessionId:'transient',token:'secret'}});
 expect(()=>importApps([malformed],[])).toThrow(/Unknown|source/);
});
it('a Workspace-synced card with a v4 field still exports in the BDOBB format', () => {
  // Cards pulled from a Workspace server carry extensions.workspace; docking Parameters open sets paramsOpen.
  const extensions = { workspace: { widget: { id: 'x' }, layout: {}, params: { symbol: 'AAPL' } } };
  for (const extra of [{ paramsOpen: true }, { fiscalYearEnd: 9 }]) {
    const dashboard: Dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ id: 'c1', extensions, ...extra })] }] };
    expect(exportCompatibleApp(dashboard)).toMatchObject({ ok: true });
  }
});
