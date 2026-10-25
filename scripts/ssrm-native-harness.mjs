// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Qualification only: real relay/gateway/native service; no analytical fixture. */
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { createServer as viteServer } from 'vite';
import { encode } from '@auth/core/jwt';
import { createPreviewServer } from '../web/server.mjs';
import { readConfig, SESSION_COOKIE } from '../web/config.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function startNativeHarness() {
    const root = process.env.TABLE_QUAL_LINUX_ROOT;
    const target = process.env.TABLE_QUAL_LINUX_TARGET;
    const gatewayPath = process.env.TABLE_QUAL_GATEWAY;
    if (!root || !target || !gatewayPath)
        throw new Error('Set TABLE_QUAL_LINUX_ROOT, TABLE_QUAL_LINUX_TARGET and TABLE_QUAL_GATEWAY; actual Linux artifacts required');
    const dir = await mkdtemp(join(tmpdir(), 'ssrm-native-'));
    const name = 'ssrm-native-' + randomBytes(5).toString('hex');
    const token = randomBytes(32).toString('base64url');
    const relay = randomBytes(32).toString('base64url');
    const serviceToken = randomBytes(32).toString('base64url');
    const profile = {
        "listen": "0.0.0.0:8080",
        "catalog_path": "/task/sources",
        "catalog": {
            "limits": {
                "max_upload_bytes": 2097152,
                "max_parse_bytes": 8388608,
                "max_cache_bytes": 67108864,
                "max_input_rows": 20000,
                "max_input_columns": 64,
                "max_output_columns": 256,
                "max_row_block_rows": 100,
                "max_export_batch_bytes": 1048576,
                "max_sessions_per_principal": 6,
                "max_concurrent_jobs_per_principal": 4
            },
            "backend_widgets": {}
        },
        "auth": {
            "desktop_tokens": {},
            "gateway_token": serviceToken
        },
        "ingestion": {
            "node": "/task/node-measured",
            "entry": "/work/server/table-ingest/dist/child.mjs",
            "backend_config": null,
            "max_concurrent_children": 1,
            "max_child_heap_mb": 128
        },
        "worker": {
            "executable": "/target/debug/pivot-native-worker",
            "memory_budget_bytes": 536870912,
            "max_frame_bytes": 8392704,
            "max_starting_workers": 2
        },
        "runtime": {
            "compute_workers": 2,
            "max_admitted_jobs": 4,
            "max_sessions": 8,
            "max_retained_slots": 18,
            "max_retained_slots_per_principal": 16,
            "max_exports_per_principal": 3,
            "max_http_requests": 4,
            "total_memory_budget_bytes": 7516192768,
            "principal_memory_budget_bytes": 6442450944
        }
    };
    let native, gateway, server, vite, standard, timer;
    const measurements = {
        samples: [],
        requests: [],
        profile: {
            limits: profile.catalog.limits,
            runtime: profile.runtime,
            worker: profile.worker,
            containerBytes: 8589934592,
        },
    };
    const cleanup = async () => {
        clearInterval(timer);
        const errors = [];
        const attempt = async (action) => {
            try {
                await action();
            }
            catch (error) {
                errors.push(error);
            }
        };
        measurements.hostNodeMaxRssKiB = process.resourceUsage().maxRSS;
        await attempt(async () => {
            let records;
            try {
                records = await readFile(join(dir, 'ingest-memory.jsonl'), 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return; // No parser was started.
                throw error;
            }
            measurements.ingest = records.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        });
        await attempt(async () => {
            const evidenceDir = process.env.TABLE_QUAL_EVIDENCE_DIR;
            if (!evidenceDir)
                return;
            await mkdir(evidenceDir, {
                recursive: true
            });
            await writeFile(join(evidenceDir, name + '.json'), JSON.stringify(measurements, null, 2));
        });
        // Every owner gets its own cleanup attempt, including after evidence or close failures.
        await attempt(() => vite?.close());
        for (const listener of [server, gateway, standard]) {
            if (!listener)
                continue;
            await attempt(() => listener.closeAllConnections?.());
            await attempt(() => new Promise((resolve, reject) => {
                listener.close(error => error ? reject(error) : resolve());
            }));
        }
        await attempt(() => {
            if (native)
                execFileSync('docker', ['stop', '-t', '2', name], {
                    stdio: 'ignore'
                });
        });
        await attempt(() => rm(dir, {
            recursive: true, force: true
        }));
        if (errors.length)
            throw errors[0];
    };
    try {
        await writeFile(join(dir, 'node-measured'), '#!/bin/sh\nexec /opt/node/bin/node --import /task/measure-node.mjs "$@"\n', {
            mode: 0o700
        });
        await writeFile(join(dir, 'measure-node.mjs'), `import {appendFileSync} from 'node:fs';process.on('exit',()=>appendFileSync('/task/ingest-memory.jsonl',JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS,...process.memoryUsage()})+'\\n'));`);
        await writeFile(join(dir, 'config.json'), JSON.stringify(profile), {
            mode: 0o600
        });
        const args = ['run', '--rm', '--name', name, '--read-only', '--user', String(process.getuid()), '--memory', '8g', '--cpus', '2', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-p', '127.0.0.1::8080'];
        for (const part of ['usr', 'var', 'etc'])
            args.push('-v', `${root}/${part}:/${part}:ro`);
        args.push('-v', `${root}/root/node-v26.10.0-linux-arm64:/opt/node:ro`, '-v', `${target}:/target:ro`, '-v', `${resolve('.')}:/work:ro`, '-v', `${dir}:/task`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '-e', 'TABLE_SERVICE_CONFIG=/task/config.json', 'rust:1.98.1-slim-trixie', '/target/debug/table-service');
        native = spawn('docker', args, {
            stdio: ['ignore', 'ignore', 'inherit']
        });
        let nativeOrigin;
        for (let n = 0; n < 100; n++) {
            try {
                const port = execFileSync('docker', ['port', name, '8080/tcp'], {
                    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                }).trim().split(':').at(-1);
                nativeOrigin = `http://127.0.0.1:${port}`;
                if ((await fetch(nativeOrigin + '/healthz')).status === 401)
                    break;
            }
            catch { /* Container startup. */
            }
            await sleep(100);
        }
        if (!nativeOrigin)
            throw new Error('Native service startup failed');
        const { createGateway } = await import(pathToFileURL(resolve(gatewayPath)).href);
        standard = httpServer(async (req, res) => {
            let body = '';
            for await (const b of req)
                body += b;
            const q = JSON.parse(body || '{}');
            measurements.requests.push({
                standard: true, ...q
            });
            const rows = Array.from({
                length: Math.min(100, 1200 - (q.startRow ?? 0))
            }, (_, i) => ({
                region: `R${(q.startRow ?? 0) + i}`, revenue: (q.startRow ?? 0) + i + 1
            }));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                rowData: rows, rowCount: 1200
            }));
        });
        standard.listen(0, '127.0.0.1');
        await once(standard, 'listening');
        const config = {
            origin: 'http://127.0.0.1',
            token,
            apiAuthorization: 'test-only',
            apiOrigin: `http://127.0.0.1:${standard.address().port}`,
            maxConcurrent: 8,
            tableOrigin: nativeOrigin,
            tableGatewayToken: serviceToken,
            tableRelayToken: relay,
            tableDesktopPrincipal: 'desktop:qualification',
            ssrmRoutes: ['/api/api/v1/qualification/table'],
            stateDir: join(dir, 'state'),
        };
        gateway = createGateway(config);
        gateway.listen(0, '127.0.0.1');
        await once(gateway, 'listening');
        config.origin = `http://127.0.0.1:${gateway.address().port}`;
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], {
            stdio: 'ignore'
        });
        server = httpsServer({
            key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem'))
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = `https://localhost:${server.address().port}`;
        const webConfig = readConfig({
            APP_ORIGIN: origin,
            AUTH_SECRET: randomBytes(32).toString('hex'),
            AUTH_GITHUB_ID: 'synthetic',
            AUTH_GITHUB_SECRET: 'synthetic',
            SESSION_EPOCH: 'qualification',
            GITHUB_ALLOWED_USER_IDS: '42,43',
            BACKEND_GATEWAY_ORIGIN: 'https://qualification.invalid',
            BACKEND_GATEWAY_TOKEN: token,
            TABLE_RELAY_TOKEN: relay,
            SSRM_ROUTES_JSON: JSON.stringify(config.ssrmRoutes),
        });
        const web = createPreviewServer({
            config: webConfig,
            fetchUpstream: async (url, init) => {
                const upstream = new URL(url);
                const path = upstream.pathname;
                let operation;
                try {
                    operation = JSON.parse(JSON.parse(init?.body?.toString() || '{}').wire || 'null')?.request;
                }
                catch { /* Non-command body. */
                }
                const start = performance.now();
                const response = await fetch(config.origin + path + upstream.search, init);
                measurements.requests.push({
                    path, operation, ms: performance.now() - start, status: response.status
                });
                return response;
            }
        });
        vite = await viteServer({
            mode: 'browser', server: {
                middlewareMode: true, hmr: false
            }, appType: 'spa'
        });
        server.on('request', (req, res) => {
            if (/^\/(table|api|auth)(\/|$)/.test(req.url)) {
                web.emit('request', req, res);
            } else {
                vite.middlewares(req, res);
            }
        });
        timer = setInterval(() => {
            try {
                const raw = execFileSync('docker', ['exec', name, 'sh', '-c', 'for p in /proc/[0-9]*; do case "$(cat "$p/comm" 2>/dev/null)" in table-service|pivot-native*|node) printf "%s " "$p"; cat "$p/status" | awk \'/^(Name|VmRSS|VmHWM|VmSize):/ {printf "%s ", $0}\'; echo;; esac; done; cat /sys/fs/cgroup/memory.current; cat /sys/fs/cgroup/memory.peak'], {
                    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                });
                measurements.samples.push({
                    at: Date.now(), raw, hostNode: process.memoryUsage()
                });
            }
            catch { /* Sample after cleanup. */
            }
        }, 1000);
        return {
            origin, measurements, async cookie(id = '42') {
                return {
                    name: SESSION_COOKIE, value: await encode({
                        token: {
                            githubId: id, epoch: webConfig.epoch, deadline: Date.now() / 1000 + 3600
                        }, secret: webConfig.secret, salt: SESSION_COOKIE, maxAge: 3600
                    }), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax'
                };
            }, inspect() {
                return execFileSync('docker', ['exec', name, 'sh', '-c', 'id; stat -c "%a %u %n" /task/config.json /task/sources; for p in /proc/[0-9]*; do case "$(cat "$p/comm" 2>/dev/null)" in pivot-native*) cat "$p/limits";; esac; done'], {
                    encoding: 'utf8'
                });
            }, health() {
                return execFileSync('docker', ['exec', name, '/opt/node/bin/node', '/work/deploy/table-service/healthcheck.mjs'], {
                    encoding: 'utf8'
                });
            }, async close() {
                await cleanup();
            }
        };
    }
    catch (error) {
        try {
            await cleanup();
        }
        catch (cleanupError) {
            // Keep the actual startup failure as the primary error and retain diagnostics.
            error.cleanupError = cleanupError;
        }
        throw error;
    }
}
