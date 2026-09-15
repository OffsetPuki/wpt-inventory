import {primaryBtn,inputCls} from '@/lib/ui-styles';
import {useState,useRef} from 'react';
import Modal from '@/components/Modal';
import {getAuthToken} from '@/lib/queryClient';
import {useQueryClient} from '@tanstack/react-query';
export default function CreateCustomerPreview({exportModel,title,customer=''}){
 const [open,setOpen]=useState(false),[name,setName]=useState(title),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null);const attempt=useRef(null);const cache=useQueryClient();
 async function create(){setBusy(true);setError('');try{
  if(!attempt.current){const bytes=await exportModel();attempt.current={bytes,id:crypto.randomUUID(),title:name};}
  const data=new FormData();data.append('model',new Blob([attempt.current.bytes],{type:'model/gltf-binary'}),'quote-product.glb');data.append('requestId',attempt.current.id);data.append('details',JSON.stringify({title:attempt.current.title,customer}));
  const response=await fetch('/api/customer-previews/from-model',{method:'POST',headers:{'X-Auth':getAuthToken()||''},body:data});const result=await response.json();if(!response.ok)throw new Error(result.message||'Could not create preview.');setCreated(result);cache.invalidateQueries({queryKey:['customer-previews']});
 }catch(e){setError(e.message||'Could not prepare the model.');}finally{setBusy(false);}}
 return <><button type="button" className="btn" onClick={()=>{setOpen(true);setCreated(null);attempt.current=null;setName(title);setError('');}}>Create customer preview</button><Modal open={open} onClose={()=>{if(!busy)setOpen(false);}} title="Customer preview" maxWidth="max-w-lg"><div className="space-y-4">{created?<><p><strong>{created.title}</strong> is saved in Customer previews.</p><p>The model is a snapshot of this design. No prices are included. Enable its customer link when ready.</p><a className={primaryBtn} href="/#/crm/previews">Manage customer previews</a></>:<><label>Preview title<input className={inputCls} value={name} maxLength={120} disabled={busy||!!attempt.current} onChange={e=>setName(e.target.value)}/></label><p>Save this 3D product on a white background with shadows. Your quote stays unchanged.</p>{error&&<p role="alert">{error}</p>}<button type="button" className={primaryBtn} disabled={busy||!name.trim()} onClick={create}>{busy?'Preparing model…':'Create preview'}</button></>}</div></Modal></>;
}
