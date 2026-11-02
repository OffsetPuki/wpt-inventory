export function websiteTestNetwork(app){
 const previous=globalThis.fetch;let offline=false,brokenPreview=false,stale=false;
 const hosts={'www.cjmmetals.com':'metals','www.cjm-concrete.com':'concrete','www.cjmtrades.com':'trades','www.cjminsulation.com':'insulation'};
 globalThis.fetch=async(url,init={})=>{
  const address=new URL(String(url)),site=hosts[address.hostname];if(!site)return previous(url,init);
  if(offline)throw Error('Synthetic website outage');
  const policy=(await app.api('/api/public/website-policy')).data,entry=policy.sites.find(s=>s.site===site);
  const preview=new Headers(init.headers).has('Cookie');
  if(address.pathname==='/__cjm/status')return Response.json({site,active:entry.active,revision:stale?0:policy.revision,durable:true,syncHealthy:true});
  if(preview&&address.pathname==='/api/quote')return new Response('Read only',{status:403,headers:{'X-CJM-Preview':'true'}});
  if(preview&&brokenPreview)return new Response('Missing asset',{status:404});
  const servicePaths={metals:'/services/custom-gates',concrete:'/services/concrete-driveways',trades:'/plan',insulation:'/services/pipe-insulation'};
  if(!['/','/es/','/test.js',servicePaths[site]].includes(address.pathname))return new Response('Missing page',{status:404});
  if(preview||entry.active)return new Response('<html><head><script src="/test.js"></script></head><body>'+(preview?'<aside id="cjm-private-preview">Private preview</aside>':'')+'Website</body></html>',{status:200});
  return new Response('Unavailable',{status:410,headers:{'X-Robots-Tag':'noindex'}});
 };
 return {setOffline:value=>offline=value,setBrokenPreview:value=>brokenPreview=value,setStale:value=>stale=value,restore:()=>globalThis.fetch=previous};
}

