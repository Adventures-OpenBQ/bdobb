// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/dashboardsFile', async () => {
  const actual = await vi.importActual<typeof import('../lib/dashboardsFile')>('../lib/dashboardsFile');
  return { ...actual, saveDashboard: vi.fn(actual.saveDashboard) };
});
import { saveDashboard } from '../lib/dashboardsFile';
import { __reset, __failPath, __read } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { saveLocalFile, readLocalFile } from '../lib/localFiles';
import { widget } from '../test/fixtures';
import { useDashboardStore } from './dashboardStore';

beforeEach(() => {
  __reset(); __resetJsonStoreForTests();
  useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, viewer: false, pendingCardRemoval: null });
});
async function local() {
  await useDashboardStore.getState().load();
  const file = await saveLocalFile(new File(['value\n42'], 'data.csv'));
  const id = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file }))!;
  return { id, file, dashboard: useDashboardStore.getState().activeDashboard()! };
}
it('deleteUndoRestoresReadableFile and original identity after changing active dashboard', async () => {
  const { id, file, dashboard } = await local();
  await useDashboardStore.getState().removeCard(id);
  expect(new TextDecoder().decode(await readLocalFile(file))).toBe('value\n42');
  await useDashboardStore.getState().addDashboard('Other');
  await useDashboardStore.getState().undoCardRemoval();
  const restored = useDashboardStore.getState().dashboards.find(d => d.id === dashboard.id)!;
  expect(restored.tabs[0].cards[0]).toEqual(dashboard.tabs[0].cards[0]);
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
});
it('failed durable removal keeps card and does not announce undo', async () => {
  const { id, dashboard } = await local();
  __failPath(`dashboards/${dashboard.id}.json`);
  await expect(useDashboardStore.getState().removeCard(id)).rejects.toThrow();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].id).toBe(id);
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
});
it('failed durable restoration retains pending entry and bytes', async () => {
  const { id, file, dashboard } = await local();
  await useDashboardStore.getState().removeCard(id);
  __failPath(`dashboards/${dashboard.id}.json`);
  await expect(useDashboardStore.getState().undoCardRemoval()).rejects.toThrow();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(0);
  expect(useDashboardStore.getState().pendingCardRemoval?.card.id).toBe(id);
  expect(await readLocalFile(file)).toBeInstanceOf(Uint8Array);
});
it('dismiss cleans bytes only when no surviving duplicate owns them', async () => {
  const { id, file, dashboard } = await local();
  const copy = (await useDashboardStore.getState().duplicateDashboard(dashboard.id))!;
  useDashboardStore.getState().setActive(dashboard.id);
  await useDashboardStore.getState().removeCard(id);
  await useDashboardStore.getState().dismissCardRemoval();
  expect(await readLocalFile(file)).toBeInstanceOf(Uint8Array);
  await useDashboardStore.getState().removeDashboard(copy);
  await expect(readLocalFile(file)).rejects.toThrow();
});
it('dashboardDuplicationRemapsWidgetOwners across tabs without mutating source', async () => {
  const { id, dashboard } = await local();
  const child = { ...dashboard.tabs[0].cards[0], id: 'child', linkedSource: { kind: 'widget' as const, sourceWidgetId: id } };
  useDashboardStore.setState({ dashboards: [{ ...dashboard, tabs: [...dashboard.tabs, { id: 'other-tab', name: 'Other', cards: [child] }] }] });
  await useDashboardStore.getState().duplicateDashboard(dashboard.id);
  const copy = useDashboardStore.getState().activeDashboard()!;
  expect(copy.tabs[1].cards[0].linkedSource?.sourceWidgetId).toBe(copy.tabs[0].cards[0].id);
  expect(child.linkedSource.sourceWidgetId).toBe(id);
});
it('removing original tab releases pending file', async () => {
  const { id, file, dashboard } = await local();
  await useDashboardStore.getState().removeCard(id);
  await useDashboardStore.getState().removeTab(dashboard.tabs[0].id);
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
  await expect(readLocalFile(file)).rejects.toThrow();
});
it('commitTableDefinition persists symbolic selection with no optimistic success on failure', async () => {
  const { id, dashboard } = await local();
  const definition = { table: { hidden: ['value'] }, search: '42' };
  const selection = { kind: 'allMatching' as const, excludedIds: ['r0'] };
  await useDashboardStore.getState().commitTableDefinition(dashboard.id, id, definition, selection);
  const committed = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];
  expect(committed.tableDefinition).toEqual(definition); expect(committed.tableSelection).toEqual(selection);
  __failPath(`dashboards/${dashboard.id}.json`);
  await expect(useDashboardStore.getState().commitTableDefinition(dashboard.id, id, { table: {}, search: 'other' }, { kind: 'none' })).rejects.toThrow();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].tableDefinition).toEqual(definition);
});
it('next deletion releases the previous entry and keeps only newest bytes', async () => {
  const { id, file } = await local();
  const newer = await saveLocalFile(new File(['x\n1'], 'new.csv'));
  const next = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: newer }))!;
  await useDashboardStore.getState().removeCard(id); await useDashboardStore.getState().removeCard(next);
  await expect(readLocalFile(file)).rejects.toThrow();
  expect(await readLocalFile(newer)).toBeInstanceOf(Uint8Array);
  expect(useDashboardStore.getState().pendingCardRemoval?.card.id).toBe(next);
});
it('viewer cannot remove, undo or dismiss cards', async () => {
  const { id, file } = await local();
  await useDashboardStore.getState().removeCard(id);
  useDashboardStore.setState({ viewer: true });
  await useDashboardStore.getState().undoCardRemoval(); await useDashboardStore.getState().dismissCardRemoval();
  expect(useDashboardStore.getState().pendingCardRemoval?.card.id).toBe(id);
  expect(await readLocalFile(file)).toBeInstanceOf(Uint8Array);
});
it('concurrent removals retain only the latest durable deletion and Undo restores it', async () => {
  const { id, file } = await local();
  const newer = await saveLocalFile(new File(['x\n1'], 'new.csv'));
  const next = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: newer }))!;
  await Promise.all([useDashboardStore.getState().removeCard(id), useDashboardStore.getState().removeCard(next)]);
  const durable = JSON.parse(__read(`dashboards/${useDashboardStore.getState().activeId}.json`)!);
  expect(durable.tabs[0].cards).toHaveLength(0);
  await useDashboardStore.getState().undoCardRemoval();
  const cards = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
  expect(cards.map(c => c.id)).toEqual([next]);
  __resetJsonStoreForTests(); await useDashboardStore.getState().load();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.map(c => c.id)).toEqual([next]);
  await expect(readLocalFile(file)).rejects.toThrow();
});
it('removal keeps the original dashboard scope when navigation changes immediately', async () => {
  const { id, dashboard } = await local();
  const other = (await useDashboardStore.getState().addDashboard('Other'))!;
  useDashboardStore.getState().setActive(dashboard.id);
  const removing = useDashboardStore.getState().removeCard(id);
  useDashboardStore.getState().setActive(other);
  await removing;
  expect(useDashboardStore.getState().pendingCardRemoval?.dashboardId).toBe(dashboard.id);
  expect(useDashboardStore.getState().dashboards.find(d => d.id === dashboard.id)!.tabs[0].cards).toHaveLength(0);
});

