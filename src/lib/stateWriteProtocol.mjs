// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export const STATE_WRITER = 'x-bdobb-state-writer';
export const STATE_SEQUENCE = 'x-bdobb-state-sequence';
export function stateWriteVersion(writer, sequence) {
  if (typeof writer !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(writer)) return null;
  if (typeof sequence !== 'string' || !/^[1-9][0-9]{0,15}$/.test(sequence)) return null;
  const value = Number(sequence);
  return Number.isSafeInteger(value) ? {writer, sequence: value} : null;
}
