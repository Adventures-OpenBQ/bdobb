// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeysRenderer, keysRows } from "./KeysRenderer";

function payload(rows: unknown[], tier = 1) {
  return { tier, rows };
}

/**
 * The three handlers are required — every one of them is wired by the panel
 * that owns this renderer — so a case that is not about them supplies
 * do-nothings and overrides only what it asserts on.
 */
const HANDLERS = {
  onProbe: () => {},
  onTest: () => {},
  onSubmit: async () => ({}),
};

describe("KeysRenderer pills", () => {
  it("shows Own key for a set, non-demo key", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false }])} />);
    expect(screen.getByText("Own key")).toBeInTheDocument();
  });

  it("shows Demo key for a set demo key", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: true }])} />);
    expect(screen.getByText("Demo key")).toBeInTheDocument();
  });

  it("shows Not set for empty and for missing", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "FMP", env_var: "A", status: "empty", demo: false },
      { provider: "FRED", env_var: "B", status: "missing", demo: false },
    ])} />);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows Unknown for unknown", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([{ provider: "FMP", env_var: "A", status: "unknown", demo: false }])} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});

describe("KeysRenderer dots", () => {
  function dotLabel(result: string) {
    const { container } = render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "FMP", env_var: "A", status: "set", demo: false, test: { result, detail: "d" } },
    ])} />);
    return within(container).getByTestId("key-dot");
  }

  it("labels each server state in natural prose, distinct from one another", () => {
    expect(dotLabel("ok")).toHaveAttribute("aria-label", "vendor accepted the key");
    expect(dotLabel("auth_failed")).toHaveAttribute("aria-label", "vendor rejected the key");
    expect(dotLabel("error")).toHaveAttribute("aria-label", "vendor returned an error");
    expect(dotLabel("no_response")).toHaveAttribute("aria-label", "vendor did not respond");
    expect(dotLabel("skipped")).toHaveAttribute("aria-label", "probe skipped");
  });

  it("gives the two amber states distinct labels, since colour alone can't tell them apart", () => {
    const authFailed = dotLabel("auth_failed").getAttribute("aria-label");
    const error = dotLabel("error").getAttribute("aria-label");
    expect(authFailed).not.toBe(error);
  });

  it("marks a transport failure red", () => {
    expect(dotLabel("no_response")).toHaveAttribute("data-tone", "red");
  });

  it("marks an HTTP error amber", () => {
    expect(dotLabel("error")).toHaveAttribute("data-tone", "amber");
  });

  it("marks a rejected key amber, not red", () => {
    expect(dotLabel("auth_failed")).toHaveAttribute("data-tone", "amber");
  });

  it("marks an accepted key green", () => {
    expect(dotLabel("ok")).toHaveAttribute("data-tone", "green");
  });

  it("marks a skipped probe grey", () => {
    expect(dotLabel("skipped")).toHaveAttribute("data-tone", "grey");
  });

  it("is grey when no probe ran at all", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([{ provider: "FMP", env_var: "A", status: "set", demo: false }])} />);
    expect(screen.getByTestId("key-dot")).toHaveAttribute("data-tone", "grey");
  });

  it("falls back to unrecognised for a result matching an inherited Object.prototype property", () => {
    // A plain-object lookup table finds a truthy inherited value for
    // "constructor" (Object.prototype.constructor), which would otherwise
    // slip past the `|| unrecognised()` fallback with a dot carrying no
    // colour and no accessible label.
    const dot = dotLabel("constructor");
    expect(dot).toHaveAttribute("aria-label", "probe ran, but the result is not recognised");
    expect(dot).toHaveAttribute("data-tone", "grey");
  });

  it("distinguishes an unrecognised probe result from no probe at all", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "FMP", env_var: "A", status: "set", demo: false, test: { result: "rate_limited", detail: "HTTP 429" } },
    ])} />);
    const dot = screen.getByTestId("key-dot");
    // Still bounded to grey — inventing a colour for an unknown state would be worse.
    expect(dot).toHaveAttribute("data-tone", "grey");
    // But a probe DID run, so the label must say something other than "not probed".
    expect(dot.getAttribute("aria-label")).not.toBe("not probed");
    // The detail column still shows whatever key-maint sent, regardless of the map.
    expect(screen.getByText("HTTP 429")).toBeInTheDocument();
  });
});

describe("the green-pill amber-dot combination", () => {
  it("keeps the pill green while the dot goes amber, because they answer different questions", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([{
      provider: "FMP", env_var: "A", status: "set", demo: false,
      test: { result: "auth_failed", detail: "HTTP 200, rejected by body" },
    }])} />);
    // The pill says a key of your own is configured — true.
    expect(screen.getByText("Own key")).toBeInTheDocument();
    // The dot says the vendor is not accepting it.
    expect(screen.getByTestId("key-dot")).toHaveAttribute("data-tone", "amber");
    // The detail names which.
    expect(screen.getByText("HTTP 200, rejected by body")).toBeInTheDocument();
  });
});

