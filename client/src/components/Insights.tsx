import {lazy,Suspense,useState} from 'react';
import {useAuth} from '@/lib/auth';
import type {InsightArea} from '@shared/insights';
const Panel=lazy(()=>import('./InsightsPanel'));
/** Keep report code out of worker pages and load only when a report is mounted. */
export default function Insights({area}:{area:InsightArea}){
 const {isElevated,user}=useAuth();
 const key=`cjm.graphs:${user?.id}:${area}`;
 const [open,setOpen]=useState(()=>{try {const saved=localStorage.getItem(key);return saved===null?!matchMedia('(max-width: 767px)').matches:saved==='open';}catch{return false;}});
 const toggle=()=>{setOpen(!open);try{localStorage.setItem(key,open?'closed':'open');}catch{/* Preference storage is optional. */}};
 return isElevated?<section className="my-5 min-w-0 space-y-3" aria-label="Business insights"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">At a glance</h2><button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={toggle} aria-expanded={open}>{open?'Hide graphs':'Show graphs'}</button></div>{open&&<Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">Loading insights…</p>}><Panel area={area}/></Suspense>}</section>:null;
}
