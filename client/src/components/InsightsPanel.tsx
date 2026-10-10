import {useEffect,useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'wouter';
import {ArrowUpRight,BarChart3,ChevronDown,Download} from 'lucide-react';
import {apiRequest} from '@/lib/queryClient';
import {useBusiness} from '@/hooks/useBusiness';
import {useInsightPeriod} from '@/hooks/useInsightPeriod';
import {formatMoney} from '@/lib/format';
import {inputCls,secondaryBtn} from '@/lib/ui-styles';
import {RetryBlock} from './RetryBlock';
import Modal from './Modal';
import {BUSINESSES} from '@shared/business.js';
import type {InsightArea,InsightChart,InsightRow,InsightReport,InsightDetail,InsightUnit} from '@shared/insights';

export function insightValue(value:number,unit:InsightUnit,suffix=''){
 if(unit==='money')return formatMoney(value);
 return `${value.toLocaleString(undefined,{maximumFractionDigits:2})}${unit==='hours'?' h':unit==='quantity'?' '+suffix:''}`;
}
const barColor=(key:string)=>/Expenses|needed|overdue|15\+|premium/i.test(key)?'bg-amber-500':/Received|Collected|available/i.test(key)?'bg-teal-600':/reserved|Ordered|Accepted/i.test(key)?'bg-indigo-500':'bg-sky-600';
function Graph({chart,onSelect}:{chart:InsightChart;onSelect:(chart:InsightChart,row?:InsightRow)=>void}){
 const [expanded,setExpanded]=useState(false);
 const rows=expanded?chart.rows:chart.rows.slice(0,7);
 const maxByUnit=new Map<string,number>();
 chart.rows.forEach(r=>maxByUnit.set(r.unit,Math.max(maxByUnit.get(r.unit)||1,Math.abs(r.value),Math.abs(r.previous||0))));
 const chartId=useId();
 return <section className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-labelledby={chartId}>
  <div className="flex items-start justify-between gap-3"><div><h3 id={chartId} className="font-semibold">{chart.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{chart.description}</p></div><BarChart3 aria-hidden className="h-5 w-5 shrink-0 text-teal-600"/></div>
  <div className="my-4 flex flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="text-2xl tabular-nums">{chart.unit==='quantity'?`${chart.groups} groups`:insightValue(chart.total,chart.unit)}</strong><span className="text-xs text-muted-foreground">{chart.totalLabel|| (chart.snapshot?'Current snapshot':'Selected period')}</span>{chart.previousTotal!==null&&chart.unit!=='quantity'&&<span className="text-xs text-muted-foreground">Previous: {insightValue(chart.previousTotal,chart.unit)}</span>}</div>
  {!rows.length?<p className="rounded-xl bg-muted/40 p-5 text-sm text-muted-foreground">No matching records for these filters.</p>:<div className="space-y-2">{rows.map(row=>{
   const max=maxByUnit.get(row.unit)||1;
   return <button key={row.key+'\0'+row.unit} type="button" className="group block min-h-14 w-full rounded-xl p-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${row.label}: ${insightValue(row.value,chart.unit,row.unit)}. View records`} onClick={()=>onSelect(chart,row)}>
    <span className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{row.label}{chart.unit==='quantity'&&<small className="ml-1 text-muted-foreground">({row.unit})</small>}</span><strong className="min-w-0 max-w-[55%] break-words text-right tabular-nums">{insightValue(row.value,chart.unit,row.unit)}<ArrowUpRight aria-hidden className="ml-1 inline h-3 w-3"/></strong></span>
    <span aria-hidden className="mt-2 block h-2.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${barColor(row.key)}`} style={{width:Math.abs(row.value)/max*100+'%'}}/></span>
    {row.previous!==null&&<><span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted/40"><span className="block h-full rounded-full bg-slate-400/70" style={{width:Math.abs(row.previous)/max*100+'%'}}/></span><small className="mt-1 block text-muted-foreground">Previous: {insightValue(row.previous,chart.unit,row.unit)}</small></>}
   </button>;
  })}</div>}
  <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-xs">{chart.rows.length>7?<button type="button" className="min-h-9 underline" onClick={()=>setExpanded(!expanded)}>{expanded?'Show fewer':'Show more groups'}</button>:<span/>}<button type="button" className="min-h-9 font-medium text-primary underline" onClick={()=>onSelect(chart)}>View all records</button></div>
  {chart.groups>24&&<p className="text-xs text-muted-foreground">Showing 24 of {chart.groups} groups. Totals and record lists include all matching records.</p>}
 </section>;
}

export default function InsightsPanel({area}:{area:InsightArea}){
 const site=useBusiness(),period=useInsightPeriod(),{from,to,compare,setPeriod}=period;
 const [open,setOpen]=useState(true),[more,setMore]=useState(false);
 const [selection,setSelection]=useState<{chart:InsightChart;row?:InsightRow}|null>(null),[page,setPage]=useState(0),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
 const span=(Date.parse(to)-Date.parse(from))/86400000;
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&span>=0&&span<366;
 const companyOnly=area==='payroll'&&site!=='all';
 const qs=new URLSearchParams({from,to,site,compare:compare?'1':'0'}).toString();
 const report=useQuery<InsightReport>({queryKey:['insights',area,site,from,to,compare],queryFn:async({signal})=>(await apiRequest('GET',`/api/insights/${area}?${qs}`,undefined,{signal})).json(),enabled:open&&valid&&!companyOnly,staleTime:60000});
 useEffect(()=>{setSelection(null);setPage(0);setExportError('');},[area,site,from,to,compare]);
 const detailQs=new URLSearchParams({from,to,site,chart:selection?.chart.id||'',group:selection?.row?.key||'',unit:selection?.row?.unit||'',page:String(page)}).toString();
 const details=useQuery<InsightDetail>({queryKey:['insights',area,'records',site,from,to,selection?.chart.id,selection?.row?.key,selection?.row?.unit,page],queryFn:async({signal})=>(await apiRequest('GET',`/api/insights/${area}?${detailQs}`,undefined,{signal})).json(),enabled:!!selection&&valid&&!companyOnly,staleTime:60000});
 const select=(chart:InsightChart,row?:InsightRow)=>{setSelection({chart,row});setPage(0);setExportError('');};
 const exportRecords=async()=>{setExporting(true);setExportError('');try{const response=await apiRequest('GET',`/api/insights/${area}?${detailQs}&format=csv`);const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${area}-${selection?.chart.id}-${from}-${to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setExportError((e as Error).message);}finally{setExporting(false);}};
 return <section className="my-5 min-w-0 space-y-4" aria-label="Business insights">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-teal-600" aria-hidden/>At a glance</h2><p className="mt-1 text-xs text-muted-foreground">{(BUSINESSES as Record<string,string>)[site]||'All businesses'} · Click any bar to see its records</p></div><button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'Hide graphs':'Show graphs'}<ChevronDown aria-hidden className={`ml-2 inline h-4 w-4 ${open?'rotate-180':''}`}/></button></div>
  {open&&<><div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-muted/25 p-3"><div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:w-80"><label className="min-w-0 text-xs font-medium">From<input aria-label="Insights from" className={`${inputCls} mt-1`} style={{width:'100%',minWidth:0}} type="date" value={from} onChange={e=>setPeriod({from:e.target.value})}/></label><label className="min-w-0 text-xs font-medium">To<input aria-label="Insights to" className={`${inputCls} mt-1`} style={{width:'100%',minWidth:0}} type="date" value={to} onChange={e=>setPeriod({to:e.target.value})}/></label></div><button type="button" className="min-h-11 rounded-lg border bg-card px-3 text-xs" onClick={()=>setPeriod({from:period.today.slice(0,7)+'-01',to:period.today})}>This month</button><button type="button" className="min-h-11 rounded-lg border bg-card px-3 text-xs" onClick={()=>setPeriod({from:new Date(Date.parse(period.today+'T12:00:00Z')-29*86400000).toISOString().slice(0,10),to:period.today})}>Last 30 days</button><label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={compare} onChange={e=>setPeriod({compare:e.target.checked})}/>Compare previous period</label></div>
   {!valid?<p role="alert">Choose valid dates, no more than one year apart.</p>:companyOnly?<p className="rounded-xl border p-4 text-sm">Payroll is company-wide. Select All businesses at the top to view these graphs.</p>:report.isError?<RetryBlock query={report}/>:report.isPending?<p role="status" className="p-5 text-sm text-muted-foreground">Loading your report…</p>:<>
    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{from} – {to}{compare?` · Previous: ${report.data.previousFrom} – ${report.data.previousTo}`:''}</span><span>Current snapshots as of {report.data.asOf}{report.isFetching?' · Updating…':''}</span></div>
    {report.data.notes.map(note=><p key={note} className="rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed">{note}</p>)}
    <div className="grid items-start gap-4 xl:grid-cols-2">{(more?report.data.charts:report.data.charts.slice(0,2)).map(chart=><Graph key={chart.id} chart={chart} onSelect={select}/>)}</div>
    {report.data.charts.length>2&&<button type="button" className={secondaryBtn} aria-expanded={more} onClick={()=>setMore(!more)}>{more?'Show fewer graphs':`More graphs (${report.data.charts.length-2})`}</button>}
   </>}
  </>}
  <Modal open={!!selection} onClose={()=>setSelection(null)} title={selection?.row?.label||selection?.chart.title||'Matching records'} maxWidth="max-w-3xl">
   <p className="mb-4 text-xs text-muted-foreground">{(BUSINESSES as Record<string,string>)[site]||'All businesses'} · {selection?.chart.snapshot?`Current snapshot as of ${report.data?.asOf||period.today}`:`${from} – ${to}`} · {selection?.chart.description}</p>
   {details.isError?<RetryBlock query={details}/>:details.isPending?<p role="status">Loading records…</p>:<><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{details.data.total} matching records</span><button type="button" className={secondaryBtn} onClick={exportRecords} disabled={exporting||!details.data.total}><Download className="h-4 w-4" aria-hidden/>{exporting?'Exporting…':'Export matching records'}</button></div>{exportError&&<p role="alert" className="text-sm text-red-600">{exportError}</p>}<div className="divide-y rounded-xl border">{details.data.rows.map((r,index)=><Link key={r.id+':'+index} href={r.href} onClick={()=>setSelection(null)} className="flex min-h-16 items-center justify-between gap-3 p-3 hover:bg-muted"><span className="min-w-0 break-words text-sm">{r.label}<small className="block text-muted-foreground">{r.date||'No date recorded'}</small></span><strong className="min-w-0 max-w-[50%] break-words text-right text-sm tabular-nums">{insightValue(r.value,details.data.unit,r.unit)}<ArrowUpRight className="ml-1 inline h-4 w-4" aria-hidden/></strong></Link>)}{!details.data.rows.length&&<p className="p-5 text-sm">No matching records in this period.</p>}</div><div className="mt-4 flex items-center justify-between gap-2"><button type="button" className={secondaryBtn} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span className="text-xs">Page {page+1} of {Math.max(1,Math.ceil(details.data.total/details.data.limit))}</span><button type="button" className={secondaryBtn} disabled={(page+1)*details.data.limit>=details.data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
  </Modal>
 </section>;
}
