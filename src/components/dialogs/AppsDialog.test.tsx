// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useModalDialog } from "../../hooks/useModalDialog";
import { APPS_ISSUE_ID, type App } from "../../lib/appsJson";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useBackendsStore } from "../../stores/backendsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { backend as makeBackend } from "../../test/fixtures";
import { stubMatchMedia } from "../../test/matchMedia";
import { AppsDialog } from "./AppsDialog";

/**
 * A well-formed app. Every test that cares about a missing or wrong-typed
 * field takes it away explicitly -- parseAppsJson only guarantees `name` and
 * `tabs`, so "absent" is a case the dialog has to survive, not a default.
 */
function makeApp(over: Partial<App> = {}): App {
  return {
    name: "App",
    description: "",
    img: "",
    img_dark: "",
    img_light: "",
    allowCustomization: false,
    tabs: { t1: { id: "t1", name: "Main", layout: [] } },
    groups: [],
    prompts: [],
    ...over,
  };
}

function seed(
  backends: Array<{ id: string; name: string; baseUrl?: string }>,
  apps: Array<{ backendId: string; app: App }>,
) {
  useBackendsStore.setState({
    backends: backends.map((b) => makeBackend({ id: b.id, name: b.name, baseUrl: b.baseUrl ?? "http://x" })),
  });
  useWidgetRegistryStore.setState({ apps });
}

/** The group headings, in DOM order. */
function groupNames(): string[] {
  return screen.queryAllByTestId("apps-group").map((g) => within(g).getByRole("heading").textContent ?? "");
}

/** The Open buttons' app names inside one group, in DOM order. */
function appNamesIn(index: number): string[] {
  const group = screen.getAllByTestId("apps-group")[index];
  return within(group)
    .getAllByTestId("app-card")
    .map((c) => within(c).getByTestId("app-card-name").textContent ?? "");
}

function render_(over: { onClose?: () => void; onOpen?: (app: App, backendId: string) => void } = {}) {
  return render(<AppsDialog onClose={over.onClose ?? vi.fn()} onOpen={over.onOpen ?? vi.fn()} />);
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useBackendsStore.setState({ backends: [], issues: {} });
  useWidgetRegistryStore.setState({ apps: [] });
});