describe("the row shapes key-maint emits that the feature spec never mentions", () => {
  it("renders the unreadable-credentials banner row as an ordinary row", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "⚠ credentials.env", env_var: "", status: "unknown", demo: false },
      { provider: "FMP", env_var: "FMP_API_KEY", status: "unknown", demo: false },
    ])} />);
    expect(screen.getByText("⚠ credentials.env")).toBeInTheDocument();
    expect(screen.getByText("FMP")).toBeInTheDocument();
  });

  it("renders a malformed-line row", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "⚠ malformed line", env_var: "NOT=A=PAIR", status: "unknown", demo: false },
    ])} />);
    expect(screen.getByText("⚠ malformed line")).toBeInTheDocument();
  });

  it("renders an unregistered credential-shaped variable", () => {
    render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "SOME_OTHER_TOKEN", env_var: "SOME_OTHER_TOKEN", status: "set", demo: false },
    ])} />);
    expect(screen.getByText("SOME_OTHER_TOKEN")).toBeInTheDocument();
  });
});

describe("sorting by provider", () => {
  const rows = [
    { provider: "FRED", env_var: "B", status: "set", demo: false },
    { provider: "Alpha Vantage", env_var: "A", status: "set", demo: false },
    { provider: "Polygon", env_var: "C", status: "set", demo: false },
  ];
  /** The provider triggers, in rendered row order. */
  function order() {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelectorAll("td")[1].textContent);
  }

  it("leaves key-maint's own order alone until the header is clicked", () => {
    render(<KeysRenderer {...HANDLERS} data={payload(rows)} />);
    expect(order()).toEqual(["FRED", "Alpha Vantage", "Polygon"]);
    expect(screen.getByRole("columnheader", { name: "Provider" })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("cycles ascending, descending, then back to the payload's order", async () => {
    render(<KeysRenderer {...HANDLERS} data={payload(rows)} />);
    const header = screen.getByRole("columnheader", { name: "Provider" });

    await userEvent.click(header);
    expect(order()).toEqual(["Alpha Vantage", "FRED", "Polygon"]);
    expect(header).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(header);
    expect(order()).toEqual(["Polygon", "FRED", "Alpha Vantage"]);
    expect(header).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(header);
    expect(order()).toEqual(["FRED", "Alpha Vantage", "Polygon"]);
    expect(header).toHaveAttribute("aria-sort", "none");
  });

  // key-maint's JSON is untrusted: a row without a string provider used to
  // throw a TypeError from localeCompare the moment the header was clicked.
  it("drops a row without a string provider or env_var instead of crashing the sort", async () => {
    render(
      <KeysRenderer
        {...HANDLERS}
        data={payload([...rows, { provider: 7, env_var: "D" }, { provider: "Zed" }, null])}
      />,
    );
    await userEvent.click(screen.getByRole("columnheader", { name: "Provider" }));
    expect(order()).toEqual(["Alpha Vantage", "FRED", "Polygon"]);
  });

  it("sorts from the keyboard: the header is in the Tab order and takes Enter and Space", async () => {
    render(<KeysRenderer {...HANDLERS} data={payload(rows)} />);
    const header = screen.getByRole("columnheader", { name: "Provider" });

    // Tab, not .focus(): what this pins is that the header is IN the tab order.
    await userEvent.tab(); // Refresh button
    await userEvent.tab(); // Provider header
    expect(header).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(order()).toEqual(["Alpha Vantage", "FRED", "Polygon"]);
    expect(header).toHaveAttribute("aria-sort", "ascending");

    await userEvent.keyboard("[Space]");
    expect(order()).toEqual(["Polygon", "FRED", "Alpha Vantage"]);
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts a copy, so the payload it was handed is untouched", async () => {
    const data = payload(rows);
    render(<KeysRenderer {...HANDLERS} data={data} />);
    await userEvent.click(screen.getByRole("columnheader", { name: "Provider" }));
    expect(data.rows).toEqual(rows);
  });
});

describe("KeysRenderer bad payloads", () => {
  it("says so rather than throwing when the payload is not a keys response", () => {
    render(<KeysRenderer {...HANDLERS} data={{ results: [] }} />);
    expect(screen.getByText(/not a key/i)).toBeInTheDocument();
  });

  it("says so rather than throwing for null", () => {
    render(<KeysRenderer {...HANDLERS} data={null} />);
    expect(screen.getByText(/not a key/i)).toBeInTheDocument();
  });

  // Both the keys card's sort and the provider dashboard's byName call
  // localeCompare on provider and on provider_id ?? env_var: a row whose
  // fields are not strings threw there and took the whole panel down.
  it("drops a row whose provider, env_var or provider_id is not a string", () => {
    const rows = keysRows(
      payload([
        { provider: "FRED", env_var: "B", status: "set" },
        { provider: 7, env_var: "D", status: "set" },
        { provider: "Zed", status: "set" },
        { provider: "Quandl", env_var: "Q", provider_id: 9, status: "set" },
      ]),
    );
    expect(rows?.map((r) => r.provider)).toEqual(["FRED"]);
  });
});

describe("secrecy", () => {
  it("never renders a tier-3 value, which the row carries in plaintext", () => {
    const { container } = render(<KeysRenderer {...HANDLERS} data={payload([
      { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false, value: "sk-SECRET-123" },
    ], 3)} />);
    expect(container.innerHTML).not.toContain("sk-SECRET-123");
  });
});

describe("probe cadence", () => {
  const row = { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false };

  it("never probes on its own -- the owner decides when to contact vendors", () => {
    const onProbe = vi.fn();
    const { rerender } = render(
      <KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onProbe={onProbe} />,
    );
    rerender(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onProbe={onProbe} />);
    expect(onProbe).not.toHaveBeenCalled();
  });

  it("asks for a probe when Refresh is pressed", async () => {
    const onProbe = vi.fn();
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onProbe={onProbe} />);
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it("tests a single service from the row context menu", async () => {
    const onTest = vi.fn();
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onTest={onTest} />);
    fireEvent.contextMenu(screen.getByText("FMP"));
    await userEvent.click(screen.getByRole("menuitem", { name: /test this service/i }));
    expect(onTest).toHaveBeenCalledWith("FMP_API_KEY");
  });
});

describe("row context menu keyboard reachability and focus restoration", () => {
  const row = { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false };

  it("reaches the provider trigger by Tab and opens the menu with the Context-Menu key", async () => {
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} />);
    await userEvent.tab(); // Refresh button
    await userEvent.tab(); // Provider column header, which sorts
    await userEvent.tab(); // provider trigger
    const trigger = screen.getByText("FMP");
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("returns focus to the trigger when the menu closes on Escape", async () => {
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} />);
    const trigger = screen.getByText("FMP");
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger when an outside press dismisses the menu", async () => {
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} />);
    const trigger = screen.getByText("FMP");
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger when an item is chosen", async () => {
    const onTest = vi.fn();
    render(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onTest={onTest} />);
    const trigger = screen.getByText("FMP");
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole("menuitem", { name: /test this service/i }));
    expect(trigger).toHaveFocus();
  });
});

