// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "../../lib/isRecord";
import type { KeysRow } from "../../lib/providerKeys";

// The row shapes live in lib/providerKeys.ts, so providerAvailability (lib)
// imports nothing from components; re-exported for this file's importers.
export type { DiagnosticCode, KeyCheck, KeysRow } from "../../lib/providerKeys";

export type KeysPayload = { tier: number; rows: KeysRow[] };

export function isKeysPayload(data: unknown): data is KeysPayload {
  return isRecord(data) && typeof data.tier === "number" && Array.isArray(data.rows);
}

/**
 * The rows of a keys payload, or null if it is not one at all.
 *
 * key-maint's document is untrusted JSON like any other, and `isKeysPayload`
 * only proves `rows` is an array — nothing about what is IN it. A null or a
 * bare string among them is one bad row, not a bad document: it is dropped
 * here, so neither KeysPanel nor providerKeysStore's hand-off has to
 * survive destructuring it. Both read rows through this one function, so a
 * row one of them skips cannot be a row the other trips over.
 *
 * The same goes for a row whose provider or env_var is not a string (or whose
 * provider_id is there and not one): the provider dashboard's byName calls
 * localeCompare on them, and a TypeError there takes
 * the whole panel down.
 */
export function keysRows(data: unknown): KeysRow[] | null {
  if (!isKeysPayload(data)) return null;
  return (data.rows as unknown[]).filter(
    (r) =>
      isRecord(r) &&
      typeof r.provider === "string" &&
      typeof r.env_var === "string" &&
      (r.provider_id === undefined || typeof r.provider_id === "string"),
  ) as unknown as KeysRow[];
}
