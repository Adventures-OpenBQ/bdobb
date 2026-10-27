// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { useBackendsStore } from "../../stores/backendsStore";
import { ConnectionsDialog } from "./ConnectionsDialog";

const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const };

beforeEach(() => useBackendsStore.setState({ backends: [], statuses: {}, issues: {}, services: {} }));

it("adds an Art's Charts server with a door choice and an Authorization key", async () => {
  render(<ConnectionsDialog onClose={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Connect Art's Charts server" }));
  expect(screen.getByRole("radio", { name: /Gateway/ })).toBeChecked();
  expect(screen.getByLabelText("Key")).toHaveValue("Authorization");
  await userEvent.type(screen.getByLabelText("Name"), "Charts");
  await userEvent.type(screen.getByLabelText("Endpoint URL"), "https://door.example.com");
  await userEvent.type(screen.getByLabelText("Value"), "Bearer test-token");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(useBackendsStore.getState().backends[0]).toMatchObject({ kind: "arts-charts", door: "gateway", headerName: "Authorization" });
});

it("offers no second Art's Charts server while one exists", () => {
  useBackendsStore.setState({ backends: [charts] });
  render(<ConnectionsDialog onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "Connect Art's Charts server" })).toBeDisabled();
});

it("says the tailnet door has no studies, and names ignored extra servers", () => {
  useBackendsStore.setState({ backends: [{ ...charts, door: "tailnet" }, { ...charts, id: "c2", name: "Charts 2" }] });
  render(<ConnectionsDialog onClose={() => {}} />);
  const row = screen.getByRole("article", { name: "Charts" });
  expect(within(row).getByText(/Studies need the gateway door/)).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Charts 2" })).getByText(/Ignored: only the first Art's Charts server is used/)).toBeInTheDocument();
});

it("shows why an Art's Charts server is offline in its row", () => {
  useBackendsStore.setState({ backends: [charts], statuses: { c1: "offline" }, errors: { c1: "The server refused the credential (401)" } });
  render(<ConnectionsDialog onClose={() => {}} />);
  expect(within(screen.getByRole("article", { name: "Charts" })).getByText(/refused the credential \(401\)/)).toBeInTheDocument();
});
