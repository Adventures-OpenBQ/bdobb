// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/** The host's dialogs under @tauri-apps/plugin-dialog's names. */
import { getHost, type HostDialog } from ".";

export const open: HostDialog["open"] = (options) => getHost().dialog.open(options);
export const confirm: HostDialog["confirm"] = (message, options) => getHost().dialog.confirm(message, options);
