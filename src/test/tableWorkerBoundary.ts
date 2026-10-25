// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createWorkerHandler } from '../lib/tableExecution/table.worker';
import type { ExecutionRequest } from '../lib/tableExecution/types';

/** Immediate in-process transport for tests that do not need lifecycle instrumentation. */
export class Boundary {
  onmessage: ((e: MessageEvent) => void) | null = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) { void this.handler(data); }
  terminate() {}
}
