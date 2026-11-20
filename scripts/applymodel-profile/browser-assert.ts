// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Audit shim: deliberately only supports plain/array definition graphs.
function equal(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const pa=Object.getPrototypeOf(a),pb=Object.getPrototypeOf(b);
 if(pa!==pb||(!Array.isArray(a)&&pa!==Object.prototype&&pa!==null))return false;
 const ak=Reflect.ownKeys(a),bk=Reflect.ownKeys(b);if(ak.length!==bk.length)return false;
 return ak.every(k=>{const x=Object.getOwnPropertyDescriptor(a,k),y=Object.getOwnPropertyDescriptor(b,k);return !!x&&!!y&&'value'in x&&'value'in y&&equal(x.value,y.value);});
}
const assert=Object.assign((v:unknown,message='audit assertion')=>{if(!v)throw Error(message);},{equal(a:unknown,b:unknown,message='audit equality'){if(!Object.is(a,b))throw Error(message);},deepEqual(a:unknown,b:unknown,message='audit definition equality'){if(!equal(a,b))throw Error(message);}});
export default assert;
