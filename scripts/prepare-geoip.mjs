// DB-IP Lite (CC BY 4.0). Downloaded at build time; visitor IPs never leave our server.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Reader} from 'maxmind';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
// The monthly city archive is about 60 MB. Slow build runners need more than
// two minutes; retry a failed transfer without accepting an incomplete database.
export async function downloadDatabase(month,{fetchImpl=fetch,wait=sleep,log=console.warn}={}){
  let failure;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await fetchImpl(`https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`,{signal:AbortSignal.timeout(300000)});
      if(!response.ok){await response.body?.cancel();throw new Error('DB-IP download HTTP '+response.status);}
      const bytes=gunzipSync(Buffer.from(await response.arrayBuffer()));
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
