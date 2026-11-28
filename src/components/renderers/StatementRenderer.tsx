// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { Fragment, useMemo, useState } from "react";
import { repeatedLines } from "../../lib/statementModel/duplicates";
import { formatCell } from "../../lib/format";
import { ITEM_COLUMN, type StatementRows } from "../../lib/statementRows";
import { useSettingsStore } from "../../stores/settingsStore";

/**
 * The pivot grid: a statement's line items down the side under collapsible
 * section rows, one column per fiscal period. Presentational over a Pivot;
 * the folds live on the card (StatementCardState) and arrive as `collapsed`.
 *
 * Drawn on the plain table's markup so it inherits that CSS: no sort,
 * filter, pins or resize -- the columns are the data's own periods, not
 * columns the toolkit knows. A collapsed section's rows are not rendered at
 * all rather than hidden: a statement is a few dozen lines, no virtualiser.
 */
export function StatementRenderer({
  statement,
  collapsed,
  onToggle,
}: {
  statement: StatementRows;
  collapsed: ReadonlySet<string>;
  onToggle: (section: string) => void;
}) {
  const maxDecimalPlaces = useSettingsStore((s) => s.settings.maxDecimalPlaces);
  const span = statement.headers.length + 1;
  // Lines whose figures repeat an earlier line's (statementModel/duplicates.ts). Shown until the user hides them:
  // agreeing figures are evidence that two names mean one thing, not proof.
  const repeats = useMemo(() => repeatedLines(statement.sections), [statement.sections]);
  const [hideRepeats, setHideRepeats] = useState(false);
  return (
    <div className="table-scroll">
      <table className="widget-table plain statement">
        <thead>
          <tr>
            <th scope="col">{ITEM_COLUMN}</th>
            {/* Verbatim: these are the data's own periods, composed by statementRows. */}
            {statement.headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statement.sections.map((section) => {
            const sectionKey = section.id ?? section.name;
            const open = !collapsed.has(sectionKey);
            return (
              <Fragment key={sectionKey}>
                <tr className="statement-section">
                  <td colSpan={span}>
                    <button type="button" aria-expanded={open} onClick={() => onToggle(sectionKey)}>
                      <span className="statement-section-label"><span aria-hidden="true">{open ? "▾" : "▸"}</span> {section.name}
                      {open ? "" : ` (${section.items.length})`}</span>
                    </button>
                  </td>
                </tr>
                {open
                  ? section.items.filter((item) => !(hideRepeats && repeats.has(item.field))).map((item) => (
                      <tr key={item.field}>
                        <td className="statement-label">{item.emphasis ? <strong>{item.label}</strong> : item.label}</td>
                        {item.values.map((value, i) => (
                          // The same call the table view makes for the same cell,
                          // so formatterFn, decimals and abbreviation all apply.
                          <td key={statement.headers[i]} title={item.errors?.[i]?.message}>
                            {item.errors?.[i] ? '#ERROR' : formatCell(value, item.field, maxDecimalPlaces, undefined, item.formats?.[i] ?? item.format)}
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        {repeats.size > 0 ? (
          <tfoot>
            <tr>
              <td colSpan={span}>
                <button type="button" aria-pressed={hideRepeats} onClick={() => setHideRepeats((hidden) => !hidden)}>
                  {hideRepeats ? `Show ${repeats.size} repeated ${repeats.size === 1 ? "line" : "lines"}` : `Hide ${repeats.size} repeated ${repeats.size === 1 ? "line" : "lines"}`}
                </button>
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
