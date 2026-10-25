// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

function asRecord(data: unknown): Record<string, unknown> | null {
  // A metric endpoint commonly answers with a one-row list rather than a bare
  // object; unwrapping here keeps that from reading as "no metric value".
  const candidate = Array.isArray(data) ? data[0] : data;
  if (typeof candidate !== "object" || candidate === null) return null;
  return candidate as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** One headline value, with label and delta where the payload supplies them. */
export function MetricRenderer({ data }: { data: unknown }) {
  const record = asRecord(data);
  const value = record ? text(record.value) : null;
  if (value === null) return <p className="empty-state">No metric value in this payload.</p>;

  const label = record ? text(record.label) : null;
  const delta = record ? text(record.delta) : null;

  return (
    <div className="metric">
      {label ? <span className="metric-label">{label}</span> : null}
      <span className="metric-value">{value}</span>
      {delta ? <span className="metric-delta">{delta}</span> : null}
    </div>
  );
}
