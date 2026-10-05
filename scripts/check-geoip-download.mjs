import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {downloadDatabase} from './prepare-geoip.mjs';
const database=await fs.readFile('dist/geoip/city.mmdb'),archive=gzipSync(database);
const options={wait:async()=>{},log:()=>{}};
let calls=0;
const recovered=await downloadDatabase('2026-10',{...options,fetchImpl:async(url,{signal})=>{
  assert.equal(url,'https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz');
  assert.ok(signal instanceof AbortSignal);
  if(++calls===1)throw new DOMException('Slow connection','TimeoutError');
  return new Response(archive);
}});
assert.equal(calls,2);assert.deepEqual(recovered,database);
for(const response of [()=>new Response('',{status:503}),()=>new Response('truncated gzip'),()=>new Response(gzipSync(Buffer.from('invalid database'))) ]){
  calls=0;
  await assert.rejects(downloadDatabase('2026-10',{...options,fetchImpl:async()=>{calls++;return response();}}),/after 2 attempts/);
  assert.equal(calls,2);
}
console.log('GeoIP download retries, complete recovery and invalid database rejection passed.');
