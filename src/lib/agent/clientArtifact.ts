// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "../isRecord";
import type { ClientArtifact } from "./types";

/** The payload accepted by the chat pane; protocol success uses the same check. */
export function isClientArtifact(v: unknown): v is ClientArtifact {
  return isRecord(v) && typeof v.type === "string" && typeof v.uuid === "string" && "content" in v;
}
