#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Additive v11 overlay only; never updates canonical v10 policy or its receipt.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [commit]=process.argv.slice(2);
if(!/^[0-9a-f]{40}$/.test(commit??'')||!process.env.OPENBQ_DOCKER_DIR) throw new Error('Use OPENBQ_DOCKER_DIR=<checkout> node scripts/gateway-vendor-temporal.mjs <40-hex commit>');
const path='funnel-gateway/temporal-policy.mjs';
const body=execFileSync('git',['-C',process.env.OPENBQ_DOCKER_DIR,'show',`${commit}:${path}`],{encoding:'utf8'});
const sha256=createHash('sha256').update(body).digest('hex');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
writeFileSync(resolve(root,'web/temporal-policy.mjs'),`// vendored from openbq-docker ${commit} ${path} sha256:${sha256}\n${body}`);
writeFileSync(resolve(root,'web/temporal-policy.vendored.json'),JSON.stringify({interfaceVersion:11,repository:'openbq-docker',commit,path,sha256},null,2)+'\n');
