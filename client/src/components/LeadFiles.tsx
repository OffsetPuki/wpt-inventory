import {useState} from 'react';
import {Download,FileText} from 'lucide-react';
import {apiRequest} from '@/lib/queryClient';

export type LeadFile={id:string;name:string;size:number};
export default function LeadFiles({files,leadId}:{files:LeadFile[];leadId:number}){
 const [pending,setPending]=useState<string|null>(null),[error,setError]=useState('');
 async function download(file:LeadFile){
  setPending(file.id);setError('');
  try{
   const response=await apiRequest('GET',`/api/crm/leads/${leadId}/files/${file.id}`);
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
   link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60_000);
  }catch{setError('This file could not download. Please try again.');}finally{setPending(null);}
 }
 if(!files.length)return null;
 return <section aria-label="Request files" className="space-y-3">
  <h3 className="font-semibold">Request files ({files.length})</h3>
  <ul className="space-y-2">{files.map(file=><li key={file.id} className="flex items-center gap-3 rounded-xl border p-3">
   <FileText size={20} aria-hidden className="shrink-0"/><div className="min-w-0 flex-1"><p className="break-words text-sm">{file.name}</p><p className="text-xs text-muted-foreground">{file.size>=1_000_000?`${(file.size/1_000_000).toFixed(1)} MB`:`${Math.max(1,Math.ceil(file.size/1000))} KB`}</p></div>
   <button type="button" disabled={pending!==null} onClick={()=>void download(file)} aria-label={`Download ${file.name}`} className="inline-flex min-h-10 items-center gap-1 underline disabled:opacity-50"><Download size={16} aria-hidden/>{pending===file.id?'Downloading…':'Download'}</button>
  </li>)}</ul>
  {error&&<p role="alert" className="text-sm">{error}</p>}
 </section>;
}
