// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Containment, region by region: a throw inside any one top-level pane or
 * dialog must degrade to THAT region's own `.error-box` and leave the rest of
 * the shell mounted and usable — not reach the app-wide catch-all, which would
 * replace the whole window with one message.
 *
 * Every region is mocked through `importOriginal`, so the component under the
 * wrapper is the REAL one and only the throw is injected. That is what makes
 * the "the rest still works" half of each assertion worth anything: the rail
 * that stays clickable is the real rail, and the dialog that opens next to a
 * crashed one is the real dialog with its real Close button.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fresh-install seeded backend makes mount-time discovery fetch; rejecting
// it deterministically keeps this file hermetic (same reason as App.test.tsx).
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
}));

// jsdom has no Tauri runtime, so the real getCurrentWindow() throws reading
// __TAURI_INTERNALS__. vi.hoisted because vi.mock factories are hoisted.
const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme }),
}));

/**
 * The labels whose region should throw on its next render. A set rather than a
 * flag per region so the wrappers below are one shape, and so a test names the
 * region by the same string the fallback has to print.
 */
const { throwIn } = vi.hoisted(() => ({ throwIn: new Set<string>() }));

/**
 * Throwing DURING RENDER is the only thing an error boundary catches — not an
 * effect, not a handler — so every wrapper calls this first thing.
 */
function boom(label: string): void {
  if (throwIn.has(label)) throw new Error(`${label} exploded`);
}

vi.mock("./LeftRail", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./LeftRail")>();
  return {
    ...mod,
    LeftRail: (props: ComponentProps<typeof mod.LeftRail>) => {
      boom("the left rail");
      return <mod.LeftRail {...props} />;
    },
  };
});

vi.mock("./DropZone", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./DropZone")>();
  return {
    ...mod,
    DropZone: (props: ComponentProps<typeof mod.DropZone>) => {
      boom("the dashboard area");
      return <mod.DropZone {...props} />;
    },
  };
});

vi.mock("./DashboardGrid", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./DashboardGrid")>();
  return {
    ...mod,
    DashboardGrid: (props: ComponentProps<typeof mod.DashboardGrid>) => {
      boom("the dashboard");
      return <mod.DashboardGrid {...props} />;
    },
  };
});

vi.mock("./WidgetLibrary", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./WidgetLibrary")>();
  return {
    ...mod,
    WidgetLibrary: (props: ComponentProps<typeof mod.WidgetLibrary>) => {
      boom("the widget library");
      return <mod.WidgetLibrary {...props} />;
    },
  };
});

vi.mock("./dialogs/AppsDialog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./dialogs/AppsDialog")>();
  return {
    ...mod,
    AppsDialog: (props: ComponentProps<typeof mod.AppsDialog>) => {
      boom("the apps dialog");
      return <mod.AppsDialog {...props} />;
    },
  };
});

vi.mock("./dialogs/ConnectionsDialog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./dialogs/ConnectionsDialog")>();
  return {
    ...mod,
    ConnectionsDialog: (props: ComponentProps<typeof mod.ConnectionsDialog>) => {
      boom("the connections dialog");
      return <mod.ConnectionsDialog {...props} />;
    },
  };
});

vi.mock("./dialogs/SettingsDialog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./dialogs/SettingsDialog")>();
  return {
    ...mod,
    SettingsDialog: (props: ComponentProps<typeof mod.SettingsDialog>) => {
      boom("the settings dialog");
      return <mod.SettingsDialog {...props} />;
    },
  };
});

vi.mock("./dialogs/HelpDialog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./dialogs/HelpDialog")>();
  return {
    ...mod,
    HelpDialog: (props: ComponentProps<typeof mod.HelpDialog>) => {
      boom("the help dialog");
      return <mod.HelpDialog {...props} />;
    },
  };
});

import App from "../App";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { __read, __reset, __seed } from "../test/memfs";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";

/**
 * React reports every error a boundary caught to console.error as well. That
 * is React working, and it is the only noise this file makes — every test here
 * is a crash test, so the silence is file-wide rather than per test.
 */
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  throwIn.clear();
  useBackendsStore.setState({ backends: [], statuses: {} });
  useWidgetRegistryStore.setState({ apps: [], widgets: [] });
  useDashboardStore.setState({ viewer: false, dashboards: [], activeId: null, activeTabId: null });
  setTheme.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  __seed(
    "dashboards/z.json",
    JSON.stringify({ id: "z", name: "Zeta", tabs: [{ id: "t1", name: "Main", cards: [] }] }),
  );
});

afterEach(() => {
  consoleError.mockRestore();
  // jsdom keeps one document for the whole file, so the viewer suite's query
  // string has to be put back or every later test would boot as a viewer.
  window.history.replaceState({}, "", "/");
});

