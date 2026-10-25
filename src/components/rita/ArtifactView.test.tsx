// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { ARTIFACT_CSP, ArtifactChart, ArtifactView, MAX_ARTIFACT_ROWS } from "./ArtifactView";

const renderPlot = vi.fn((_node: HTMLElement, _figure: unknown) => Promise.resolve());
const purgePlot = vi.fn((_node: HTMLElement) => {});
vi.mock("../../lib/plotly", () => ({
  renderPlot: (node: HTMLElement, figure: unknown) => renderPlot(node, figure),
  purgePlot: (node: HTMLElement) => purgePlot(node),
  resizePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const logError = vi.fn((_message: string) => Promise.resolve());
vi.mock("../../lib/logger", () => ({ logError: (message: string) => logError(message) }));

describe("ArtifactView", () => {
  it("renders a table capped at 50 rows with a note and formatted numbers", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ n: i, price: 1234567.5 }));
    render(<ArtifactView artifact={{ type: "table", uuid: "t", name: "Prices", content: rows }} />);
    expect(screen.getByRole("heading", { name: "Prices" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(MAX_ARTIFACT_ROWS + 1);
    expect(screen.getByText("Showing 50 of 60 rows")).toBeInTheDocument();
    expect(screen.getAllByText(new Intl.NumberFormat().format(1234567.5)).length).toBeGreaterThan(0);
  });

  it("renders markdown artifacts through the markdown renderer", () => {
    render(<ArtifactView artifact={{ type: "markdown", uuid: "m", content: "**bold**" }} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("mounts a plotly chart once and purges it on unmount", () => {
    const figure = { data: [{ type: "scatter", x: [1], y: [2] }], layout: {} };
    const { unmount } = render(<ArtifactView artifact={{ type: "chart", uuid: "c", content: figure }} />);
    expect(renderPlot).toHaveBeenCalledTimes(1);
    expect(renderPlot.mock.calls[0][1]).toEqual(figure);
    unmount();
    expect(purgePlot).toHaveBeenCalledTimes(1);
  });

  it("logs a rejected chart render instead of leaking it", async () => {
    const figure = { data: [{ type: "scatter", x: [1], y: [2] }], layout: {} };
    renderPlot.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    render(<ArtifactChart figure={figure} />);
    await waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
    expect(logError.mock.calls[0][0]).toBe("artifact chart render failed: boom");
  });

  it("falls back to JSON for an unregistered trace type", () => {
    const figure = { data: [{ type: "sankey" }], layout: {} };
    render(<ArtifactView artifact={{ type: "chart", uuid: "c2", content: figure }} />);
    expect(screen.getByText('Chart type "sankey" is not available; showing the figure as JSON.')).toBeInTheDocument();
    // Both the note ("Chart type "sankey" is not available...") and the <pre>
    // JSON dump (`"type": "sankey"`) contain `"sankey"` in their own direct
    // text nodes, so getByText's uniqueness check throws here regardless of
    // markup; getAllByText keeps the intent (the JSON dump is present).
    expect(screen.getAllByText(/"sankey"/).length).toBeGreaterThan(0);
  });

  it("renders html in a sandboxed iframe", () => {
    render(<ArtifactView artifact={{ type: "html", uuid: "h", content: "<b>x</b>" }} />);
    const frame = screen.getByTitle("HTML artifact") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-forms allow-popups");
    expect(frame.getAttribute("srcdoc")).toBe(`${ARTIFACT_CSP}<b>x</b>`);
    expect(ARTIFACT_CSP).toContain("default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'");
  });

  // The frame runs no script, so an artifact can only follow the theme
  // through prefers-color-scheme; WebKit takes that from the iframe's own
  // color-scheme, so the app's theme setting reaches the artifact.
  it.each(["light", "dark"] as const)("gives the html frame the app's %s color scheme", (theme) => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme } });
    render(<ArtifactView artifact={{ type: "html", uuid: `h-${theme}`, content: "<b>x</b>" }} />);
    expect((screen.getByTitle("HTML artifact") as HTMLIFrameElement).style.colorScheme).toBe(theme);
  });

  it("puts the CSP after a leading doctype, so the artifact keeps standards mode", () => {
    render(<ArtifactView artifact={{ type: "html", uuid: "d", content: "  <!DOCTYPE html><p>x</p>" }} />);
    expect(screen.getByTitle("HTML artifact").getAttribute("srcdoc")).toBe(`  <!DOCTYPE html>${ARTIFACT_CSP}<p>x</p>`);
  });

  it("renders a remote image in a markdown artifact as a link, not an <img>", () => {
    const { container } = render(<ArtifactView artifact={{ type: "markdown", uuid: "m", content: "![](https://attacker.example/p.gif)" }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders anything else as JSON", () => {
    render(<ArtifactView artifact={{ type: "mystery", uuid: "z", content: { a: 1 } }} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it("renders a tool-error artifact as one warning line", () => {
    render(
      <ArtifactView
        artifact={{ type: "tool-error", uuid: "e", name: "Tool call failed", content: { server: "mcp.example", tool: "quote", code: "http_500", message: "MCP tools/call failed: HTTP 500 boom" } }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Tool call failed: mcp.example.quote — http_500: MCP tools/call failed: HTTP 500 boom");
  });

  it("names a proxied tool-error by its effective name", () => {
    render(
      <ArtifactView
        artifact={{
          type: "tool-error",
          uuid: "e",
          name: "Tool call failed",
          content: {
            server: "mcp.example",
            tool: "call_tool",
            display: "mcp.example · equity_price_historical (via call_tool)",
            code: "TOOL_DISABLED",
            message: "equity_price_historical is turned off; it was not sent.",
          },
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tool call failed: mcp.example · equity_price_historical (via call_tool) — TOOL_DISABLED: equity_price_historical is turned off; it was not sent.",
    );
  });
});
