// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ExchangeCalendar } from "../../lib/calendar";
import { wireParams } from "../../lib/params";
import type { WidgetDef } from "../../lib/types";

type Props = {
  /** Absent only until discovery resolves the card; every entry is then untyped. */
  widget?: WidgetDef;
  params: Record<string, string>;
  /** By paramName, as useFiscalYearEnd resolves it. */
  fiscalYearEnd?: Record<string, number>;
  /** By MIC, as useTradingCalendar loads them, so a `bd` step lands where the GET's would. */
  calendars?: Record<string, ExchangeCalendar>;
  /** v5.4.0: the dashboard's exchange. */
  exchange?: string;
};

/**
 * Takes the card's EFFECTIVE params — the group-merged values WidgetCard
 * computes — and shows them as a request would carry them: expressions
 * resolved, a range expanded into its two keys, a quarter labelled under
 * the resolved year end. Through wireParams, the very function the GET
 * uses, so what this card shows IS what a fetching card would send. A
 * built-in with no backend: the whole point is to make a group's effect
 * visible on a card that fetches nothing.
 */
export function ParamEchoRenderer({ widget, params, fiscalYearEnd, calendars, exchange }: Props) {
  const errors: Record<string, string> = {};
  const resolved = wireParams(widget, params, { fiscalYearEnd, calendars, exchange, errors });
  const names = Object.keys(resolved).sort();
  return (
    <dl className="param-echo">
      {names.map((name) => (
        // aria-label on both halves so a term and its definition are findable
        // by the param's name alone; the visible text is the same string.
        <div key={name} className="param-echo-row">
          <dt aria-label={name}>{name}</dt>
          <dd aria-label={name}>{errors[name] !== undefined ? `⚠ ${errors[name]}` : resolved[name]}</dd>
        </div>
      ))}
    </dl>
  );
}
