// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID } from "../lib/builtins";
import type { Dashboard, DashboardCard, WidgetDef } from "../lib/types";
import { __resetLoggerForTests } from "../lib/logger";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useProviderKeysStore } from "../stores/providerKeysStore";
import { useBackendsStore } from "../stores/backendsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __read, __reset as __resetFs } from "../test/memfs";
import { backend, card, widget as baseWidget } from "../test/fixtures";
import { WIDGET_DRAG_TYPE, WidgetLibrary, type LibraryTarget } from "./WidgetLibrary";

const TARGET: LibraryTarget = { dashboardId: "d1", tabId: "t1" };

const widget = (over: Partial<WidgetDef>): WidgetDef => baseWidget({ name: "Widget", ...over });

// Several tests below replace addCardTo with a vi.fn() via setState.
// vi.restoreAllMocks() does not undo that (it only reverts vi.spyOn spies),
// so the real action is captured once at module load and reinstated here
// before every test.
const REAL_ACTIONS = { addCardTo: useDashboardStore.getState().addCardTo };

function setDashboard(cards: DashboardCard[] = []) {
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards }] }],
    activeId: "d1",
    activeTabId: "t1",
    previousId: null,
  });
}

beforeEach(() => {
  __resetLoggerForTests();
  __resetFs();
  useFoldersStore.setState({ folders: [], folderOrder: [], placement: {}, collapsed: [] });
  useWidgetRegistryStore.setState({
    widgets: [
      widget({ id: "prices", name: "Price History", category: "Equity", type: "table", subCategory: "Price", source: ["FMP"] }),
      widget({ id: "chart", name: "Candles", category: "Equity", type: "chart", subCategory: "Price", source: ["yFinance"] }),
      widget({
        id: "cpi",
        name: "Consumer Prices",
        category: "Economy",
        type: "table",
        subCategory: "CPI",
        source: ["FRED"],
        description: "Inflation series",
      }),
    ],
  });
  setDashboard([]);
  useProviderKeysStore.setState({ status: {}, probe: {}, source: "none" });
});

