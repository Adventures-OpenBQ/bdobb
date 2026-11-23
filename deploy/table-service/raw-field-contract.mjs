// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
export const fields = ['category','hasOwnProperty','__proto__','','day','hover','m1','m2'];
export function rows() {
  return JSON.parse('[{"category":1,"hasOwnProperty":100,"__proto__":102,"":101,"day":"2026-11-20","hover":{"value":100,"description":"synthetic own cell"},"m1":100,"m2":200},{"category":2,"hasOwnProperty":20,"__proto__":22,"":21,"day":"2026-11-19","hover":{"value":20,"description":"synthetic own cell"},"m1":20,"m2":40},{"category":3,"hasOwnProperty":300,"__proto__":302,"":301,"day":"2026-11-21","hover":{"value":300,"description":"synthetic own cell"},"m1":300,"m2":600}]');
}
export function tagged(value) {
  if (value === null) return {tag:'null'};
  if (Array.isArray(value)) return {tag:'array',value:value.map(tagged)};
  if (typeof value === 'object') return {tag:'record',value:Object.entries(value).map(([key,v])=>[key,tagged(v)])};
  return {tag:typeof value==='number'?'f64':typeof value==='boolean'?'bool':typeof value,value};
}
export function plain(value) {
  if (value.tag === 'record') return Object.fromEntries(value.value.map(([key,v])=>[key,plain(v)]));
  if (value.tag === 'array') return value.value.map(plain);
  if (value.tag === 'null') return null;
  assert.ok(['f64','bool','string'].includes(value.tag));
  return value.value;
}
export function ordinaryTable() {
  return {sorting:[{id:'',desc:false}],columnFilters:[{id:'',value:tagged({min:30})}],columnOrder:['','__proto__','hasOwnProperty','category','day','hover','m1','m2']};
}
export function result(envelope) {
  const value = JSON.parse(envelope.wire).response;
  assert.notEqual(value.kind,'error',value.error?.code);
  return value;
}
