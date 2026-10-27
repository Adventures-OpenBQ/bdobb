// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/** The host's link opener under @tauri-apps/plugin-opener's name. */
import { getHost } from ".";

export const openUrl = (url: string): Promise<void> => getHost().openUrl(url);
