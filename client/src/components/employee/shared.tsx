import {L} from '@/lib/language';
import {requestDigest} from '@/lib/request-identity';
import {businessDateInput, formatDateTime, getBusinessTimeZone} from '@/lib/format';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/lib/auth';

export const employeeButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50';
export const employeePrimary = employeeButton+' border-transparent bg-primary text-primary-foreground';
export const employeeInput = 'mt-2 min-h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-base';
export const duration = (minutes:number) => {const n=Math.round(Math.abs(minutes));return `${minutes<0?'−':''}${Math.floor(n/60)}h ${n%60}m`;};
export const stamp = (ms:number) => formatDateTime(ms);
export const time = (ms:number) => new Date(ms).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:getBusinessTimeZone(),timeZoneName:'short'});
export const localDate = (ms=Date.now()) => businessDateInput(ms);
export const localInput = (ms:number) => {const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export const dateLabel = (date:string) => new Date(date+'T12:00:00').toLocaleDateString([], {month:'short',day:'numeric'});
export const kindLabel = (kind:string) => ({work:'Job work',shop:'Shop work',paid_break:'Paid break',unpaid_break:'Unpaid break',paid_meal:'Paid meal',unpaid_meal:'Unpaid meal'}[kind]||kind);
export const statusLabel = (status:string) => ({running:'On the clock',pending:'Waiting for approval',approved:'Approved',changes_requested:'Needs correction',changes:'Needs correction',legacy:'Earlier recorded time'}[status]||status);
export function EmployeeCard({children,className=''}:{children:ReactNode;className?:string}) {return <section className={'min-w-0 rounded-2xl border border-border bg-card p-5 '+className}>{children}</section>;}
export function EmployeeError({error,retry}:{error:any;retry:()=>void}) {return <div role="alert" className="rounded-xl border border-destructive/40 p-4"><p>{error?.message||'Could not load this page.'}</p><button className={employeeButton+' mt-3'} onClick={retry}><L>{"Try again"}</L></button></div>;}
export function Status({status}:{status:string}) {return <span className={'inline-flex rounded-lg px-2 py-1 text-sm font-medium '+(['changes','changes_requested'].includes(status)?'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100':'bg-muted text-foreground')}><L>{statusLabel(status)}</L></span>;}
export function useEmployeeQuery<T=any>(name:string,path:string) {
  const {user}=useAuth();
  return useQuery<T>({queryKey:['employee',name,user?.id],queryFn:async()=>(await apiRequest('GET',path)).json(),staleTime:0,refetchOnWindowFocus:'always',refetchInterval:15000});
}
export function useEmployeeMutation(path:string,method='POST',saved?:(body:any)=>void) {
  const {user}=useAuth(),qc=useQueryClient(),storeKey=`employee-request:${user?.id}:${method}:${path}`;
  const identity=useRef<{body:string;key:string}|null>(null);
  return useMutation({mutationFn:async(body:any)=>{
    const encoded=await requestDigest(JSON.stringify(body));
    if(!identity.current)try{identity.current=JSON.parse(sessionStorage.getItem(storeKey)||'null');}catch{/* Use a fresh key if browser storage is unavailable. */}
    if(identity.current?.body!==encoded)identity.current={body:encoded,key:crypto.randomUUID()};
    try{sessionStorage.setItem(storeKey,JSON.stringify(identity.current));}catch{/* The in-memory key still protects retries on this screen. */}
    return (await apiRequest(method,path,body,{idempotencyKey:identity.current.key})).json();
  },onSuccess:async(_data,body)=>{try{if(JSON.parse(sessionStorage.getItem(storeKey)||'null')?.key===identity.current?.key)sessionStorage.removeItem(storeKey);}catch{}identity.current=null;saved?.(body);await Promise.all([qc.invalidateQueries({queryKey:['employee']}),qc.invalidateQueries({queryKey:['hr-payroll-summary']}),qc.invalidateQueries({queryKey:['hr-leave']})]);}});
}
export function useOnline() {
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  return online;
}
// Login-scoped drafts survive navigation and reload. Show failures instead of claiming a save.
export function useEmployeeDraft<T extends object>(name:string,initial:T) {
  const {user}=useAuth(),key=`employee-draft:${user!.id}:${name}`;
  const [draft,setState]=useState<T>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved&&typeof saved==='object'?{...initial,...saved}:initial;}catch{return initial;}});
  const [persisted,setPersisted]=useState(true);
  const setDraft=(value:T)=>{setState(value);try{localStorage.setItem(key,JSON.stringify(value));setPersisted(true);}catch{setPersisted(false);}};
  const reset=(submitted?:T)=>{try{const stored=localStorage.getItem(key);if(submitted&&stored&&JSON.stringify(JSON.parse(stored))!==JSON.stringify(submitted))return;localStorage.removeItem(key);setPersisted(true);}catch{setPersisted(false);}setState(initial);};
  return {draft,setDraft,reset,persisted};
}
export function DraftNote({persisted}:{persisted:boolean}) {return <p role={persisted?undefined:'alert'} className="text-sm text-muted-foreground"><L>{persisted?'Draft kept on this device until you send it.':'This device could not save your draft. Keep this screen open until you send it.'}</L></p>;}