/**
 * Opens a region the way a user does. Every dialog but help has its own rail
 * row; help's row opens a MENU (Quick Help, Reference Manual, Report a Bug and
 * Request a Feature), so the shortcut is the one-step route -- ⌘? is ⌘⇧/,
 * hence both modifiers. It opens the quick set, which is the one these cases
 * assert on.
 */
async function open(row: string) {
  if (row !== "Help") {
    await userEvent.click(screen.getByRole("button", { name: row }));
    return;
  }
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "?",
        code: "Slash",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** The dashboard has loaded and the grid is on screen. */
async function shellIsUp() {
  await screen.findByRole("tablist", { name: "Tabs" });
}

function errorBoxes(): NodeListOf<Element> {
  return document.querySelectorAll(".error-box");
}

describe("the panes", () => {
  it("contains a throw in the dashboard grid, keeping the rail and the drop zone", async () => {
    throwIn.add("the dashboard");

    render(<App />);

    expect(await screen.findByText("Something went wrong in the dashboard.")).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(1);
    // The <main> is DropZone's own element, so its survival is the drop zone's.
    expect(screen.getByRole("main")).toBeInTheDocument();
    // ...and the rail is not just mounted but working.
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(await screen.findByRole("dialog", { name: "Connections" })).toBeInTheDocument();
  });

  it("contains a throw in the left rail, keeping the dashboard", async () => {
    throwIn.add("the left rail");

    render(<App />);

    expect(await screen.findByText("Something went wrong in the left rail.")).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(1);
    expect(screen.getByRole("main")).toBeInTheDocument();
    await shellIsUp();
  });

  it("contains a throw in the drop zone, keeping the rail", async () => {
    throwIn.add("the dashboard area");

    render(<App />);

    expect(await screen.findByText("Something went wrong in the dashboard area.")).toBeInTheDocument();
    // The zone renders the <main> itself, so this crash does take the whole
    // dashboard area with it -- which is why the rail, beside it, has to
    // survive. What it no longer takes is the dialogs; see below.
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeEnabled();
  });

  it("leaves the dialogs openable when the drop zone has crashed", async () => {
    // The blast radius, measured. The five dialogs used to be DropZone's
    // CHILDREN, so this boundary contained them: a throw in the zone left a
    // rail whose every button was dead, since each one only sets an open
    // state whose dialog the caught boundary would not render. They are
    // siblings of the zone now, and the rail still opens them.
    throwIn.add("the dashboard area");

    render(<App />);
    await screen.findByText("Something went wrong in the dashboard area.");

    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(await screen.findByRole("dialog", { name: "Connections" })).toBeInTheDocument();
    // Still the one fallback: opening a dialog did not disturb the caught
    // region, and the dialog did not arrive inside it.
    expect(errorBoxes()).toHaveLength(1);
  });

  it("offers a crashed pane Retry alone, with nothing to dismiss it to", async () => {
    // A pane's fallback IS that pane: dismissing it would leave a hole in the
    // shell with no way back. Only the dialogs, which have somewhere to
    // return to, get a Dismiss.
    throwIn.add("the dashboard");

    render(<App />);
    await screen.findByText("Something went wrong in the dashboard.");

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("writes one log line naming the region, and no component stack", async () => {
    throwIn.add("the dashboard");

    render(<App />);

    await screen.findByText("Something went wrong in the dashboard.");
    await waitFor(() => {
      expect(__read("logs/bdobb.log") ?? "").toContain("unhandled error in the dashboard");
    });
    const lines = (__read("logs/bdobb.log") ?? "")
      .trim()
      .split("\n")
      .filter((l) => l.includes("unhandled error"));
    expect(lines).toHaveLength(1);
    // A component stack is a list of "    at Name" frames; none of it, and no
    // second line, may ride out on the crash.
    expect(lines[0]).not.toMatch(/\s+at\s/);
  });
});

/**
 * Rail row, boundary label, and the dialog's own accessible name. `other` is a
 * second row to click while the first is crashed: whichever it is, it must not
 * be the crashed one.
 */
const DIALOGS = [
  { row: "Widget Library", label: "the widget library", dialog: "Widget library", other: "Connections" },
  { row: "Apps", label: "the apps dialog", dialog: "Apps", other: "Connections" },
  { row: "Connections", label: "the connections dialog", dialog: "Connections", other: "Settings" },
  { row: "Settings", label: "the settings dialog", dialog: "Settings", other: "Connections" },
  { row: "Help", label: "the help dialog", dialog: "Quick Help", other: "Connections" },
] as const;

describe.each(DIALOGS)("$label", ({ row, label, dialog, other }) => {
  it("degrades to its own fallback, leaves the shell working, and comes back clean", async () => {
    throwIn.add(label);

    render(<App />);
    await shellIsUp();

    await open(row);

    // Its own region named, and nothing else caught.
    expect(await screen.findByText(`Something went wrong in ${label}.`, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(1);
    // The panes are untouched: the grid is still there and the rail still
    // opens a different dialog.
    expect(screen.getByRole("tablist", { name: "Tabs" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: other }));
    const neighbour = await screen.findByRole("dialog", { name: other });
    await userEvent.click(within(neighbour).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: other })).not.toBeInTheDocument();
    });

    // Recovered: Retry re-renders the region, which now works...
    throwIn.delete(label);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    const opened = await screen.findByRole("dialog", { name: dialog });
    expect(errorBoxes()).toHaveLength(0);

    // ...and after a close, the next open is clean rather than wedged on the
    // fallback. That is STRUCTURAL, not `resetKey`: each boundary sits inside
    // its own `open ? ... : null`, so closing unmounts it and the next open
    // builds a fresh one. `resetKey` never fires here at all -- it holds one
    // value for the boundary's whole lifetime, and deleting all five of them
    // leaves this suite green. It is kept for the day one is hoisted out of
    // its conditional.
    await userEvent.click(within(opened).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: dialog })).not.toBeInTheDocument();
    });
    await open(row);
    expect(await screen.findByRole("dialog", { name: dialog })).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(0);
  });

  it("can be dismissed while it is still crashing, and reopens clean", async () => {
    // The boundary sits inside the dialog's own `open ? ... : null`, so a
    // deterministic crash leaves the open state true with the dialog's Close
    // button never rendered. Without a Dismiss the fallback is there until the
    // app restarts -- Retry only re-runs the render that just threw.
    throwIn.add(label);

    render(<App />);
    await shellIsUp();
    await open(row);
    expect(await screen.findByText(`Something went wrong in ${label}.`, {}, { timeout: 10000 })).toBeInTheDocument();

    // Retry alone cannot get out of this: the region throws every time.
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(`Something went wrong in ${label}.`, {}, { timeout: 10000 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(errorBoxes()).toHaveLength(0);
    });
    // The shell is whole, not merely free of the fallback.
    expect(screen.getByRole("tablist", { name: "Tabs" })).toBeInTheDocument();

    // And the next open is the real dialog rather than the fallback the
    // dismiss left behind -- the boundary unmounted with it.
    throwIn.delete(label);
    await open(row);
    expect(await screen.findByRole("dialog", { name: dialog })).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(0);
  });
});

