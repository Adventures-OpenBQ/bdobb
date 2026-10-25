// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { AgentCall } from "./agent/types";
import { chatFilename, chatTitle, chatToMarkdown } from "./chatExport";
import type { ChatMessage } from "../stores/chatStore";

const AT = "2026-09-03T10:00:00.000Z";

describe("chatTitle", () => {
  it("is the first human prompt's first line, capped at 80 chars", () => {
    expect(chatTitle([{ role: "human", content: "Compare AAPL\nand MSFT" }])).toBe("Compare AAPL");
    const long = "x".repeat(100);
    expect(chatTitle([{ role: "human", content: long }])).toBe(`${"x".repeat(79)}…`);
    expect(chatTitle([])).toBe("Rita chat");
  });
});

describe("chatFilename", () => {
  it("names the file after the title and export date", () => {
    expect(chatFilename("Compare AAPL", AT)).toBe("Compare AAPL 2026-09-03.md");
  });
});

describe("chatToMarkdown", () => {
  const messages: ChatMessage[] = [
    { role: "human", content: "Show prices" },
    { role: "ai", content: { function: "get_widget_data", input_arguments: {} } },
    { role: "tool", function: "get_widget_data", input_arguments: {}, data: [] },
    {
      role: "ai",
      content: [
        { type: "table", uuid: "t1", name: "Prices", content: [{ sym: "A|B", note: "two\nlines" }, "junk"] },
        { type: "chart", uuid: "c1", content: { data: [], layout: {} } },
        { type: "markdown", uuid: "m1", content: "**bold**" },
      ],
    },
    { role: "ai", content: "Here you go." },
  ];
  const calls: AgentCall[] = [
    { kind: "widget_data", url: "http://x/historical", params: { symbol: "A" }, ok: true, durationMs: 12, rows: 2 },
    { kind: "widget_data", url: "", params: {}, ok: false, error: "unknown widget u", durationMs: 1, rows: 0 },
    { kind: "agent_tool", server_id: "s1", tool: "search", narrated: "Searching" },
  ];

  it("renders headed sections, artifacts and the call ledger", () => {
    const md = chatToMarkdown(messages, calls, AT);
    expect(md.startsWith("# Show prices\n\n_Exported 2026-09-03T10:00:00.000Z_\n")).toBe(true);
    expect(md).toContain("## You\n\nShow prices\n");
    expect(md).toContain("### Prices\n\n| sym | note |\n| --- | --- |\n| A\\|B | two lines |\n|  |  |\n");
    expect(md).toContain("### chart\n\n```json\n{\n  \"data\": [],\n  \"layout\": {}\n}\n```\n");
    expect(md).toContain("### markdown\n\n**bold**\n");
    expect(md).toContain("## Rita\n\nHere you go.\n");
    expect(md).not.toContain("get_widget_data");
    expect(md).toContain(
      "## API calls made on your behalf\n\n- ok http://x/historical {\"symbol\":\"A\"} (2 rows, 12 ms)\n- failed  {} (0 rows, 1 ms) — unknown widget u\n- s1/search: Searching\n",
    );
  });

  it("omits the ledger heading when there were no calls", () => {
    expect(chatToMarkdown([{ role: "human", content: "hi" }], [], AT)).not.toContain("API calls");
  });

  it("names a proxied call by its effective name in the ledger", () => {
    const calls: AgentCall[] = [
      { kind: "agent_tool", server_id: "s1", tool: "call_tool", narrated: "Fetching", display: "OpenBQ · equity_price_historical (via call_tool)" },
      { kind: "agent_tool", server_id: "s1", tool: "call_tool", narrated: "Tool call failed", ok: false, error: "TOOL_DISABLED: off", display: "OpenBQ · x (via call_tool)" },
    ];
    const md = chatToMarkdown([{ role: "human", content: "hi" }], calls, AT);
    expect(md).toContain("- OpenBQ · equity_price_historical (via call_tool): Fetching\n");
    expect(md).toContain("- OpenBQ · x (via call_tool): failed — TOOL_DISABLED: off\n");
    expect(md).not.toContain("s1/call_tool");
  });

  it("renders a failed agent_tool call with its error, not its narration", () => {
    const failedCall: AgentCall = {
      kind: "agent_tool",
      server_id: "s1",
      tool: "quote",
      narrated: "Tool call failed",
      ok: false,
      error: "timeout: MCP tools/call timed out",
    };
    const md = chatToMarkdown([{ role: "human", content: "hi" }], [failedCall], AT);
    expect(md).toContain("- s1/quote: failed — timeout: MCP tools/call timed out\n");
  });
});
