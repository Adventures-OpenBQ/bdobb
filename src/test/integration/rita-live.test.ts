// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
// Runs only when OPENBB_RITA_URL points at a live Rita. Never in CI.
import { describe, expect, it } from "vitest";
import { fetchAgentsJson } from "../../lib/agent/agents-json";
import { buildWidgetRefs, executeFunction, makeWidgetDataFetcher } from "../../lib/agent/execute";
import { runAgentQuery } from "../../lib/agent/query";
import type { AgentMessage } from "../../lib/agent/types";
import type { BackendConfig, DashboardCard, WidgetDef } from "../../lib/types";
import { cardRequestSync } from "../../hooks/useCardRequest";
import { sendFeedback } from "../../lib/agent/feedback";
import { pdfBase64 } from "../pdfFixture";
import { widget as widgetOf } from "../fixtures";

const ritaUrl = process.env.OPENBB_RITA_URL ?? "";
const backendUrl = process.env.OPENBB_BACKEND_URL ?? "http://127.0.0.1:7779";
const live = ritaUrl !== "" ? describe : describe.skip;
// The NAS backend challenges every request; real-endpoints.test.ts sends the same Basic auth.
const nasAuth = process.env.OPENBB_NAS_AUTH ?? "";
const authHeaders: Record<string, string> = nasAuth === "" ? {} : { Authorization: `Basic ${Buffer.from(nasAuth).toString("base64")}` };

const backend: BackendConfig = {
  id: "reference",
  name: "Reference",
  baseUrl: backendUrl,
  authLocation: "header",
  validateWidgets: false,
  ...(nasAuth === "" ? {} : { headerName: "Authorization", headerValue: authHeaders.Authorization }),
};

