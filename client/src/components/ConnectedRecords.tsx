import {useState} from 'react';
import {Link} from 'wouter';
import {useAuth} from '@/lib/auth';
import {useSuiteQuery} from '@/lib/suite-query';
import {RetryBlock} from './RetryBlock';
type Props={kind:'customer'|'lead'|'quote'|'job'|'invoice';id:number};
function Summary({kind,id}:Props){
 const [expanded,setExpanded]=useState(false),[page,setPage]=useState(0),size=expanded?25:5,q=useSuiteQuery(['record-connections',kind,id,page,size],`/api/suite/connections/${kind}/${id}?page=${page}&size=${size}`);
 if(q.isError)return <RetryBlock query={q}/>;
 if(!q.data)return <p className="text-sm" role="status">Loading connected records…</p>;
 const rows=q.data.records,visible=rows;
 return <section className="rounded-xl border bg-card p-3" aria-label="Connected records"><h2 className="mb-2 text-sm font-semibold">Connected records</h2><div className="flex flex-wrap gap-2">{visible.map((r:any)=><Link key={r.type+':'+r.id} className="flex min-h-11 max-w-full flex-col justify-center rounded-lg border px-3 py-2 hover:bg-muted" href={r.href}><span className="text-xs text-muted-foreground">{r.type}{r.status?' · '+r.status:''}</span><span className="break-words text-sm font-medium">{r.label}</span></Link>)}{q.data.jobs.slice(0,expanded?undefined:1).map((j:any)=><div key={j.id} className="flex gap-2"><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm" href={j.filesHref}>{q.data.jobs.length>1?j.name+' files':'Files'}</Link><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm" href={j.activityHref}>Activity</Link></div>)}</div>{q.data.total>5&&<button type="button" className="mt-2 min-h-11 text-sm underline" onClick={()=>{setExpanded(!expanded);setPage(0);}}>{expanded?'Show fewer':`All ${q.data.total} connected records`}</button>}{expanded&&q.data.total>25&&<div className="flex flex-wrap items-center gap-3"><button className="min-h-11 rounded-lg border px-3" disabled={!q.data.page} onClick={()=>setPage(q.data.page-1)}>Previous records</button><span className="text-sm">Page {q.data.page+1}</span><button className="min-h-11 rounded-lg border px-3" disabled={(q.data.page+1)*25>=q.data.total} onClick={()=>setPage(q.data.page+1)}>Next records</button></div>}{q.data.missing.map((message:string)=><p key={message} className="mt-2 text-xs text-muted-foreground">{message}</p>)}</section>;
}
export default function ConnectedRecords(props:Props){const {isElevated}=useAuth();return isElevated?<Summary key={props.kind+':'+props.id} {...props}/>:null;}
