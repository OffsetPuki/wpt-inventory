import {useState} from 'react';
import {createPortal} from 'react-dom';
import {useQuery} from '@tanstack/react-query';
import Modal from '@/components/Modal';
import {apiRequest} from '@/lib/queryClient';
import {secondaryBtn} from '@/lib/ui-styles';

type Kind='quote'|'invoice';
type Visit={id:string;revision:string;startedAt:number;lastAt:number;activeMs:number;device:string;browser:string;scrollPct:number;loadMs:number;assetErrors:number;actionErrors:number;actions:Record<string,number>};
type Report={kind:Kind;number:string;revision:string;summary:{visits:number;activeMs:number;firstVisit:number|null;lastVisit:number|null;averageLoadMs:number;assetErrors:number;actionErrors:number;scrollPct:number};actions:{name:string;count:number}[];devices:{device:string;browser:string;visits:number}[];visits:Visit[];confirmed:{status:string;sentAt:number|null;acceptedAt?:number|null;declinedAt?:number|null;acceptNote?:string;declineNote?:string;declineReason?:string;legacyOpens?:number;paidCents?:number;payments?:{id:number;amountCents:number;method:string;paidAt:string;createdAt:number}[]}};
const names:Record<string,string>={print:'Print / PDF dialog',attachment:'Attachment links',accept:'Accept clicks',decline:'Decline submissions',pay:'Pay clicks',compare:'Compare options',phone:'Phone links',email:'Email links',main:'CJM Metals website',other:'Other links'};
const date=(value:number|null|undefined)=>value?new Date(value).toLocaleString():'—';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
function time(ms:number){const s=Math.floor(ms/1000);return s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m ${s%60}s`:`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`;}

function Activity({kind,id,onClose}:{kind:Kind;id:number;onClose:()=>void}){
  const query=useQuery<Report>({queryKey:['document-activity',kind,id],queryFn:async()=>(await apiRequest('GET',`/api/document-activity/${kind}/${id}`)).json(),refetchInterval:15000});
  const data=query.data;
  return <Modal open onClose={onClose} title={`Customer activity · ${data?.number||kind}`} maxWidth="max-w-4xl">
    <div className="space-y-6" aria-label="Document activity report">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm text-muted-foreground">Activity starts when tracking was enabled. Visits count page openings, not identified people. Use the Suite’s document preview to exclude your own checks.</p><button className={secondaryBtn} disabled={query.isFetching} onClick={()=>query.refetch()}>Refresh activity</button></div>
      {query.isError&&<p role="alert">Could not refresh activity. Please try again.</p>}
      {!data?query.isPending&&<p>Loading activity…</p>:<>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[['Document visits',data.summary.visits],['Active viewing time',time(data.summary.activeMs)],['Average per visit',time(data.summary.visits?data.summary.activeMs/data.summary.visits:0)],['Furthest read',`${data.summary.scrollPct}%`],['Average page load',data.summary.visits?`${(data.summary.averageLoadMs/1000).toFixed(1)}s`:'—'],['Image / action errors',`${data.summary.assetErrors} / ${data.summary.actionErrors}`]].map(([label,value])=><div key={label} className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
        <p className="text-xs text-muted-foreground">First visit: {date(data.summary.firstVisit)}<br/>Latest activity: {date(data.summary.lastVisit)}<br/>A visit needs two seconds of visible viewing. Time pauses in hidden tabs and after 60 seconds without activity. Counts can be incomplete when tracking is blocked. Reading reach measures the document shown on screen.</p>
        <section className="space-y-3"><h3 className="font-semibold">Document actions & links</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(names).filter(([key])=>kind==='quote'?key!=='pay':!['accept','decline','compare'].includes(key)).map(([key,label])=><div key={key} className="rounded-lg border border-border p-3 text-sm">{label}<strong className="ml-2">{data.actions.find(a=>a.name===key)?.count||0}</strong></div>)}</div><p className="text-xs text-muted-foreground">Clicks show interest. They do not prove a PDF was saved, an attachment was read, a call was completed, or a payment succeeded. Email opens and downloaded PDF viewing are not tracked.</p></section>
        <section className="space-y-3"><h3 className="font-semibold">{kind==='quote'?'Confirmed quote response':'Recorded invoice payments'}</h3><div className="space-y-2 rounded-lg border border-border p-3 text-sm"><p>Recorded status: <strong className="capitalize">{data.confirmed.status}</strong></p><p>Sent: {date(data.confirmed.sentAt)}</p>{kind==='quote'?<>
          <p>Accepted: {date(data.confirmed.acceptedAt)}</p><p>Declined: {date(data.confirmed.declinedAt)}</p>
          {data.confirmed.acceptNote&&<p className="whitespace-pre-wrap break-words">Acceptance note: {data.confirmed.acceptNote}</p>}
          {data.confirmed.declineReason&&<p>Decline reason: {data.confirmed.declineReason.replaceAll('_',' ')}</p>}
          {data.confirmed.declineNote&&<p className="whitespace-pre-wrap break-words">Decline note: {data.confirmed.declineNote}</p>}
          <p className="text-xs text-muted-foreground">Existing opened counter: {data.confirmed.legacyOpens}. This includes earlier page requests and uses a different counting method.</p>
        </>:<><p>Total recorded paid: <strong>{money(data.confirmed.paidCents||0)}</strong></p><p className="text-xs text-muted-foreground">From the payment ledger, including manual entries and reversals. Latest 50 entries.</p>{data.confirmed.payments?.map(p=><p key={p.id}>{p.paidAt} · {money(p.amountCents)} · {p.method.replaceAll('_',' ')}</p>)}{!data.confirmed.payments?.length&&<p>No payments recorded.</p>}</>}</div></section>
        <section className="space-y-3"><h3 className="font-semibold">Devices & loading</h3>{data.devices.map(d=><p className="text-sm" key={`${d.device}:${d.browser}`}>{d.device} · {d.browser}: {d.visits} {d.visits===1?'visit':'visits'}</p>)}<p className="text-xs text-muted-foreground">Loading covers the page and its images. Action errors mean a quote response or payment checkout could not be submitted.</p></section>
        <section className="space-y-3"><h3 className="font-semibold">Visit timeline</h3><p className="text-xs text-muted-foreground">Latest 100 visits. Totals include all recorded visits.</p>{!data.visits.length&&<p className="text-sm text-muted-foreground">No recorded visits yet. Share the customer link to start collecting activity.</p>}{data.visits.map(v=><details key={v.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">{date(v.startedAt)} · {v.device} / {v.browser} · {time(v.activeMs)} active</summary><div className="mt-3 space-y-2 text-xs"><p>{kind==='quote'?`Version ${v.revision}`:v.revision===data.revision?'Current invoice content':'Earlier invoice content'} · Last activity: {date(v.lastAt)}</p><p>Read: {v.scrollPct}% · Load: {(v.loadMs/1000).toFixed(1)}s · Image / action errors: {v.assetErrors} / {v.actionErrors}</p><p>Actions: {Object.entries(v.actions).filter(([,n])=>n).map(([key,n])=>`${names[key]} (${n})`).join(', ')||'None'}</p></div></details>)}</section>
      </>}
    </div>
  </Modal>;
}

export default function DocumentActivityButton({kind,id,className=secondaryBtn}:{kind:Kind;id:number;className?:string}){
  const [open,setOpen]=useState(false);
  return <><button type="button" className={className} onClick={()=>setOpen(true)}>Customer activity</button>{open&&createPortal(<Activity kind={kind} id={id} onClose={()=>setOpen(false)}/>,document.body)}</>;
}