describe("tier-3 editing", () => {
  const row = { provider: "FMP", env_var: "FMP_API_KEY", status: "empty", demo: false };

  it("offers no edit control below tier 3", () => {
    render(<KeysRenderer {...HANDLERS} data={{ tier: 2, rows: [row] }} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("offers an edit control at tier 3", () => {
    render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("submits the typed value for that row", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ restart_required: true });
    render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.type(screen.getByLabelText(/new value/i), "sk-NEW");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith("FMP_API_KEY", "sk-NEW");
  });

  it("shows a persistent restart notice naming the container", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ restart_required: true });
    render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.type(screen.getByLabelText(/new value/i), "sk-NEW");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    // The running openbb-api cannot see the change: a container's environ is
    // frozen at process start.
    expect(await screen.findByText(/openbb-api/)).toBeInTheDocument();
    expect(screen.getByText(/restart/i)).toBeInTheDocument();
  });

  it("never puts the typed value in the DOM once submitted", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ restart_required: true });
    const { container } = render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.type(screen.getByLabelText(/new value/i), "sk-SECRET-XYZ");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(container.innerHTML).not.toContain("sk-SECRET-XYZ");
  });
});

describe("tier downgrade with a form open", () => {
  const row = { provider: "FMP", env_var: "FMP_API_KEY", status: "empty", demo: false };

  it("removes an open form — no password input, no Save button — when a refresh drops the tier below 3", async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText(/new value/i)).toBeInTheDocument();

    await act(async () => {
      rerender(<KeysRenderer {...HANDLERS} data={{ tier: 1, rows: [row] }} onSubmit={onSubmit} />);
    });

    expect(screen.queryByLabelText(/new value/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});

describe("a failed submit", () => {
  const row = { provider: "FMP", env_var: "FMP_API_KEY", status: "empty", demo: false };

  it("shows a failure message and no restart notice when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network error"));
    render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.type(screen.getByLabelText(/new value/i), "sk-NEW");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/fail/i)).toBeInTheDocument();
    expect(screen.queryByText(/openbb-api/)).not.toBeInTheDocument();
  });

  it("does not leak an unhandled promise rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const onSubmit = vi.fn().mockRejectedValue(new Error("network error"));
      render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
      await userEvent.click(screen.getByRole("button", { name: /edit/i }));
      await userEvent.type(screen.getByLabelText(/new value/i), "sk-NEW");
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await screen.findByText(/fail/i);
      // Let any unhandled-rejection microtask surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("never puts the typed value in the failure message", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("failed for sk-SECRET-XYZ"));
    const { container } = render(<KeysRenderer {...HANDLERS} data={{ tier: 3, rows: [row] }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.type(screen.getByLabelText(/new value/i), "sk-SECRET-XYZ");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByText(/fail/i);
    expect(container.innerHTML).not.toContain("sk-SECRET-XYZ");
  });
});
