// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../dataClient";
import type { BackendConfig } from "../types";

const { fetchWidgetPath } = vi.hoisted(() => ({ fetchWidgetPath: vi.fn() }));
vi.mock("../dataClient", async (orig) => ({ ...(await orig<typeof import("../dataClient")>()), fetchWidgetPath }));
const { artsChartWidget, discoverArtsCharts } = await import("./widget");

const charts: BackendConfig = {
  id: "c1", name: "My charts", baseUrl: "https://door.example.com", authLocation: "header", validateWidgets: true,
  kind: "arts-charts", door: "gateway", headerName: "Authorization", headerValue: "Bearer test-token",
};

describe("arts_chart widget", () => {
  beforeEach(() => { fetchWidgetPath.mockReset(); });
  it("is B5's definition", () => {
    const w = artsChartWidget(charts);
    expect(w).toMatchObject({ id: "arts_chart", type: "arts_chart", name: "Art's Charts", wsEndpoint: "ta_series_ws", backendId: "c1" });
    expect(w.params.map((p) => [p.paramName, p.show !== false])).toEqual([
      ["symbol", true], ["interval", true], ["provider", true], ["start", true], ["end", true],
      ["chart_id", false], ["live", false], ["panels", false], ["macro", false], ["indicators", false],
    ]);
    expect(w.params.find((p) => p.paramName === "provider")?.options?.map((o) => o.value)).toEqual(["yfinance", "eodhd", "temporaldb"]);
  });
  it("a 200 from /ta_registry is online with the one widget", async () => {
    fetchWidgetPath.mockResolvedValue({ studies: [] });
    const r = await discoverArtsCharts(charts);
    expect(fetchWidgetPath).toHaveBeenCalledWith(charts, "ta_registry", {});
    expect(r).toMatchObject({ backendId: "c1", status: "online", apps: [], issues: [] });
    expect(r.widgets.map((w) => w.id)).toEqual(["arts_chart"]);
  });
  it("a 404 is offline: not an Art's Charts server", async () => {
    fetchWidgetPath.mockRejectedValue(new HttpError("404", 404, ""));
    expect(await discoverArtsCharts(charts)).toMatchObject({ status: "offline", widgets: [], error: "Not an Art's Charts server" });
  });
  it("a 401 is offline with the refusal, not the 404 wording", async () => {
    fetchWidgetPath.mockRejectedValue(new HttpError("401 Unauthorized", 401, ""));
    const r = await discoverArtsCharts(charts);
    expect(r.status).toBe("offline");
    expect(r.error).toBe("The server refused the credential (401)");
  });
});