describe("WidgetLibrary", () => {
  // A div overlay, not a <dialog>: nothing moves focus in on its own, so
  // after ⌘K typing would reach nothing and Tab would walk the background.
  it("focuses the search box on open and hands focus back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByRole("searchbox")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("lists every discovered widget with its name and type badge", () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByText("Price History")).toBeInTheDocument();
    expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
    // Scoped to the type badge: "table" and "chart" are now also option
    // text inside the new Type <select>, so an unscoped query would match
    // both the badge and the filter option.
    expect(screen.getAllByText("table", { selector: ".type-badge" })).toHaveLength(2);
    expect(screen.getByText("chart", { selector: ".type-badge" })).toBeInTheDocument();
  });

  it("filters by name via the search box", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.type(screen.getByRole("searchbox"), "candle");
    expect(screen.getByText("Candles")).toBeInTheDocument();
    expect(screen.queryByText("Price History")).not.toBeInTheDocument();
  });

  it("searches the description too", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.type(screen.getByRole("searchbox"), "inflation");
    expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
    expect(screen.queryByText("Candles")).not.toBeInTheDocument();
  });

  it("filters by category and composes with search", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Economy");
    expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
    expect(screen.queryByText("Price History")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "candle");
    expect(screen.queryByText("Consumer Prices")).not.toBeInTheDocument();
  });

  it("clears a category filter by selecting All categories again", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const category = screen.getByLabelText("Category");

    await userEvent.selectOptions(category, "Economy");
    expect(screen.queryByText("Price History")).not.toBeInTheDocument();

    await userEvent.selectOptions(category, "");
    expect(screen.getByText("Price History")).toBeInTheDocument();
  });

  it("filters by type", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "chart");
    expect(screen.getByText("Candles")).toBeInTheDocument();
    expect(screen.queryByText("Price History")).not.toBeInTheDocument();
  });

  it("filters by provider", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "FRED");
    expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
    expect(screen.queryByText("Candles")).not.toBeInTheDocument();
  });

  it("composes all four filters with search", async () => {
    // Fixture where each filter is individually load-bearing: every decoy
    // differs from the target in exactly one dimension, so dropping any one
    // of the four filters below reintroduces exactly that filter's decoy.
    // (The three-widget default fixture doesn't do this: its one decoy
    // fails two dimensions at once, so the test would still pass even with
    // one of the four filters silently broken.)
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "target", name: "Target Widget", category: "Equity", subCategory: "Price", type: "table", source: ["FMP"] }),
        widget({ id: "decoy-category", name: "Decoy Category Widget", category: "Economy", subCategory: "Price", type: "table", source: ["FMP"] }),
        widget({ id: "decoy-subcategory", name: "Decoy Subcategory Widget", category: "Equity", subCategory: "Other", type: "table", source: ["FMP"] }),
        widget({ id: "decoy-type", name: "Decoy Type Widget", category: "Equity", subCategory: "Price", type: "chart", source: ["FMP"] }),
        widget({ id: "decoy-provider", name: "Decoy Provider Widget", category: "Equity", subCategory: "Price", type: "table", source: ["yFinance"] }),
      ],
    });

    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Equity");
    await userEvent.selectOptions(screen.getByLabelText("Subcategory"), "Price");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "table");
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "FMP");

    expect(screen.getByText("Target Widget")).toBeInTheDocument();
    expect(screen.queryByText("Decoy Category Widget")).not.toBeInTheDocument();
    expect(screen.queryByText("Decoy Subcategory Widget")).not.toBeInTheDocument();
    expect(screen.queryByText("Decoy Type Widget")).not.toBeInTheDocument();
    expect(screen.queryByText("Decoy Provider Widget")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.queryByText("Target Widget")).not.toBeInTheDocument();
  });

  it("reflects the selected category in the Category select's value", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const category = screen.getByLabelText("Category");
    await userEvent.selectOptions(category, "Economy");
    expect(category).toHaveValue("Economy");
  });

  it("Reset clears the filters but leaves the search text untouched", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Economy");
    await userEvent.type(screen.getByRole("searchbox"), "candle");
    // Category=Economy plus search "candle" matches nothing yet.
    expect(screen.queryByText("Candles")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(screen.getByRole("searchbox")).toHaveValue("candle");
    expect(screen.getByLabelText("Category")).toHaveValue("");
    // With the category filter cleared, the untouched search now matches.
    expect(screen.getByText("Candles")).toBeInTheDocument();
  });

  // These use fireEvent rather than userEvent so the click's `detail` is
  // exactly what a real browser would give it -- 1 for a plain click, 2 for
  // the second click of a double click, 0 for Enter/Space activation of a
  // focused button -- which is the whole of the add-vs-add-and-close rule.
  it("single click adds exactly once and does not close the library", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    const onClose = vi.fn();

    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 1 });
    await act(async () => {});

    expect(addCardTo).toHaveBeenCalledTimes(1);
    expect(addCardTo).toHaveBeenCalledWith("d1", "t1", expect.objectContaining({ id: "prices" }), {});
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /widget library/i })).toBeInTheDocument();
  });

  it("double-click adds exactly once and closes the library, even though it also fires click, click", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    const onClose = vi.fn();

    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    const button = screen.getByRole("button", { name: /add price history/i });
    // A real double-click fires click(detail 1), click(detail 2), then
    // dblclick, in that order. The detail-1 click is the add; the detail-2
    // click must NOT add a second time, only close.
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.doubleClick(button);
    await act(async () => {});

    expect(addCardTo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dblclick with the active dashboard switched to B returns to origin A/a1 and closes", async () => {
    useDashboardStore.setState({
      ...REAL_ACTIONS,
      dashboards: [
        { id: "d1", name: "One", tabs: [{ id: "a1", name: "Main", cards: [] }] },
        { id: "d2", name: "Two", tabs: [{ id: "b1", name: "Main", cards: [] }] },
      ],
      activeId: "d1",
      activeTabId: "a1",
      previousId: null,
    });
    const origin: LibraryTarget = { dashboardId: "d1", tabId: "a1" };
    const onClose = vi.fn();
    render(<WidgetLibrary onClose={onClose} target={origin} />);

    // Simulate the active dashboard changing (e.g. via the rail) while the
    // library stays open, same as the Option+0 scenario below.
    useDashboardStore.getState().setActive("d2");
    expect(useDashboardStore.getState().activeId).toBe("d2");

    const button = screen.getByRole("button", { name: /add price history/i });
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.doubleClick(button);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(useDashboardStore.getState().activeId).toBe("d1");
    expect(useDashboardStore.getState().activeTabId).toBe("a1");
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
  });

  it("adds once on keyboard activation (Enter), whose click carries detail 0", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    const onClose = vi.fn();

    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 0 });
    await act(async () => {});

    expect(addCardTo).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("click A then click B adds both, and closes for neither", async () => {
    // Two different cards clicked in quick succession: the browser gives the
    // second one detail 1 as well (a double click needs the same target), so
    // both are plain adds.
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    const onClose = vi.fn();

    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: /add candles/i }), { detail: 1 });
    await act(async () => {});

    expect(addCardTo).toHaveBeenCalledTimes(2);
    expect(addCardTo).toHaveBeenCalledWith("d1", "t1", expect.objectContaining({ id: "prices" }), {});
    expect(addCardTo).toHaveBeenCalledWith("d1", "t1", expect.objectContaining({ id: "chart" }), {});
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps both adds when Escape closes the library right after two clicks", async () => {
    // A click adds there and then -- there is no window in which the add is
    // still pending and Escape could take it back. Escape closes the
    // library; the two cards stay added.
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    const onClose = vi.fn();

    const { unmount } = render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: /add candles/i }), { detail: 1 });

    const search = screen.getByRole("searchbox");
    fireEvent(search, new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {});

    expect(addCardTo).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state pointing at the connections dialog when nothing is discovered", () => {
    useWidgetRegistryStore.setState({ widgets: [] });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByText(/no widgets/i)).toBeInTheDocument();
    expect(screen.getByText(/connections/i)).toBeInTheDocument();
  });

  it("shows a no-matches state (not the connections pointer) when search has no hits", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz-nonexistent");

    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
    expect(screen.queryByText(/no widgets discovered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connections/i)).not.toBeInTheDocument();
  });

  it("closes on the close button and on Escape, without changing the active dashboard", async () => {
    const onClose = vi.fn();
    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("takes the Escape for itself, so nothing behind the overlay also acts on it", async () => {
    const onClose = vi.fn();
    render(<WidgetLibrary onClose={onClose} target={TARGET} />);

    // Attached AFTER the library is open, in the bubble phase: this stands in
    // for a maximized WidgetCard's own window Escape listener. Without the
    // library's stopImmediatePropagation, one press would close the library
    // AND restore the card underneath it.
    const spy = vi.fn();
    window.addEventListener("keydown", spy);
    try {
      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", spy);
    }
  });

  describe("Option+0", () => {
    it("returns to the library's origin dashboard/tab and closes it, even if the active dashboard changed while it was open", () => {
      useDashboardStore.setState({
        ...REAL_ACTIONS,
        dashboards: [
          { id: "d1", name: "One", tabs: [{ id: "a1", name: "Main", cards: [] }] },
          { id: "d2", name: "Two", tabs: [{ id: "b1", name: "Main", cards: [] }] },
        ],
        activeId: "d1",
        activeTabId: "a1",
        previousId: null,
      });
      const origin: LibraryTarget = { dashboardId: "d1", tabId: "a1" };
      const onClose = vi.fn();
      render(<WidgetLibrary onClose={onClose} target={origin} />);

      // Simulate the active dashboard changing (e.g. via the rail) while the
      // library stays open.
      useDashboardStore.getState().setActive("d2");
      expect(useDashboardStore.getState().activeId).toBe("d2");

      const search = screen.getByRole("searchbox");
      fireEvent(search, new KeyboardEvent("keydown", { code: "Digit0", altKey: true, bubbles: true }));

      expect(useDashboardStore.getState().activeId).toBe("d1");
      expect(useDashboardStore.getState().activeTabId).toBe("a1");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("origin dashboard deleted -- leaves the active dashboard unchanged and closes", () => {
      // The origin ("d1") is gone by the time Option+0 fires; returnToOrigin
      // must not blindly setActive/setActiveTab a stale id (dashboardStore's
      // setters have no such guard themselves).
      useDashboardStore.setState({
        ...REAL_ACTIONS,
        dashboards: [{ id: "d2", name: "Two", tabs: [{ id: "b1", name: "Main", cards: [] }] }],
        activeId: "d2",
        activeTabId: "b1",
        previousId: null,
      });
      const origin: LibraryTarget = { dashboardId: "d1", tabId: "a1" };
      const onClose = vi.fn();
      render(<WidgetLibrary onClose={onClose} target={origin} />);

      const search = screen.getByRole("searchbox");
      fireEvent(search, new KeyboardEvent("keydown", { code: "Digit0", altKey: true, bubbles: true }));

      expect(useDashboardStore.getState().activeId).toBe("d2");
      expect(useDashboardStore.getState().activeTabId).toBe("b1");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does nothing on a plain '0' with no Option modifier", () => {
      const onClose = vi.fn();
      render(<WidgetLibrary onClose={onClose} target={TARGET} />);
      const search = screen.getByRole("searchbox");
      fireEvent(search, new KeyboardEvent("keydown", { code: "Digit0", bubbles: true }));

      expect(onClose).not.toHaveBeenCalled();
      expect(useDashboardStore.getState().activeId).toBe("d1");
    });
  });

  it("contains a rejected add-card write instead of letting it escape as an unhandled rejection", async () => {
    // addCardTo reaches saveDashboard, which can reject on a failed disk
    // write. The library must catch that rejection (and log it) rather than
    // let it surface as an unhandled rejection. In Vitest an uncaught
    // rejection fails the run at the process level even when every expect()
    // below passes, so that is the real signal here.
    //
    // The call-count assertion alone would also pass against a wholesale
    // revert to `void addCardTo(...)` with no try/catch at all -- only the
    // log-content assertion below, which only exists if the catch body
    // actually ran, tells the two apart. Mirrors the containment test in
    // DashboardGrid.test.tsx.
    const addCardTo = vi.fn().mockRejectedValue(new Error("disk full"));
    useDashboardStore.setState({ addCardTo });

    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 1 });

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to add card for widget prices");
    });
  });

  it("cannot be made to forge a second log line by a widget id with a newline in it", async () => {
    // A widget's KEY in a backend's widgets.json is unvalidated -- widgetsJson
    // takes `Object.entries(root)` verbatim, so the id is whatever string that
    // backend chose, newlines included. It reaches logError here, and the log
    // is a line-oriented file the user reads and sends in: an unclamped id
    // could end its line early and write a whole fabricated ERROR line of the
    // backend's choosing beneath it.
    useWidgetRegistryStore.setState({
      widgets: [
        widget({
          id: "evil\n2026-01-01T00:00:00.000Z ERROR credentials accepted from 10.0.0.1",
          name: "Evil",
          category: "Equity",
          type: "table",
          subCategory: "Price",
          source: ["FMP"],
        }),
      ],
    });
    const addCardTo = vi.fn().mockRejectedValue(new Error("disk full"));
    useDashboardStore.setState({ addCardTo });

    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add evil/i }), { detail: 1 });

    await waitFor(() => {
      expect(__read("logs/bdobb.log") ?? "").toContain("failed to add card for widget evil");
    });

    const log = __read("logs/bdobb.log") ?? "";
    // The forged text may still appear -- clamping strips the control
    // character, it does not censor words. What must NOT survive is the line
    // BREAK, which is the only thing that turns text into a second record.
    const records = log.split("\n").filter((line) => line.includes("ERROR"));
    expect(records).toHaveLength(1);
    expect(log).not.toContain("\nERROR");
    expect(log).not.toContain("\n2026-01-01T00:00:00.000Z ERROR");
  });

  it("origin tab deleted -- single click logs and closes, no card added", async () => {
    // The real addCardTo returns null when its target tab is gone (removed
    // while the library stayed open); handleAdd must treat that as reason
    // to log and close, not stay silently open over dead UI.
    useDashboardStore.setState({
      ...REAL_ACTIONS,
      dashboards: [{ id: "d1", name: "Main", tabs: [] }],
      activeId: "d1",
      activeTabId: null,
      previousId: null,
    });
    const onClose = vi.fn();

    render(<WidgetLibrary onClose={onClose} target={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: /add price history/i }), { detail: 1 });
    await act(async () => {});

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useDashboardStore.getState().dashboards[0].tabs).toHaveLength(0);

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("widget library target tab t1 no longer exists");
    });
  });

  it("shows the provider name on a single-source widget", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "one", name: "One", source: ["FRED"] })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    // Scoped to the source badge: "FRED" is now also option text inside the
    // Provider <select>, so an unscoped query would match both.
    expect(screen.getByText("FRED", { selector: ".source-badge" })).toBeInTheDocument();
  });

  it("labels a multi-source widget Multisource, listing them in the title", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "many", name: "Many", source: ["FRED", "OECD"] })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const badge = screen.getByText("Multisource");
    // Each provider carries its own probe tone; OECD needs no key, so it has
    // none to carry. (See "provider badge tones" below.)
    expect(badge).toHaveAttribute("title", "FRED: not probed, OECD");
  });

  it("renders no provider badge when the widget has no source", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "none", name: "None", type: "table", source: [] })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    // The type badge is still there; only the source badge is absent.
    // Scoped to the badge: "table" is now also option text inside the Type
    // <select>, so an unscoped query would match both.
    expect(screen.getByText("table", { selector: ".type-badge" })).toBeInTheDocument();
    expect(screen.queryByTestId("source-badge")).toBeNull();
  });

  it("renders the badges backend, then provider, then type", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "one", name: "One", type: "table", source: ["FRED"] })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const badges = screen.getByRole("button", { name: /add one/i }).querySelector(".library-card-badges");
    const children = Array.from(badges?.children ?? []);
    expect(children.map((el) => el.className)).toEqual([
      "backend-badge",
      "source-badge",
      "type-badge",
    ]);
  });

  it("names the backend on the card, from Connections", () => {
    useBackendsStore.setState({ backends: [backend({ id: "b1", name: "OpenBB Community" })] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "one", name: "One", backendId: "b1" })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByTestId("backend-badge")).toHaveTextContent("OpenBB Community");
  });

  it("marks a builtin widget Built-in rather than leaving the pill blank", () => {
    useBackendsStore.setState({ backends: [] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "one", name: "One", backendId: BUILTIN_BACKEND_ID })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByTestId("backend-badge")).toHaveTextContent("Built-in");
  });

  it("falls back to the bare id for a backend removed from Connections", () => {
    useBackendsStore.setState({ backends: [] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "one", name: "One", backendId: "gone" })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByTestId("backend-badge")).toHaveTextContent("gone");
  });

  it("filters by backend, and clears the choice when that backend's widgets go (#5)", async () => {
    useBackendsStore.setState({
      backends: [backend({ id: "b1", name: "Reference" }), backend({ id: "b2", name: "OpenBQ Docker" })],
    });
    const one = widget({ id: "one", name: "One", backendId: "b1" });
    const two = widget({ id: "two", name: "Two", backendId: "b2" });
    useWidgetRegistryStore.setState({ widgets: [one, two] });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.selectOptions(screen.getByLabelText("Backend"), "b2");
    expect(screen.queryByRole("button", { name: /add one/i })).toBeNull();
    expect(screen.getByRole("button", { name: /add two/i })).toBeInTheDocument();
    // Removing b2 in Connections takes its widgets out of the registry; the
    // filter must not stay on an id that matches nothing.
    act(() => useWidgetRegistryStore.setState({ widgets: [one] }));
    expect(screen.getByLabelText("Backend")).toHaveValue("");
    expect(screen.getByRole("button", { name: /add one/i })).toBeInTheDocument();
  });

  it("pins the widget drag type, since drop handlers key off its exact value", () => {
    expect(WIDGET_DRAG_TYPE).toBe("application/x-bdobb-widget");
  });

  it("makes each card draggable and writes the widget key on dragstart", () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const card = screen.getByRole("button", { name: /add price history/i });
    expect(card).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(WIDGET_DRAG_TYPE, "b1:prices");
  });

  it("never lists a keys-type widget, because that surface lives in Settings", () => {
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "prices", name: "Price History", type: "table" }),
        widget({ id: "provider_api_keys_panel", name: "Provider keys", type: "keys" }),
      ],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByText("Price History")).toBeInTheDocument();
    expect(screen.queryByText("Provider keys")).not.toBeInTheDocument();
  });

  it("never lists a settings-type widget, because it is a section of the Settings dialog", () => {
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "prices", name: "Price History", type: "table" }),
        widget({ id: "rss_ticker_settings", name: "RSS ticker", type: "settings" }),
      ],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByText("Price History")).toBeInTheDocument();
    expect(screen.queryByText("RSS ticker")).not.toBeInTheDocument();
  });

  it("never lists the local-table built-in, which only a file drop can create", () => {
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "prices", name: "Price History", type: "table" }),
        widget({ id: "local_table", name: "Local file", type: "local_table" }),
      ],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    expect(screen.getByText("Price History")).toBeInTheDocument();
    expect(screen.queryByText("Local file")).not.toBeInTheDocument();
  });

  describe("already-on-this-tab shading", () => {
    it("shades only the entry whose widget/backend pair is already on the target tab", () => {
      setDashboard([card({ id: "c1", widgetId: "prices", backendId: "b1" })]);
      render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);

      const present = screen.getByRole("button", { name: /add price history/i });
      const absent = screen.getByRole("button", { name: /add candles/i });

      expect(present).toHaveClass("library-card-present");
      expect(present).toHaveAttribute("aria-label", "Add Price History (already on this tab)");
      expect(absent).not.toHaveClass("library-card-present");
      expect(absent).toHaveAttribute("aria-label", "Add Candles");
    });

    it("shades an entry once it has been added, without closing the library", async () => {
      setDashboard([]);
      const onClose = vi.fn();

      render(<WidgetLibrary onClose={onClose} target={TARGET} />);
      const candles = screen.getByRole("button", { name: /add candles/i });
      expect(candles).not.toHaveClass("library-card-present");

      fireEvent.click(candles, { detail: 1 });
      await act(async () => {});

      expect(screen.getByRole("button", { name: /add candles/i })).toHaveClass("library-card-present");
    });
  });

  describe("dashboard pills", () => {
    /** One tab per dashboard unless a test says otherwise. */
    const dash = (id: string, name: string, cards: DashboardCard[] = []): Dashboard => ({
      id,
      name,
      tabs: [{ id: `${id}-t1`, name: "Main", cards }],
    });

    /** The library was opened from d1's only tab. */
    const PILL_TARGET: LibraryTarget = { dashboardId: "d1", tabId: "d1-t1" };

    function setDashboards(dashboards: Dashboard[]) {
      useDashboardStore.setState({
        ...REAL_ACTIONS,
        dashboards,
        activeId: "d1",
        activeTabId: "d1-t1",
        previousId: null,
      });
    }

    const prices = (id = "c") => card({ id, widgetId: "prices", backendId: "b1" });

    function pills(widgetName: string): HTMLElement[] {
      const cardEl = screen.getByRole("button", { name: new RegExp(`add ${widgetName}`, "i") });
      return Array.from(cardEl.querySelectorAll<HTMLElement>(".dashboard-badge"));
    }

    it("shows no pills for a widget that is on no dashboard", () => {
      setDashboards([dash("d1", "Main"), dash("d2", "Macro")]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      expect(pills("candles")).toEqual([]);
      expect(
        screen.getByRole("button", { name: /add candles/i }).querySelector(".library-card-dashboards"),
      ).toBeNull();
    });

    it("shows one pill, titled On <name>, for the single dashboard the widget is on", () => {
      setDashboards([dash("d1", "Main", [prices()]), dash("d2", "Macro")]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      const [pill, ...rest] = pills("price history");
      expect(rest).toEqual([]);
      expect(pill).toHaveTextContent("Main");
      expect(pill).toHaveAttribute("title", "On Main");
    });

    it("shows all three pills at three dashboards, with no overflow pill", () => {
      setDashboards([
        dash("d1", "Main", [prices()]),
        dash("d2", "Macro", [prices()]),
        dash("d3", "Credit", [prices()]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      expect(pills("price history").map((p) => p.textContent)).toEqual(["Main", "Macro", "Credit"]);
    });

    it("shows the first three and a +N pill listing the rest at five dashboards", () => {
      setDashboards([
        dash("d1", "Main", [prices()]),
        dash("d2", "Macro", [prices()]),
        dash("d3", "Credit", [prices()]),
        dash("d4", "Rates", [prices()]),
        dash("d5", "FX", [prices()]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      const rendered = pills("price history");
      expect(rendered.map((p) => p.textContent)).toEqual(["Main", "Macro", "Credit", "+2"]);
      expect(rendered[3]).toHaveAttribute("title", "On Rates, FX");
    });

    it("marks only the pill for the dashboard the library was opened from", () => {
      setDashboards([dash("d1", "Main", [prices()]), dash("d2", "Macro", [prices()])]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      const [main, macro] = pills("price history");
      expect(main).toHaveAttribute("data-active");
      expect(macro).not.toHaveAttribute("data-active");
    });

    it("counts an unresolved card as presence, matching on widget id alone", () => {
      setDashboards([
        dash("d1", "Main"),
        dash("d2", "Macro", [card({ widgetId: "prices", backendId: UNRESOLVED_BACKEND_ID })]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      expect(pills("price history").map((p) => p.textContent)).toEqual(["Macro"]);
    });

    it("shows one pill for a widget sitting on two tabs of the same dashboard", () => {
      setDashboards([
        {
          id: "d1",
          name: "Main",
          tabs: [
            { id: "d1-t1", name: "One", cards: [prices("c1")] },
            { id: "d1-t2", name: "Two", cards: [prices("c2")] },
          ],
        },
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      expect(pills("price history").map((p) => p.textContent)).toEqual(["Main"]);
    });

    it("orders pills the way the rail orders its rows: a foldered dashboard before a top-level one", () => {
      setDashboards([dash("d1", "Main", [prices()]), dash("d2", "Macro", [prices()])]);
      // d2 sits in a folder, so the rail draws it above the top-level d1 --
      // the reverse of the flat dashboard order the store holds.
      useFoldersStore.setState({
        folders: [{ id: "f1", name: "Research", parentId: null }],
        folderOrder: ["f1"],
        placement: { d2: "f1" },
        collapsed: [],
      });
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      expect(pills("price history").map((p) => p.textContent)).toEqual(["Macro", "Main"]);
    });

    it("leaves the already-on-this-tab outline and label exactly as they were", () => {
      setDashboards([dash("d1", "Main", [prices()]), dash("d2", "Macro", [prices()])]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      const present = screen.getByRole("button", { name: /add price history/i });
      expect(present).toHaveClass("library-card-present");
      expect(present).toHaveAttribute("aria-label", "Add Price History (already on this tab)");
    });

    it("does not shade a card whose only presence is on another dashboard", () => {
      setDashboards([dash("d1", "Main"), dash("d2", "Macro", [prices()])]);
      render(<WidgetLibrary onClose={vi.fn()} target={PILL_TARGET} />);

      const cardEl = screen.getByRole("button", { name: /add price history/i });
      expect(cardEl).not.toHaveClass("library-card-present");
      expect(cardEl).toHaveAttribute("aria-label", "Add Price History");
      expect(pills("price history").map((p) => p.textContent)).toEqual(["Macro"]);
    });
  });

  describe("On dashboard filter", () => {
    const dash = (id: string, name: string, cards: DashboardCard[] = []): Dashboard => ({
      id,
      name,
      tabs: [{ id: `${id}-t1`, name: "Main", cards }],
    });

    const FILTER_TARGET: LibraryTarget = { dashboardId: "d1", tabId: "d1-t1" };

    function setDashboards(dashboards: Dashboard[]) {
      useDashboardStore.setState({
        ...REAL_ACTIONS,
        dashboards,
        activeId: "d1",
        activeTabId: "d1-t1",
        previousId: null,
      });
    }

    it("narrows the grid to the widgets already on the chosen dashboard", async () => {
      setDashboards([
        dash("d1", "Main", [card({ id: "c1", widgetId: "prices", backendId: "b1" })]),
        dash("d2", "Macro", [card({ id: "c2", widgetId: "cpi", backendId: "b1" })]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);

      await userEvent.selectOptions(screen.getByLabelText("On dashboard"), "d2");

      expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
      expect(screen.queryByText("Price History")).not.toBeInTheDocument();
      expect(screen.queryByText("Candles")).not.toBeInTheDocument();
    });

    // Both surfaces now read ONE inverted presence index, so the pill and the
    // filter cannot answer differently -- including for the case that used to
    // have the rule written out twice: a card carrying the unresolved-backend
    // sentinel, which matches on widget id alone.
    it("agrees with the dashboard pills about an unresolved card", async () => {
      setDashboards([
        dash("d1", "Main"),
        dash("d2", "Macro", [
          card({ id: "c1", widgetId: "prices", backendId: UNRESOLVED_BACKEND_ID }),
        ]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);

      const pill = screen
        .getByRole("button", { name: /add price history/i })
        .querySelector(".dashboard-badge");
      expect(pill).toHaveTextContent("Macro");

      await userEvent.selectOptions(screen.getByLabelText("On dashboard"), "d2");

      expect(screen.getByText("Price History")).toBeInTheDocument();
      expect(screen.queryByText("Consumer Prices")).not.toBeInTheDocument();
    });

    it("offers a dashboard carrying nothing, and shows the no-match state for it", async () => {
      setDashboards([dash("d1", "Main"), dash("d2", "Empty")]);
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);

      await userEvent.selectOptions(screen.getByLabelText("On dashboard"), "d2");

      expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
      expect(screen.queryByText(/no widgets discovered/i)).not.toBeInTheDocument();
    });

    it("lists every dashboard in rail order, a foldered one before a top-level one", () => {
      setDashboards([dash("d1", "Main"), dash("d2", "Macro")]);
      useFoldersStore.setState({
        folders: [{ id: "f1", name: "Research", parentId: null }],
        folderOrder: ["f1"],
        placement: { d2: "f1" },
        collapsed: [],
      });
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);

      const select = screen.getByLabelText("On dashboard") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "Any",
        "Macro",
        "Main",
      ]);
    });

    it("clears the filter when the chosen dashboard is deleted while the library is open", async () => {
      const onD1 = card({ id: "c1", widgetId: "prices", backendId: "b1" });
      setDashboards([
        dash("d1", "Main", [onD1]),
        dash("d2", "Macro", [card({ id: "c2", widgetId: "cpi", backendId: "b1" })]),
      ]);
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);
      await userEvent.selectOptions(screen.getByLabelText("On dashboard"), "d2");
      expect(screen.queryByText("Price History")).not.toBeInTheDocument();

      // Deleted from the rail with the library still open: the select's value
      // now names no option, so it draws blank -- reading as "Any" while
      // matchesFilter hides every widget. The filter has to let go of it.
      act(() => setDashboards([dash("d1", "Main", [onD1])]));

      expect(screen.getByLabelText("On dashboard")).toHaveValue("");
      expect(screen.getByText("Price History")).toBeInTheDocument();
      expect(screen.getByText("Consumer Prices")).toBeInTheDocument();
    });

    it("Reset clears the dashboard filter with the rest", async () => {
      setDashboards([dash("d1", "Main"), dash("d2", "Empty")]);
      render(<WidgetLibrary onClose={vi.fn()} target={FILTER_TARGET} />);
      await userEvent.selectOptions(screen.getByLabelText("On dashboard"), "d2");
      expect(screen.queryByText("Candles")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));

      expect(screen.getByLabelText("On dashboard")).toHaveValue("");
      expect(screen.getByText("Candles")).toBeInTheDocument();
    });
  });

  describe("provider badge tones", () => {
    const only = (source: string[]) => {
      useWidgetRegistryStore.setState({
        widgets: [widget({ id: "one", name: "One", type: "table", source })],
      });
      render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
      return screen.getByTestId("source-badge");
    };

    it("is grey before any probe has landed", () => {
      expect(only(["FRED"])).toHaveAttribute("data-tone", "grey");
    });

    it("takes the provider's probe tone, matching key-maint's dot", () => {
      useProviderKeysStore.setState({ probe: { fred: "green" } });
      const badge = only(["FRED"]);
      expect(badge).toHaveAttribute("data-tone", "green");
      expect(badge).toHaveAttribute("title", "FRED: key accepted");
    });

    it("reaches the tone through normalizeProvider, not the raw widgets.json spelling", () => {
      useProviderKeysStore.setState({ probe: { alphavantage: "amber" } });
      expect(only(["Alpha_vantage"])).toHaveAttribute("data-tone", "amber");
    });

    it("takes the worst tone of a multi-source widget, with each provider in the title", () => {
      useProviderKeysStore.setState({ probe: { fred: "green", fmp: "red" } });
      const badge = only(["FRED", "FMP"]);
      expect(badge).toHaveTextContent("Multisource");
      expect(badge).toHaveAttribute("data-tone", "red");
      expect(badge).toHaveAttribute("title", "FRED: key accepted, FMP: no response");
    });

    it("stays neutral for a provider that needs no key -- there is nothing to probe", () => {
      useProviderKeysStore.setState({ probe: { fred: "green" } });
      const badge = only(["yFinance"]);
      expect(badge).not.toHaveAttribute("data-tone");
      expect(badge).toHaveAttribute("title", "yFinance");
    });

    it("tones a multi-source widget by its keyed providers, ignoring the keyless ones", () => {
      useProviderKeysStore.setState({ probe: { fred: "amber" } });
      const badge = only(["yFinance", "FRED"]);
      expect(badge).toHaveAttribute("data-tone", "amber");
      expect(badge).toHaveAttribute("title", "yFinance, FRED: key rejected or errored");
    });

    it("is neutral when no source of a multi-source widget needs a key", () => {
      const badge = only(["yFinance", "OECD"]);
      expect(badge).not.toHaveAttribute("data-tone");
    });
  });
});
