import {useState} from 'react';
import {Link} from 'wouter';
import {useSuiteQuery} from '@/lib/suite-query';
import {PageButtons} from '@/lib/list-page';
import {secondaryBtn} from '@/lib/ui-styles';
import {RetryBlock} from './RetryBlock';
export default function RelationshipReview(){
 const [open,setOpen]=useState(false),[page,setPage]=useState(0);
 const q=useSuiteQuery(['relationship-review',page],`/api/suite/relationship-review?page=${page}`,open);
 return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)} className="rounded-xl border p-5"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Customer, quote and job connections</summary><p className="my-3 text-sm text-muted-foreground">Review missing or conflicting links using the actual records. Shared names alone do not connect customers. Corrections use the existing reviewed settings or restoration process.</p>{q.isError?<RetryBlock query={q}/>:!q.data?<p>Open to check connections.</p>:<><p className="mb-3 text-sm">{q.data.total} relationships to review</p>{q.data.rows.map((r:any)=><article key={r.kind+':'+r.id} className="space-y-2 border-t py-4"><h3 className="font-medium">{r.label} · {r.title}</h3><p className="text-sm">{r.evidence}</p><p className="rounded-lg bg-muted p-3 text-sm">{r.suggestion}</p><Link href={r.href} className={secondaryBtn}>Review source record</Link></article>)}{q.data.total>25&&<PageButtons page={q.data.page} setPage={setPage} count={q.data.rows.length} total={q.data.total} limit={25}/>}</>}</details>;
}
