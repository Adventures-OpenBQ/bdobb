// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/// <reference types="vite/client" />

/** The two flags lib/chartTickRelay.ts reads; a host's own web shell sets them. */
interface Window {
  __bdobbSocketTickets?: boolean;
  __bdobbChartTicks?: boolean;
}
