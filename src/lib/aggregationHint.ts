// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Its own module, free of Tauri, so the server-side table ingest validates a hint by the client's rule.
import { isRecord } from "./isRecord";
import { AGG_NAMES, HINT_STATUSES, type AggName, type AggregationHint } from "./types";

/**
 * A column's `aggregation` hint (openbq-eodhd's dictionary, which its Data
 * models put on a field's `x-widget_config` and OpenBB merges into that
 * column's `columnsDefs` entry), or nothing. All five parts must be
 * well-formed or the whole hint is dropped: a hint is advice the pivot acts
 * on, and a half-typed one -- an operator this app does not know, a status it
 * does not recognise -- is not advice it can follow. `time` may be null
 * (reviewed, no rule), which is a meaningful hint and is kept.
 *
 * Ported from bdobb-v2 a385fdef (PR #164) and 16d3ead3 (PR #165) at v9.6.3.
 */
export function toAggregationHint(value: unknown): AggregationHint | undefined {
  if (!isRecord(value)) return undefined;
  // An ABSENT `time` is a null one. The provider writes `time: null` for a
  // reviewed-no-rule column and for a dimension, but FastAPI's OpenAPI
  // serialisation drops None, so the wire carries no key at all. A named
  // operator that is not one of ours is still a dropped hint.
  const time =
    value.time === null || value.time === undefined
      ? null
      : (AGG_NAMES as readonly string[]).includes(String(value.time))
        ? (value.time as AggName)
        : undefined;
  if (time === undefined) return undefined;
  if (!Array.isArray(value.frequencies) || !value.frequencies.every((f) => typeof f === "string")) return undefined;
  if (value.entity !== "require_selection") return undefined;
  if (!(HINT_STATUSES as readonly string[]).includes(String(value.status))) return undefined;
  if (typeof value.ruleset !== "string") return undefined;
  return {
    time,
    frequencies: value.frequencies as string[],
    entity: "require_selection",
    status: value.status as AggregationHint["status"],
    ruleset: value.ruleset,
  };
}
