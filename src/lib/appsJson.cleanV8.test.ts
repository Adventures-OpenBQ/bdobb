// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { decodeV3AppExtension } from './appsExtensionsV3';
import { prepareV5 } from './appsExtensionsV5';
import { exportAll, exportCompatibleApp, exportApp, importApps } from './appsJson';
import { DOCKS_ID, makeDefaultDocks } from './dashboardsFile';
import { card } from '../test/fixtures';
import { migratePivot } from './tableModel/migration';
import type { Dashboard } from './types';
function fixture(): Dashboard {
  return { id: 'd', name: 'Pinned', tabs: [
    { id: 'one', name: 'One', cards: [card({ id: 'quote', widgetId: 'quote', pinned: 'bottom' }), card({ id: 'chart', widgetId: 'chart', view: 'chart' })] },
    { id: 'two', name: 'Two', cards: [card({ id: 'news', widgetId: 'news', pinned: 'top', title: 'Wire' })] },
  ] };
}
function exported() {
  const result = exportCompatibleApp(fixture());
  if (!result.ok) throw new Error(result.issue.message);
  return JSON.parse(JSON.stringify(result.value));
}
it('exports a v8 profile around the v3 base and restores each pinned edge on its own slot', () => {
  const app = exported();
  expect(app.extensions.bdobb).toMatchObject({ schemaVersion: 1, profile: 'v8', base: { profile: 'v3', tabOrder: ['one', 'two'] }, cards: [{ tab: 'one', index: 0, pinned: 'bottom' }, { tab: 'two', index: 0, pinned: 'top' }] });
  // Never the donor's plain layout field: Workspace and older profiles see nothing.
  expect(JSON.stringify(app.tabs)).not.toContain('pinned');
  const [dashboard] = importApps([app], []).dashboards;
  expect(dashboard.tabs[0].cards.map(c => c.pinned)).toEqual(['bottom', undefined]);
  expect(dashboard.tabs[0].cards[1]).not.toHaveProperty('pinned');
  expect(dashboard.tabs[1].cards[0]).toMatchObject({ pinned: 'top', title: 'Wire' });
  expect(dashboard.tabs[0].cards[0].layout).toEqual({ x: 0, y: 0, w: 20, h: 9 });
});
it('wraps a v5 base, and through it the v4 model, without losing either', () => {
  const d: Dashboard = { id: 'd', name: 'Statements', tabs: [{ id: 't', name: 'T', cards: [card({ id: 's', widgetId: 'cash', view: 'statement', statement: { collapsed: ['Investing'] }, paramsOpen: true, pinned: 'top', tableDefinition: { table: {}, search: '', analytical: migratePivot({ enabled: false, grouping: ['region'], split: [] }) } })] }] };
  const result = exportCompatibleApp(d);
  if (!result.ok) throw new Error(result.issue.message);
  expect(result.value.extensions?.bdobb).toMatchObject({ profile: 'v8', base: { profile: 'v5', base: { profile: 'v4', base: { profile: 'v3' } } } });
  const imported = importApps(JSON.parse(JSON.stringify([result.value])), []).dashboards[0].tabs[0].cards[0];
  expect(imported).toMatchObject({ pinned: 'top', view: 'statement', statement: { collapsed: ['Investing'] }, paramsOpen: true, tableDefinition: { analytical: { enabled: false } } });
});
it('writes no v8 envelope when nothing is pinned, and the plain export never carries a pin', () => {
  const d = fixture();
  for (const tab of d.tabs) for (const c of tab.cards) delete c.pinned;
  const result = exportCompatibleApp(d);
  if (!result.ok) throw new Error(result.issue.message);
  expect(result.value.extensions?.bdobb.profile).toBe('v3');
  expect(JSON.stringify(exportApp(fixture()))).not.toContain('pinned');
});
it('older profiles refuse a v8 envelope cleanly, as v7 imports it', () => {
  const app = exported();
  // v3 is the decoder a v7 import ends at: prepareV5 and prepareV4 pass the file through untouched.
  const decoded = decodeV3AppExtension(app.extensions.bdobb, '$.extensions.bdobb');
  expect(decoded.ok).toBe(false);
  if (!decoded.ok) expect(decoded.issue.code).toBe('UNSUPPORTED_EXTENSION');
  expect(prepareV5([app]).plain).toEqual([app]);
  // A v5 envelope with a v8 base is refused by the v5 decoder before anything is allocated.
  const nested = { ...app, extensions: { bdobb: { schemaVersion: 1, profile: 'v5', base: app.extensions.bdobb, cards: [] } } };
  expect(() => importApps([nested], [])).toThrow(/UNSUPPORTED_EXTENSION/);
});
// REVIEW (C1b, user ruling 2026-10-12): these were refusals in Part A; v8 data a
// file carries that this version cannot read now degrades as the sync's Q3 does.
// Each case still proves the bad v8 data is NOT taken, and now also that the
// dashboard, every readable pin and the skip report come through.
it('skips unreadable card overlays one card at a time, imports the dashboard and reports the skip', () => {
  const cases: Array<[(app: ReturnType<typeof exported>) => void, Array<string | undefined>, number]> = [
    // [mutation, pins of [one/quote, one/chart, two/news] after import, cards skipped]
    [app => { app.extensions.bdobb.cards[0].futureState = { x: 1 }; }, [undefined, undefined, 'top'], 1],
    [app => { app.extensions.bdobb.cards[0].pinned = 'left'; }, [undefined, undefined, 'top'], 1],
    [app => { app.extensions.bdobb.cards[0].index = 5; }, [undefined, undefined, 'top'], 1],
    [app => { app.extensions.bdobb.cards[1].tab = 'nowhere'; }, ['bottom', undefined, undefined], 1],
    [app => { app.extensions.bdobb.cards.push({ ...app.extensions.bdobb.cards[0], pinned: 'top' }); }, ['bottom', undefined, 'top'], 1],
    [app => { app.extensions.bdobb.cards[0] = 'nope'; }, [undefined, undefined, 'top'], 1],
  ];
  for (const [mutate, pins, skipped] of cases) {
    const app = exported();
    mutate(app);
    const result = importApps([app], []);
    const [dashboard] = result.dashboards;
    expect(dashboard).toMatchObject({ name: 'Pinned' });
    expect(dashboard.tabs.map(t => t.name)).toEqual(['One', 'Two']);
    expect(dashboard.tabs.flatMap(t => t.cards).map(c => c.pinned)).toEqual(pins);
    for (const c of dashboard.tabs.flatMap(t => t.cards)) expect(c).not.toHaveProperty('futureState');
    expect(result.v8Skipped).toEqual([{ dashboardId: dashboard.id, all: false, cards: skipped }]);
  }
});
it('imports without any v8 state when the envelope has unknown fields or a newer schema, and says so', () => {
  const cases: Array<(app: ReturnType<typeof exported>) => void> = [
    app => { app.extensions.bdobb.futureDocks = []; },
    app => { app.extensions.bdobb.schemaVersion = 2; },
    app => { app.extensions.bdobb.cards = 'later'; },
  ];
  for (const mutate of cases) {
    const app = exported();
    mutate(app);
    const result = importApps([app], []);
    const [dashboard] = result.dashboards;
    expect(dashboard.tabs.map(t => t.name)).toEqual(['One', 'Two']);
    expect(dashboard.tabs[1].cards[0]).toMatchObject({ title: 'Wire' });
    for (const c of dashboard.tabs.flatMap(t => t.cards)) expect(c).not.toHaveProperty('pinned');
    expect(result.v8Skipped).toEqual([{ dashboardId: dashboard.id, all: true, cards: 0 }]);
  }
});
it('reports nothing skipped for a readable v8 file', () => {
  expect(importApps([exported()], [])).not.toHaveProperty('v8Skipped');
});
it('still refuses what is not v8 data: an unreadable base profile or tab order', () => {
  const cases: Array<[(app: ReturnType<typeof exported>) => void, RegExp]> = [
    [app => { app.extensions.bdobb.base = { ...app.extensions.bdobb }; }, /UNSUPPORTED_EXTENSION/],
    [app => { app.extensions.bdobb.schemaVersion = 2; app.extensions.bdobb.base = { profile: 'v9' }; }, /UNSUPPORTED_EXTENSION/],
    [app => { app.extensions.bdobb.base.tabOrder = [1]; }, /Invalid base tab order/],
  ];
  for (const [mutate, error] of cases) {
    const app = exported();
    mutate(app);
    expect(() => importApps([app], [])).toThrow(error);
  }
});
it('refuses a declared v8 accessor without invoking it', () => {
  const app = exported();
  let calls = 0;
  Object.defineProperty(app.extensions.bdobb.cards[0], 'pinned', { enumerable: true, get() { calls++; return 'top'; } });
  expect(() => importApps([app], [])).toThrow(/Invalid v8 accessor/);
  expect(calls).toBe(0);
});
it('refuses to export a stored pin that is not an edge', () => {
  const d = fixture();
  (d.tabs[0].cards[0] as { pinned?: string }).pinned = 'left';
  const result = exportCompatibleApp(d);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issue.message).toMatch(/Invalid pinned edge/);
});

