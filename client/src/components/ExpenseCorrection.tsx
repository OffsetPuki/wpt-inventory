import {RecordSelect} from './RecordSelect';
import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'wouter';
import {apiRequest} from '@/lib/queryClient';
import {useApiMutation} from '@/hooks/useApiMutation';
import {formatMoney,parseMoney} from '@/lib/format';
import {inputCls,primaryBtn} from '@/lib/ui-styles';
import type {Expense} from '@shared/finance-schema';

export function ExpenseCorrection({expense,onDone}:{expense:Expense;onDone:()=>void}) {
 const [open,setOpen]=useState(false),[amount,setAmount]=useState((expense.amountCents/100).toFixed(2)),[delta,setDelta]=useState('0'),[draft,setDraft]=useState(''),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false);
 const key=useRef(crypto.randomUUID());
 const history=useQuery<any[]>({queryKey:['finance-expense-corrections',expense.id],queryFn:async()=>(await apiRequest('GET',`/api/finance/expenses/${expense.id}/corrections`)).json(),enabled:open});
 const save=useApiMutation({request:()=>({method:'POST',url:`/api/finance/expenses/${expense.id}/corrections`,body:{requestKey:key.current,expectedAmountCents:expense.amountCents,amountCents:parseMoney(amount),customerDeltaCents:parseMoney(delta),draftInvoiceId:draft?Number(draft):null,reason,reviewed}}),invalidate:[['finance-expenses'],['finance-invoices'],['finance-expense-corrections']],successTitle:'Correction recorded for review',errorTitle:'Could not record correction',onSuccess:onDone});
 return <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"><p>This expense was billed. <Link className="underline" href={`/finance/invoices?invoice=${expense.invoiceId}`}>Open its invoice</Link>.</p><button type="button" className="mt-2 min-h-11 rounded-lg border px-4 font-medium" onClick={()=>setOpen(!open)}>{open?'Close correction':'Review correction'}</button>{open&&<div className="mt-4 space-y-3">
 <p>Review the job cost and customer charge separately. Issued invoices stay unchanged. A positive charge creates a new draft when needed; a credit needs an existing unpaid draft with sufficient charges.</p>
 <label className="block">Corrected expense cost ($)<input className={inputCls} type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
 <label className="block">Add or subtract customer charge ($, before tax)<input className={inputCls} type="number" step="0.01" value={delta} onChange={e=>setDelta(e.target.value)}/></label>
 <label className="block">Existing draft invoice (optional)<RecordSelect type="invoice-drafts" aria-label="Adjustment draft invoice" value={draft} onChange={e=>setDraft(e.target.value)}/></label>
 <label className="block">Reason<textarea className={inputCls} value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label>
 <p>Cost: {formatMoney(expense.amountCents)} → {formatMoney(parseMoney(amount))}. Customer adjustment: {formatMoney(parseMoney(delta))} plus applicable tax.</p>
 <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed both amounts and the destination invoice.</label>
 <button type="button" className={primaryBtn} disabled={!reviewed||reason.trim().length<3||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'Saving correction…':'Record correction'}</button>
 {history.data?.map(h=><p key={h.id} className="border-t pt-2 text-xs">{new Date(h.created_at).toLocaleDateString()}: {formatMoney(h.before_cents)} → {formatMoney(h.after_cents)} · Customer {formatMoney(h.customer_delta_cents)} · {h.reason}</p>)}
 </div>}</section>;
}
