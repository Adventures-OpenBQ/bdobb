// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useRef, useState } from "react";
import { compatibleGroups, groupFor } from "../../../lib/paramGroups";
import type { DashboardCard, ParamGroup } from "../../../lib/types";
import { logError } from "../../../lib/logger";
import { getHost } from "../../../host";
import { GroupMenu } from "../../GroupMenu";

type Props = {
  card: DashboardCard;
  groups: ParamGroup[] | undefined;
  groupsDisabled: boolean;
  /** The reserved facet name: CHART_RANGE or CHART_INTERVAL (spec 2026-09-25, F3). */
  paramName: string;
  /** The human word beside the link ("Range" / "Interval"). */
  label: string;
  /** The current encoded facet value: a new group starts from it, and the menu shows it. */
  value: string;
};

/**
 * The join/leave chip for a chart-state facet (spec 2026-09-25, F): the SAME
 * dropdown Symbol and every parameter uses (GroupMenu), but its store calls
 * differ from GroupLink's in one way that matters. A chart facet is not a
 * declared parameter, so LEAVING must not hand the group's value back into
 * `card.params` the way the store's leaveGroup does: queryParams forwards any
 * undeclared key to the endpoint (it drops only form params), so a
 * `chart.range` in params would leak onto the wire -- exactly what F9 keeps a
 * chart facet from doing. So leave goes through dropUngroupable, which removes
 * only the binding. The card's own state.range/state.interval was never
 * written while bound (splitChartEdit keeps a bound facet off the card), so the
 * card returns to exactly what it had (F5). Symbol keeps using GroupLink, where
 * the hand-back IS the right behaviour.
 */
export function ChartGroupChip({ card, groups, groupsDisabled, paramName, label, value }: Props) {
  const { createGroup, joinGroup, dropUngroupable } = getHost().groups;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  // mousedown, not click, for the same reason GroupLink and the card menu use
  // it: the menu must be gone before the press lands somewhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const bound = groupsDisabled ? undefined : groupFor(card, groups, paramName);
  const all = groups ?? [];
  const numberOf = (g: ParamGroup) => all.findIndex((x) => x.id === g.id) + 1;
  // compatibleGroups filters on an EXACT groupType match (F3), so only chart
  // groups of this facet are offered -- a `chart.range` group is never shown to
  // Interval, nor a `symbol` group to either.
  const offerable = compatibleGroups(groups, paramName);

  const run = (what: string, p: Promise<unknown>) => {
    setOpen(false);
    void p.catch((err) => logError(`failed to ${what} for card ${card.id}: ${err}`));
  };

  return (
    <span className="param-link-wrap" ref={ref}>
      {bound ? (
        <button
          type="button"
          className="param-badge param-link"
          aria-label={`Group ${numberOf(bound)}: ${bound.name} — shared across grouped cards`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${bound.name} — shared across grouped cards`}
          onClick={() => setOpen((v) => !v)}
        >
          {numberOf(bound)}
        </button>
      ) : (
        <button
          type="button"
          className="param-link"
          aria-label={`Group ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={groupsDisabled}
          title={groupsDisabled ? "Grouping is off for this dashboard" : `Group ${label}`}
          onClick={() => setOpen((v) => !v)}
        >
          {/* U+FE0E pins the text presentation of the chain link, as GroupLink does. */}
          {"⛓︎"}
        </button>
      )}
      {open ? (
        <GroupMenu
          offered={bound && !offerable.some((g) => g.id === bound.id) ? [bound, ...offerable] : offerable}
          numberOf={numberOf}
          boundGroupId={bound?.id}
          onCreate={() => run("create a chart group", createGroup(card.id, paramName, paramName, value))}
          onJoin={(id) => run("join a chart group", joinGroup(id, card.id, paramName))}
          // Leave through dropUngroupable, NOT leaveGroup: no params hand-back,
          // so the reserved name never reaches card.params or the wire (F9).
          onLeave={() => run("leave a chart group", dropUngroupable(card.id, [paramName]))}
        />
      ) : null}
    </span>
  );
}
