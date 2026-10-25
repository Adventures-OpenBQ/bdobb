// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isStoredBackendArray, withDefaults, type StoredBackend } from "./backendsFile";
import { IMPORT_MAX_BACKENDS } from "./importLimits";
import type { BackendConfig } from "./types";

export type BackendsImportPlan =
  | { ok: true; backends: BackendConfig[]; notice: string }
  | { ok: false; refusal: string };

/**
 * What importing a backends.json would do, decided without touching the
 * store: the merged list and the notice, or the reason to refuse.
 *
 * Merge by id, never replace: an entry whose id is already here is updated
 * in place, an unknown id is appended, and nothing present is removed. So a
 * file exported on another machine cannot delete a connection that exists
 * only on this one, and importing the same file twice is a no-op. Same
 * validator as the file on disk, since it IS that file's format.
 *
 * Updated in place field by field, too: a field the file leaves out keeps
 * this device's value. Replacing the whole entry erased a stored credential
 * whenever the file had no headerValue -- one exported where the value was
 * kept in memory only, say, or hand-edited to leave the secret out.
 */
export function planBackendsImport(text: string, existing: BackendConfig[]): BackendsImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refusal: "That file is not JSON." };
  }
  if (!isStoredBackendArray(parsed)) {
    return {
      ok: false,
      refusal: "That file is not a backends.json: expected a list of connections.",
    };
  }
  if (parsed.length === 0) return { ok: false, refusal: "That file holds no connections." };
  if (parsed.length > IMPORT_MAX_BACKENDS) {
    return {
      ok: false,
      refusal: `File holds ${parsed.length} connections; the limit is ${IMPORT_MAX_BACKENDS}.`,
    };
  }

  // One row per id: a file that names an id twice (hand-edited, say) keeps
  // the last entry, in the position of the first, and is counted once. Kept
  // as stored, defaults NOT yet applied, so mergeKnown can tell an absent
  // field from a default one.
  const byId = new Map(parsed.map((b) => [b.id, b]));
  const incoming = [...byId.values()];
  const known = new Set(existing.map((b) => b.id));
  const updated = incoming.filter((b) => known.has(b.id)).length;
  const backends = [
    ...existing.map((b) => {
      const next = byId.get(b.id);
      return next ? withDefaults(mergeKnown(b, next)) : b;
    }),
    ...incoming.filter((b) => !known.has(b.id)).map(withDefaults),
  ];
  const n = incoming.length;
  return {
    ok: true,
    backends,
    notice: `Imported ${n} ${n === 1 ? "connection" : "connections"} (${updated} updated, ${n - updated} added).`,
  };
}

/**
 * A known connection updated from a file. The file's entry wins, because a
 * file cannot say "cleared": clearing a credential or askOnStartup in the
 * editor leaves the key out, so an absent credential means none. Two things
 * an absent key can NOT mean, and so do not clear:
 * - The secret, when the file still names the same header. The exporting
 *   device held that value in memory only (persistable leaves it out), so
 *   this device keeps the value it stored.
 * - authLocation and validateWidgets, settings rather than credentials,
 *   which a file from before they existed simply does not carry.
 */
function mergeKnown(existing: BackendConfig, next: StoredBackend): StoredBackend {
  const sameHeaderNoValue =
    next.headerName !== undefined && next.headerName === existing.headerName && next.headerValue === undefined;
  return {
    ...next,
    authLocation: next.authLocation ?? existing.authLocation,
    validateWidgets: next.validateWidgets ?? existing.validateWidgets,
    ...(sameHeaderNoValue ? { headerValue: existing.headerValue } : {}),
  };
}

/**
 * True when `after` is a different connection from `before` as far as a
 * Workspace session is concerned. A session holds a copy of the credential
 * it connected with, so a changed address or credential makes it a different
 * connection, as a changed Workspace address does (saveConnection); a rename
 * does not. Shared by the Connections edit and the backends.json import.
 */
export function connectionDetailsChanged(before: BackendConfig, after: BackendConfig): boolean {
  return (["baseUrl", "headerName", "headerValue", "authLocation"] as const).some((k) => before[k] !== after[k]);
}
