// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { loadRustRuntime, createRustExecutor, type WasmModule } from '../rust/runtime';
import { createRustWorkerHandler } from '../rust/rust.worker';
import type { ExecutionRequest, TableExecutor } from '../types';

const runtime = loadRustRuntime(async () => {
  const module = await import('../rust/generated/pivot_wasm');
  await module.default({ module_or_path: readFileSync(new URL('../rust/generated/pivot_wasm_bg.wasm', import.meta.url)) });
  return module as unknown as WasmModule;
});
/** In-process transport only; every calculation runs the compiled WASM handler. */
export async function createWasmTestExecutor(): Promise<TableExecutor> {
  const loaded = await runtime;
  return createRustExecutor('trace', () => {
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null, onmessageerror: null,
      postMessage(request: ExecutionRequest) { void handler(request); },
      terminate() { void handler({kind: 'dispose', requestId: 'trace-dispose', revision: {widgetId: 'trace', input: 0, model: 0, output: 0}}); },
    };
    const handler = createRustWorkerHandler(message => queueMicrotask(() => worker.onmessage?.({ data: message } as MessageEvent)), async () => loaded, Intl.DateTimeFormat().resolvedOptions().locale);
    return worker as unknown as Worker;
  });
}
