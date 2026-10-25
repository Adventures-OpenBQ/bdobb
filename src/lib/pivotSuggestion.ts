// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Periodicity } from "./periodicity";
import { activeLists, bucketOf, legalAggregations } from "./pivotConfig";
import type { FieldKind } from "./pivotTable";
import type { TableColumn } from "./tableColumns";
import type { AggName, AggregationHint, Bucket, PivotConfig } from "./types";

/**
 * Whether a column's provider suggestion may be offered for the pivot as it
 * stands, and if not, why.
 *
 * `suggested` is the one answer that offers an operator. The rest are the
 * reasons the panel and Rita explain: `unreviewed` -- the provider reviewed
 * the column and has no rule for it (an explicit `time: null` hint);
 * `frequency` -- the rule was reviewed at other frequencies than this pivot's
 * bucket; `entity` -- a group would combine entities (issuers, instruments),
 * for which the provider defines no rule; `none` -- the column carries no hint
 * at all (a model the dictionary does not cover) or is itself a dimension.
 */
export type Suggestion =
  | { kind: "suggested"; fn: AggName }
  | { kind: "unreviewed" }
  | { kind: "frequency"; reviewed: string[] }
  | { kind: "entity"; field: string; ungrouped?: true }
  | { kind: "none" };

/** Dimensions that are period keys, not entities: a date grouping already decides them. */
const PERIOD_KEYS = new Set(["fiscal_year", "fiscal_period"]);
/**
 * Entity keys that count as dimensions without a hint: openbq-eodhd's bar
 * mirrors send multi-symbol rows with a `symbol` field that is not a model
 * field, so it never carries one.
 */
const ENTITY_KEYS = new Set(["symbol"]);

/**
 * The provider's frequency tokens, as openbq-eodhd's dictionary spells them,
 * against this app's buckets. Statements are reviewed at `annual` / `quarter`;
 * EOD bars at `1d` / `1W` / `1M`. A native bucket is named by the data's own
 * periodicity, so quarterly data at its native bucket IS `quarter`. This is
 * the whole of the client's vocabulary for the provider's tokens -- five
 * constants, not a second dictionary.
 */

export const BUCKET_TOKEN: Record<Exclude<Bucket, "native">, string> = {
  week: "1W",
  month: "1M",
  quarter: "quarter",
  year: "annual",
};
const PERIODICITY_TOKEN: Partial<Record<Periodicity, string>> = {
  daily: "1d",
  weekly: "1W",
  monthly: "1M",
  quarterly: "quarter",
  annual: "annual",
};

function hintOf(columns: TableColumn[], field: string): AggregationHint | undefined {
  return columns.find((c) => c.field === field)?.hint;
}

function isDimension(c: TableColumn | undefined): boolean {
  return c !== undefined && (c.hint ? c.hint.status === "dimension" : ENTITY_KEYS.has(c.field));
}

/** Entity dimensions that must remain separate before a provider operator is eligible. */
export function ungroupedEntityFields(columns: TableColumn[], kinds: ReadonlyMap<string, FieldKind>, grouped: readonly string[]): string[] {
  return columns.filter(c => isDimension(c) && kinds.get(c.field) !== "date" && !PERIOD_KEYS.has(c.field) && !grouped.includes(c.field)).map(c => c.field);
}

/**
 * The provider's suggestion for `field`, or the reason there is none.
 *
 * Nothing here ever applies an operator: the panel shows a suggestion and
 * applies it on one click, Rita reads it from the profile and chooses. The
 * dictionary's own `auto_apply` is false, and the pivot's rule that nothing is
 * summed until chosen holds.
 *
 * Three guards, in the order a reader would ask them: is there a rule; is it
 * reviewed for the frequency this pivot rolls up to; and does the grouping
 * keep entities apart. The frequency guard reads every grouped date field --
 * a pivot with none collapses all periods into one cell, which no rule was
 * reviewed for -- and the entity guard reads every grouped non-date field,
 * which must itself carry a `dimension` hint (a period key, a symbol): any
 * other grouping puts several entities in one cell. So does a non-date
 * dimension left ungrouped (a symbol column on a multi-instrument table),
 * except the fiscal period keys, which follow the grouped date.
 */
export function suggestionFor(input: {
  field: string;
  columns: TableColumn[];
  kinds: ReadonlyMap<string, FieldKind>;
  periodicity: ReadonlyMap<string, Periodicity>;
  config: PivotConfig;
}): Suggestion {
  const { field, columns, kinds, periodicity, config } = input;
  const hint = hintOf(columns, field);
  if (!hint || hint.status === "dimension") return { kind: "none" };
  if (hint.time === null || hint.status !== "conditional") return { kind: "unreviewed" };

  const hasDate = columns.some((c) => kinds.get(c.field) === "date");
  if (!legalAggregations(kinds.get(field) ?? "none", hasDate).includes(hint.time)) return { kind: "none" };

  const known = new Set(columns.map((c) => c.field));
  const { grouping, split } = activeLists(config, known);
  const grouped = [...grouping, ...split];

  for (const f of grouped) {
    if (kinds.get(f) === "date") continue;
    if (!isDimension(columns.find((c) => c.field === f))) return { kind: "entity", field: f };
  }

  const dated = grouped.filter((f) => kinds.get(f) === "date");
  if (dated.length === 0) return { kind: "frequency", reviewed: hint.frequencies };
  for (const f of dated) {
    const bucket = bucketOf(config, f);
    const token =
      bucket === "native"
        ? (() => {
            const native = periodicity.get(f);
            return native === undefined ? undefined : PERIODICITY_TOKEN[native];
          })()
        : BUCKET_TOKEN[bucket];
    if (token === undefined || !hint.frequencies.includes(token)) {
      return { kind: "frequency", reviewed: hint.frequencies };
    }
  }
  const [ungrouped] = ungroupedEntityFields(columns, kinds, grouped);
  if (ungrouped !== undefined) return { kind: "entity", field: ungrouped, ungrouped: true };
  return { kind: "suggested", fn: hint.time };
}

/** One sentence for a tooltip or a profile note; null when there is nothing to explain. */
export function suggestionNote(s: Suggestion, header: (field: string) => string): string | null {
  switch (s.kind) {
    case "suggested":
      return null;
    case "unreviewed":
      return "No reviewed rule for this column.";
    case "frequency":
      return `The provider's rule was reviewed at ${s.reviewed.join(", ")}; bucket to one of those to use it.`;
    case "entity":
      return s.ungrouped
        ? `Leaving ${header(s.field)} ungrouped combines entities, for which the provider suggests no rule; group by it to use the rule.`
        : `Grouping by ${header(s.field)} combines entities, for which the provider suggests no rule.`;
    case "none":
      return null;
  }
}
