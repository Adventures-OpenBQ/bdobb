// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from './types';
/** Acquisition only: definitions and calculated output belong to the executor. */
export type AcquiredData = {
  kind: 'file';
  name: string;
  bytes: Uint8Array;
  /** The card's chosen year-end backend asked for these reporters (absent: none chosen; rows stay as reported). */
  yearEnds?: (symbols: string[]) => Promise<Record<string, number | null>>;
} | {
  kind: 'dataset';
  dataset: WidgetDataset;
};
export interface SourceAdapter {
  acquire(signal: AbortSignal): Promise<AcquiredData>;
}
