export type VisitContextData={deviceName?:string;os?:string;location?:{city:string;region:string;country:string}|null};
export function VisitContext({visit}:{visit:VisitContextData}){
 const l=visit.location;
 return <div className="space-y-1 text-xs"><p>Device: {visit.deviceName||'Details unavailable'}{visit.os&&visit.os!=='Unknown'?` · ${visit.os}`:''}</p><p>Approximate location: {l?[l.city,l.region,l.country].filter(Boolean).join(', '):'Unavailable for this visit'}</p></div>;
}
export function VisitContextNote(){return <p className="text-xs text-muted-foreground">Device details depend on what the browser shares. Location is estimated from the internet connection, not GPS or a street address; VPNs and mobile networks can show another city. Older visits may lack these details. <a className="underline" href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a>.</p>;}
