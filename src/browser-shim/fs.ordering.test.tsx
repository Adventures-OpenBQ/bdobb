// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach, afterEach, it, vi, expect} from 'vitest';
import {webLocks} from '../test/webLocks';
let ownership: ReturnType<typeof webLocks>;

type Write = {path: string; body: string; writer: string | null; sequence: string | null; keepalive: boolean; finish: () => void};
let writes: Write[];
let stored: string;
let removeListeners: () => void;
const versions = new Map<string, number>();
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); sessionStorage.clear();
  ownership = webLocks(); vi.stubGlobal("navigator", {locks: ownership.locks});
  const win = vi.spyOn(window, 'addEventListener'), doc = vi.spyOn(document, 'addEventListener');
  removeListeners = () => {
    for (const [type, listener, options] of win.mock.calls) window.removeEventListener(type, listener, options);
    for (const [type, listener, options] of doc.mock.calls) document.removeEventListener(type, listener, options);
    win.mockRestore(); doc.mockRestore();
  };
  window.__bdobbPersist = true; window.__bdobbSeed = {'settings.json': '{}'};
  vi.stubGlobal('location', {origin: 'https://preview.example.com', href: 'https://preview.example.com/', assign: vi.fn()});
  writes = []; stored = '{}'; versions.clear();
  // The real gateway owns durable fencing; this transport models its validated commit/409 contract.
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => new Promise<Response>(resolve => {
    const headers = new Headers(init.headers), writer = headers.get('x-bdobb-state-writer'), sequence = headers.get('x-bdobb-state-sequence');
    let finished = false;
    writes.push({path: url, body: String(init.body), writer, sequence, keepalive: !!init.keepalive, finish: () => {
      if (finished) return; finished = true;
      const versionKey = `${url}:${writer}`;
      const n = Number(sequence), latest = writer ? versions.get(versionKey) ?? 0 : 0;
      const admitted = !!writer && Number.isSafeInteger(n) && n > latest;
      if (admitted) {versions.set(versionKey, n); stored = init.method === 'DELETE' ? '<deleted>' : String(init.body);}
      resolve(new Response(null, {status: admitted ? 204 : 409}));
    }});
  })));
});
afterEach(async () => {
  removeListeners();
  for (let round = 0; round < 5; round++) {
    for (const write of writes) write.finish();
    await vi.advanceTimersByTimeAsync(0);
  }
  document.querySelector('.web-preview-notice')?.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); delete window.__bdobbPersist; sessionStorage.clear();
});

it('fences an older ordinary PUT behind a newer hide-time save', async () => {
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"old"}'); await vi.advanceTimersByTimeAsync(600);
  await fs.writeTextFile('settings.json', '{"theme":"new"}'); window.dispatchEvent(new Event('pagehide'));
  expect(writes).toHaveLength(2);
  expect(writes[0].writer).toMatch(/^[0-9a-f-]{36}$/);
  expect(writes[1].writer).toBe(writes[0].writer);
  expect(Number(writes[1].sequence)).toBeGreaterThan(Number(writes[0].sequence));
  writes[1].finish(); await vi.advanceTimersByTimeAsync(0);
  writes[0].finish(); await vi.advanceTimersByTimeAsync(1000);
  expect(stored).toBe('{"theme":"new"}');
});

it('keeps the newest recovery body until its own save is acknowledged across resume and repeated hides', async () => {
  const bar = document.createElement('div'); bar.className = 'web-preview-notice';
  bar.append('Private web preview · Changes are saved to your account · '); document.body.append(bar);
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"old"}'); await vi.advanceTimersByTimeAsync(600);
  await fs.writeTextFile('settings.json', '{"theme":"middle"}'); window.dispatchEvent(new Event('pagehide'));
  document.dispatchEvent(new Event('visibilitychange'));
  await fs.writeTextFile('settings.json', '{"theme":"new"}'); window.dispatchEvent(new Event('pagehide'));
  expect(writes).toHaveLength(3);
  writes[0].finish(); await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(sessionStorage.getItem('bdobb-unsaved')!).files['settings.json']).toBe('{"theme":"new"}');
  expect(bar.textContent).toContain('Saving changes');
  writes[2].finish(); await vi.advanceTimersByTimeAsync(0);
  writes[1].finish(); await vi.advanceTimersByTimeAsync(1000);
  expect(stored).toBe('{"theme":"new"}');
  expect(sessionStorage.getItem('bdobb-unsaved')).toBeNull();
});

