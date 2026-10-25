// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
import type { AuthLocation, BackendConfig } from "./types";

const PATH = "backends.json";

const AUTH_LOCATIONS: AuthLocation[] = ["header", "query", "cookie"];

/**
 * What a backends.json entry looks like on disk: the two fields added after
 * v1 (authLocation, validateWidgets) may be absent on a file written before
 * they existed. `withDefaults` is the only place that fills them in.
 */
export type StoredBackend = Omit<BackendConfig, "authLocation" | "validateWidgets"> &
  Partial<Pick<BackendConfig, "authLocation" | "validateWidgets">> & {
    authLocation?: string;
  };

function isStoredBackend(value: unknown): value is StoredBackend {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.baseUrl !== "string") return false;
  if ("headerName" in value && typeof value.headerName !== "string") return false;
  if ("headerValue" in value && typeof value.headerValue !== "string") return false;
  // Absent is fine — withDefaults supplies it. Present-but-not-a-string is
  // still corruption. But present-and-a-string-yet-not-one-of-the-three
  // placements is NOT rejected here, unlike every other malformed field on
  // this type. An enum's valid set can shrink across a downgrade — a future
  // build could write a fourth placement, and rolling back to a build that
  // only knows "header"/"query"/"cookie" would otherwise quarantine (and
  // reseed, destroying) every backend and credential in the file just
  // because one entry named a placement this build doesn't recognize yet.
  // withDefaults coerces the unrecognized value to "header" instead, so an
  // unknown enum value degrades that one field, not the whole file. Fields
  // like baseUrl are open-typed strings with no fixed valid set, so they
  // don't have this asymmetry and keep the strict reject-and-quarantine
  // policy.
  if ("authLocation" in value && typeof value.authLocation !== "string") return false;
  if ("validateWidgets" in value && typeof value.validateWidgets !== "boolean") return false;
  if ("askOnStartup" in value && typeof value.askOnStartup !== "boolean") return false;
  return true;
}

/** Field-level, not container-level: every entry is validated individually. */
export function isStoredBackendArray(value: unknown): value is StoredBackend[] {
  return Array.isArray(value) && value.every(isStoredBackend);
}

/**
 * The ONLY place a default for a newly-added field is applied. Applying it on
 * read (not on write) is what lets a backends.json written before the field
 * existed keep working, with its auth intact.
 */
export function withDefaults(stored: StoredBackend): BackendConfig {
  const authLocation = AUTH_LOCATIONS.includes(stored.authLocation as AuthLocation)
    ? (stored.authLocation as AuthLocation)
    : "header";
  // v3.0.0 kept a per-backend allowedCodeLanguages list; the backend's server
  // now decides which code languages run. Deleted from the copy rather than
  // ignored, so the next saveBackends writes it out of the file.
  const rest: StoredBackend & { allowedCodeLanguages?: unknown } = { ...stored };
  delete rest.allowedCodeLanguages;
  return {
    ...rest,
    authLocation,
    validateWidgets: stored.validateWidgets ?? true,
  };
}

export function makeDefaultBackend(): BackendConfig {
  // A build can ship its own seed. The App Review build points at the
  // funnelled reference backend (deploy/review-backend/) so a reviewer who
  // has never seen a Connections dialog still opens the app to data; every
  // other build keeps the local openbb-docker default.
  const url = import.meta.env.VITE_DEFAULT_BACKEND_URL;
  const auth = import.meta.env.VITE_DEFAULT_BACKEND_AUTH;
  return {
    id: crypto.randomUUID(),
    name: url ? "Reference" : "Local",
    baseUrl: url || "http://localhost:6900",
    // Only set when the build supplies one: an empty headerValue would send a
    // bare `Authorization:` on every request.
    ...(auth ? { headerName: "Authorization", headerValue: auth } : {}),
    authLocation: "header",
    validateWidgets: true,
  };
}

export async function loadBackends(): Promise<BackendConfig[]> {
  const loaded = await loadJson(PATH, isStoredBackendArray);
  if (loaded === ABSENT) {
    // A fresh install is pre-seeded with one backend pointing at the local
    // openbb-docker stack, so the app is populated without the user typing
    // anything. This only fires when the file is ABSENT — once it exists,
    // even as `[]`, it is never reseeded, so deleting the default does not
    // resurrect it on the next launch.
    const seeded = [makeDefaultBackend()];
    await saveJson(PATH, seeded);
    return seeded;
  }
  return loaded.map(withDefaults);
}

export async function saveBackends(backends: BackendConfig[]): Promise<void> {
  await saveJson(PATH, backends);
}
