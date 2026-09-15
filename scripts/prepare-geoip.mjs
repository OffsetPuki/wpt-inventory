// DB-IP Lite (CC BY 4.0). Downloaded at build time; visitor IPs never leave our server.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Reader} from 'maxmind';
const folder='dist/geoip',file=folder+'/city.mmdb',now=new Date();
const month=now.toISOString().slice(0,7);
try{if((await fs.readFile(folder+'/release.txt','utf8'))===month){new Reader(await fs.readFile(file));process.exit(0);}}catch{}
const response=await fetch(`https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`,{signal:AbortSignal.timeout(120000)});
if(!response.ok)throw new Error('Could not download current DB-IP city data: '+response.status);
const bytes=gunzipSync(Buffer.from(await response.arrayBuffer()));new Reader(bytes);
await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,bytes);await fs.writeFile(folder+'/release.txt',month);
console.log('Local DB-IP city database prepared: '+month);
