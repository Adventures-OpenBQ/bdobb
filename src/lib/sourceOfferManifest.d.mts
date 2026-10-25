// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
export interface SourceOffer {
  schemaVersion: 1;
  release: string;
  baseCommit: string;
  sourceId: string;
  archiveFilename: string;
  archiveUrl: string;
  license: 'AGPL-3.0-only';
  status: 'prepared';
}
export function validateSourceOffer(value: unknown): Readonly<SourceOffer>;
