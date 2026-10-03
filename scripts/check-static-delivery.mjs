import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import express from 'express';
import {serveStatic} from '../server/static.ts';
const original=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'suite-static-'));
const dir=path.join(temp,'dist/public/assets');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(temp,'dist/public/index.html'),'<html>Fixture app</html>');
const body=Buffer.from('console.log("fixture");');
fs.writeFileSync(path.join(dir,'fixture.js'),body);
fs.writeFileSync(path.join(dir,'fixture.js.br'),zlib.brotliCompressSync(body));
fs.writeFileSync(path.join(dir,'fixture.js.gz'),zlib.gzipSync(body));
fs.writeFileSync(path.join(dir,'plain.js'),body);
process.chdir(temp);const app=express();serveStatic(app);const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const request=(pathname,encoding)=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:server.address().port,path:pathname,headers:encoding===undefined?{}:{'Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));
try {
 for(const [accept,expected] of [[undefined,undefined],['br;q=0, gzip;q=1','gzip'],['br;q=.3, gzip;q=.8','gzip'],['br;q=1,gzip;q=.5','br'],['br;q=0,gzip;q=0',undefined],['*;q=1','br']]) {
  const result=await request('/assets/fixture.js',accept);assert.equal(result.status,200);assert.equal(result.headers['content-encoding'],expected,accept);assert.equal(result.headers.vary,'Accept-Encoding');
  assert.deepEqual(expected==='br'?zlib.brotliDecompressSync(result.body):expected==='gzip'?zlib.gunzipSync(result.body):result.body,body);
 }
 assert.equal((await request('/assets/fixture.js','br;q=0,gzip;q=0,identity;q=0')).status,406);
 assert.equal((await request('/assets/plain.js','br')).headers['content-encoding'],undefined);
 assert.equal((await request('/assets/plain.js','br,identity;q=0')).status,406);
 for(const url of ['/assets/retired.js','/missing.css','/api/missing'])assert.equal((await request(url)).status,404,url);
 assert.equal((await request('/customer-view')).status,200,'SPA navigation still opens');
 console.log('Static missing-file responses, SPA routes and compression negotiation passed.');
}finally{await new Promise(r=>server.close(r));process.chdir(original);fs.rmSync(temp,{recursive:true,force:true});}
