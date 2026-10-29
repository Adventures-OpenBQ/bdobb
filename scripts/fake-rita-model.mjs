// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fake OpenAI-compatible model (Chat Completions, streamed) for capturing and
 * checking Rita's Art's Charts snapshot round trip (v12 part 3). Rita's
 * OPENAI_BASE_URL points here. It is not a model: with no tool result in the
 * conversation it calls the offered tool whose name ends in `snapshot_chart` on
 * `chartId`; after a tool result (a `tool` message, or the user message the pinned Rita sends in its place) it answers in one line. Any other request (a
 * title, no snapshot tool offered) gets a one-word answer.
 *
 *   node scripts/fake-rita-model.mjs <port> <chart id>
 */
import { createServer } from "node:http";

const ANSWER = "Here is the AAPL daily chart; the numbers are from the same revision.";

function send(res, delta, finish = null) {
  const chunk = { id: "fake", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }] };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

export function startFakeModel({ port, chartId }) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const tool = (body.tools ?? []).map((t) => t?.function?.name).find((n) => typeof n === "string" && n.endsWith("snapshot_chart"));
    res.writeHead(200, { "content-type": "text/event-stream" });
    // The pinned Rita hands a tool result back as a user message ("MCP tool result from <tool>:").
    const isResult = (m) => m.role === "tool" || (m.role === "user" && typeof m.content === "string" && /^(MCP|Earlier) tool result from /.test(m.content));
    if (messages.some(isResult)) {
      calls.push("answer");
      send(res, { role: "assistant", content: ANSWER });
      send(res, {}, "stop");
    } else if (tool) {
      calls.push(`call ${tool}`);
      send(res, { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: tool, arguments: JSON.stringify({ chart_id: chartId }) } }] });
      send(res, {}, "tool_calls");
    } else {
      calls.push("other");
      send(res, { role: "assistant", content: "ok" });
      send(res, {}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve({ calls, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

if (process.argv[1]?.endsWith("fake-rita-model.mjs")) {
  const [port, chartId] = process.argv.slice(2);
  if (!port || !chartId) throw new Error("Use: node scripts/fake-rita-model.mjs <port> <chart id>");
  await startFakeModel({ port: Number(port), chartId });
  console.log(`fake model on :${port} for chart ${chartId}`);
}
