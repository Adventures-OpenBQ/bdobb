// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * A chart snapshot Rita took in a chat (v12 part 3): the `content` of an
 * `arts_chart_snapshot` artifact, which the host's chat hands over as it came.
 *
 * - The content is untrusted (any MCP server can emit an artifact, R6). Only
 *   the schema and the two ids are read for the fetch, and the path is built
 *   from the ids alone: no field of the artifact can steer a credentialed
 *   request. Bad content fetches nothing.
 * - The PNG comes through the host's `chartsFetch` and shows as a `data:` URL
 *   (the inbox's way): an `<img src>` cannot carry the credential, and the
 *   host's artifact rules allow no remote image.
 * - States: loading; shown; "no longer kept" after the 30-day purge, with
 *   Open chart when the host has it; failed, with Retry; not connected when
 *   the host has no `chartsFetch`.
 */
import { useEffect, useState } from "react";
import { getHost, type ArtsChartsHost } from "../../host";
import { ChartServerError, getChart, snapshotDataUrl } from "../../lib/chartServer";

export const SNAPSHOT_SCHEMA = "arts-chart-snapshot/1";
/** What the server mints (store.is_chart_id): a canonical lowercase uuid. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Snapshot = { chartId: string; snapshotId: string; title: string; symbol: string; interval: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The snapshot an artifact's content names, or null when it is not one this version reads. */
export function snapshotOf(content: unknown): Snapshot | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  if (c.schema !== SNAPSHOT_SCHEMA) return null;
  if (typeof c.chart_id !== "string" || !ID.test(c.chart_id)) return null;
  if (typeof c.snapshot_id !== "string" || !ID.test(c.snapshot_id)) return null;
  return { chartId: c.chart_id, snapshotId: c.snapshot_id, title: text(c.title), symbol: text(c.symbol), interval: text(c.interval) };
}

function hostOrNull(): ArtsChartsHost | null {
  try { return getHost(); } catch { return null; }
}

export function ArtsChartsSnapshot({ content }: { content: unknown }) {
  const shot = snapshotOf(content);
  const host = hostOrNull();
  const f = host?.chartsFetch;
  const path = shot === null ? null : `/charts/${shot.chartId}/snapshots/${shot.snapshotId}.png`;
  // undefined: loading; null: no longer kept; "": failed.
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (f === undefined || path === null) return;
    let active = true;
    setSrc(undefined);
    snapshotDataUrl(f, path).then((s) => { if (active) setSrc(s); }, () => { if (active) setSrc(""); });
    return () => { active = false; };
  }, [f, path, attempt]);

  if (shot === null) return <p className="arts-snapshot-note">This is not an Art's Charts snapshot this app can show.</p>;
  if (f === undefined) return <p className="arts-snapshot-note">Art's Charts is not connected.</p>;
  const label = shot.title || `${shot.symbol} · ${shot.interval}`;

  const open = async (openChart: (id: string) => void) => {
    try { await getChart(f, shot.chartId); } catch (error) {
      if (error instanceof ChartServerError && error.status === 404) { setNote("This chart was deleted on the chart server."); return; }
    }
    setNote(null);
    openChart(shot.chartId);
  };

  return (
    <figure className="arts-snapshot">
      {src === undefined ? <p className="arts-snapshot-note" role="status">Loading the snapshot…</p> : null}
      {typeof src === "string" && src !== "" ? <img src={src} alt={`Snapshot of ${label}`} /> : null}
      {src === null ? (
        <p className="arts-snapshot-note">
          This snapshot is no longer kept (snapshots are kept 30 days).{" "}
          {host?.openChart ? <button type="button" onClick={() => void open(host.openChart!)}>Open chart</button> : null}
        </p>
      ) : null}
      {src === "" ? (
        <p className="arts-snapshot-note">
          The snapshot did not load.{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      ) : null}
      {note === null ? null : <p className="arts-snapshot-note" role="status">{note}</p>}
      <figcaption>{label}</figcaption>
    </figure>
  );
}
