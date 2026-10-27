// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * WidgetCard's arts_chart branch (spec §1). Gated: WidgetCard reaches it only through lazy().
 * onPatch splits a chart edit the package's way: the card's own facets onto card.chart, the
 * bound facets (interval, range, session, layout) onto their groups. Keyed on the epoch so a
 * changed connection remounts the card on the new host.
 */
import { ArtsChartsRenderer, splitChartEdit } from "@adventures-openbq/arts-charts";
import "@adventures-openbq/arts-charts/arts-charts.css";
import { useArtsChartsStore } from "../../stores/artsChartsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import type { BackendConfig, DashboardCard, ParamGroup, WidgetDef } from "../types";

export type ArtsChartsCardProps = {
  backend: BackendConfig; widget: WidgetDef; card: DashboardCard; params: Record<string, string>;
  exchange?: string; groups?: ParamGroup[]; groupsDisabled: boolean; refreshKey: number;
  onParam: (patch: Record<string, string>) => void;
};

export default function ArtsChartsCard({ backend, widget, card, params, exchange, groups, groupsDisabled, refreshKey, onParam }: ArtsChartsCardProps) {
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
    />
  );
}
