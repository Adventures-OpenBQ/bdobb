// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { fetchWidgetData } from "../../lib/dataClient";
import { isRecord } from "../../lib/isRecord";
import { paramsKey } from "../../lib/params";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { RawJsonView } from "./RawJsonView";
import { TableRenderer } from "./TableRenderer";

/**
 * The Raw view of an `html` or `youtube` widget that declares `raw: true`.
 * Its payload is markup or a video, not the data behind it, so the reference
 * (widget-types/html.md, "Raw Data View") has Raw ask the same endpoint again
 * with `raw=true` added to the card's params. The normal view never sends
 * it. A list of records -- or an object's `results` list -- is a table;
 * anything else is shown as JSON. `refreshKey` is how the header's Refresh
 * reaches this request, as for multi_file_viewer.
 */
export function RawRequestView({
  backend,
  widget,
  params,
  refreshKey,
}: {
  backend: BackendConfig;
  widget: WidgetDef;
  params: Record<string, string>;
  refreshKey: number;
}) {
  const [result, setResult] = useState<{ data: unknown } | { error: string } | null>(null);
  // A value-derived key, as in useWidgetData: the caller's params object can
  // change identity without changing the question.
  const key = paramsKey(params);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    fetchWidgetData(backend, widget, { ...params, raw: "true" }).then(
      (data) => {
        if (!cancelled) setResult({ data });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `params`
  }, [backend, widget, key, refreshKey]);

  if (result === null) return <p className="empty-state">Loading…</p>;
  if ("error" in result) return <p className="empty-state">{result.error}</p>;
  const { data } = result;
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.results) ? data.results : null;
  return rows ? <TableRenderer data={rows} /> : <RawJsonView data={data} />;
}
