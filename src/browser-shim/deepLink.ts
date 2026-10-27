// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
// Browser mode has no OS URL scheme: the web query (?inbox= / ?chart=) is read from the location instead.
export const getCurrent = async (): Promise<string[] | null> => null;
export const onOpenUrl = async (_: (urls: string[]) => void) => () => {};
