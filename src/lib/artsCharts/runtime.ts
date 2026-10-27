// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
/** Gated: loaded only through ./load (spec B2). */
export { discoverArtsCharts } from "./widget";

import { useBackendsStore } from "../../stores/backendsStore";
import { reconfigure } from "../artsChartsHost";
import { installChartsSocketShim } from "./desktopSocket";

/** Configure once at startup and again on every backends change (spec §2). Returns the unsubscribe. */
export function startArtsCharts(options: { viewer: boolean }): () => void {
  const uninstall = import.meta.env.MODE === "browser" ? () => {} : installChartsSocketShim();
  reconfigure(options);
  const unsubscribe = useBackendsStore.subscribe((s, prev) => { if (s.backends !== prev.backends) reconfigure(options); });
  return () => { unsubscribe(); uninstall(); };
}