it('assigns a newer fenced sequence to DELETE than an in-flight PUT', async () => {
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"old"}'); await vi.advanceTimersByTimeAsync(600);
  await fs.remove('settings.json'); window.dispatchEvent(new Event('pagehide'));
  expect(Number(writes[1].sequence)).toBeGreaterThan(Number(writes[0].sequence));
  writes[1].finish(); await vi.advanceTimersByTimeAsync(0);
  writes[0].finish(); await vi.advanceTimersByTimeAsync(1000);
  expect(stored).toBe('<deleted>');
});

it('resends the rest of a first mirror after an older file version physically lands', async () => {
  window.__bdobbSeed = {'dashboards/big.json': JSON.stringify({id:'big', pad:'x'.repeat(70000)}), 'settings.json':'{}'};
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"new"}'); await vi.advanceTimersByTimeAsync(600);
  await fs.writeTextFile('dashboards/big.json', JSON.stringify({id:'big', pad:'y'.repeat(70000)}));
  writes[0].finish(); await vi.advanceTimersByTimeAsync(0);
  expect(writes).toHaveLength(2);
  window.dispatchEvent(new Event('pagehide'));
  expect(writes.filter(write => write.keepalive).map(write => write.path)).toEqual(['/state/dashboards/big.json', '/state/settings.json']);
});

it('keeps the tab writer and increasing file sequence after reload', async () => {
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"old"}'); await vi.advanceTimersByTimeAsync(600);
  writes[0].finish(); await vi.advanceTimersByTimeAsync(0);
  const first = writes[0];
  window.__bdobbSeed = {'settings.json': stored};
  ownership.terminateDocument(); // A real reload destroys the prior document and releases its locks.
  vi.resetModules();
  const reloaded = await import('./fs');
  await reloaded.writeTextFile('settings.json', '{"theme":"new"}');
  window.dispatchEvent(new Event('pagehide'));
  expect(writes).toHaveLength(2);
  expect(writes[1].writer).toBe(first.writer);
  expect(Number(writes[1].sequence)).toBeGreaterThan(Number(first.sequence));
  writes[1].finish(); await vi.advanceTimersByTimeAsync(0);
  expect(stored).toBe('{"theme":"new"}');
});

it('reserves a new sequence for an unchanged first-mirror seed after another writer changed it', async () => {
  const fs = await import('./fs');
  await fs.writeTextFile('settings.json', '{"theme":"old"}'); await vi.advanceTimersByTimeAsync(600);
  writes[0].finish(); await vi.advanceTimersByTimeAsync(0);
  const first = writes[0];
  // A new bootstrap can contain another tab's value, even though this tab's counter survives.
  window.__bdobbSeed = {'settings.json': '{"theme":"other-tab"}'};
  ownership.terminateDocument(); // A real reload destroys the prior document and releases its locks.
  vi.resetModules();
  const reloaded = await import('./fs');
  await reloaded.writeTextFile('backends.json', '[]'); await vi.advanceTimersByTimeAsync(600);
  writes[1].finish(); await vi.advanceTimersByTimeAsync(0);
  const mirrored = writes.find(write => write !== first && write.path === '/state/settings.json')!;
  expect(mirrored.body).toBe('{"theme":"other-tab"}');
  expect(mirrored.writer).toBe(first.writer);
  expect(Number(mirrored.sequence)).toBeGreaterThan(Number(first.sequence));
  mirrored.finish(); await vi.advanceTimersByTimeAsync(0);
  expect(stored).toBe('{"theme":"other-tab"}');
});

it('waits for writer ownership before changing an account file or starting its save', async () => {
  let grant!: () => void;
  const available = new Promise<void>(resolve => {grant = resolve;});
  vi.stubGlobal('navigator', {locks: {
    request: (...args: Parameters<LockManager['request']>) => available.then(() => ownership.locks.request(...args)),
  }});
  const fs = await import('./fs');
  let settled = false;
  const mutation = fs.writeTextFile('settings.json', '{"theme":"owned"}').then(() => {settled = true;});
  await vi.advanceTimersByTimeAsync(600);
  expect(settled).toBe(false);
  expect(await fs.readTextFile('settings.json')).toBe('{}');
  expect(writes).toHaveLength(0);
  grant(); await mutation;
  window.dispatchEvent(new Event('pagehide'));
  expect(writes).toHaveLength(1);
  expect(writes[0].writer).toMatch(/^[0-9a-f-]{36}$/);
});
