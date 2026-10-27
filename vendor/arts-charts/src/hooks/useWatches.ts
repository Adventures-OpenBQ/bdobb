// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * The watches on one chart document (spec §3: "a bell with a count on cards
 * that have watches"), from `GET /watches?chart_id=` and refetched on every
 * kind `watch` feed event or reconnect. Empty with no `chartsFetch` or no
 * `chart_id`. A failed fetch keeps the last list: a bell that briefly lags is
 * better than one that flickers off while the server is away.
 */
import { useEffect, useState } from "react";
import { getHost } from "../host";
import { followFeed, listWatches, type Watch } from "../lib/chartServer";

export function useWatches(chartId: string): Watch[] {
  const f = getHost().chartsFetch;
  const [watches, setWatches] = useState<Watch[]>([]);
  useEffect(() => {
    setWatches([]);
    if (f === undefined || chartId === "") return;
    let active = true;
    const stop = followFeed(f, "watch", async () => {
      const next = await listWatches(f, chartId);
      if (active) setWatches(next);
    });
    return () => { active = false; stop(); };
  }, [f, chartId]);
  return watches;
}
