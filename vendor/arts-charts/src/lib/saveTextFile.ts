// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/** bdobb-v2's save-through-the-picker helpers, answered by the host. */
import { getHost } from "../host";

export function saveTextFile(name: string, filterName: string, text: string, extension = "json"): Promise<boolean> {
  return getHost().saveTextFile(name, filterName, text, extension);
}

export function saveBinaryFile(name: string, filterName: string, bytes: Uint8Array, extension: string): Promise<boolean> {
  return getHost().saveBinaryFile(name, filterName, bytes, extension);
}