live("Rita live", () => {
  it("discovers at least one agent", async () => {
    const agents = await fetchAgentsJson(ritaUrl);
    expect(Object.keys(agents).length).toBeGreaterThan(0);
  });

  it("answers a plain turn", async () => {
    // A plain (no-function) turn returns the history UNCHANGED — that is the
    // documented query.ts contract (see query.test.ts "returns the history
    // unchanged"). The reply is delivered as streamed `chunk` events, which
    // chatStore assembles into the ai message. Assemble them the same way
    // here; draining the generator and inspecting the returned history (as
    // this test used to) can never see the answer.
    const gen = runAgentQuery({
      ritaUrl,
      messages: [{ role: "human", content: "Reply with the single word pong." }],
      refresh: () => ({ primary: [] }),
      tools: [],
      executeFunction: async () => {
        throw new Error("no function calls expected");
      },
      timeoutMs: 120_000,
    });
    let text = "";
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      const event = next.value as { type?: string; delta?: string };
      if (event.type === "chunk" && typeof event.delta === "string") text += event.delta;
    }
    expect(text.toLowerCase()).toContain("pong");
  }, 150_000);

  it("round-trips get_widget_data against the reference backend", async () => {
    const res = await fetch(`${backendUrl}/widgets.json`, { headers: authHeaders });
    // Not up, or refused: a failure, never a silent pass.
    expect(res.ok, `widgets.json answered ${res.status}`).toBe(true);
    const widgets = (await res.json()) as Record<string, Omit<WidgetDef, "id" | "backendId">>;
    const [id, raw] = Object.entries(widgets)[0];
    // A served widget may omit `params` entirely; production always runs
    // widgets.json through normalizeWidgets, which defaults it to []. Mirror
    // that here so buildWidgetRefs (which maps over params) does not crash on
    // a param-less widget.
    const widget = { ...raw, id, backendId: backend.id, params: Array.isArray(raw.params) ? raw.params : [] } as WidgetDef;
    const card: DashboardCard = {
      id: "card-1",
      widgetId: id,
      backendId: backend.id,
      params: {},
      layout: { x: 0, y: 0, w: 4, h: 4 },
    };
    const fetchWidget = makeWidgetDataFetcher({ cards: [card], backends: [backend], findWidget: () => widget, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) });
    const primary = buildWidgetRefs([card], () => widget, () => backend.name, new Set());
    let calls = 0;
    // runAgentQuery streams Rita's answer as `chunk` events and returns the history ending on the last
    // TOOL message (query.test.ts: "returns the history unchanged"); it never appends the ai text. The
    // donor asserted the last role was "ai", which this line's contract cannot produce after a tool round.
    const gen = runAgentQuery({
      ritaUrl,
      messages: [{ role: "human", content: `Use get_widget_data on widget ${card.id} and tell me how many rows came back.` }],
      refresh: () => ({ primary }),
      tools: [],
      executeFunction: (payload, signal) => {
        calls += 1;
        return executeFunction(payload, { fetchWidget, runAgentTool: async () => null }, signal);
      },
      timeoutMs: 120_000,
    });
    let text = "";
    const warnings: string[] = [];
    let history: AgentMessage[];
    for (;;) {
      const next = await gen.next();
      if (next.done) { history = next.value; break; }
      const event = next.value as { type?: string; delta?: string; status?: { eventType?: string; message?: string } };
      if (event.type === "chunk" && typeof event.delta === "string") text += event.delta;
      if (event.type === "status" && event.status?.eventType === "WARNING") warnings.push(event.status.message ?? "");
    }
    expect(calls).toBeGreaterThan(0);
    // Hitting the round limit also returns history ending on a tool message, with a WARNING status: that is not a finished answer.
    // Only that WARNING counts: Rita's own per-tool status (e.g. "get_widget_data: no usable data returned") is a WARNING too and is not a limit hit.
    expect(warnings.filter(m => /-round tool limit/.test(m)), "no round-limit WARNING").toEqual([]);
    expect(history[history.length - 1].role).toBe("tool");
    expect(text.trim().length, "Rita answered after the tool round").toBeGreaterThan(0);
  }, 300_000);

  const PDF_CARD: DashboardCard = { id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "conformance_report", backendId: backend.id, params: {}, layout: { x: 0, y: 0, w: 4, h: 4 } };
  const PDF_WIDGET = widgetOf({ id: "conformance_report", backendId: backend.id, name: "Quarterly Report", description: "A one-page PDF report.", type: "pdf", endpoint: "/conformance_report", params: [] });
  const PDF = pdfBase64(["Quarterly report for the conformance run.", "Revenue grew 12 percent in 2025."]);

  /** One turn over a dashboard holding only the PDF card, its document served from memory. */
  async function pdfTurn(question: string) {
    const fetchWidget = makeWidgetDataFetcher(
      { cards: [PDF_CARD], backends: [backend], findWidget: () => PDF_WIDGET, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) },
      (async () => ({ content: PDF, data_format: { data_type: "pdf", filename: "report.pdf" } })) as never,
    );
    const primary = buildWidgetRefs([PDF_CARD], () => PDF_WIDGET, () => backend.name, new Set());
    const gen = runAgentQuery({
      ritaUrl,
      messages: [{ role: "human", content: `${question} The PDF is on widget ${PDF_CARD.id}; load it with get_widget_data.` }],
      refresh: () => ({ primary }),
      tools: [],
      executeFunction: (payload, signal) => executeFunction(payload, { fetchWidget, runAgentTool: async () => null }, signal),
      timeoutMs: 120_000,
    });
    let text = "";
    const citations: Record<string, unknown>[] = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      const e = next.value;
      if (e.type === "chunk") text += e.delta;
      if (e.type === "citations" && Array.isArray(e.payload.citations)) citations.push(...(e.payload.citations as Record<string, unknown>[]));
    }
    return { text, citations };
  }

  it("answers from a PDF card's content", async () => {
    const { text } = await pdfTurn("By what percent did revenue grow in 2025, according to the PDF?");
    expect(text).toMatch(/12\s*(%|percent)/i);
  }, 300_000);

  it("cites a PDF quote with at least one highlight box", async () => {
    const { citations } = await pdfTurn("Quote the sentence about revenue verbatim and cite it with cite_quote.");
    expect(citations.some((c) => Array.isArray(c.quote_bounding_boxes) && c.quote_bounding_boxes.length > 0)).toBe(true);
  }, 300_000);

  it("accepts a feedback vote", async () => {
    await expect(sendFeedback(ritaUrl, { vote: "thumbs_up", tags: [], user_comment: "", ai_response: "pong", user_prompt: "ping", trace_id: crypto.randomUUID() })).resolves.toBeUndefined();
  });
});
