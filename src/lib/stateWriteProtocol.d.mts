// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export const STATE_WRITER: 'x-bdobb-state-writer';
export const STATE_SEQUENCE: 'x-bdobb-state-sequence';
export function stateWriteVersion(writer: unknown, sequence: unknown): {writer: string; sequence: number} | null;
