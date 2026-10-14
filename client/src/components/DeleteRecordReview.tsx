import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {useLanguage} from '@/lib/language';
import {secondaryBtn} from '@/lib/ui-styles';
import ConfirmDialog from './ConfirmDialog';
import DeletionReview,{useDeletionReview} from './DeletionReview';
export default function DeleteRecordReview({kind,id,name,busy,error,onConfirm,unsaved=false}:{kind:'customer'|'lead'|'item';id:number;name:string;busy:boolean;error?:string;onConfirm:()=>void;unsaved?:boolean}){
 const [open,setOpen]=useState(false),{t}=useLanguage(),q=useDeletionReview(kind,id,open);
 return <><button type="button" className={secondaryBtn+' text-destructive'} disabled={busy} onClick={()=>setOpen(true)}><Trash2 size={16}/>{t(kind==='lead'?'Delete lead':'Delete')}</button>{open&&<ConfirmDialog title={t('Move to Trash')+'?'} confirmLabel={t('Move to Trash')} busy={busy} disabled={!q.data||q.isError} error={error} onClose={()=>setOpen(false)} onConfirm={onConfirm}><p><strong>{name}</strong></p><p>{t('You can restore this record from Trash. Linked history is kept; this does not cancel issued invoices or customer agreements.')}</p>{unsaved&&<p>{t('Unsaved edits are not applied when you delete this record.')}</p>}<DeletionReview query={q}/></ConfirmDialog>}</>;
}
