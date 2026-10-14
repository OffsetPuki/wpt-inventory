import {useState} from 'react';
import {apiRequest} from '@/lib/queryClient';
import {secondaryBtn} from '@/lib/ui-styles';
export default function OfflineJobPack({id,employee=false}:{id:number;employee?:boolean}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const download=async()=>{setBusy(true);setError('');try{const r=await apiRequest('GET',`/api/${employee?'employee':'suite'}/jobs/${id}/pack`);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`job-${id}-${r.headers.get('X-Pack-Revision')||'snapshot'}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);const missing=Number(r.headers.get('X-Pack-Excluded')||0);setNotice(missing?`Pack prepared. ${missing} files need a separate download; see the pack’s file list.`:'Offline copy prepared. Open the downloaded file before leaving to confirm it saved correctly.');}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div><button type="button" className={secondaryBtn} disabled={busy} onClick={download}>{busy?'Preparing job pack…':'Save offline job pack'}</button>{notice&&<p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}{error&&<p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}</div>;
}
