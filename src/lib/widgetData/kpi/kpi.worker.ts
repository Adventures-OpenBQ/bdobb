// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { buildKpiSnapshot } from './build';
import type { KpiReply, KpiRequest } from './workerClient';

self.onmessage = ({ data }: MessageEvent<KpiRequest>) => {
  const { identity, dataset, options } = data;
  try {
    const result = buildKpiSnapshot(dataset, options);
    self.postMessage({ ...identity, result } satisfies KpiReply);
  } catch (error) {
    self.postMessage({ ...identity, error: error instanceof Error ? error.message : String(error) } satisfies KpiReply);
  }
};
