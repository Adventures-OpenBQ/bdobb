// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceRegistry } from './chartSourceContracts';
import { newsSourceAdapter } from './newsEvidence';
import { ownershipSourceAdapter } from './ownershipEvidence';

/** Only reviewed, source-specific adapters belong here. Local-only adapters have no routes. */
export const chartSourceRegistry: ChartSourceRegistry = Object.freeze({ news: newsSourceAdapter, ownership: ownershipSourceAdapter });
