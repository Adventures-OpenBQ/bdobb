// vendored from openbq-docker 84ac1af9cf21ad026d9ac9e70420b3bcb55c2538 funnel-gateway/temporal-policy.mjs sha256:ee0eb16d8d30b24393579cc7c40504861c5102dc306794131c80f43c53bca173
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

// Additive v11 contract. Canonical v10 policy.mjs is intentionally unchanged.
// Backend base: <preview>/temporal. Strip exactly that outer prefix at the gateway.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const rules = [
  ['GET', /^\/temporal\/(?:widgets\.json|apps\.json)?$/, []],
  ['GET', /^\/temporal\/temporal\/v1\/capabilities$/, []],
  ['GET|POST', /^\/temporal\/temporal\/v1\/queries$/, []],
  ['POST', /^\/temporal\/temporal\/v1\/queries\/import$/, []],
  ['GET', /^\/temporal\/temporal\/v1\/cache\/datasets$/, ['cursor','limit']],
  ['POST', /^\/temporal\/temporal\/v1\/cache\/(?:describe|coverage)$/, []],
  ['POST', /^\/temporal\/temporal\/v1\/queries\/validate$/, []],
  ['GET', new RegExp(`^/temporal/temporal/v1/queries/import/${UUID}/export$`), []],
  ['GET|PUT|DELETE', new RegExp(`^/temporal/temporal/v1/queries/${UUID}$`), ['revision','receipt_id']],
  ['GET', new RegExp(`^/temporal/temporal/v1/queries/${UUID}/export$`), ['revision','receipt_id']],
  ['POST', /^\/temporal\/temporal\/v1\/executions$/, []],
  ['GET|DELETE', new RegExp(`^/temporal/temporal/v1/executions/${UUID}$`), []],
  ['GET', new RegExp(`^/temporal/temporal/v1/executions/${UUID}/pages$`), ['cursor']],
  ['POST', /^\/temporal\/temporal\/v1\/audits$/, []],
  ['GET', new RegExp(`^/temporal/temporal/v1/audits/${UUID}$`), []],
  ['POST', new RegExp(`^/temporal/temporal/v1/audits/${UUID}/replay$`), []],
  ['POST', new RegExp(`^/temporal/temporal/v1/audits/${UUID}/publications$`), []],
  ['GET', new RegExp(`^/temporal/temporal/v1/audits/${UUID}/publications/${UUID}$`), []],
];
const values = { revision: /^[1-9][0-9]{0,8}$/, receipt_id: new RegExp(`^${UUID}$`), cursor: /^[A-Za-z0-9_.=-]{1,2048}$/, limit: /^(?:[1-9]|[1-9][0-9]|100)$/ };
export function temporalRoute(url, method, config) {
  if (config?.temporalDB !== true || url.hash || url.pathname.length + url.search.length > 4096) return null;
  const rule = rules.find(([methods,path]) => methods.split('|').includes(method) && path.test(url.pathname));
  if (!rule) return null;
  const pairs = [...url.searchParams];
  if (new Set(pairs.map(([key])=>key)).size !== pairs.length) return null;
  for (const [key,value] of pairs) if (method !== 'GET' || !rule[2].includes(key) || !values[key].test(value)) return null;
  return {method, path:url.pathname + (pairs.length ? '?' + url.searchParams.toString() : '')};
}
// Only known semantic statuses survive either proxy. Error bodies/headers never do.
export function temporalStatus(status) {
  return [200,201,202,400,403,404,409,413,415,422,429,503].includes(status) ? status : 502;
}
