import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {requestDigestFallback,requestDigest,installRandomUuid} from '../client/src/lib/request-identity.ts';
for(const value of ['', 'abc', 'CJM — cliente español 中文 🔩', 'a'.repeat(1_000_000)]){
 const expected=createHash('sha256').update(value).digest('hex');
 assert.equal(requestDigestFallback(new TextEncoder().encode(value)),expected);
 assert.equal(await requestDigest(value),expected);
}
for(const size of [1,54,55,56,57,63,64,65,119,120,127,128,129,4096,65537]){
 const bytes=randomBytes(size);assert.equal(requestDigestFallback(bytes),createHash('sha256').update(bytes).digest('hex'));
}
Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});installRandomUuid();
const ids=new Set();for(let i=0;i<1000;i++){const id=crypto.randomUUID();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);ids.add(id);}assert.equal(ids.size,1000);
console.log('PASS local Wi-Fi retry digests match native SHA-256; UUIDs preserve secure randomness and v4 format.');
