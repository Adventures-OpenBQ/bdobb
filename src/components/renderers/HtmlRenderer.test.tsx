// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HtmlRenderer } from "./HtmlRenderer";

describe("HtmlRenderer", () => {
  it("puts the server HTML in a srcdoc frame", () => {
    render(<HtmlRenderer data={"<p>hi</p>"} />);
    const frame = screen.getByTitle("Widget content");
    expect(frame).toHaveAttribute("srcdoc", "<p>hi</p>");
  });

  it("sandboxes without allow-same-origin", () => {
    render(<HtmlRenderer data={"<p>hi</p>"} />);
    const sandbox = screen.getByTitle("Widget content").getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts allow-forms allow-popups");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("says so rather than throwing when the payload is not a string", () => {
    render(<HtmlRenderer data={{ html: "<p>hi</p>"}} />);
    expect(screen.getByText(/not html/i)).toBeInTheDocument();
  });
});

/** Same jsdom mechanics as IframeRenderer.test.tsx; see the note there. */
function stubFrame(frame: Element): { win: Window; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", { value: { postMessage }, configurable: true });
  return { win: (frame as HTMLIFrameElement).contentWindow as Window, postMessage };
}

function send(source: unknown, data: unknown, origin: string): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("HtmlRenderer widget messages", () => {
  const messaging = (onParamsUpdate = vi.fn()) => ({
    headers: { "X-Key": "secret-value" },
    params: { symbol: "AAPL" },
    declaredParamNames: ["symbol"],
    onParamsUpdate,
  });

  it("never sends a credential to a srcdoc frame, which has no origin to match", () => {
    // Not a limitation to work around: the frame is sandboxed WITHOUT
    // allow-same-origin precisely so its document cannot act as this app, and
    // a document with no origin has nothing for the auth rule to match.
    render(<HtmlRenderer data={"<p>hi</p>"} messaging={messaging()} />);
    const { win, postMessage } = stubFrame(screen.getByTitle("Widget content"));

    send(win, { type: "openbb-connect" }, "null");

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
  });

  it("still answers a srcdoc frame's connect with the current params", () => {
    render(<HtmlRenderer data={"<p>hi</p>"} messaging={messaging()} />);
    const { win, postMessage } = stubFrame(screen.getByTitle("Widget content"));

    send(win, { type: "openbb-connect" }, "null");

    expect(postMessage).toHaveBeenCalledWith(
      { type: "openbb-params-update", params: { symbol: "AAPL" } },
      "*",
    );
  });

  it("accepts a params update from the HTML widget's own frame", () => {
    const onParamsUpdate = vi.fn();
    render(<HtmlRenderer data={"<p>hi</p>"} messaging={messaging(onParamsUpdate)} />);
    const { win } = stubFrame(screen.getByTitle("Widget content"));

    send(win, { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" }, "null");

    expect(onParamsUpdate).toHaveBeenCalledWith({ symbol: "MSFT" }, []);
  });
});
