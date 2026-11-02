// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// A stand-in for OpenAI's chat completions, for scripts/agent-conformance.sh. It streams
// "stub reply", then the system prompt and the last user message, so a test can see what
// the example agent built from BDOBB's request. A non-streamed call with `functions` answers
// with a call to the first function, every enum parameter set to its first value.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 17799);
const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4o", object: "model", created: 0, owned_by: "stub" }] }));
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404); return res.end(); }
  const parts = []; for await (const p of req) parts.push(p);
  const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const fn = Array.isArray(body.functions) ? body.functions[0] : undefined;
  if (fn && !body.stream) {
    const args = Object.fromEntries(Object.entries(fn.parameters?.properties ?? {}).flatMap(([k, p]) =>
      Array.isArray(p.enum) ? [[k, p.enum[0]]] : p.type === "object" ? [[k, {}]] : []));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "stub", object: "chat.completion", created: 0, model: "gpt-4o",
      choices: [{ index: 0, finish_reason: "function_call", message: { role: "assistant", content: null, function_call: { name: fn.name, arguments: JSON.stringify(args) } } }] }));
  }
  const text = (role) => body.messages.filter((m) => m.role === role).map((m) => m.content).at(-1) ?? "";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(chunk({ role: "assistant", content: `stub reply\n${text("system")}\n${text("user")}` }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
}).listen(port, "127.0.0.1");
