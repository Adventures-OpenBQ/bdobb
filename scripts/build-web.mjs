// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { build as viteBuild } from "vite";
import { build as bundle } from "esbuild";
import { mkdir, readFile, writeFile, cp, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Not the desktop build; no secrets are defined/replaced at build time.
await viteBuild({ mode: "browser", build: { outDir: "dist/web", sourcemap: false } });
const html = await readFile("dist/web/index.html", "utf8");
// The notice bar is 28px tall and in flow above #root. `.app-shell` is sized from
// the VIEWPORT (100dvh in styles.css, so iOS keeps its bottom row), not from #root,
// so #root's percentage height never reached it: the shell ran 28px past the bottom
// and took the rail's last bottom-pinned row -- Help -- below the fold. The second
// rule gives those 28px back on the shell itself (web/browser-smoke.mjs pins it).
await writeFile("dist/web/index.html", html.replace("</head>",
  '<script src="/preview-bootstrap.js"></script><style>.web-preview-notice{height:28px;box-sizing:border-box;padding:5px 12px;background:#1a2432;color:#c7d5e8;font:12px system-ui}.web-preview-notice a{color:#a9ccfa}#root{height:calc(100% - 28px)}.app-shell{height:calc(100vh - 28px);height:calc(100dvh - 28px - var(--safe-top))}</style></head>'));
const root = ".vercel/output";
await rm(root, { recursive: true, force: true });
const func = `${root}/functions/preview.func`;
await mkdir(func, { recursive: true });
await cp("dist/web", `${func}/ui`, { recursive: true });
await bundle({
  entryPoints: ["web/entry.mjs"], outfile: `${func}/index.mjs`, platform: "node",
  target: "node22", format: "esm", bundle: true, sourcemap: false,
  // ws' optional native accelerators are not needed; the JS implementation is bundled.
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
await writeFile(`${func}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs",
  shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 300,
}, null, 2));
await writeFile(`${root}/config.json`, JSON.stringify({
  version: 3, routes: [{ src: "/(.*)", dest: "/preview" }],
}, null, 2));
// Contract: not one byte of the private UI is emitted as a public static primitive.
if ((await readdir(root)).includes("static")) throw new Error("Public static output forbidden");
console.log(`Private web function built at ${resolve(func)}. Nothing deployed.`);