const NEWS = { feeds: [{ url: 'https://a.example/feed', name: 'Wire', tab: 'Wires' }, { url: 'https://s.example/feed', name: '', tab: '' }], highlights: ['fed'], tabOrder: ['Wires'] };
function newsDashboard(): Dashboard {
  return { id: 'd', name: 'News', tabs: [{ id: 't', name: 'T', cards: [card({ id: 'rail', widgetId: 'news', backendId: 'builtin', params: { url: 'https://ticker.example' }, news: structuredClone(NEWS), pinned: 'bottom' }), card({ id: 'plain', widgetId: 'news', backendId: 'builtin' })] }] };
}
it("carries a News card's feeds in the v8 envelope, beside its pin, and never in the plain layout", () => {
  const result = exportCompatibleApp(newsDashboard());
  if (!result.ok) throw new Error(result.issue.message);
  expect(result.value.extensions?.bdobb).toMatchObject({ profile: 'v8', cards: [{ tab: 't', index: 0, pinned: 'bottom', news: NEWS }] });
  expect(JSON.stringify(result.value.tabs)).not.toContain('feeds');
  expect(JSON.stringify(exportApp(newsDashboard()))).not.toContain('feeds');
  const [rail, plain] = importApps(JSON.parse(JSON.stringify([result.value])), []).dashboards[0].tabs[0].cards;
  expect(rail).toMatchObject({ news: NEWS, pinned: 'bottom', params: { url: 'https://ticker.example' } });
  expect(plain).not.toHaveProperty('news');
});
// REVIEW (C1b): was a refusal; the card's whole v8 overlay (its News state and its pin)
// is now skipped, never part of it, and the dashboard and the other card import.
it('skips malformed News state whole, with the pin beside it, rather than importing part of it', () => {
  const bad: Array<(news: Record<string, unknown> & { feeds: Array<Record<string, unknown>> }) => void> = [
    news => { news.feeds[0].url = 'javascript:alert(1)'; },
    news => { news.feeds[0].extra = true; },
    news => { news.feeds[1].name = 7; },
    news => { news.highlights = 'fed'; },
    news => { news.tabOrder = [1]; },
    news => { news.future = []; },
    news => { (news as Record<string, unknown>).feeds = 'none'; },
  ];
  for (const mutate of bad) {
    const result = exportCompatibleApp(newsDashboard());
    if (!result.ok) throw new Error(result.issue.message);
    const app = JSON.parse(JSON.stringify(result.value));
    mutate(app.extensions.bdobb.cards[0].news);
    const imported = importApps([app], []);
    const [rail, plain] = imported.dashboards[0].tabs[0].cards;
    expect(rail).toMatchObject({ widgetId: 'news', params: { url: 'https://ticker.example' } });
    expect(rail).not.toHaveProperty('news');
    expect(rail).not.toHaveProperty('pinned');
    expect(plain).toMatchObject({ widgetId: 'news' });
    expect(imported.v8Skipped).toEqual([{ dashboardId: imported.dashboards[0].id, all: false, cards: 1 }]);
  }
});

