// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, expect, it } from "vitest";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { card, widget } from "../test/fixtures";
import { __reset } from "../test/memfs";
import { useDashboardStore } from "./dashboardStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  useWidgetRegistryStore.setState({ widgets: [
    widget({ id: "one", params: [{ paramName: "symbol" }] }),
    widget({ id: "many", params: [{ paramName: "symbol", multiSelect: true }] }),
  ] });
});
afterEach(() => useWidgetRegistryStore.setState({ widgets: [] }));

/** Deletes group g, holding `value`, bound by a single-symbol card and a multiSelect card. */
async function deleteWith(value: string) {
  const bound = [{ groupId: "g", paramName: "symbol" }];
  useDashboardStore.setState({
    viewer: false, activeId: "d", activeTabId: "t", pendingCardRemoval: null,
    dashboards: [{
      id: "d", name: "D",
      groups: [{ id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value }],
      tabs: [{ id: "t", name: "T", cards: [
        card({ id: "a", widgetId: "one", params: { symbol: "X" }, bindings: bound }),
        card({ id: "b", widgetId: "many", params: { symbol: "X" }, bindings: bound }),
      ] }],
    }],
  });
  await useDashboardStore.getState().deleteGroup("d", "g");
  return Object.fromEntries(useDashboardStore.getState().dashboards[0].tabs[0].cards.map((c) => [c.id, c.params.symbol]));
}

it("deleting a list group hands a single-symbol member the first entry and a multiSelect member the whole list (U4)", async () => {
  expect(await deleteWith("AAPL,MSFT")).toEqual({ a: "AAPL", b: "AAPL,MSFT" });
});

it("deleting a one-entry group hands it back byte for byte, as today", async () => {
  expect(await deleteWith(" AAPL ")).toEqual({ a: " AAPL ", b: " AAPL " });
});