it('optimistic edits during delayed durable deletion preserve the edit and never resurrect source on disk', async () => {
  const { id, dashboard } = await local();
  const other = (await useDashboardStore.getState().addCard(widget({ id: 'ordinary' })))!;
  const actual = await vi.importActual<typeof import('../lib/dashboardsFile')>('../lib/dashboardsFile');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(saveDashboard).mockImplementationOnce(async d => { entered(); await gate; await actual.saveDashboard(d); });
  const removing = useDashboardStore.getState().removeCard(id); await started;
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.some(c => c.id === id)).toBe(true);
  const editing = useDashboardStore.getState().patchCardField(other, 'title', 'Keep this edit');
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find(c => c.id === other)?.title).toBe('Keep this edit');
  release(); await Promise.all([removing, editing]);
  const disk = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(disk.tabs[0].cards.map((c: { id: string }) => c.id)).toEqual([other]);
  expect(disk.tabs[0].cards[0].title).toBe('Keep this edit');
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].title).toBe('Keep this edit');
});
it.each(['remove', 'undo'] as const)('failed durable %s during another card edit preserves both ownership and that edit', async operation => {
  const { id, dashboard } = await local();
  const other = (await useDashboardStore.getState().addCard(widget({ id: 'ordinary' })))!;
  if (operation === 'undo') await useDashboardStore.getState().removeCard(id);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(saveDashboard).mockImplementationOnce(async () => { entered(); await gate; throw Error('durable write failed'); });
  const failing = (operation === 'remove' ? useDashboardStore.getState().removeCard(id) : useDashboardStore.getState().undoCardRemoval()).catch(error => error);
  await started;
  const editing = useDashboardStore.getState().patchCardField(other, 'title', 'Preserved');
  release(); expect(await failing).toBeInstanceOf(Error); await editing;
  const disk = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(disk.tabs[0].cards.some((c: { id: string }) => c.id === id)).toBe(operation === 'remove');
  expect(disk.tabs[0].cards.find((c: { id: string }) => c.id === other).title).toBe('Preserved');
  expect(useDashboardStore.getState().pendingCardRemoval?.card.id).toBe(operation === 'undo' ? id : undefined);
});