// v8 locked widgets in the envelope (R1; donor b0cb040d, f5f4664a, 93c6662f
// carried as 5e952d3d, reshaped): app-level `docks` beside `cards`, never the
// donor's plain `dock: true` / `dockRows`.
function lockedDocks(): Dashboard {
  const d = makeDefaultDocks();
  return {
    ...d,
    dockRows: { top: 4, bottom: 10 },
    tabs: [
      { ...d.tabs[0], cards: [card({ id: 'q', widgetId: 'quote', layout: { x: 0, y: 0, w: 20, h: 4 } })] },
      { ...d.tabs[1], cards: [card({ id: 'rail', widgetId: 'news', backendId: 'builtin', news: structuredClone(NEWS) })] },
    ],
  };
}
function docksApp() {
  const result = exportCompatibleApp(lockedDocks());
  if (!result.ok) throw new Error(result.issue.message);
  return JSON.parse(JSON.stringify(result.value));
}
it('exports the docks as one app: tabs keyed by edge, `docks` with the rows beside `cards`, no plain dock fields', () => {
  const app = docksApp();
  expect(Object.keys(app.tabs).sort()).toEqual(['bottom', 'top']);
  expect(app.extensions.bdobb).toMatchObject({ schemaVersion: 1, profile: 'v8', docks: { rows: { top: 4, bottom: 10 } }, cards: [{ tab: 'bottom', index: 0, news: NEWS }] });
  expect(app).not.toHaveProperty('dock');
  expect(app).not.toHaveProperty('dockRows');
  expect(JSON.stringify(exportApp(lockedDocks()))).not.toMatch(/"dock|hidden/);
});
it('imports a docks app as THE docks, out of the dashboards, with its edges, rows and the card v8 state', () => {
  const result = importApps([exported(), docksApp()], []);
  expect(result.dashboards.map(d => d.name)).toEqual(['Pinned']);
  expect(result.docks).toMatchObject({ id: DOCKS_ID, hidden: true, dockRows: { top: 4, bottom: 10 } });
  expect(result.docks!.tabs.map(t => [t.id, t.name, t.cards.map(c => c.widgetId)])).toEqual([
    ['top', 'Locked at Top', ['quote']],
    ['bottom', 'Locked at Bottom', ['news']],
  ]);
  expect(result.docks!.tabs[1].cards[0].news).toEqual(NEWS);
  expect(result).not.toHaveProperty('v8Skipped');
});
it('an empty docks app is not a docks, and is not a dashboard either; the first docks wins', () => {
  const empty = exportCompatibleApp(makeDefaultDocks());
  if (!empty.ok) throw new Error(empty.issue.message);
  const none = importApps([JSON.parse(JSON.stringify(empty.value))], []);
  expect(none.dashboards).toEqual([]);
  expect(none).not.toHaveProperty('docks');
  const second = docksApp();
  second.tabs.top.layout = [];
  const two = importApps([docksApp(), second], []);
  expect(two.dashboards).toEqual([]);
  expect(two.docks!.tabs[0].cards).toHaveLength(1);
});
it('an out-of-range band height is clamped into 2-24 on import, and the bands still come in as the docks', () => {
  for (const [top, want] of [[30, 24], [1, 2]]) {
    const app = docksApp();
    app.extensions.bdobb.docks = { rows: { top, bottom: 8 } };
    const result = importApps([app], []);
    expect(result.docks).toMatchObject({ id: DOCKS_ID, dockRows: { top: want, bottom: 8 } });
    expect(result.dashboards).toHaveLength(0);
    expect(result.v8Skipped ?? []).toEqual([]);
  }
});
it('an unreadable docks member is skipped: the app comes in as a dashboard, and the skip says so', () => {
  for (const docks of [{ rows: { top: 6.5, bottom: 8 } }, { rows: { top: 6 } }, { rows: { top: 6, bottom: 8 }, later: true }, 'yes']) {
    const app = docksApp();
    app.extensions.bdobb.docks = docks;
    const result = importApps([app], []);
    expect(result).not.toHaveProperty('docks');
    expect(result.dashboards.map(d => d.name)).toEqual(['Locked widgets']);
    expect(result.dashboards[0].tabs[1].cards[0].news).toEqual(NEWS);
    expect(result.v8Skipped).toEqual([{ dashboardId: result.dashboards[0].id, all: false, cards: 0, docks: true }]);
  }
});
it('v3-v5 never see the docks: a v7 import stops at the v3 decoder', () => {
  const decoded = decodeV3AppExtension(docksApp().extensions.bdobb, '$.extensions.bdobb');
  expect(decoded.ok).toBe(false);
  if (!decoded.ok) expect(decoded.issue.code).toBe('UNSUPPORTED_EXTENSION');
});
it('Export all writes every dashboard then the docks, and leaves an empty docks out', () => {
  const all = exportAll([fixture(), newsDashboard()], lockedDocks());
  if (!all.ok) throw new Error(all.issue.message);
  expect(all.value.map(a => a.name)).toEqual(['Pinned', 'News', 'Locked widgets']);
  expect(all.value[2].extensions?.bdobb).toHaveProperty('docks');
  const bare = exportAll([fixture()], makeDefaultDocks());
  expect(bare.ok && bare.value.map(a => a.name)).toEqual(['Pinned']);
  const round = importApps(JSON.parse(JSON.stringify(all.value)), []);
  expect(round.dashboards.map(d => d.name)).toEqual(['Pinned', 'News']);
  expect(round.docks?.tabs[0].cards).toHaveLength(1);
});
it('Export all refuses, naming the dashboard, when one cannot be exported', () => {
  const bad = fixture();
  (bad.tabs[0].cards[0] as { pinned?: string }).pinned = 'left';
  const all = exportAll([newsDashboard(), bad], makeDefaultDocks());
  expect(all.ok).toBe(false);
  if (!all.ok) expect(all.name).toBe('Pinned');
});
