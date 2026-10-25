// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.fn((_message: string) => Promise.resolve());
vi.mock("../lib/logger", () => ({
  logError: (message: string) => logError(message),
}));

import { useModalDialog } from "../hooks/useModalDialog";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * The prop value that must never reach the log: it stands in for a card's
 * parameters or a backend's auth header, which is what a boundary sitting
 * over an arbitrary subtree has in its hands when something throws.
 */
const SECRET = "sk-not-in-the-log";

/** Flipped per test rather than per instance, so a Retry can find it false. */
let throws = true;

function Boom({ secret }: { secret: string }) {
  if (throws) throw new Error("the renderer exploded");
  return <p>rendered with {secret}</p>;
}

beforeEach(() => {
  throws = true;
  logError.mockClear();
  // React reports every error a boundary catches to console.error as well.
  // That is React working, not the test failing, and it is the only noise
  // these cases produce.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders a child that does not throw untouched", () => {
    throws = false;
    const { container } = render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    // No wrapper of its own: a boundary that is not catching anything must be
    // invisible to the layout it was dropped into.
    expect(container.innerHTML).toBe(`<p>rendered with ${SECRET}</p>`);
    expect(logError).not.toHaveBeenCalled();
  });

  it("names the region and shows the thrown message, with a Retry", () => {
    render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong in the test region.")).toBeInTheDocument();
    expect(screen.getByText("the renderer exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("clears the caught state on Retry and re-renders the children", async () => {
    render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    throws = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText(`rendered with ${SECRET}`)).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("clears the caught state when resetKey changes, with no Retry", () => {
    const { rerender } = render(
      <ErrorBoundary label="the test region" resetKey="first">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong in the test region.")).toBeInTheDocument();

    throws = false;
    rerender(
      <ErrorBoundary label="the test region" resetKey="second">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(`rendered with ${SECRET}`)).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("offers Retry alone for a region with no way to close it", () => {
    // The panes -- rail, grid, drop zone -- pass no onDismiss: there is
    // nothing to dismiss them TO, so a Dismiss there would be a button that
    // blanked a third of the window with no way back.
    render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("offers a Dismiss beside Retry when the region can be closed", async () => {
    // A dialog's boundary sits inside its own `open ? ... : null`, so the
    // fallback holds the dialog's open state true with its Close button gone:
    // without this the only way out of a deterministic crash is a restart.
    const onDismiss = vi.fn();
    render(
      <ErrorBoundary label="the test region" onDismiss={onDismiss}>
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("puts a dismissible region's fallback in the top layer, as an open <dialog>", () => {
    // The region it replaces IS a showModal() dialog, so the fallback has to
    // be one too. A plain div is ordinary markup in the dashboard area: open
    // Connections and then crash Settings, and Settings' fallback lands
    // UNDER Connections' backdrop, inert -- its Dismiss unclickable until
    // the dialog the user was not looking at is closed.
    //
    // jsdom implements neither the top layer nor inertness (see
    // src/test/setup.ts), so what is pinned here is the one thing it can
    // see: the fallback is a <dialog> that was opened modally. The
    // two-modals case itself is on the human checklist.
    const { container } = render(
      <ErrorBoundary label="the test region" onDismiss={vi.fn()}>
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute("open");
    // The box itself is unchanged -- same look, same buttons, one layer up.
    expect(dialog?.querySelector(".error-box")).not.toBeNull();
    expect(screen.getByText("Something went wrong in the test region.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("puts a dialog's fallback on the modal stack: Escape dismisses it, not the dialog beneath", async () => {
    // Settings open, and the dialog over it crashes. Off the stack, the
    // fallback was invisible to Escape: Settings' own listener answered the
    // press and closed Settings -- its draft discarded -- under a fallback
    // that stayed up.
    const lowerClose = vi.fn();
    function Lower() {
      return <dialog ref={useModalDialog(lowerClose)} aria-label="Lower" />;
    }
    const onDismiss = vi.fn();
    render(
      <>
        <Lower />
        <ErrorBoundary label="the test region" onDismiss={onDismiss}>
          <Boom secret={SECRET} />
        </ErrorBoundary>
      </>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(lowerClose).not.toHaveBeenCalled();
  });

  it("leaves a pane's fallback as plain markup, with no dialog around it", () => {
    // The panes (rail, grid, drop zone) pass no onDismiss and are not modal:
    // a <dialog> there would cover the app for a failure contained to one
    // third of it, and there is no Dismiss to get out of it with.
    const { container } = render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".error-box")).not.toBeNull();
  });

  it("writes one log line naming the label, and neither the stack nor a prop", () => {
    render(
      <ErrorBoundary label="the test region">
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(logError).toHaveBeenCalledTimes(1);
    const line = logError.mock.calls[0][0];
    expect(line).toContain("the test region");
    expect(line).toContain("the renderer exploded");
    // Never a prop value: the boundary has the whole subtree's props in
    // reach and must reach for none of them.
    expect(line).not.toContain(SECRET);
    // Never the component stack: React hands it to componentDidCatch as the
    // second argument, and every frame in it is a component name.
    expect(line).not.toContain("Boom");
    expect(line).not.toMatch(/\n|\s+at\s/);
  });

  it("cannot let a label forge a line in the log, however long or however written", async () => {
    // Most labels here are this file's own literals, but a card's boundary is
    // labelled with its widget's `name` -- a string from whatever backend the
    // user added. A newline in it would end the log line early and write a
    // second one of the backend's choosing; the length is its choice too.
    const forged = `Prices\n2026-01-01T00:00:00.000Z INFO all clear${"x".repeat(200)}`;
    render(
      <ErrorBoundary label={forged}>
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    const line = logError.mock.calls[0][0];
    expect(line).toContain("Prices");
    // The line structure is the whole channel: the forged text survives as
    // text on THIS line, where it is plainly part of a label, and no second
    // line ever begins.
    expect(line).not.toContain("\n");
    // Capped, so one name cannot push the message it is logged with out of
    // a reader's view either.
    expect(line.length).toBeLessThan(160);
  });

  it("still shows the label on screen in full, controls and all", () => {
    // The clamp is about the LOG line, which is a record a reader parses. On
    // screen the label is text in a paragraph: a newline in it renders as a
    // space and forges nothing, and truncating a widget's name in the one
    // sentence that says which region died would only make it harder to read.
    render(
      <ErrorBoundary label={`A ${"very ".repeat(30)}long name`}>
        <Boom secret={SECRET} />
      </ErrorBoundary>,
    );

    expect(
      screen.getByText(`Something went wrong in A ${"very ".repeat(30)}long name.`),
    ).toBeInTheDocument();
  });
});
