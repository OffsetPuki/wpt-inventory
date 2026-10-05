// DB-IP Lite (CC BY 4.0). Downloaded at build time; visitor IPs never leave our server.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Reader} from 'maxmind';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
// Large responses can stall at the download CDN. Fetch bounded ranges, check
// their offsets and sizes, then validate the complete archive before using it.
const CHUNK_BYTES=4*1024*1024,MAX_ARCHIVE_BYTES=256*1024*1024;
async function downloadArchive(url,fetchImpl){
  const chunks=[],transferLimit=AbortSignal.timeout(300000);let offset=0,total=null,validator=null;
  while(total===null||offset<total){
    const headers={Range:`bytes=${offset}-${offset+CHUNK_BYTES-1}`};
    if(validator)headers['If-Range']=validator;
    const response=await fetchImpl(url,{headers,signal:AbortSignal.any([transferLimit,AbortSignal.timeout(120000)])});
    // Accept a server that ignores Range only on the first request.
    if(response.status===200&&offset===0)return Buffer.from(await response.arrayBuffer());
    const range=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if(response.status!==206||!range){await response.body?.cancel();throw new Error('Invalid DB-IP range response: '+response.status);}
    const [,start,end,size]=range.map(Number),etag=response.headers.get('etag'),currentValidator=(etag&&!etag.startsWith('W/')?etag:null)||response.headers.get('last-modified');
    if(start!==offset||end!==Math.min(offset+CHUNK_BYTES, size)-1||size>MAX_ARCHIVE_BYTES||size<=offset||(total!==null&&size!==total)||(validator&&currentValidator!==validator)){
      await response.body?.cancel();throw new Error('DB-IP range changed or was incomplete');
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==end-start+1)throw new Error('Incomplete DB-IP range body');
    total=size;validator=currentValidator;chunks.push(bytes);offset+=bytes.length;
  }
  return Buffer.concat(chunks);
}
export async function downloadDatabase(month,{fetchImpl=fetch,wait=sleep,log=console.warn}={}){
  let failure;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const archive=await downloadArchive(`https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`,fetchImpl);
      const bytes=gunzipSync(archive);
      new Reader(bytes);
      return bytes;
    }catch(error){
      failure=error;
      if(attempt<2){log('DB-IP download incomplete; retrying once in 5 seconds.');await wait(5000);}
    }
  }
  throw new Error('Could not download and validate current DB-IP city data after 2 attempts',{cause:failure});
}
async function prepare(){
const folder='dist/geoip',file=folder+'/city.mmdb',now=new Date();
const month=now.toISOString().slice(0,7);
try{if((await fs.readFile(folder+'/release.txt','utf8'))===month){new Reader(await fs.readFile(file));return;}}catch{}
const bytes=await downloadDatabase(month);
await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,bytes);await fs.writeFile(folder+'/release.txt',month);
console.log('Local DB-IP city database prepared: '+month);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepare();
