// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";

const inboxProps: unknown[] = [];
const stream = { open: 0, closed: 0 };
const mounts: (string | undefined)[] = [];
vi.mock("@adventures-openbq/arts-charts", () => ({
  ArtsChartsInbox: (p: { focusItem?: string }) => {
    inboxProps.push(p);
    // Stands in for the inbox's followFeed subscription: opened on mount, stopped on unmount.
    useEffect(() => { mounts.push(p.focusItem); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only record
    useEffect(() => { stream.open++; return () => { stream.closed++; }; }, []);
    return <button type="button">Inbox</button>;
  },
}));
const { useBackendsStore } = await import("../stores/backendsStore");
const { useArtsChartsStore } = await import("../stores/artsChartsStore");
const { LeftRail } = await import("./LeftRail");

const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const };

const railElement = () => (
  <LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />
);
const renderRail = () => render(railElement());

it("shows the inbox above Help only while an Art's Charts connection exists, passing the link's focus", async () => {
  useBackendsStore.setState({ backends: [] });
  const { rerender } = renderRail();
  expect(screen.queryByRole("button", { name: "Inbox" })).toBeNull();
  useBackendsStore.setState({ backends: [charts] });
  useArtsChartsStore.getState().focusInbox("0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d");
  rerender(railElement());
  const inbox = await screen.findByRole("button", { name: "Inbox" });
  const help = screen.getByRole("button", { name: "Help" });
  expect(inbox.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(inboxProps.at(-1)).toEqual({ focusItem: "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d" });
});

it("removing the connection while the inbox is open removes it and stops its stream, without an error", async () => {
  useArtsChartsStore.getState().focusInbox(null);
  useBackendsStore.setState({ backends: [charts] });
  stream.open = 0; stream.closed = 0;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  renderRail();
  await screen.findByRole("button", { name: "Inbox" });
  expect(stream).toEqual({ open: 1, closed: 0 });
  act(() => { useBackendsStore.setState({ backends: [] }); });
  expect(screen.queryByRole("button", { name: "Inbox" })).toBeNull();
  expect(stream).toEqual({ open: 1, closed: 1 });
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it("a second link to the same item remounts the inbox with that focus, so it opens again", async () => {
  const id = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
  useArtsChartsStore.getState().focusInbox(null);
  useBackendsStore.setState({ backends: [charts] });
  mounts.length = 0;
  renderRail();
  await screen.findByRole("button", { name: "Inbox" });
  act(() => useArtsChartsStore.getState().focusInbox(id));
  act(() => useArtsChartsStore.getState().focusInbox(id));
  expect(mounts).toEqual([undefined, id, id]);
});

it("a changed connection does not reopen a stale link", async () => {
  const id = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
  useBackendsStore.setState({ backends: [charts] });
  renderRail();
  await screen.findByRole("button", { name: "Inbox" });
  act(() => useArtsChartsStore.getState().focusInbox(id));
  mounts.length = 0;
  act(() => useArtsChartsStore.getState().bump());
  expect(mounts).toEqual([undefined]);
  expect(useArtsChartsStore.getState().focusItem).toBeNull();
});
