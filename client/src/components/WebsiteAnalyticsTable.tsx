import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { csvCell, type AnalyticsRow } from '@shared/website-analytics';
import { inputCls, secondaryBtn } from '@/lib/ui-styles';

export type AnalyticsColumn={key:string;label:string;format?:(value:string|number|null,row:AnalyticsRow)=>React.ReactNode;export?:(value:string|number|null)=>string;numeric?:boolean};
export function downloadAnalyticsCsv(name:string,columns:AnalyticsColumn[],rows:AnalyticsRow[]) {
  const content=[columns.map(c=>csvCell(c.label)).join(','),...rows.map(row=>columns.map(c=>csvCell(c.export?c.export(row[c.key]??null):row[c.key])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name.replace(/[^a-z0-9_-]/gi,'-')+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function WebsiteAnalyticsTable({title,description,columns,rows,empty='No rows reported for this period.',sortKey,filename}:{title:string;description?:string;columns:AnalyticsColumn[];rows:AnalyticsRow[];empty?:string;sortKey?:string;filename:string}) {
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[sort,setSort]=useState(sortKey||columns[0].key),[ascending,setAscending]=useState(!sortKey);
  const filtered=useMemo(()=>rows.filter(row=>columns.some(c=>String(row[c.key]??'').toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>{
    const left=a[sort],right=b[sort];
    if(left==null)return right==null?0:1;if(right==null)return -1;
    const order=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right));
    return ascending?order:-order;
  }),[rows,columns,search,sort,ascending]);
  const count=Math.max(1,Math.ceil(filtered.length/15)),current=Math.min(page,count-1);
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5"><div className="min-w-0"><h3 className="font-semibold">{title}</h3>{description&&<p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>}</div><button className={secondaryBtn+' shrink-0 text-xs print:hidden'} disabled={!filtered.length} onClick={()=>downloadAnalyticsCsv(filename,columns,filtered)}><Download size={14}/>Export CSV</button></div>
    {rows.length>0&&<div className="relative mx-4 mb-3 print:hidden"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><input aria-label={'Filter '+title} placeholder="Find a page, search term or source…" className={inputCls+' pl-9'} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>}
    <div className="max-w-full overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{title}</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{columns.map(c=><th key={c.key} scope="col" aria-sort={sort===c.key?(ascending?'ascending':'descending'):'none'} className={'px-4 py-3 '+(c.numeric?'text-right':'text-left')}><button onClick={()=>{setSort(c.key);setAscending(sort===c.key?!ascending:!c.numeric);setPage(0);}} className={'inline-flex items-center gap-1 whitespace-nowrap '+(c.numeric?'justify-end':'')}>{c.label}{sort===c.key&&(ascending?<ArrowUp size={12}/>:<ArrowDown size={12}/>)}</button></th>)}</tr></thead><tbody className="divide-y divide-border">{filtered.slice(current*15,current*15+15).map((row,index)=><tr key={index} className="hover:bg-muted/30">{columns.map(c=><td key={c.key} className={'px-4 py-3 tabular-nums '+(c.numeric?'text-right whitespace-nowrap':'min-w-32 max-w-xs break-words')}>{c.format?c.format(row[c.key]??null,row):row[c.key]??'—'}</td>)}</tr>)}</tbody></table></div>
    {!filtered.length&&<p className="p-6 text-sm text-muted-foreground">{rows.length?'No matching rows. Try another search.':empty}</p>}
    {!!filtered.length&&<div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground"><span>{current*15+1}–{Math.min((current+1)*15,filtered.length)} of {filtered.length.toLocaleString()} rows · Export includes all matching rows</span><div className="flex items-center gap-3 print:hidden"><button className={secondaryBtn} disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>{current+1} / {count}</span><button className={secondaryBtn} disabled={current>=count-1} onClick={()=>setPage(current+1)}>Next</button></div></div>}
  </section>;
}
