// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/** The host's file system under @tauri-apps/plugin-fs's names (see HostFs). */
import { getHost, type HostFs } from ".";

export const exists: HostFs["exists"] = (...a) => getHost().fs.exists(...a);
export const readTextFile: HostFs["readTextFile"] = (...a) => getHost().fs.readTextFile(...a);
export const writeTextFile: HostFs["writeTextFile"] = (...a) => getHost().fs.writeTextFile(...a);
export const readDir: HostFs["readDir"] = (...a) => getHost().fs.readDir(...a);
export const rename: HostFs["rename"] = (...a) => getHost().fs.rename(...a);
export const remove: HostFs["remove"] = (...a) => getHost().fs.remove(...a);
export const mkdir: HostFs["mkdir"] = (...a) => getHost().fs.mkdir(...a);
export const stat: HostFs["stat"] = (...a) => getHost().fs.stat(...a);
