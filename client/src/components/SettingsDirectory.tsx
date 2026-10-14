import {useState} from 'react';
import {Link} from 'wouter';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
const entries=[
 {group:'Company',name:'Branding, logo & documents',detail:'Company-wide appearance and paperwork.',href:'#company-branding'},
 {group:'Company',name:'Backups & recovery',detail:'Download a complete copy and check restore evidence.',href:'#business-backup'},
 {group:'Company',name:'Connections & delivery problems',detail:'Review missing links, payment exceptions and failed email.',href:'/suite-health'},
 {group:'Team',name:'Employee setup & pay rates',detail:'Connect sign-in accounts, employee records and dated rates.',href:'/employee-approvals?tab=setup'},
 {group:'Team',name:'Sign-in accounts & permissions',detail:'Manage users and their access.',href:'/users'},
 {group:'Team',name:'Job templates',detail:'Reusable work plans for new jobs.',href:'/admin/templates'},
 {group:'Customers & money',name:'Quote pricing & trade defaults',detail:'Open Quotes, then Tools for the price book and shop details.',href:'/crm/quotes'},
 {group:'Customers & money',name:'Email settings & history',detail:'Sender, templates, delivery state and communication preferences.',href:'/emails'},
 {group:'Websites',name:'Website analytics & connections',detail:'Search, traffic and inquiries across all four websites.',href:'/marketing?tab=analytics'},
 {group:'Websites',name:'Trade-specific marketing connections',detail:'Select the business before reviewing its connections.',href:'/marketing?tab=connections'},
 {group:'Recovery',name:'Deleted records',detail:'Review and restore recoverable records.',href:'/trash'},
 {group:'Recovery',name:'Change history',detail:'See who changed a record and when.',href:'/audit'},
];
export default function SettingsDirectory(){
 const [search,setSearch]=useState('');const clock=useQuery({queryKey:['business-clock'],queryFn:async()=>(await apiRequest('GET','/api/suite/clock')).json(),staleTime:60000});
 const filtered=entries.filter(e=>`${e.group} ${e.name} ${e.detail}`.toLowerCase().includes(search.toLowerCase()));
 return <section className="mb-6 space-y-4" aria-label="Find a setting"><label className="block font-medium">Find a setting<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Try payroll, email or backups" className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3 text-base"/></label><p className="text-sm text-muted-foreground">Company settings apply across the suite. Website settings apply to the selected business. Reporting timezone: {clock.data?.timeZone||'Loading…'}.</p><div className="grid gap-3 sm:grid-cols-2">{filtered.map(e=>{const content=<><span className="text-xs text-muted-foreground">{e.group}</span><strong className="mt-1 block">{e.name}</strong><p className="mt-1 text-sm text-muted-foreground">{e.detail}</p></>;const cls='block min-h-24 rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline focus-visible:outline-primary';return e.href.startsWith('#')?<button key={e.name} className={cls+' text-left'} onClick={()=>document.getElementById(e.href.slice(1))?.scrollIntoView({behavior:'smooth',block:'start'})}>{content}</button>:<Link key={e.name} className={cls} href={e.href}>{content}</Link>;})}</div>{!filtered.length&&<p>No matching setting. Try another word.</p>}</section>;
}