/** Delay a real durable write's completion, with optional delay before I/O. */
async function delayNextSave(beforeWrite = false, failWrite = false) {
  const actual = await vi.importActual<typeof import('../lib/dashboardsFile')>('../lib/dashboardsFile');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(saveDashboard).mockImplementationOnce(async d => {
    if (!beforeWrite) await actual.saveDashboard(d);
    entered(); await gate;
    if (failWrite) throw Error('durable write failed');
    if (beforeWrite) await actual.saveDashboard(d);
  });
  return { started, release };
}
it.each(['remove', 'undo'] as const)('dashboard rename during delayed %s preserves the committed card lifecycle on disk', async operation => {
  const { id, dashboard } = await local();
  if (operation === 'undo') await useDashboardStore.getState().removeCard(id);
  const delay = await delayNextSave();
  const change = operation === 'remove' ? useDashboardStore.getState().removeCard(id) : useDashboardStore.getState().undoCardRemoval();
  await delay.started;
  const renaming = useDashboardStore.getState().renameDashboard(dashboard.id, 'Renamed during lifecycle');
  delay.release(); await Promise.all([change, renaming]);
  const memory = useDashboardStore.getState().dashboards.find(d => d.id === dashboard.id)!;
  const disk = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(memory.name).toBe('Renamed during lifecycle'); expect(disk.name).toBe('Renamed during lifecycle');
  expect(memory.tabs[0].cards.some(c => c.id === id)).toBe(operation === 'undo');
  expect(disk.tabs[0].cards.some((c: { id: string }) => c.id === id)).toBe(operation === 'undo');
});
it('dashboard removal concurrent with delayed rename cannot resurrect its owner file', async () => {
  const { dashboard } = await local();
  const delay = await delayNextSave(true);
  const renaming = useDashboardStore.getState().renameDashboard(dashboard.id, 'Renamed'); await delay.started;
  const removing = useDashboardStore.getState().removeDashboard(dashboard.id);
  // Let removal enter its queue before permitting the delayed rename write.
  await Promise.resolve(); delay.release(); await Promise.all([renaming, removing]);
  expect(useDashboardStore.getState().dashboards.some(d => d.id === dashboard.id)).toBe(false);
  expect(__read(`dashboards/${dashboard.id}.json`)).toBeUndefined();
});
it('failed duplicate owner tab removal followed by Dismiss preserves durably owned file bytes', async () => {
  const { id, file, dashboard } = await local();
  const copyId = (await useDashboardStore.getState().duplicateDashboard(dashboard.id))!;
  const copyTabId = useDashboardStore.getState().activeDashboard()!.tabs[0].id;
  useDashboardStore.getState().setActive(dashboard.id); await useDashboardStore.getState().removeCard(id);
  useDashboardStore.getState().setActive(copyId); __failPath(`dashboards/${copyId}.json`);
  await expect(useDashboardStore.getState().removeTab(copyTabId)).rejects.toThrow();
  await useDashboardStore.getState().dismissCardRemoval();
  const durable = JSON.parse(__read(`dashboards/${copyId}.json`)!);
  expect(durable.tabs[0].cards[0].params.file).toBe(file);
  expect(new TextDecoder().decode(await readLocalFile(file))).toBe('value\n42');
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].params.file).toBe(file);
});

it.each([false, true])('delayed tab removal (failure=%s) retains owners until success and preserves other-tab edits', async failWrite => {
  const { dashboard } = await local();
  const originalTabId = dashboard.tabs[0].id;
  const otherTabId = (await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, 'Other'))!;
  useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, otherTabId);
  const other = (await useDashboardStore.getState().addCard(widget({ id: 'ordinary' })))!;
  useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, originalTabId);
  const delay = await delayNextSave(true, failWrite);
  const deleting = useDashboardStore.getState().removeTab(originalTabId).catch(error => error);
  await delay.started;
  const before = useDashboardStore.getState().activeDashboard()!;
  const editing = useDashboardStore.getState().patchCardField(other, 'title', 'Other tab edit');
  delay.release(); const result = await deleting; await editing;
  expect(before.tabs.some(t => t.id === originalTabId)).toBe(true);
  if (failWrite) expect(result).toBeInstanceOf(Error);
  const memory = useDashboardStore.getState().activeDashboard()!;
  const disk = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(memory.tabs.some(t => t.id === originalTabId)).toBe(failWrite);
  expect(disk.tabs.some((t: { id: string }) => t.id === originalTabId)).toBe(failWrite);
  expect(memory.tabs.find(t => t.id === otherTabId)!.cards[0].title).toBe('Other tab edit');
  expect(disk.tabs.find((t: { id: string }) => t.id === otherTabId).cards[0].title).toBe('Other tab edit');
  expect(useDashboardStore.getState().activeTabId).toBe(failWrite ? originalTabId : otherTabId);
});

