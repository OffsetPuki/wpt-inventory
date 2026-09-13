// One-time, loopback-only setup. The key is never logged, returned, or sent to the Suite client.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'cjm-bing-setup-'));
const {bingGet}=await import('../server/bing-reporting.ts');
const sites=['metals','concrete','insulation','trades'];
const nonce=randomBytes(24).toString('hex');
let origin,finished=false;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'`);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(req.method==='GET'&&req.url==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><title>Connect Bing to local Business Suite</title><meta name="viewport" content="width=device-width"><style>body{font:17px system-ui;max-width:620px;margin:60px auto;padding:20px}input,button{font:inherit;padding:12px;margin:12px 0;display:block}input{width:90%}button{background:#20393e;color:white;border:0;border-radius:6px}p{line-height:1.6}</style><h1>Connect Bing reporting</h1><p>Save the reporting key on this computer for the local Business Suite. The connection checks all four CJM websites. Nothing is published.</p><form><label for="key">Bing API key</label><input id="key" name="key" type="password" autocomplete="off" required><button>Connect four websites</button></form><p role="status" id="status"></p><script nonce="${nonce}">document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();const input=document.querySelector('input'),button=document.querySelector('button'),status=document.querySelector('#status');button.disabled=true;status.textContent='Checking access…';try{const res=await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':'${nonce}'},body:JSON.stringify({key:input.value})});input.value='';const data=await res.json();status.textContent=data.message;if(res.ok)document.querySelector('form').remove();else button.disabled=false;}catch{status.textContent='Connection check failed. Please retry.';button.disabled=false;}}</script>`);return;
  }
  if(req.method!=='POST'||req.url!=='/connect'||req.headers.origin!==origin||req.headers['x-setup-token']!==nonce||finished){res.writeHead(403).end();return;}
  res.setHeader('Content-Type','application/json');
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Invalid key.');}
    const key=JSON.parse(body).key?.trim();
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{20,200}$/.test(key))throw new Error('Invalid key format.');
    for(const site of sites)await bingGet('GetFeeds',site,fetch,key);
    writeFileSync(new URL('../.env.bing.local',import.meta.url),`BING_REPORTING_API_KEY=${key}\n`,{mode:0o600});
    finished=true;
    res.end(JSON.stringify({message:'Connected locally: CJM Metals, Concrete, Insulation and Trades. The key is saved privately on this computer.'}));
    console.log('Bing reporting access verified for all four websites; saved to ignored server-only local environment.');
  }catch{res.writeHead(400).end(JSON.stringify({message:'Bing access could not be verified for all four websites. Check the API key and site permissions.'}));}
});
server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log('Local Bing setup: '+origin);});
setTimeout(()=>server.close(()=>process.exit(0)),15*60*1000).unref();
