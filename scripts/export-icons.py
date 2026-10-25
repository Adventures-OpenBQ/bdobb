#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Optional artwork exporter. pip install cairosvg pillow; normal builds need neither."""
from io import BytesIO
from pathlib import Path
import json
import struct
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SVG = "src/assets/branding/"


def render(path, size, opaque=False):
    data = cairosvg.svg2png(url=str(ROOT / path), output_width=size, output_height=size)
    return Image.open(BytesIO(data)).convert("RGB" if opaque else "RGBA")


def ico(path, images):
    frames = []
    for image in images:
        out = BytesIO()
        image.save(out, format="PNG")
        frames.append((image.width, out.getvalue()))
    offset = 6 + 16 * len(frames)
    directory = b""
    for size, data in frames:
        directory += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    (ROOT / path).write_bytes(struct.pack("<HHH", 0, 1, len(frames)) + directory + b"".join(data for _, data in frames))


for size in [32, 64, 128, 256, 512, 1024]:
    render(SVG + "bdobb-macos.svg", size).save(ROOT / f"src-tauri/icons/{size}x{size}.png")
render(SVG + "bdobb-macos.svg", 256).save(ROOT / "src-tauri/icons/128x128@2x.png")
render(SVG + "bdobb-macos.svg", 512).save(ROOT / "src-tauri/icons/icon.png")
render(SVG + "bdobb-app-square.svg", 1024, True).save(ROOT / "src-tauri/icon-src.png")
render(SVG + "bdobb-macos.svg", 1024).save(ROOT / "src-tauri/icons/icon.icns")
ico("src-tauri/icons/icon.ico", [
    render("public/favicon.svg" if size <= 32 else SVG + "bdobb-macos.svg", size)
    for size in [32, 16, 24, 48, 64, 256]
])
for size in [16, 32, 48]:
    render("public/favicon.svg", size).save(ROOT / f"public/favicon-{size}.png")
ico("public/favicon.ico", [render("public/favicon.svg", size) for size in [32, 16, 48]])
render(SVG + "bdobb-app-square.svg", 180, True).save(ROOT / "public/apple-touch-icon.png")
for size in [192, 512]:
    render(SVG + "bdobb-app-square.svg", size, True).save(ROOT / f"public/icon-{size}.png")
    render(SVG + "bdobb-maskable.svg", size, True).save(ROOT / f"public/icon-maskable-{size}.png")
catalog = ROOT / "src-tauri/icons/apple/AppIcon.appiconset"
for slot in json.loads((catalog / "Contents.json").read_text())["images"]:
    size = int(float(slot["size"].split("x")[0]) * int(slot["scale"].rstrip("x")))
    render(SVG + "bdobb-app-square.svg", size, True).save(ROOT / catalog / slot["filename"])
print("Exported desktop, Apple and web icons. Run pnpm test:run src/lib/appIcons.test.ts.")
