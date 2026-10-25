// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceCard } from "./ServiceCard";
import { ServiceStatus } from "./ServiceStatus";

describe("ServiceCard", () => {
  it("renders mark, name, kind, status, actions, endpoint and detail", () => {
    render(
      <ServiceCard
        mark="DB"
        name="OpenBB API"
        kind="Data backend · 12 widgets · 1 app"
        status={<ServiceStatus state="online" />}
        actions={<button type="button">Edit OpenBB API</button>}
        endpoint={{ label: "Endpoint", value: <code>https://data.example/api</code> }}
        detail={<p role="note">an apps note</p>}
        ariaLabel="OpenBB API backend"
      />,
    );
    expect(screen.getByRole("article", { name: "OpenBB API backend" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenBB API" })).toBeInTheDocument();
    expect(screen.getByText("Data backend · 12 widgets · 1 app")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit OpenBB API" })).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("https://data.example/api")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("an apps note");
    // The icon mark is decorative.
    expect(screen.getByText("DB")).toHaveAttribute("aria-hidden", "true");
  });

  it("omits endpoint and detail slots when not given", () => {
    render(<ServiceCard mark="AI" name="Agent" kind="AI service" status={<ServiceStatus state="unchecked" />} />);
    expect(screen.queryByText("Endpoint")).toBeNull();
    expect(document.querySelector(".bd-service-detail")).toBeNull();
  });
});
