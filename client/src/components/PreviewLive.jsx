import {isolatedPreviewHtml} from '@/lib/preview-html';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/lib/queryClient';
export default function PreviewLive({preview,form}) {
 const host=useRef(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[html,setHtml]=useState('');
 const option=preview?.options?.find(o=>o.id===selected)||preview?.options?.[0];
 useEffect(()=>{
  if(!option)return;
  let stopped=false,viewer;const abort=new AbortController();setError('');setHtml('');
  if(option.kind==='html'){apiRequest('GET',`/api/customer-previews/${preview.id}/models/${option.id}`,undefined,{signal:abort.signal}).then(r=>r.text()).then(text=>{if(!stopped)setHtml(isolatedPreviewHtml(text));}).catch(()=>{if(!stopped)setError('HTML preview unavailable.');});return()=>{stopped=true;abort.abort();};}
  if(!host.current)return;
  Promise.all([import('../quote/lib/product-studio.js'),import('three/addons/loaders/GLTFLoader.js'),apiRequest('GET',`/api/customer-previews/${preview.id}/models/${option.id}`,undefined,{signal:abort.signal}).then(r=>r.arrayBuffer())]).then(async([studio,{GLTFLoader},bytes])=>{
   const gltf=await new GLTFLoader().parseAsync(bytes,'');
   if(stopped){studio.disposeProduct(gltf.scene);return;}
   gltf.scene.traverse(o=>{if(o.name==='CJM_Frame')o.visible=false;});
   viewer=studio.createProductStudio(host.current);viewer.setProduct(gltf.scene);
  }).catch(e=>{if(!stopped)setError('Model preview unavailable. Your details can still be saved.');});
  return()=>{stopped=true;abort.abort();viewer?.destroy();};
 },[preview?.id,option?.id,option?.revision,preview?.version]);
 return <section className="rounded-xl border border-border bg-background p-4" aria-label="Live customer preview">
  <p className="text-xs text-muted-foreground">Live preview · Save details or publish model updates below</p>
  <h2 className="mt-2 break-words text-2xl font-semibold">{form.title||'Project title'}</h2>
  <p className="mt-2 whitespace-pre-wrap break-words">{form.description}</p>
  {preview?.options?.length>1&&<label className="block mt-3">Design option<select className="w-full border p-2" value={option?.id||''} onChange={e=>setSelected(e.target.value)}>{preview.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
  {option?.kind==='html'?<iframe title="Interactive HTML design" sandbox="allow-scripts" referrerPolicy="no-referrer" key={html} src="/api/preview-html-renderer" onLoad={e=>{if(html)e.currentTarget.contentWindow?.postMessage(html,"*");}} className="mt-3 w-full border-0" style={{height:480,background:'#fff'}}/>:option?<div ref={host} style={{height:320,background:'#f2f0e9'}} className="mt-3 overflow-hidden rounded"/>:<p className="my-8 text-sm text-muted-foreground">Create a preview from your quote’s model, or add a design option below.</p>}
  {error&&<p role="alert">{error}</p>}
  <p className="mt-3 text-sm">{[['Width',form.width],['Depth',form.depth],['Height',form.height],['Finish',form.finish]].filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p>
  <p className="mt-3 whitespace-pre-wrap break-words">{form.note}</p>
 </section>;
}
