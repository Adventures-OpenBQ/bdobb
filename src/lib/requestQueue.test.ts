// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { withRequestSlot } from './requestQueue';

it('removes an aborted queued request and allows the following request to finish', async () => {
  let release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const held=Array.from({length:4},()=>withRequestSlot('https://abort.example/data',undefined,()=>gate));
  const abort=new AbortController();const cancelled=vi.fn(async()=> 'cancelled');
  const queued=withRequestSlot('https://abort.example/ref',abort.signal,cancelled);
  const following=withRequestSlot('https://abort.example/api',undefined,async()=> 'following');
  try {
    abort.abort();
    await expect(queued).rejects.toMatchObject({name:'AbortError'});
    expect(cancelled).not.toHaveBeenCalled();
  } finally {release();await Promise.all(held);}
  await expect(following).resolves.toBe('following');
  expect(cancelled).not.toHaveBeenCalled();
});

it('keeps a different origin available while one backend is saturated', async () => {
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const held=Array.from({length:4},()=>withRequestSlot('https://slow.example/data',undefined,()=>gate));
  try {await expect(withRequestSlot('https://working.example/data',undefined,async()=> 'data')).resolves.toBe('data');}
  finally {release();await Promise.all(held);}
});
