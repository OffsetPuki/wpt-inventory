import {L} from '@/lib/language';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiRequest } from '@/lib/queryClient';
import { EmployeeCard, EmployeeError, duration, time, kindLabel, statusLabel, employeeButton, employeePrimary, employeeInput, useEmployeeQuery, useOnline } from './shared';

function useClockState() {
  const {user}=useAuth(),home=useEmployeeQuery('home','/api/employee/home'),qc=useQueryClient(),online=useOnline();
  const key=`employee-clock:${user!.id}`,receiptKey=`employee-clock-receipt:${user!.id}`;
  const read=(k:string)=>{try{return JSON.parse(sessionStorage.getItem(k)||'null');}catch{return null;}};
  const [pending,setPending]=useState<any>(()=>read(key)),[receipt,setReceipt]=useState<any>(()=>read(receiptKey));
  const [saved,setSaved]=useState<number|null>(null),[tick,setTick]=useState(Date.now()),inFlight=useRef(false);
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const remember=(k:string,v:any)=>{try{v?sessionStorage.setItem(k,JSON.stringify(v)):sessionStorage.removeItem(k);}catch{/* Server versions still reject duplicate punches. */}};
  const mutation=useMutation({mutationFn:async(request:any)=>(await apiRequest('POST','/api/employee/clock',request.body,{idempotencyKey:request.key})).json(),onSuccess:async(data,request)=>{
    setPending(null);remember(key,null);setSaved(data.savedAt);
    if(data.receipt){setReceipt(data.receipt);remember(receiptKey,data.receipt);}
    if(request.body.action==='in'){setReceipt(null);remember(receiptKey,null);}
    await qc.invalidateQueries({queryKey:['employee']});
  },onError:async(error:any)=>{if(error.status&&error.status<500){setPending(null);remember(key,null);await home.refetch();}},onSettled:()=>{inFlight.current=false;}});
  const current=home.data?.current,segment=current?.entries.find((e:any)=>e.ended_at==null),working=segment&&['work','shop'].includes(segment.work_kind);
  const activeJobs=home.data?.jobs.filter((j:any)=>!['done','on_hold'].includes(j.status))||[];
  const lastWork=current?[...current.entries].reverse().find((e:any)=>['work','shop'].includes(e.work_kind)):null;
  const previous=lastWork?.project_id??home.data?.lastProjectId;
  const lastProjectId=activeJobs.some((j:any)=>j.id===previous)?previous:null;
  const busy=mutation.isPending||!!pending||!online||!home.data||home.isError;
  const send=(request:any)=>{if(inFlight.current||!online)return;inFlight.current=true;mutation.mutate(request);};
  const act=(action:string,projectId:number|null=lastProjectId)=>{
    if(busy||inFlight.current)return;
    const request={key:crypto.randomUUID(),body:{action,version:action==='stop_legacy'?home.data.legacy.id:current?.version??0,projectId}};
    setPending(request);remember(key,request);setSaved(null);send(request);
  };
  return {home,online,current,segment,working,activeJobs,lastProjectId,busy,act,pending,receipt,saved,mutation,retry:()=>pending&&send(pending),
    serverNow:home.data?.serverNow+Math.max(0,tick-home.dataUpdatedAt)};
}
const ClockContext=createContext<ReturnType<typeof useClockState>|null>(null);
export function EmployeeClockProvider({children}:{children:ReactNode}) {const value=useClockState();return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;}
export function useEmployeeClock() {const value=useContext(ClockContext);if(!value)throw new Error('Employee clock provider is required');return value;}
export function ClockFeedback() {
  const c=useEmployeeClock();
  return <>
    {c.mutation.isPending&&<p role="status" className="mt-3 text-sm"><L>{"Saving your clock action…"}</L></p>}
    {c.mutation.isError&&<p role="alert" className="mt-3 text-sm text-destructive">{c.mutation.error.message}</p>}
    {c.pending&&!c.mutation.isPending&&<div role="alert" className="mt-3 rounded-xl border border-amber-500/40 p-3"><p className="text-sm"><L>{"This action has not been confirmed. Retry to check whether it saved."}</L></p><button disabled={!c.online} className={employeeButton+' mt-3'} onClick={c.retry}><RefreshCw size={16}/><L>{"Retry clock action"}</L></button></div>}
    {c.saved&&!c.mutation.isPending&&!c.pending&&<p role="status" className="mt-3 flex items-center gap-2 text-sm"><CheckCircle2 size={17}/><L>{"Saved at"}</L> {time(c.saved)}</p>}
  </>;
}
export function ClockPanel() {
  const c=useEmployeeClock(),[changing,setChanging]=useState(false),[selection,setSelection]=useState('');
  useEffect(()=>{setSelection(c.lastProjectId?String(c.lastProjectId):'');setChanging(false);},[c.lastProjectId,c.current?.version]);
  if(c.home.isPending)return <EmployeeCard><p role="status"><L>{"Checking your clock…"}</L></p></EmployeeCard>;
  if(c.home.isError)return <EmployeeError error={c.home.error} retry={()=>c.home.refetch()}/>;
  const data=c.home.data,project=c.activeJobs.find((j:any)=>j.id===c.lastProjectId),jobName=(c.working?c.segment.project_name:project?.name)||'Shop work';
  const paid=c.current?c.current.entries.reduce((n:number,e:any)=>n+(e.work_kind.startsWith('unpaid_')?0:(e.ended_at??c.serverNow)-e.started_at),0)/60000:0;
  const onBreak=c.current&&!c.working,breakMinutes=onBreak?(c.serverNow-c.segment.started_at)/60000:0;
  return <>
    {c.receipt&&!c.current&&!c.pending&&<EmployeeCard><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={20}/><L>{"Your hours were submitted"}</L></p><dl className="mt-4 grid grid-cols-2 gap-4"><div><dt className="text-sm text-muted-foreground"><L>{"Paid hours"}</L></dt><dd className="mt-1 text-xl font-semibold">{duration(c.receipt.entries.reduce((n:number,e:any)=>n+e.duration_min,0))}</dd></div><div><dt className="text-sm text-muted-foreground"><L>{"Unpaid breaks"}</L></dt><dd className="mt-1 text-xl font-semibold">{duration(c.receipt.entries.reduce((n:number,e:any)=>n+(e.work_kind.startsWith('unpaid_')?(e.ended_at-e.started_at)/60000:0),0))}</dd></div></dl><p className="mt-4 text-sm">{statusLabel(data.lastShift?.id===c.receipt.id?data.lastShift.status:c.receipt.status)}<L>{". View details in My hours."}</L></p><Link className="mt-2 inline-flex min-h-12 items-center underline" href="/employee/time"><L>{"View my hours"}</L></Link></EmployeeCard>}
    <EmployeeCard>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold"><L>{onBreak?kindLabel(c.segment.work_kind):'Your clock'}</L></h2><span className="rounded-lg bg-muted px-2 py-1 text-sm"><L>{c.current?onBreak?(c.segment.work_kind.startsWith('unpaid_')?'Unpaid':'Paid'):'On the clock':'Clocked out'}</L></span></div>
      <p className="mt-4 text-4xl font-semibold tracking-tight tabular-nums">{duration(c.current?(onBreak?breakMinutes:paid):data.todayMinutes)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{onBreak?`Break elapsed · ${duration(paid)} paid this shift`:c.current?`Paid this shift · started ${time(c.current.started_at)}`:'Recorded today'}</p>
      <p className="mt-4 break-words font-medium"><L>{onBreak?'Resume at: ':c.current?'Working at: ':'Clock in at: '}</L>{jobName}</p>
      {c.current?.long&&<p role="alert" className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"><L>{"Over 12 hours on the clock. Check your finish time in My hours if you missed clocking out."}</L></p>}
      {data.legacy?<><p className="mt-3 text-sm"><L>{"An earlier timer is still running. Close it to submit those hours."}</L></p><button disabled={c.busy} onClick={()=>c.act('stop_legacy')} className={employeePrimary+' mt-4 w-full'}><L>{"Close earlier timer"}</L></button></>:<>
        <button disabled={c.busy} className={employeePrimary+' mt-5 w-full text-base'} onClick={()=>c.act(!c.current?'in':onBreak?'resume':'out')}><Clock3 size={19}/><L>{!c.current?'Clock in':onBreak?'Resume work':'Clock out'}</L></button>
        {!onBreak&&<div className="mt-3 flex flex-wrap gap-2">
          {c.working&&<><button disabled={c.busy} className={employeeButton+' flex-1'} onClick={()=>c.act('break')}><L>{data.policy.break_paid?'Paid':'Unpaid'}</L> <L>{"break"}</L></button><button disabled={c.busy} className={employeeButton+' flex-1'} onClick={()=>c.act('meal')}><L>{data.policy.meal_paid?'Paid':'Unpaid'}</L> <L>{"meal"}</L></button></>}
          <button disabled={c.busy} className={employeeButton+' w-full'} aria-expanded={changing} onClick={()=>setChanging(v=>!v)}><L>{"Change job"}</L></button>
        </div>}
        {onBreak&&<button disabled={c.busy} className={employeeButton+' mt-3 w-full'} onClick={()=>c.act('out')}><L>{"Clock out instead"}</L></button>}
        {changing&&!onBreak&&<form className="mt-4" onSubmit={e=>{e.preventDefault();if(c.current)c.act('switch',selection?Number(selection):null);else c.act('in',selection?Number(selection):null);}}><label className="block text-sm"><L>{"Where are you working?"}</L><select autoFocus className={employeeInput} value={selection} onChange={e=>setSelection(e.target.value)}><option value=""><L>{"Shop work"}</L></option>{c.activeJobs.map((j:any)=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label><button disabled={c.busy||!!c.current&&(selection?Number(selection):null)===c.segment?.project_id} className={employeeButton+' mt-3 w-full'}><L>{c.current?'Use this job':'Clock in here'}</L></button></form>}
      </>}
      <ClockFeedback/>
      {!c.online&&<p role="alert" className="mt-3 text-sm"><L>{"Reconnect to save. You can request missed time in My hours."}</L></p>}
      <p className="mt-4 text-sm text-muted-foreground"><L>{"Clock out when you finish. Signing out keeps your clock running."}</L></p>
    </EmployeeCard>
  </>;
}
export function JobClockAction({job,secondary=false}:{job:any;secondary?:boolean}) {
  const c=useEmployeeClock();
  if(['done','on_hold'].includes(job.status)||c.home.data?.legacy)return null;
  if(c.current&&c.working&&c.segment?.project_id===job.id)return <p className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={18}/><L>{"You’re working on this job"}</L></p>;
  return <div><button disabled={c.busy} className={(secondary?employeeButton:employeePrimary)+' w-full'} onClick={()=>c.act(!c.current?'in':c.working?'switch':'resume',job.id)}>{!c.current?'Start work on this job':c.working?'Work on this job':'Resume on this job'}</button>{!secondary&&<ClockFeedback/>}</div>;
}