describe("AppsDialog", () => {
  it("opens as a real modal dialog, and refuses the native close request", () => {
    seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app: makeApp() }]);

    render_();

    const dialog = screen.getByRole("dialog", { name: "Apps" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");

    const cancel = new Event("cancel", { cancelable: true, bubbles: false });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  describe("grouping", () => {
    it("groups apps under their backend's display name, in backend order", () => {
      seed(
        [
          { id: "b2", name: "Beta" },
          { id: "b1", name: "Alpha" },
        ],
        [
          { backendId: "b1", app: makeApp({ name: "A1" }) },
          { backendId: "b2", app: makeApp({ name: "B1" }) },
        ],
      );

      render_();

      // Backend order, not alphabetical and not the order the apps arrived in.
      expect(groupNames()).toEqual(["Beta", "Alpha"]);
      expect(appNamesIn(0)).toEqual(["B1"]);
      expect(appNamesIn(1)).toEqual(["A1"]);
    });

    it("keeps apps.json order within a backend", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          { backendId: "b1", app: makeApp({ name: "Zulu" }) },
          { backendId: "b1", app: makeApp({ name: "Alfa" }) },
          { backendId: "b1", app: makeApp({ name: "Mike" }) },
        ],
      );

      render_();

      expect(appNamesIn(0)).toEqual(["Zulu", "Alfa", "Mike"]);
    });

    it("renders no group for a backend that serves no app", () => {
      seed(
        [
          { id: "b1", name: "Alpha" },
          { id: "b2", name: "Beta" },
        ],
        [{ backendId: "b2", app: makeApp({ name: "B1" }) }],
      );

      render_();

      expect(groupNames()).toEqual(["Beta"]);
    });
  });

  describe("card", () => {
    it("shows the name, description and tab count", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          {
            backendId: "b1",
            app: makeApp({
              name: "Macro",
              description: "Rates and inflation",
              tabs: {
                a: { id: "a", name: "One", layout: [] },
                b: { id: "b", name: "Two", layout: [] },
                c: { id: "c", name: "Three", layout: [] },
              },
            }),
          },
        ],
      );

      render_();

      const card = screen.getByTestId("app-card");
      expect(within(card).getByTestId("app-card-name")).toHaveTextContent("Macro");
      expect(within(card).getByText("Rates and inflation")).toBeInTheDocument();
      expect(within(card).getByText("3 tabs")).toBeInTheDocument();
    });

    it("says '1 tab', not '1 tabs'", () => {
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app: makeApp() }]);

      render_();

      expect(screen.getByText("1 tab")).toBeInTheDocument();
    });

    // parseAppsJson casts to App after checking only `name` and `tabs`, so a
    // backend can serve an app with no description and a `tabs` that is not
    // the record the type claims.
    it("survives a missing description and an unusable tabs", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          {
            backendId: "b1",
            app: { name: "Bare" } as unknown as App,
          },
        ],
      );

      render_();

      expect(screen.getByTestId("app-card-name")).toHaveTextContent("Bare");
      expect(screen.getByText("0 tabs")).toBeInTheDocument();
    });

    it("calls onOpen with the app and the backend that served it", async () => {
      const app = makeApp({ name: "Macro" });
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app }]);
      const onOpen = vi.fn();

      render_({ onOpen });
      await userEvent.click(screen.getByRole("button", { name: "Open Macro" }));

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(app, "b1");
    });
  });

  describe("image", () => {
    function imgIn(): HTMLImageElement | null {
      return screen.queryByTestId("app-card-img") as HTMLImageElement | null;
    }

    it("uses img_dark in the dark theme and img_light in the light one", () => {
      const app = makeApp({
        img: "http://x/plain.png",
        img_dark: "http://x/dark.png",
        img_light: "http://x/light.png",
      });
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app }]);

      const { unmount } = render_();
      expect(imgIn()).toHaveAttribute("src", "http://x/dark.png");
      unmount();

      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } });
      render_();
      expect(imgIn()).toHaveAttribute("src", "http://x/light.png");
    });

    // The image follows the RESOLVED theme, not the raw setting: under
    // "system" the OS decides, so on a light Mac the card must show
    // img_light. "Anything that is not light is dark" would have shown
    // img_dark here, which is the bug useResolvedTheme() removes.
    it("resolves the system theme through the OS appearance", () => {
      const media = stubMatchMedia(false);
      try {
        const app = makeApp({
          img_dark: "http://x/dark.png",
          img_light: "http://x/light.png",
        });
        seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app }]);
        useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "system" } });

        render_();

        expect(media.queries).toContain("(prefers-color-scheme: dark)");
        expect(imgIn()).toHaveAttribute("src", "http://x/light.png");
      } finally {
        media.restore();
      }
    });

    it("falls back to img when the themed one is absent", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [{ backendId: "b1", app: makeApp({ img: "http://x/plain.png" }) }],
      );

      render_();

      expect(imgIn()).toHaveAttribute("src", "http://x/plain.png");
    });

    it("resolves a relative image against the backend's baseUrl", () => {
      seed(
        [{ id: "b1", name: "Alpha", baseUrl: "http://x/api" }],
        [{ backendId: "b1", app: makeApp({ img: "/img/a.png" }) }],
      );

      render_();

      expect(imgIn()).toHaveAttribute("src", "http://x/img/a.png");
    });

    // An <img> cannot carry the backend's auth header, so a load failure is
    // ordinary — and the only thing left to show is the glyph.
    it("swaps in the glyph when the image fails to load", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [{ backendId: "b1", app: makeApp({ img: "http://x/a.png" }) }],
      );

      render_();
      expect(screen.queryByTestId("app-card-glyph")).not.toBeInTheDocument();

      fireEvent.error(imgIn()!);

      expect(imgIn()).not.toBeInTheDocument();
      expect(screen.getByTestId("app-card-glyph")).toBeInTheDocument();
    });

    it.each([
      ["javascript", "javascript:alert(1)"],
      ["data", "data:image/svg+xml,<svg/>"],
      ["file", "file:///etc/passwd"],
    ])("never sets a %s: URL, showing the glyph instead", (_label, url) => {
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app: makeApp({ img: url }) }]);

      render_();

      expect(imgIn()).not.toBeInTheDocument();
      expect(screen.getByTestId("app-card-glyph")).toBeInTheDocument();
    });

    // `img` is one of the fields parseAppsJson never checks, so it can be
    // any JSON value at all. An object is the dangerous one: `new URL(raw,
    // base)` would happily stringify it to "[object Object]" and resolve
    // that against the backend, so the type guard -- not the URL parse -- is
    // what refuses it.
    it("shows the glyph when img is not a string at all", () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [{ backendId: "b1", app: makeApp({ img: {} as unknown as string }) }],
      );

      render_();

      expect(imgIn()).not.toBeInTheDocument();
      expect(screen.getByTestId("app-card-glyph")).toBeInTheDocument();
    });

    // A protocol-relative URL takes the backend's SCHEME but its own host,
    // so it loads from somewhere the backend merely named. That is allowed:
    // safeUrl's boundary is http(s) or nothing, and the design lets an app's
    // image live on a CDN.
    it("takes the backend's scheme for a protocol-relative image, third-party host and all", () => {
      seed(
        [{ id: "b1", name: "Alpha", baseUrl: "http://x/api" }],
        [{ backendId: "b1", app: makeApp({ img: "//cdn.example/a.png" }) }],
      );

      render_();

      expect(imgIn()).toHaveAttribute("src", "http://cdn.example/a.png");
    });

    it("shows the glyph when there is no image at all", () => {
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app: makeApp() }]);

      render_();

      expect(imgIn()).not.toBeInTheDocument();
      expect(screen.getByTestId("app-card-glyph")).toBeInTheDocument();
    });
  });

  describe("search", () => {
    function seedTwo() {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          { backendId: "b1", app: makeApp({ name: "Macro", description: "Rates" }) },
          { backendId: "b1", app: makeApp({ name: "Equities", description: "Company fundamentals" }) },
        ],
      );
    }

    it("matches on the name", async () => {
      seedTwo();
      render_();

      await userEvent.type(screen.getByLabelText("Search apps"), "mac");

      expect(appNamesIn(0)).toEqual(["Macro"]);
    });

    it("matches on the description", async () => {
      seedTwo();
      render_();

      await userEvent.type(screen.getByLabelText("Search apps"), "fundamentals");

      expect(appNamesIn(0)).toEqual(["Equities"]);
    });

    it("drops a backend whose apps all fall out of the search", async () => {
      seed(
        [
          { id: "b1", name: "Alpha" },
          { id: "b2", name: "Beta" },
        ],
        [
          { backendId: "b1", app: makeApp({ name: "Macro" }) },
          { backendId: "b2", app: makeApp({ name: "Equities" }) },
        ],
      );
      render_();

      await userEvent.type(screen.getByLabelText("Search apps"), "macro");

      expect(groupNames()).toEqual(["Alpha"]);
    });

    // `description` is one of the fields parseAppsJson never checks, so the
    // needle is compared against whatever the backend sent. A number must
    // neither throw nor answer a search for its digits.
    it("survives a description that is not a string", async () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          {
            backendId: "b1",
            app: { name: "Macro", description: 42, tabs: {} } as unknown as App,
          },
        ],
      );
      render_();

      const search = screen.getByLabelText("Search apps");
      await userEvent.type(search, "42");
      expect(screen.getByText("No apps match.")).toBeInTheDocument();

      await userEvent.clear(search);
      await userEvent.type(search, "mac");
      expect(appNamesIn(0)).toEqual(["Macro"]);
    });

    // A card is keyed by its position in the backend's UNFILTERED list, so
    // narrowing the search cannot hand one app another's identity -- and
    // with it that app's per-card state. React reconciles by key across the
    // whole list, so the surviving Equities card keeps the instance (and the
    // failed image) it already had; keyed by the filtered index it would
    // take over the Macro card's, whose image never failed.
    it("keeps a card's state when the search narrows around it", async () => {
      seed(
        [{ id: "b1", name: "Alpha" }],
        [
          { backendId: "b1", app: makeApp({ name: "Macro", img: "http://x/m.png" }) },
          { backendId: "b1", app: makeApp({ name: "Equities", img: "http://x/e.png" }) },
        ],
      );
      render_();

      fireEvent.error(screen.getAllByTestId("app-card-img")[1]!);
      expect(screen.getAllByTestId("app-card-img")).toHaveLength(1);

      await userEvent.type(screen.getByLabelText("Search apps"), "equ");

      expect(appNamesIn(0)).toEqual(["Equities"]);
      expect(screen.queryByTestId("app-card-img")).not.toBeInTheDocument();
    });
  });

  describe("empty states", () => {
    it("asks for a connection when there is none", () => {
      render_();

      expect(screen.getByText("Add a connection to see its apps.")).toBeInTheDocument();
    });

    it("says so when the connections serve no app", () => {
      seed([{ id: "b1", name: "Alpha" }], []);

      render_();

      expect(screen.getByText("None of your connections serves an app.")).toBeInTheDocument();
    });

    it("says so when the search matches nothing", async () => {
      seed([{ id: "b1", name: "Alpha" }], [{ backendId: "b1", app: makeApp({ name: "Macro" }) }]);

      render_();
      await userEvent.type(screen.getByLabelText("Search apps"), "zzz");

      expect(screen.getByText("No apps match.")).toBeInTheDocument();
    });
  });


  describe("an apps.json that could not be read", () => {
    const ISSUE = { id: APPS_ISSUE_ID, reason: "apps.json from Alpha is not a list of apps" };

    it("shows one muted line under the connection, even though it serves no app", () => {
      seed([{ id: "b1", name: "Alpha" }], []);
      useBackendsStore.setState({ issues: { b1: [ISSUE] } });

      render_();

      // The group exists for the line's sake: a backend whose apps.json was
      // refused has no apps by construction, so without this it would say
      // nothing at all.
      expect(groupNames()).toEqual(["Alpha"]);
      const line = screen.getByText("This connection's apps.json could not be read.");
      expect(line).toHaveClass("apps-issue");
      // The issue's own reason is never rendered: it is discovery's wording
      // about a backend's document, not a line written for this dialog.
      expect(screen.queryByText(/is not a list of apps/)).not.toBeInTheDocument();
    });

    it("does not contradict itself with the no-apps empty state", () => {
      seed([{ id: "b1", name: "Alpha" }], []);
      useBackendsStore.setState({ issues: { b1: [ISSUE] } });

      render_();

      expect(
        screen.queryByText("None of your connections serves an app."),
      ).not.toBeInTheDocument();
    });

    it("says nothing for a backend whose only issues are about its widgets", () => {
      seed([{ id: "b1", name: "Alpha" }], []);
      useBackendsStore.setState({ issues: { b1: [{ id: "w1", reason: "widget w1 has no endpoint" }] } });

      render_();

      expect(groupNames()).toEqual([]);
      expect(
        screen.queryByText("This connection's apps.json could not be read."),
      ).not.toBeInTheDocument();
    });

    it("keeps the line out of a search, which is about apps", async () => {
      seed(
        [
          { id: "b1", name: "Alpha" },
          { id: "b2", name: "Beta" },
        ],
        [{ backendId: "b2", app: makeApp({ name: "Macro" }) }],
      );
      useBackendsStore.setState({ issues: { b1: [ISSUE] } });

      render_();
      expect(groupNames()).toEqual(["Alpha", "Beta"]);

      await userEvent.type(screen.getByLabelText("Search apps"), "zzz");

      expect(groupNames()).toEqual([]);
      expect(screen.getByText("No apps match.")).toBeInTheDocument();
    });

    it("does not read an issue list off Object.prototype", () => {
      // `issues` is keyed by backend id, and a bare index lookup would
      // answer with Object.prototype's own member for an id spelled like
      // one -- a line about a connection that reported nothing.
      seed([{ id: "constructor", name: "Alpha" }], []);
      useBackendsStore.setState({ issues: {} });

      render_();

      expect(groupNames()).toEqual([]);
      expect(
        screen.queryByText("This connection's apps.json could not be read."),
      ).not.toBeInTheDocument();
    });
  });

  describe("Escape and focus", () => {
    it("closes on the close button and on Escape", async () => {
      const onClose = vi.fn();
      render_({ onClose });

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      await userEvent.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("over another dialog, closes itself on Escape and leaves the one beneath open", async () => {
      // A dialog already open underneath -- Settings, Connections -- whose
      // own Escape listener was registered first. Off the modal stack, that
      // listener answered the press and closed the LOWER dialog (Settings
      // discarding its draft) while Apps stayed up.
      const lowerClose = vi.fn();
      function Lower() {
        return <dialog ref={useModalDialog(lowerClose)} aria-label="Lower" />;
      }
      const onClose = vi.fn();
      render(
        <>
          <Lower />
          <AppsDialog onClose={onClose} onOpen={vi.fn()} />
        </>,
      );

      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(lowerClose).not.toHaveBeenCalled();
    });

    it("takes the Escape for itself, so nothing behind it also acts on the same press", async () => {
      const onClose = vi.fn();
      render_({ onClose });

      // A bubble-phase WINDOW listener, standing in for a maximized card's
      // own Escape handler. This dialog listens on document, one hop earlier.
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

    it("still yields to a capture-phase window listener, which is where nested menus live", async () => {
      const onClose = vi.fn();
      render_({ onClose });

      const menu = vi.fn((e: KeyboardEvent) => e.stopImmediatePropagation());
      window.addEventListener("keydown", menu, { capture: true });
      try {
        await userEvent.keyboard("{Escape}");

        expect(menu).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("keydown", menu, { capture: true });
      }
    });

    it("hands focus back to whatever opened it when it unmounts", () => {
      const trigger = document.createElement("button");
      document.body.appendChild(trigger);
      try {
        trigger.focus();
        const { unmount } = render_();
        // jsdom's showModal() stand-in does not move focus, so do it here --
        // otherwise focus never leaves the trigger and this proves nothing.
        screen.getByRole("button", { name: "Close" }).focus();
        expect(trigger).not.toHaveFocus();

        unmount();

        expect(trigger).toHaveFocus();
      } finally {
        trigger.remove();
      }
    });
  });
});

describe("AppsDialog backend filter", () => {
  it("offers the backends that serve an app, by name and in name order, and narrows to the one chosen", async () => {
    seed(
      [
        { id: "b1", name: "Zeta" },
        { id: "b2", name: "Alpha" },
        { id: "b3", name: "Empty" },
      ],
      [
        { backendId: "b1", app: makeApp({ name: "Z app" }) },
        { backendId: "b2", app: makeApp({ name: "A app" }) },
      ],
    );
    render_();

    const select = screen.getByRole("combobox", { name: "Backend" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All backends", "Alpha", "Zeta"]);
    expect(groupNames()).toEqual(["Zeta", "Alpha"]);

    await userEvent.selectOptions(select, "b1");
    expect(groupNames()).toEqual(["Zeta"]);

    await userEvent.selectOptions(select, "");
    expect(groupNames()).toEqual(["Zeta", "Alpha"]);
  });

  it("filters by backend id, so two backends with one name stay apart", async () => {
    seed(
      [
        { id: "b1", name: "Same" },
        { id: "b2", name: "Same" },
      ],
      [
        { backendId: "b1", app: makeApp({ name: "First" }) },
        { backendId: "b2", app: makeApp({ name: "Second" }) },
      ],
    );
    render_();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Backend" }), "b2");
    expect(appNamesIn(0)).toEqual(["Second"]);
    expect(screen.getAllByTestId("apps-group")).toHaveLength(1);
  });

  it("combines with the search, and says so when nothing is left", async () => {
    seed(
      [
        { id: "b1", name: "Alpha" },
        { id: "b2", name: "Beta" },
      ],
      [
        { backendId: "b1", app: makeApp({ name: "Rates" }) },
        { backendId: "b2", app: makeApp({ name: "Equities" }) },
      ],
    );
    render_();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Backend" }), "b1");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search apps" }), "Equ");
    expect(screen.getByText("No apps match.")).toBeInTheDocument();
  });
});
