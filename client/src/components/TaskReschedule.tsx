import {useState} from 'react';
import {useSuiteQuery} from '@/lib/suite-query';
import {useApiMutation} from '@/hooks/useApiMutation';
import Modal from './Modal';
import {RetryBlock} from './RetryBlock';
import {inputCls,primaryBtn} from '@/lib/ui-styles';
export default function TaskReschedule({ids,close}:{ids:number[];close:()=>void}){
 const [date,setDate]=useState(''),[requestKey]=useState(()=>crypto.randomUUID());
 const q=useSuiteQuery(['task-reschedule',ids,date],`/api/suite/tasks/reschedule?ids=${ids.join(',')}&dueDate=${date}`,!!date);
 const save=useApiMutation({request:()=>({method:'POST',url:'/api/suite/tasks/reschedule',body:{ids,dueDate:date,version:q.data.version,requestKey}}),errorTitle:'Could not reschedule tasks',successTitle:`${ids.length} tasks rescheduled`,invalidate:[['pm-tasks'],['suite-today']],onSuccess:close});
 return <Modal open title="Review new task dates" onClose={close} busy={save.isPending}><div className="space-y-4"><p className="text-sm">Only the selected tasks’ due dates will change. Start dates and assignments stay as shown.</p><label className="block text-sm">New due date<input type="date" className={inputCls} value={date} onChange={e=>setDate(e.target.value)}/></label>{q.isError?<RetryBlock query={q}/>:q.data?<ul className="divide-y">{q.data.rows.map((r:any)=><li key={r.id} className="py-3"><strong className="block text-sm">{r.title}</strong><span className="text-xs">Due {r.previousDueDate||'not set'} → {r.dueDate} · Starts {r.startDate||'not set'}</span></li>)}</ul>:date?<p>Preparing preview…</p>:null}{save.isError&&<p role="alert">{save.error.message}</p>}<div className="suite-modal-actions"><button type="button" disabled={!q.data||q.isFetching||save.isPending} className={primaryBtn} onClick={()=>save.mutate()}>Confirm {ids.length} new due dates</button></div></div></Modal>;
}
