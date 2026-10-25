// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { ExecutionProtocolError } from '../validation';
/** Opt-in experimental ceilings; none is a measured supported-device default. */
export type ResourceLimits = {
    maxInputBytes?: number;
    maxRows?: number;
    maxPivotColumns?: number;
    maxBatchBytes?: number;
    maxCachedBlockBytes?: number;
    maxConcurrentTransfers?: number;
    maxStateBytes?: number;
    inputBytes?: number;
    cacheBytes?: number;
    exportBytes?: number;
};
/** JS capacities/allocator sizes are unavailable. This is a conservative structural
 * reservation using UTF16 storage, property slots, encoded escapes and conversion copies. */
export function estimatedHostBytes(root: unknown, maximum = Infinity): number {
    const ancestors = new Set<object>();
    let bytes = 0;
    const charge = (amount: number) => {
        bytes += amount;
        resourceCheck(maximum === Infinity ? undefined : maximum, bytes, 'Host graph reservation exceeded');
    };
    const visit = (value: unknown): void => {
        // No bounded pre-conversion magnitude API is available. Never allocate the
        // decimal string just to decide whether an opt-in byte profile admits it.
        if (typeof value === 'bigint') {
            charge(Infinity);
            return;
        }
        if (typeof value === 'string') {
            charge(64 + value.length * 14);
            return;
        }
        if (value === null || typeof value !== 'object') {
            charge(32);
            return;
        }
        if (value instanceof Uint8Array) {
            charge(128 + value.byteLength * 8);
            return;
        }
        if (ancestors.has(value))
            throw new ExecutionProtocolError('INVALID_REQUEST', 'Cyclic resource graph');
        ancestors.add(value);
        charge(128);
        // Sparse array holes become missing wire values during conversion. Charge
        // all element slots before clone/Array.from, including absent properties.
        if (Array.isArray(value)) charge(value.length * 32);
        // Enumerate without materializing a complete key/descriptor array before
        // a tiny admission limit can stop traversal. Never evaluate property getters.
        for (const key in value) {
            if (!Object.hasOwn(value, key)) continue;
            const property = Object.getOwnPropertyDescriptor(value, key);
            if (!property || !('value' in property))
                throw new ExecutionProtocolError('INVALID_REQUEST', 'Accessor resource graph');
            charge(128 + key.length * 14);
            visit(property.value);
        }
        ancestors.delete(value);
    };
    visit(root);
    return bytes;
}

export function resourceCheck(limit: number | undefined, bytes: number, message: string): void { if (limit !== undefined && (!Number.isSafeInteger(bytes) || bytes > limit))
    throw new ExecutionProtocolError('RESOURCE_LIMIT', message); }
export function resourceResponse(request: {
    requestId: string;
    revision: import('../types').Revision;
}, message: string): import('../types').ExecutionResponse { return { kind: 'error', ...request, completeness: { kind: 'unknown', warnings: [] }, diagnostics: [], error: { code: 'RESOURCE_LIMIT', message } }; }
export function validateResourceLimits(limits: ResourceLimits | undefined): void {
    if (limits === undefined)
        return;
    const allowed = ['maxInputBytes', 'maxRows', 'maxPivotColumns', 'maxBatchBytes', 'maxCachedBlockBytes', 'maxConcurrentTransfers', 'maxStateBytes', 'inputBytes', 'cacheBytes', 'exportBytes'];
    if (!limits || typeof limits !== 'object' || Array.isArray(limits) || ![null, Object.prototype].includes(Object.getPrototypeOf(limits)))
        throw new Error('Invalid Rust resource limits');
    for (const key of Reflect.ownKeys(limits)) {
        const property = Object.getOwnPropertyDescriptor(limits, key);
        if (typeof key !== 'string' || !allowed.includes(key) || !property?.enumerable || !('value' in property) || !Number.isSafeInteger(property.value) || property.value < 0 || property.value > 4294967295)
            throw new Error('Invalid Rust resource limit');
    }
}
export function inputLimit(limits: ResourceLimits): number | undefined { const values = [limits.maxInputBytes, limits.inputBytes].filter((value): value is number => value !== undefined); return values.length ? Math.min(...values) : undefined; }
