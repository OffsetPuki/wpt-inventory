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
calls=0;
assert.deepEqual(await downloadDatabase('2026-10',{...options,fetchImpl:async(url,{headers})=>{
  const [,startText,endText]=headers.Range.match(/^bytes=(\d+)-(\d+)$/),start=Number(startText),end=Math.min(Number(endText),archive.length-1);
  if(calls++)assert.equal(headers['If-Range'],'"same-release"');
  return new Response(archive.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${archive.length}`,ETag:'"same-release"'}});
}}),database);
assert.equal(calls,Math.ceil(archive.length/(4*1024*1024)));
for(const failure of ['wrong offset','short body','changed release']){
  calls=0;
  await assert.rejects(downloadDatabase('2026-10',{...options,fetchImpl:async(url,{headers})=>{
    calls++;
    const start=Number(headers.Range.match(/^bytes=(\d+)-/)[1]),end=Math.min(start+4*1024*1024,archive.length)-1;
    return new Response(archive.subarray(start,failure==='short body'?start+1:end+1),{status:206,headers:{
      'Content-Range':`bytes ${failure==='wrong offset'?start+1:start}-${end}/${archive.length}`,
      ETag:failure==='changed release'&&start?'"changed"':'"same-release"',
    }});
  }}),/after 2 attempts/);
  assert.equal(calls,failure==='changed release'?4:2);
}
for(const response of [()=>new Response('',{status:503}),()=>new Response('truncated gzip'),()=>new Response(gzipSync(Buffer.from('invalid database'))) ]){
  calls=0;
  await assert.rejects(downloadDatabase('2026-10',{...options,fetchImpl:async()=>{calls++;return response();}}),/after 2 attempts/);
  assert.equal(calls,2);
}
console.log('GeoIP download retries, complete recovery and invalid database rejection passed.');
