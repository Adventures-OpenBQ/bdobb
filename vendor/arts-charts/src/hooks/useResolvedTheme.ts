// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost } from "../host";

/** The host's effective theme, as a hook so a theme change re-renders the chart. */
export function useResolvedTheme(): "dark" | "light" {
  return getHost().useResolvedTheme();
}
