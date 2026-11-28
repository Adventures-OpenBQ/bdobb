// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { correctStatementRows, inferYearEnds, isQuarterPeriod, isStatementPeriodParam, knownYearEnds } from "../lib/statementFiscal";
import { isTableSnapshotEnvelope, tableRows } from "../lib/tableRowValues";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { statementSymbolsOf, useAnnualYearEnds, useStatementYearEnds } from "./useStatementYearEnds";

const NO_SYMBOLS: string[] = [];

/**
 * A statement widget's rows carry fiscal labels derived from the reporter's
 * fiscal year end, corrected HERE so the table, the Statement view (and the
 * table worker it reads), charts and export all read the same rows -- whether
 * the card is mounted (WidgetCard) or its source runs headless off-tab
 * (DashboardGrid's BackendSourceRunner). Not a statement widget, or the year
 * end unknown: the rows exactly as the provider sent them. `asReported` is
 * true when the rows could not be relabelled.
 *
 * The year end is the backend's lookup answer first. Where it has none, the
 * company's own rows say: an annual row's closing month, or a quarterly row's
 * named fiscal quarter (inferYearEnds). A quarterly card whose rows name no
 * quarter asks for one annual row per such symbol (useAnnualYearEnds).
 */
export function useStatementRows(
  widget: WidgetDef | undefined,
  backend: BackendConfig | undefined,
  query: Record<string, string>,
  rawData: unknown,
): { data: unknown; asReported: boolean } {
  const periodParam = widget?.params.find((p) => p.paramName === "period");
  const statement = periodParam !== undefined && isStatementPeriodParam(periodParam);
  const statementSymbols = statement ? statementSymbolsOf(query) : [];
  const symbolsKey = statementSymbols.join(",");
  const period = query.period ?? "";
  const yearEnds = useStatementYearEnds(statement ? backend : undefined, statementSymbols);
  const envelope = widget?.type === "table" && isTableSnapshotEnvelope(rawData) ? rawData : undefined;
  const rows = useMemo(() => (statement ? tableRows(envelope ? envelope.rows : rawData) : null), [statement, envelope, rawData]);
  // What the lookup and the rows themselves establish; null until the lookup has answered.
  const known = useMemo(
    () => (rows === null || yearEnds.pending ? null : knownYearEnds(yearEnds.months, inferYearEnds(rows, period, statementSymbols))),
    // yearEnds.months / .pending, not `yearEnds` (a new object every render);
    // statementSymbols is rebuilt every render, so its joined text stands in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, yearEnds.months, yearEnds.pending, period, symbolsKey],
  );
  const unresolved = useMemo(
    () => (known === null || !isQuarterPeriod(period) ? NO_SYMBOLS : statementSymbols.map((s) => s.toUpperCase()).filter((s) => known[s] === null || known[s] === undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [known, period, symbolsKey],
  );
  const annual = useAnnualYearEnds(statement ? backend : undefined, widget, query, unresolved);
  return useMemo(() => {
    if (rows === null || known === null || annual.pending) return { data: rawData, asReported: false };
    const out = correctStatementRows(rows, period, knownYearEnds(annual.months, known), statementSymbols);
    return { data: envelope ? { ...envelope, rows: out.rows } : out.rows, asReported: out.asReported };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData, rows, envelope, known, annual.months, annual.pending, period, symbolsKey]);
}
