// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Vercel build for the public reference demo: the static browser bundle with
// its connection backend and a demo dashboard seeded in. Set as the project's
// Build Command. Requires VITE_REFERENCE_BACKEND_URL (the funnel ts.net URL).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { buildSeed, injectIntoHead, seedScript } from "./demo-seed.mjs";

const backend = process.env.VITE_REFERENCE_BACKEND_URL;
if (!backend) {
  throw new Error("VITE_REFERENCE_BACKEND_URL is required (e.g. https://reference-backend.<tailnet>.ts.net)");
}

// The Tauri-shimmed web bundle (same mode the app's own web preview uses).
execSync("pnpm exec vite build --mode browser", { stdio: "inherit" });

// A synchronous <script> in <head> runs before the deferred module bundle, so
// window.__bdobbSeed is set before src/main.tsx reads it.
const seed = buildSeed(backend);
const indexPath = "dist/index.html";
const tag = seedScript(seed);
let html = readFileSync(indexPath, "utf8");
if (!html.includes("</head>")) throw new Error("dist/index.html has no </head> to seed into");
writeFileSync(indexPath, injectIntoHead(html, tag));
console.log(`reference-demo: seeded backend ${backend} and the demo dashboard into ${indexPath}`);
