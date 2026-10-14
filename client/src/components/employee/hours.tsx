import {L} from '@/lib/language';
import { useState } from 'react';
import { useEmployeeClock } from './clock';
import { EmployeeCard, EmployeeError, DraftNote, Status, duration, time, stamp, dateLabel, localInput, kindLabel, employeeButton, employeePrimary, employeeInput, useEmployeeQuery, useEmployeeMutation, useEmployeeDraft } from './shared';

function TimeRequest({entry,close}:{entry?:any;close:(saved?:boolean)=>void}) {
  const {home,lastProjectId}=useEmployeeClock();
  const {draft,setDraft,reset,persisted}=useEmployeeDraft(`time:${entry?.id||'missed'}`,{start:entry?localInput(entry.started_at):'',end:localInput(entry?.ended_at||Date.now()),job:String(lastProjectId||''),reason:''});
  const save=useEmployeeMutation(entry?'/api/employee/time-requests':'/api/employee/manual-time','POST',()=>reset(draft));
  const set=(key:string,value:string)=>setDraft({...draft,[key]:value});
  return <EmployeeCard><h2 className="text-xl font-semibold"><L>{entry?'Fix these hours':'Fix a missed clock-in'}</L></h2><p className="mt-2 text-sm">{entry?'The recorded times are filled in. Change only what needs fixing.':'Enter when you actually started and finished. Add separate requests around unpaid breaks.'}</p><form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({...(entry?{entryId:entry.id}:{projectId:draft.job?Number(draft.job):null}),startedAt:+new Date(draft.start),endedAt:+new Date(draft.end),reason:draft.reason},{onSuccess:()=>close(true)});}}>
    {!entry&&<label className="block text-sm"><L>{"Job"}</L><select disabled={save.isPending} value={draft.job} onChange={e=>set('job',e.target.value)} className={employeeInput}><option value=""><L>{"Shop work"}</L></option>{home.data?.jobs.map((j:any)=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label>}
    <p className="text-sm text-muted-foreground"><L>Enter times in this device’s time zone:</L> {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    <label className="block text-sm"><L>{"Started"}</L><input autoFocus required disabled={save.isPending} type="datetime-local" value={draft.start} onChange={e=>set('start',e.target.value)} className={employeeInput}/></label>
    <label className="block text-sm"><L>{"Finished"}</L><input required disabled={save.isPending} type="datetime-local" value={draft.end} onChange={e=>set('end',e.target.value)} className={employeeInput}/></label>
    <label className="block text-sm"><L>{"What happened?"}</L><textarea required disabled={save.isPending} minLength={3} maxLength={1000} value={draft.reason} onChange={e=>set('reason',e.target.value)} placeholder="For example: my phone had no connection." className={employeeInput}/></label>
    <DraftNote persisted={persisted}/>{save.isError&&<p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    <div className="grid grid-cols-2 gap-3"><button type="button" disabled={save.isPending} className={employeeButton} onClick={()=>close(false)}><L>{"Keep for later"}</L></button><button disabled={save.isPending} className={employeePrimary}>{save.isPending?'Sending…':'Send to owner'}</button></div>
  </form></EmployeeCard>;
}
function DayHours({day,correct}:{day:any;correct:(e:any)=>void}) {
  const statuses=[...new Set(day.entries.map((e:any)=>e.status))] as string[];
  return <EmployeeCard><details><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{new Date(day.date+'T12:00:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})}</h2><div className="mt-2 flex flex-wrap gap-2">{statuses.map(s=><Status key={s} status={s}/>)}{!statuses.length&&<Status status="approved"/>}</div></div><p className="text-2xl font-semibold">{duration(day.paid)}</p></div><p className="mt-3 text-sm underline"><L>{"View jobs & breaks"}</L></p></summary>
    {day.entries.map((e:any)=><div key={e.id} className="mt-4 border-t pt-4"><p className="font-semibold">{e.project_name||kindLabel(e.work_kind)}</p><p className="mt-1 text-sm">{time(e.countedStart)} – {e.ended_at?time(e.countedEnd):'Running'} · {kindLabel(e.work_kind)}</p><p className="mt-1 text-sm">{e.work_kind.startsWith('unpaid_')?`${duration(e.unpaidMinutes)} unpaid`:`${duration(e.paidMinutes)} paid`}</p>{e.review_note&&<p className="mt-2 rounded-lg bg-muted p-3 text-sm"><L>{"Owner:"}</L> {e.review_note}</p>}{e.status!=='running'&&(e.locked?<p className="mt-2 text-sm text-muted-foreground"><L>{"Already billed or in closed payroll. Contact the owner for an adjustment."}</L></p>:<button className={employeeButton+' mt-3'} onClick={()=>correct(e)}><L>{"Fix these hours"}</L></button>)}</div>)}
    {day.adjustments.map((a:any)=><div key={a.id} className="mt-4 border-t pt-3 text-sm"><p className="font-semibold"><L>{"Owner adjustment ·"}</L> {duration(a.minutes_delta)}</p><p className="mt-1">{a.reason}</p></div>)}
  </details></EmployeeCard>;
}
export function EmployeeHours() {
  const {home}=useEmployeeClock(),[dates,setDates]=useState({from:'',to:''}),[editingDates,setEditingDates]=useState(false),[dateError,setDateError]=useState(''),[form,setForm]=useState<any>(undefined),[sent,setSent]=useState(false);
  const chosen=dates.from&&dates.to&&dates.from<=dates.to?`?from=${dates.from}&to=${dates.to}`:'';
  const q=useEmployeeQuery(`hours${chosen}`,`/api/employee/hours${chosen}`),requests=useEmployeeQuery('requests','/api/employee/time');
  const open=(entry:any)=>{setForm(entry);setSent(false);window.scrollTo({top:0,behavior:'smooth'});};
  return <div className="space-y-5"><h1 className="text-3xl font-semibold"><L>{"My hours"}</L></h1>
    {form!==undefined&&<TimeRequest key={form?.id||'new'} entry={form||undefined} close={saved=>{setForm(undefined);setSent(!!saved);}}/>}
    {sent&&<p role="status" className="rounded-xl border border-border bg-card p-4"><L>{"Hours sent for approval."}</L></p>}
    {q.isError?<><EmployeeError error={q.error} retry={()=>q.refetch()}/>{chosen&&<button className={employeeButton+' w-full'} onClick={()=>{setDates({from:'',to:''});setEditingDates(false);setDateError('');}}><L>{"Use current period"}</L></button>}</>:!q.data?<p role="status"><L>{"Loading your hours…"}</L></p>:<>
      <EmployeeCard><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">{q.data.label}</h2><p className="mt-1 text-sm">{dateLabel(q.data.from)} – {dateLabel(q.data.to)}</p></div><button className={employeeButton} aria-expanded={editingDates} onClick={()=>setEditingDates(v=>!v)}><L>{"Change dates"}</L></button></div>
        {dateError&&<p role="alert" className="mt-3 text-sm text-destructive">{dateError}</p>}{editingDates&&<form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();const values=new FormData(e.currentTarget);if(String(values.get('from'))>String(values.get('to'))){setDateError('The end date must be on or after the start date.');return;}setDateError('');setDates({from:String(values.get('from')),to:String(values.get('to'))});setEditingDates(false);}}><label className="block text-sm"><L>{"From"}</L><input required name="from" type="date" defaultValue={q.data.from} className={employeeInput}/></label><label className="block text-sm"><L>{"Through"}</L><input required name="to" type="date" defaultValue={q.data.to} className={employeeInput}/></label><button className={employeeButton+' w-full'}><L>{"Show these dates"}</L></button>{chosen&&<button type="button" className={employeeButton+' w-full'} onClick={()=>{setDates({from:'',to:''});setEditingDates(false);}}><L>{"Use"}</L> {home.data?.period.label.toLowerCase()||'current week'}</button>}</form>}
        <dl className="mt-5 space-y-3">{[['Approved',q.data.totals.approved],['Waiting for approval',q.data.totals.pending],['Needs correction',q.data.totals.changes]].map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2 border-t pt-3"><dt>{label}</dt><dd className="text-lg font-semibold tabular-nums">{duration(Number(value))}</dd></div>)}</dl>
        {q.data.totals.running>0&&<p className="mt-4 text-sm"><L>{"On the clock:"}</L> {duration(q.data.totals.running)} <L>{"· submit by clocking out."}</L></p>}
        {q.data.totals.unpaid>0&&<p className="mt-3 text-sm"><L>{"Unpaid breaks:"}</L> {duration(q.data.totals.unpaid)} <L>{"· excluded from paid hours."}</L></p>}
        {q.data.totals.legacy>0&&<p className="mt-3 text-sm text-muted-foreground"><L>{"Approved total includes earlier recorded hours carried into this workspace."}</L></p>}
        {!!q.data.totals.adjustments&&<p className="mt-3 text-sm"><L>{"Approved total includes owner adjustments of"}</L> {duration(q.data.totals.adjustments)}.</p>}
      </EmployeeCard>
      <button className={employeeButton+' w-full'} onClick={()=>open(null)}><L>{"Fix a missed clock-in"}</L></button>
      {requests.data?.requests.length>0&&<EmployeeCard><details open={requests.data.requests.some((r:any)=>r.status==='pending')}><summary className="min-h-12 cursor-pointer py-3 font-semibold"><L>{"My correction requests"}</L></summary>{requests.data.requests.map((r:any)=><div key={r.id} className="mt-3 border-t pt-3 text-sm"><p>{stamp(r.started_at)} – {stamp(r.ended_at)}</p><p className="mt-2 font-semibold"><L>{r.status==='pending'?'Waiting for approval':r.status==='denied'?'Declined':'Accepted'}</L></p><p className="mt-1">{r.decision_note||r.reason}</p></div>)}</details></EmployeeCard>}
      {!q.data.days.length?<EmployeeCard><L>{"No recorded hours in these dates."}</L></EmployeeCard>:q.data.days.map((d:any)=><DayHours key={d.date} day={d} correct={open}/>)}
    </>}
  </div>;
}
