import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';
import { secondaryBtn } from '@/lib/ui-styles';
import ConfirmDialog from './ConfirmDialog';
import DeletionReview,{useDeletionReview} from './DeletionReview';

export default function DeleteJobButton({job,onDeleted}:{job:{id:number;name:string;jobNumber:string;_version?:number};onDeleted?:()=>void}) {
  const [open,setOpen]=useState(false);
  const dependencies=useDeletionReview('job',job.id,open);
  const remove=useApiMutation({
    request:()=>({method:'DELETE',url:`/api/projects/${job.id}`,expectedVersion:job._version}),
    invalidate:[['projects'],['trash','projects']],
    errorTitle:'Could not delete job',successTitle:'Job moved to Trash',
    onSuccess:()=>{setOpen(false);onDeleted?.();},
  });
  return <>
    <button type="button" className={`${secondaryBtn} text-destructive`} aria-label={`Delete job ${job.jobNumber}`} onClick={()=>{remove.reset();setOpen(true);}}><Trash2 className="h-4 w-4" aria-hidden="true"/>Delete job</button>
    {open&&<ConfirmDialog title={`Delete job ${job.jobNumber}?`} confirmLabel="Move to Trash" busy={remove.isPending} disabled={!dependencies.data||dependencies.isError} error={remove.error?.message} onClose={()=>setOpen(false)} onConfirm={()=>remove.mutate()}>
      <p><strong>{job.name}</strong> will leave the active Jobs list. You can restore it from Trash.</p>
      <p>Quotes, invoices, payments and job work records are retained. This does not cancel customer documents or resend anything.</p>
      <p>Reserved materials are released; check reservations again if you restore the job.</p>
      <DeletionReview query={dependencies}/>
    </ConfirmDialog>}
  </>;
}
