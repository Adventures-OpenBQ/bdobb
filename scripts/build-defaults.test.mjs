// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { it, expect } from 'vitest';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ['VITE_OPENBB_API_URL', 'VITE_RITA_URL', 'VITE_MCP_SERVERS', 'VITE_SHARE_FOLDERS', 'VITE_DEFAULT_BACKEND_URL', 'VITE_DEFAULT_BACKEND_AUTH', 'VITE_DEFAULT_RITA_URL', 'VITE_DEFAULT_MCP_URL'];

it('checks the same serialized defaults the actual Vite-built seed consumes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bdobb-build-defaults-')));
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    await writeFile(join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/probe.js"></script></body></html>');
    await writeFile(join(root, 'probe.js'), `import { makeDefaultBackend } from ${JSON.stringify(join(repo, 'src/lib/backendsFile.ts'))}; import { withDefaults } from ${JSON.stringify(join(repo, 'src/lib/settingsFile.ts'))}; window.seed = makeDefaultBackend(); window.services = withDefaults({});`);
    for (const populated of [true, false]) {
      for (const name of names) process.env[name] = '';
      if (populated) {
        process.env.VITE_DEFAULT_BACKEND_URL = 'https://synthetic.example.invalid';
        process.env.VITE_DEFAULT_RITA_URL = 'https://synthetic-agent.example.invalid';
        process.env.VITE_DEFAULT_MCP_URL = 'https://synthetic-tools.example.invalid/mcp';
        process.env.VITE_DEFAULT_BACKEND_AUTH = 'synthetic_build_auth_&quot;_"_&amp;_value';
      }
      const output = join(root, populated ? 'populated' : 'empty');
      await build({ root, configFile: join(repo, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir: output, emptyOutDir: true, sourcemap: false } });
      const html = await readFile(join(output, 'index.html'), 'utf8');
      const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://build.example.invalid/' });
      try {
        const meta = dom.window.document.querySelector('meta[name="bdobb-build-defaults"]');
        expect(meta).not.toBeNull();
        const defaults = JSON.parse(meta.content);
        expect(Object.keys(defaults).sort()).toEqual([...names].sort());
        expect(defaults.VITE_DEFAULT_BACKEND_URL).toBe(process.env.VITE_DEFAULT_BACKEND_URL);
        const scripts = [...dom.window.document.querySelectorAll('script[src]')];
        expect(scripts).toHaveLength(1);
        const script = await readFile(join(output, scripts[0].getAttribute('src').replace(/^\//, '')), 'utf8');
        dom.window.eval(script);
        expect(dom.window.seed.baseUrl).toBe(populated ? 'https://synthetic.example.invalid' : 'http://localhost:6900');
        expect(dom.window.seed.headerValue).toBe(populated ? 'synthetic_build_auth_&quot;_"_&amp;_value' : undefined);
        expect(dom.window.services.ritaUrl).toBe(populated ? 'https://synthetic-agent.example.invalid' : '');
        expect(dom.window.services.mcpServers.map(server => server.url)).toEqual(populated ? ['https://synthetic-tools.example.invalid/mcp'] : []);
        const checked = spawnSync('python3', ['-c', 'import importlib.util,pathlib,sys;s=importlib.util.spec_from_file_location("release",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.check_frontend(pathlib.Path(sys.argv[2]))', join(repo, 'scripts/public-release.py'), output], { encoding: 'utf8' });
        expect(checked.status, checked.stderr).toBe(populated ? 1 : 0);
        if (populated) {
          expect(checked.stderr).toContain('VITE_DEFAULT_BACKEND_URL');
          expect(checked.stderr).not.toContain('synthetic_build_auth_&quot;_"_&amp;_value');
        }
      } finally { dom.window.close(); }
    }
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
