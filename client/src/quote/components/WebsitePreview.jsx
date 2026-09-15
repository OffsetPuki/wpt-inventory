import {useEffect,useRef,useState} from 'react';
import {tableBaseFootprint} from '../data/configurators.js';
const TYPES=['gate','fence','carport','pergola','railing','table'];
export const websitePreviewAvailable=type=>TYPES.includes(type);
export default function WebsitePreview({type,state}){
 const frame=useRef(null),latest=useRef(state),[ready,setReady]=useState(false);latest.current=state;
 const base=import.meta.env.VITE_DESIGN_PREVIEW_ORIGIN||'https://www.cjmmetals.com';
 const origin=new URL(base).origin;
 function send(){const s=latest.current;const data=Object.fromEntries(Object.entries(s).filter(([,v])=>['string','number','boolean'].includes(typeof v)));
  if(type==='table'){const size=tableBaseFootprint(s);Object.assign(data,{frameLengthFt:size.lengthFt,frameWidthIn:size.widthIn,type:s.tableType,top:s.includeTop==='yes'?'show':'hide',lengthFt:s.lengthFt,widthIn:s.widthIn,heightIn:Number(s.frameHeightIn)+Number(s.topThicknessIn||2)});}
  frame.current?.contentWindow?.postMessage({kind:'cjm-design-preview',state:data},origin);
 }
 useEffect(()=>{setReady(false);const message=e=>{if(e.source!==frame.current?.contentWindow||e.origin!==origin)return;if(e.data?.kind==='cjm-preview-ready'){setReady(true);send();}};window.addEventListener('message',message);return()=>window.removeEventListener('message',message);},[type,origin]);
 useEffect(()=>{if(ready)send();},[state,ready]);
 return <div className="website-product-preview">{!ready&&<p role="status">Loading website preview…</p>}<iframe ref={frame} title={`${type} website preview`} src={`${base}/customize/${type}?quotePreview=1`} allow="fullscreen" referrerPolicy="strict-origin-when-cross-origin" /></div>;
}
