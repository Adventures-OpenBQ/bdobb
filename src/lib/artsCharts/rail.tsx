// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The inbox in the left rail (B9): present only while an Art's Charts connection exists.
 * The inbox is its own button, badge and panel; it follows /charts/events and loads snapshots
 * through chartsFetch (spec §3). Keyed on the epoch and the link count: a changed connection remounts it, and so does every
 * link (the package opens an item once per mount, and has no way to tell the host it did).
 */
import { ArtsChartsInbox } from "@adventures-openbq/arts-charts";
import { useArtsChartsStore } from "../../stores/artsChartsStore";
import { useBackendsStore } from "../../stores/backendsStore";
import { artsChartsConnections } from "./connection";

export default function ArtsChartsRailItem() {
  const connected = useBackendsStore((s) => artsChartsConnections(s.backends).active !== null);
  const epoch = useArtsChartsStore((s) => s.epoch);
  const focusItem = useArtsChartsStore((s) => s.focusItem);
  const focusNonce = useArtsChartsStore((s) => s.focusNonce);
  if (!connected) return null;
  return (
    <div className="rail-arts-inbox">
      <ArtsChartsInbox key={`${epoch}:${focusNonce}`} {...(focusItem === null ? {} : { focusItem })} />
    </div>
  );
}
