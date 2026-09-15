import {open, type CityResponse, type Reader} from 'maxmind';
import {isIP} from 'node:net';
let reader:Promise<Reader<CityResponse>|null>|undefined;
export function deviceDetails(ua:string){
 const device=/ipad|tablet|android(?!.*mobile)/i.test(ua)?'Tablet':/mobile|iphone|ipod/i.test(ua)?'Phone':ua?'Computer':'Unknown';
 const os=/iphone|ipad|ipod/i.test(ua)?'iOS':/android/i.test(ua)?'Android':/windows/i.test(ua)?'Windows':/cros/i.test(ua)?'ChromeOS':/macintosh|mac os x/i.test(ua)?'macOS':/linux/i.test(ua)?'Linux':'Unknown';
 const model=/iphone/i.test(ua)?'iPhone':/ipad/i.test(ua)?'iPad':/ipod/i.test(ua)?'iPod':os==='Android'?(ua.match(/Android[^;)]*;\s*(?:[a-z]{2}-[A-Z]{2};\s*)?([^;)]+?)(?: Build[ /]|[;)])/i)?.[1]?.trim()||'Android device'):os==='Windows'?'Windows computer':os==='macOS'?'Mac':os==='ChromeOS'?'Chromebook':device;
 // Reduced Android UAs use K as a placeholder, not a real device model.
 const deviceName=model==='K'?'Android device':model.slice(0,80);
 const browser=/edg(?:a|ios)?\//i.test(ua)?'Edge':/samsungbrowser/i.test(ua)?'Samsung Internet':/opr\/|opera/i.test(ua)?'Opera':/firefox|fxios/i.test(ua)?'Firefox':/chrome|crios/i.test(ua)?'Chrome':/safari/i.test(ua)?'Safari':'Other';
 return {device,browser,deviceName,os};
}
export async function visitorContext(ua:string,ip=''){
 const info=deviceDetails(ua.slice(0,500));let location:null|{city:string;region:string;country:string;source:string}=null;
 // Only a single proxy-provided address is accepted. No coordinates or raw IP are stored.
 if(isIP(ip))try{
  reader??=open<CityResponse>(process.env.GEOIP_DATABASE_PATH||'dist/geoip/city.mmdb').catch(()=>null);
  const geo=(await reader)?.get(ip);
  if(geo?.country?.iso_code)location={city:(geo.city?.names?.en||'').slice(0,100),region:(geo.subdivisions?.[0]?.names?.en||'').slice(0,100),country:geo.country.iso_code,source:'DB-IP Lite'};
 }catch{}
 return {...info,location};
}
