// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { card } from "../test/fixtures";
import { makeDefaultDocks } from "./dashboardsFile";
import { decodeDocksContent, encodeDocksContent } from "./docksSync";

const docks = () => {
  const d = makeDefaultDocks();
  return { ...d, revision: 1_760_000_000_000, dockRows: { top: 4, bottom: 10 }, tabs: [d.tabs[0], { ...d.tabs[1], cards: [card({ id: "c", title: "Rail" })] }] };
};

describe("the docks' server content (R6)", () => {
  it("round-trips the docks as the file holds them; the revision rides beside the content, not in it", () => {
    const content = encodeDocksContent(docks());
    expect(content).toMatchObject({ schemaVersion: 1, profile: "v8", dashboard: { id: "docks", hidden: true, dockRows: { top: 4, bottom: 10 } } });
    expect(content.dashboard).not.toHaveProperty("revision");
    const back = decodeDocksContent(JSON.parse(JSON.stringify(content)));
    expect(back?.tabs[1].cards[0]).toMatchObject({ id: "c", title: "Rail" });
    expect(back?.dockRows).toEqual({ top: 4, bottom: 10 });
  });

  it("reads nothing it cannot read: another schema, unknown fields, not a dashboard, not the docks", () => {
    const good = JSON.parse(JSON.stringify(encodeDocksContent(docks())));
    for (const bad of [
      null,
      { ...good, schemaVersion: 2 },
      { ...good, profile: "v9" },
      { ...good, extra: true },
      { ...good, dashboard: { id: "docks" } },
      { ...good, dashboard: { ...good.dashboard, id: "d1" } },
    ]) {
      expect(decodeDocksContent(bad)).toBeNull();
    }
  });
});
