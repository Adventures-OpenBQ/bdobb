// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const text = (path: string) => readFileSync(path, "utf8");
function png(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    chunks.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += bytes.readUInt32BE(offset) + 12;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    depth: bytes[24], colorType: bytes[25], chunks };
}

describe("BDOBB icon contract", () => {
  it("uses the app's actual accent tokens, clear axes and three ascending bars", () => {
    const css = text("src/styles.css");
    const axes = "M4 4h2v22h22v2H4z";
    const bars = "M10 16h3v6h-3zM16 10h3v12h-3zM22 4h3v18h-3z";
    for (const [file, color] of [["green", "#22c99b"], ["light", "#16a67f"]]) {
      const mark = text(`src/assets/branding/bdobb-mark-${file}.svg`);
      expect(css).toContain(`--accent: ${color}`);
      expect(mark).toContain(`fill="${color}"`);
      expect(mark).toContain(axes);
      expect(mark).toContain(bars);
    }
    expect(text("web/server.mjs")).toContain(axes);
    expect(text("web/server.mjs")).toContain(bars);
    expect(text("src/assets/branding/bdobb-mark-currentcolor.svg")).toContain('fill="currentColor"');
  });

  it("ships self-contained vector SVGs, not embedded raster files or executable content", () => {
    const files = readdirSync("src/assets/branding").filter(name => name.endsWith(".svg"));
    expect(files.length).toBe(10);
    for (const file of [...files.map(name => `src/assets/branding/${name}`),
      "public/favicon.svg", "public/safari-pinned-tab.svg"]) {
      const doc = new DOMParser().parseFromString(text(file), "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.querySelector("image, script, foreignObject")).toBeNull();
      expect(doc.documentElement.getAttribute("viewBox")).toBeTruthy();
    }
  });

  it("wires every browser icon link to a real file", () => {
    const doc = new DOMParser().parseFromString(text("index.html"), "text/html");
    for (const rel of ["icon", "apple-touch-icon", "mask-icon", "manifest"]) {
      const links = doc.querySelectorAll(`link[rel="${rel}"]`);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(existsSync(join("public", link.getAttribute("href")!))).toBe(true);
      }
    }
    expect(doc.querySelector('link[type="image/svg+xml"]')?.getAttribute("href")).toBe("/favicon.svg");
  });

  it("preserves all declared PWA sizes and purpose-specific icons", () => {
    const manifest = JSON.parse(text("public/site.webmanifest"));
    expect(manifest.name).toBe("BDOBB");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toHaveLength(4);
    for (const icon of manifest.icons) {
      const header = png(join("public", icon.src));
      expect(icon.sizes).toBe(`${header.width}x${header.height}`);
      expect(icon.type).toBe("image/png");
      expect(["any", "maskable"]).toContain(icon.purpose);
    }
    expect(png("public/apple-touch-icon.png")).toMatchObject({ width: 180, height: 180, colorType: 2 });
  });

  it("keeps every Apple slot square, opaque RGB and at its declared resolution", () => {
    const root = "src-tauri/icons/apple/AppIcon.appiconset";
    const catalog = JSON.parse(text(`${root}/Contents.json`));
    expect(catalog.images).toHaveLength(18);
    for (const image of catalog.images) {
      const [width, height] = image.size.split("x").map(Number);
      const scale = Number(image.scale.replace("x", ""));
      const header = png(`${root}/${image.filename}`);
      expect(header).toMatchObject({ width: width * scale, height: height * scale,
        colorType: 2, depth: 8 });
      expect(header.chunks).not.toContain("tRNS");
    }
    expect(catalog.images).toContainEqual({
      idiom: "ipad", size: "83.5x83.5", scale: "2x", filename: "AppIcon-167.png",
    });
    expect(catalog.images).toContainEqual({
      idiom: "ios-marketing", size: "1024x1024", scale: "1x", filename: "AppIcon-1024.png",
    });
    expect(png("src-tauri/icon-src.png")).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
  });

  it("preserves Tauri bundle paths and multi-resolution desktop containers", () => {
    const config = JSON.parse(text("src-tauri/tauri.conf.json"));
    for (const path of config.bundle.icon) expect(existsSync(`src-tauri/${path}`)).toBe(true);
    const icns = readFileSync("src-tauri/icons/icon.icns");
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const layers: string[] = [];
    for (let offset = 8; offset < icns.length; offset += icns.readUInt32BE(offset + 4)) {
      layers.push(icns.toString("ascii", offset, offset + 4));
    }
    expect(layers).toEqual(expect.arrayContaining(["ic07", "ic08", "ic09", "ic10"]));
    for (const [path, sizes] of [
      ["public/favicon.ico", [16, 32, 48]],
      ["src-tauri/icons/icon.ico", [16, 24, 32, 48, 64, 256]],
    ] as const) {
      const ico = readFileSync(path);
      expect(ico.readUInt16LE(2)).toBe(1);
      const frames = Array.from({ length: ico.readUInt16LE(4) },
        (_, i) => ico[6 + 16 * i] || 256);
      expect(frames[0]).toBe(32);
      expect(frames.sort((a, b) => a - b)).toEqual(sizes);
    }
  });
});
