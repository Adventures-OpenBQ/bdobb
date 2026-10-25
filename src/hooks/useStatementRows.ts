// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { correctStatementRows, isStatementPeriodParam } from "../lib/statementFiscal";
import { tableRows } from "../lib/tableColumns";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { statementSymbolsOf, useStatementYearEnds } from "./useStatementYearEnds";

/**
 * A statement widget's rows carry fiscal labels derived from the reporter's
 * fiscal year end, corrected HERE so the table, the Statement view (and the
 * table worker it reads), charts and export all read the same rows -- whether
 * the card is mounted (WidgetCard) or its source runs headless off-tab
 * (DashboardGrid's BackendSourceRunner). Not a statement widget, or the year
 * end unknown: the rows exactly as the provider sent them. `asReported` is
 * true when the rows could not be relabelled.
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
  const yearEnds = useStatementYearEnds(statement ? backend : undefined, statementSymbols);
  return useMemo(() => {
    const rows = statement ? tableRows(rawData) : null;
    if (rows === null || yearEnds.pending) return { data: rawData, asReported: false };
    const out = correctStatementRows(rows, query.period ?? "", yearEnds.months, statementSymbols);
    return { data: out.rows, asReported: out.asReported };
    // yearEnds.months / .pending, not `yearEnds` (a new object every render);
    // statementSymbols is rebuilt every render, so its joined text stands in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData, statement, yearEnds.months, yearEnds.pending, query.period, statementSymbols.join(",")]);
}
