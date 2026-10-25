// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { DOCKS_ID, readStoredDashboard, storedDashboard } from "./dashboardsFile";
import { isRecord } from "./isRecord";
import type { Dashboard } from "./types";

/**
 * What the docks' server record holds as its `content` (v8, ruling R6): the
 * docks dashboard exactly as docks.json holds it, inside a versioned
 * envelope. The server keeps `content` as sent and only BDOBB reads it; the
 * envelope is what lets a later client's record be recognised as one this
 * client cannot read, rather than misread.
 */
export type DocksContent = { schemaVersion: 1; profile: "v8"; dashboard: Dashboard };

export function encodeDocksContent(docks: Dashboard): DocksContent {
  const { revision: _revision, ...rest } = storedDashboard(docks);
  return { schemaVersion: 1, profile: "v8", dashboard: rest };
}

/**
 * The docks a server record carries, or null when this client cannot read
 * it (another schema, unknown fields, not the docks). Null is the Q3 degrade:
 * the caller keeps its local docks and says so quietly, never refuses the
 * rest of the sync.
 */
export function decodeDocksContent(content: unknown): Dashboard | null {
  if (!isRecord(content) || content.schemaVersion !== 1 || content.profile !== "v8") return null;
  if (Object.keys(content).some((key) => !["schemaVersion", "profile", "dashboard"].includes(key))) return null;
  const dashboard = readStoredDashboard(content.dashboard);
  return dashboard !== null && dashboard.id === DOCKS_ID ? dashboard : null;
}
