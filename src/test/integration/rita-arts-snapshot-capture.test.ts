// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
// Captures src/test/fixtures/rita-arts-snapshot-stream.sse from the pinned Rita
// (v12 part 3, R8). Runs only when RITA_CAPTURE_URL (a local openbq-rita whose
// OPENAI_BASE_URL is this test's fake model) and ARTS_CHARTS_CAPTURE_URL (a local
// arts-charts on fake bars) are set. Never in CI. Re-run it when Rita is re-pinned.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeFunction } from "../../lib/agent/execute";
import { runAgentQuery } from "../../lib/agent/query";
import type { AgentTool } from "../../lib/agent/types";
// @ts-expect-error -- a plain .mjs script with no types
import { startFakeModel } from "../../../scripts/fake-rita-model.mjs";

const ritaUrl = process.env.RITA_CAPTURE_URL ?? "";
const chartsUrl = process.env.ARTS_CHARTS_CAPTURE_URL ?? "";
const modelPort = Number(process.env.CAPTURE_MODEL_PORT ?? "18911");
const live = ritaUrl !== "" && chartsUrl !== "" ? describe : describe.skip;
const OUT = "src/test/fixtures/rita-arts-snapshot-stream.sse";
const SERVER_ID = "arts-charts";

async function mcp(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${chartsUrl}/charts/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.ok, `arts-charts ${method} answered ${res.status}`).toBe(true);
  return ((await res.json()) as { result: Record<string, unknown> }).result;
}

live("capture Rita's arts_chart_snapshot pass-through", () => {
  it("records the stream that carries the artifact", async () => {
    const chart = await fetch(`${chartsUrl}/charts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Apple daily", body: { schema: "chart/1", symbol: "AAPL", interval: "1d" } }),
    }).then((r) => r.json() as Promise<{ id: string }>);
    const model = await startFakeModel({ port: modelPort, chartId: chart.id });
    try {
      const listed = (await mcp("tools/list", {})).tools as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
      const snap = listed.find((t) => t.name === "snapshot_chart");
      expect(snap, "arts-charts lists snapshot_chart").toBeDefined();
      const tools: AgentTool[] = [{
        server_id: SERVER_ID, name: snap!.name, url: `${chartsUrl}/charts/mcp`, endpoint: "",
        description: snap!.description, input_schema: snap!.inputSchema,
      }];
      const streams: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        const text = await res.text();
        streams.push(text);
        return new Response(text, { status: res.status, headers: res.headers });
      };
      const gen = runAgentQuery({
        ritaUrl,
        messages: [{ role: "human", content: "Snapshot my AAPL chart." }],
        refresh: () => ({ primary: [] }),
        tools,
        executeFunction: (payload, signal) => executeFunction(payload, {
          fetchWidget: (async () => { throw new Error("no widgets in this capture"); }) as never,
          runAgentTool: (_server, tool, args) => mcp("tools/call", { name: tool, arguments: args }),
        }, signal),
        timeoutMs: 120_000,
        fetchImpl,
      });
      for (let next = await gen.next(); !next.done; next = await gen.next()) { /* drain */ }
      expect(model.calls, "the fake model was asked to call snapshot_chart, then to answer").toEqual(
        expect.arrayContaining([expect.stringMatching(/^call .*snapshot_chart$/), "answer"]),
      );
      const fixture = streams.find((s) => s.includes("event: copilotMessageArtifact"));
      expect(fixture, "a stream carries copilotMessageArtifact").toBeDefined();
      expect(fixture).toContain('"arts_chart_snapshot"');
      expect(fixture).not.toContain(new URL(chartsUrl).host);
      writeFileSync(OUT, fixture!);
    } finally {
      await model.close();
    }
  }, 180_000);
});
