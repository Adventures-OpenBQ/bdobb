// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WidgetCard's arts_chart branch (spec §1). Gated: WidgetCard reaches it only through lazy().
 * onPatch splits a chart edit the package's way: the card's own facets onto card.chart, the
 * bound facets (interval, range, session, layout) onto their groups. Keyed on the epoch so a
 * changed connection remounts the card on the new host.
 */
import { ArtsChartsRenderer, splitChartEdit } from "@adventures-openbq/arts-charts";
import "@adventures-openbq/arts-charts/arts-charts.css";
import type { ReactNode } from "react";
import { useArtsChartsStore } from "../../stores/artsChartsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import type { BackendConfig, DashboardCard, ParamGroup, WidgetDef } from "../types";

export type ArtsChartsCardProps = {
  backend: BackendConfig; widget: WidgetDef; card: DashboardCard; params: Record<string, string>;
  exchange?: string; groups?: ParamGroup[]; groupsDisabled: boolean; refreshKey: number;
  onParam: (patch: Record<string, string>) => void;
  /** Receives the renderer's command strip; WidgetCard draws it under the card header. */
  controlsSlot: (node: ReactNode) => void;
};

export default function ArtsChartsCard({ backend, widget, card, params, exchange, groups, groupsDisabled, refreshKey, onParam, controlsSlot }: ArtsChartsCardProps) {
  const epoch = useArtsChartsStore((s) => s.epoch);
  const store = useDashboardStore.getState();
  const onPatch = (edit: Parameters<typeof splitChartEdit>[0]) => {
    const { cardPatch, groupEdits } = splitChartEdit(edit, card, groups, groupsDisabled);
    if (Object.keys(cardPatch).length) void store.patchCardField(card.id, "chart", cardPatch);
    if (groupEdits.length) void store.applyCardParams(card.id, { cardParams: card.params, groupEdits });
  };
  return (
    <ArtsChartsRenderer
      key={epoch}
      backend={backend} widget={widget} params={params} state={card.chart ?? {}} card={card}
      onPatch={onPatch} onParam={onParam} onClear={() => void store.patchCardField(card.id, "chart", null)}
      exchange={exchange} groups={groups} groupsDisabled={groupsDisabled} refreshKey={refreshKey}
      controlsSlot={controlsSlot}
    />
  );
}