describe("the viewer window", () => {
  it("contains a throw in its dashboard grid instead of going blank", async () => {
    window.history.replaceState({}, "", "/?viewer=z");
    throwIn.add("the dashboard");

    render(<App />);

    expect(await screen.findByText("Something went wrong in the dashboard.")).toBeInTheDocument();
    // The viewer window has no rail, so the <main> IS the rest of the window:
    // without a boundary of its own the app-wide one would have taken it.
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("the lazy help chunk", () => {
  /**
   * A fresh module graph: App.tsx builds `HelpDialog = lazy(...)` once at
   * module scope, and React.lazy calls that loader — and permanently caches
   * what it resolves to — only on the first render. Only an App re-imported
   * AFTER the dynamic import is mocked exercises the load path at all.
   */
  async function freshApp() {
    const { default: FreshApp } = await import("../App");
    return FreshApp;
  }

  afterEach(() => {
    vi.doUnmock("./dialogs/HelpDialog");
  });

  it("keeps the shell when the import rejects, through HelpLoadFailed rather than the boundary", async () => {
    vi.resetModules();
    vi.doMock("./dialogs/HelpDialog", () => {
      throw new Error("chunk load failed");
    });
    const FreshApp = await freshApp();

    render(<FreshApp />);
    await screen.findByRole("main");
    await open("Help");

    // App's own `.catch` converts the rejection into a RESOLVED module, so the
    // promise React sees never rejects and the boundary is never entered. That
    // is the intended order: HelpLoadFailed is a real showModal() dialog (so it
    // cannot end up behind an open Settings), it is dismissible, and it says
    // what to do -- all three of which the generic fallback is not.
    expect(await screen.findByRole("dialog", { name: "Help unavailable" }, { timeout: 10000 })).toBeInTheDocument();
    expect(errorBoxes()).toHaveLength(0);
    // Either way the tree stands: this is the assertion the boundary would
    // otherwise have to make.
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("catches a module that loads without the export, which the `.catch` cannot", async () => {
    vi.resetModules();
    // The export is PRESENT but not a component (a circular import, a bad
    // build). The promise resolves, so App's `.catch` never runs -- and React
    // is then handed an invalid element type and throws where the lazy
    // component sits, inside the Suspense. Declaring the key rather than
    // omitting it is deliberate: vitest's mock proxy throws on reading an
    // undeclared export, which would land back in the `.catch` and prove
    // nothing.
    vi.doMock("./dialogs/HelpDialog", () => ({ HelpDialog: undefined }));
    const FreshApp = await freshApp();

    render(<FreshApp />);
    await screen.findByRole("main");
    await open("Help");

    expect(await screen.findByText("Something went wrong in the help dialog.")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