it('guarded reconciliation skips stale work and accepts only after durable save before publication', async () => {
  const { id, dashboard } = await local();
  const definition = { table: {}, search: '' }, selection = { kind: 'none' as const };
  const expected = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];
  let accepted = false;
  const guard = { expected, isCurrent: () => false, beforePublish: () => { accepted = true; } };
  const save = vi.mocked(saveDashboard); save.mockClear();
  await useDashboardStore.getState().commitTableDefinition(dashboard.id, id, definition, selection, guard);
  expect(save).not.toHaveBeenCalled(); expect(accepted).toBe(false);
  const unsubscribe = useDashboardStore.subscribe(() => { expect(accepted).toBe(true); });
  await useDashboardStore.getState().commitTableDefinition(dashboard.id, id, definition, selection, { ...guard, isCurrent: () => true });
  unsubscribe(); expect(accepted).toBe(true);
});
it('stale reconciliation during save cannot overwrite a later user selection', async () => {
  const { id, dashboard } = await local();
  const expected = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];
  let current = true, release!: () => void, accepted = false;
  const realSave = (await vi.importActual<typeof import('../lib/dashboardsFile')>('../lib/dashboardsFile')).saveDashboard;
  vi.mocked(saveDashboard).mockImplementationOnce(async d => { await new Promise<void>(resolve => { release = resolve; }); await realSave(d); });
  const old = useDashboardStore.getState().commitTableDefinition(dashboard.id, id, { table: {}, search: '' }, { kind: 'none' }, { expected, isCurrent: () => current, beforePublish: () => { accepted = true; } });
  await vi.waitFor(() => expect(release).toBeDefined());
  current = false;
  const chosen = { kind: 'explicit' as const, ids: ['new-row'] };
  const newer = useDashboardStore.getState().commitTableDefinition(dashboard.id, id, { table: {}, search: '' }, chosen);
  release(); await Promise.all([old, newer]);
  expect(accepted).toBe(false);
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].tableSelection).toEqual(chosen);
});

it('replacement serializes behind card deletion and persists the same imported dashboard it displays', async () => {
  const { id, file, dashboard } = await local();
  const imported = { ...dashboard, tabs: [{ ...dashboard.tabs[0], name: 'Imported', cards: [] }] };
  await Promise.all([
    useDashboardStore.getState().removeCard(id),
    useDashboardStore.getState().replaceDashboardContents(dashboard.id, imported),
  ]);
  const memory = useDashboardStore.getState().activeDashboard()!;
  const disk = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(disk).toEqual(memory);
  expect(disk.tabs[0].name).toBe('Imported');
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
  await expect(readLocalFile(file)).rejects.toThrow();
});

it('replacement retires only its own pending deletion so Undo cannot restore a discarded card', async () => {
  const { id, file, dashboard } = await local();
  await useDashboardStore.getState().removeCard(id);
  const imported = { ...dashboard, tabs: [{ ...dashboard.tabs[0], cards: [] }] };
  await useDashboardStore.getState().replaceDashboardContents(dashboard.id, imported);
  await useDashboardStore.getState().undoCardRemoval();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toEqual([]);
  expect(useDashboardStore.getState().pendingCardRemoval).toBeNull();
  await expect(readLocalFile(file)).rejects.toThrow();
});

it('replacement queued after dashboard deletion cannot recreate its file', async () => {
  const { dashboard } = await local();
  await Promise.all([
    useDashboardStore.getState().removeDashboard(dashboard.id),
    useDashboardStore.getState().replaceDashboardContents(dashboard.id, dashboard),
  ]);
  expect(useDashboardStore.getState().dashboards.some(d => d.id === dashboard.id)).toBe(false);
  expect(__read(`dashboards/${dashboard.id}.json`)).toBeUndefined();
});
