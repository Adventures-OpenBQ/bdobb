// SPDX-License-Identifier: Apache-2.0
import type {Server} from 'node:http';
import type {PreviewConfig} from './config.mjs';
export function createPreviewServer(options: {config?: PreviewConfig | null; assets?: string; fetchUpstream?: typeof fetch}): Server;
