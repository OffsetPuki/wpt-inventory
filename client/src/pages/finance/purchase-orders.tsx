import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getAuthToken } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useDialogDraft } from '@/lib/dialog-draft';
import { useRecordLink } from '@/lib/record-link';
import { inputCls, primaryBtn, secondaryBtn } from '@/lib/ui-styles';
import { formatMoney, formatDate } from '@/lib/format';
import { toast } from '@/components/ui/toaster';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import ReceiveDelivery from '@/components/inventory/ReceiveDelivery';
import { RetryBlock } from '@/components/RetryBlock';
import { Chip } from '@/components/ui/Chip';
import { ORDER_LABELS, ORDER_TRANSITIONS, ORDER_STATUSES, emptyOrderDetails, orderTotals, type OrderDetails, type OrderType, type OrderStatus } from '@shared/purchase-orders';
import { parseLineItems, type LineItem } from '@shared/biz-common';
import { cn } from '@/lib/utils';
import { Plus, FileDown, Paperclip, Search, X, Loader2 } from 'lucide-react';

type Po=any;
type Line=Omit<LineItem,'qty'|'unitPriceCents'> & {qty:string;price:string};
const blankLine=():Line=>({description:'',qty:'1',unit:'each',price:''});
const keys=[['finance-pos'],['po-detail'],['inventory'],['finance-stats'],['finance-expenses']];
function Status({po}:{po:Po}) {return <Chip tone={po.status==='cancelled'?'red':['draft','review'].includes(po.status)?'amber':['received','closed','delivered'].includes(po.status)?'emerald':'blue'}>{po.partiallyReceived?'Partially received':ORDER_LABELS[po.status as OrderStatus]}</Chip>;}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;}
function Section({title,children}:{title:string;children:ReactNode}) {return <fieldset className="rounded-xl border border-border p-4"><legend className="px-2 font-semibold">{title}</legend><div className="grid gap-4 sm:grid-cols-2">{children}</div></fieldset>;}
const initial=(type:OrderType)=>({orderType:type,vendor:'',customerName:'',clientId:'',leadId:'',quoteId:'',projectId:'',customerPoNumber:'',customerProjectNumber:'',expectedDate:'',notes:'',discount:'',shipping:'',tax:'',deposit:'',taxShipping:false,details:emptyOrderDetails(),lines:[blankLine()]});
type Form=ReturnType<typeof initial>;
function fromPo(p:Po):Form {return {...initial(p.orderType),...Object.fromEntries(['vendor','customerName','customerPoNumber','customerProjectNumber','expectedDate','notes'].map(k=>[k,p[k]||''])),...Object.fromEntries(['clientId','leadId','quoteId','projectId'].map(k=>[k,p[k]?String(p[k]):''])),details:{...emptyOrderDetails(),...(typeof p.details==='string'?JSON.parse(p.details):p.details)},lines:parseLineItems(p.items).map(i=>({...i,qty:String(i.qty),price:(i.unitPriceCents/100).toFixed(2)})),discount:((p.discountCents||0)/100).toFixed(2),shipping:((p.shippingCents||0)/100).toFixed(2),tax:((p.taxRateBp||0)/100).toFixed(2),deposit:((p.depositCents||0)/100).toFixed(2),taxShipping:!!p.taxShipping};}
const decimal=(v:string)=>{if(v!==''&&!/^\d+(\.\d{0,4})?$/.test(v.trim()))throw new Error('Use nonnegative numbers for quantities and prices.');return Number(v||0);};
function payload(f:Form){return {orderType:f.orderType,vendor:f.vendor,customerName:f.customerName,clientId:Number(f.clientId)||null,leadId:Number(f.leadId)||null,quoteId:Number(f.quoteId)||null,projectId:Number(f.projectId)||null,customerPoNumber:f.customerPoNumber,customerProjectNumber:f.customerProjectNumber,expectedDate:f.expectedDate||null,notes:f.notes,details:f.details,items:f.lines.map(l=>({description:l.description,qty:decimal(l.qty),unitPriceCents:Math.round(decimal(l.price)*100),unit:l.unit,inventoryItemId:l.inventoryItemId,materialKey:l.materialKey})),discountCents:Math.round(decimal(f.discount)*100),shippingCents:Math.round(decimal(f.shipping)*100),taxRateBp:Math.round(decimal(f.tax)*100),taxShipping:f.taxShipping,depositCents:Math.round(decimal(f.deposit)*100)};}

function Editor({po,type,onClose}:{po:Po|null;type:OrderType;onClose:()=>void}) {
  const [row,setRow]=useState<Po|null>(po),[f,setF]=useState<Form>(()=>po?fromPo(po):initial(type)),[pane,setPane]=useState('Order'),[lookup,setLookup]=useState(''),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[receiving,setReceiving]=useState(false),[uploading,setUploading]=useState(false),[docKind,setDocKind]=useState('original_po'),[busy,setBusy]=useState(false);
  const qc=useQueryClient();
  const editable=!row||(['draft','review'].includes(row.status)&&row.revision>0);
  const recovered=useDialogDraft(`PoFormModal:${row?.id||'new:'+type}`,true,{f},v=>{if(v.f)setF(v.f);},row?._version);
  const detail=useQuery<Po>({queryKey:['po-detail',row?.id],enabled:!!row,queryFn:async()=> (await apiRequest('GET',`/api/finance/purchase-orders/${row.id}/detail`)).json()});
  const options=useQuery<any>({queryKey:['po-lookups',lookup],queryFn:async()=> (await apiRequest('GET',`/api/finance/purchase-orders/options/search?q=${encodeURIComponent(lookup)}`)).json()});
  const update=(k:keyof Form,v:any)=>setF(s=>({...s,[k]:v}));
  const dt=(k:keyof OrderDetails,v:any)=>setF(s=>({...s,details:{...s.details,[k]:v}}));
  const after=async(saved:Po)=>{recovered.reset({f:fromPo(saved)},saved._version);setRow(saved);setF(fromPo(saved));setReviewed(false);setReason('');for(const key of keys)await qc.invalidateQueries({queryKey:key});};
  const save=useApiMutation<Po>({request:()=>({method:row?'PATCH':'POST',url:`/api/finance/purchase-orders${row?'/'+row.id:''}`,body:payload(f),expectedVersion:recovered.expectedVersion}),invalidate:keys,successTitle:'Order draft saved',errorTitle:'Could not save order',onSuccess:after});
  const action=useApiMutation<Po,{path:string;body:any}>({request:v=>({method:'POST',url:`/api/finance/purchase-orders/${row.id}/${v.path}`,body:v.body,expectedVersion:row._version}),invalidate:keys,successTitle:'Order updated',errorTitle:'Could not update order',onSuccess:after});
  let totals:any=null,mathError='';try{const data=payload(f);totals=orderTotals(data.items,data);}catch(e:any){mathError=e.message;}
  const dirty=row&&JSON.stringify(f)!==JSON.stringify(fromPo(row));
  const current=detail.data;
  async function fillQuote(){
    if(!f.quoteId)return;setBusy(true);
    try{const q=await (await apiRequest('GET',`/api/finance/purchase-orders/quote/${f.quoteId}`)).json();
      setF(s=>({...s,customerName:q.customerName,clientId:q.clientId?String(q.clientId):'',leadId:q.leadId?String(q.leadId):'',deposit:(q.depositCents/100).toFixed(2),discount:'',shipping:'',tax:'',lines:[{description:q.summary||`Work per ${q.number}`,qty:'1',unit:'job',price:(q.totalCents/100).toFixed(2)}],details:{...s.details,business:q.business||s.details.business,contactName:q.contactName,email:q.email,phone:q.phone,billingAddress:q.billingAddress,scope:q.scope,specifications:q.specifications,finish:q.finish,paymentTerms:q.paymentTerms}}));
    }catch(e:any){toast({variant:'destructive',title:'Could not load quote',description:e.message});}finally{setBusy(false);}
  }
  async function download(url:string,name:string){try{const res=await apiRequest('GET',url);const object=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=object;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),30000);}catch(e:any){toast({variant:'destructive',title:'Download failed',description:e.message});}}
  async function upload(file:File){
    if(!row||dirty)return;setUploading(true);
    try{const form=new FormData();form.append('kind',docKind);form.append('file',file);
      const res=await fetch(`/api/finance/purchase-orders/${row.id}/documents`,{method:'POST',headers:{'X-Auth':getAuthToken()||'','If-Match':`"${row._version}"`},body:form});
      const data=await res.json();if(!res.ok)throw new Error(data.message);await after(data);
    }catch(e:any){toast({variant:'destructive',title:'Upload failed',description:e.message});}finally{setUploading(false);}
  }
  async function pdf(snapshot?:Po){setBusy(true);try{const settings=await (await apiRequest('GET','/api/quotes/settings')).json();const {downloadOrderPdf}=await import('@/lib/purchase-order-pdf');await downloadOrderPdf(snapshot||row,settings.shop);}catch(e:any){toast({variant:'destructive',title:'Could not export PDF',description:e.message});}finally{setBusy(false);}}
  const stringField=(k:keyof Form,label:string,inputType='text')=><Field label={label}><input className={inputCls} type={inputType} value={String(f[k]??'')} onChange={e=>update(k,e.target.value)}/></Field>;
  const detailField=(k:keyof OrderDetails,label:string,multi=false)=><Field label={label}>{multi?<textarea rows={3} className={inputCls+' h-auto py-2'} value={String(f.details[k])} onChange={e=>dt(k,e.target.value)}/>:<input className={inputCls} value={String(f.details[k])} onChange={e=>dt(k,e.target.value)}/>}</Field>;
  const selector=(k:'clientId'|'leadId'|'quoteId'|'projectId',label:string,list:any[],name:(v:any)=>string)=><Field label={label}><select aria-label={label} className={inputCls} value={f[k]} onChange={e=>{update(k,e.target.value);if(k==='clientId'){const c=list.find(v=>String(v.id)===e.target.value);if(c)setF(s=>({...s,clientId:String(c.id),customerName:c.company||c.name,details:{...s.details,contactName:c.name,email:c.email||'',phone:c.phone||'',billingAddress:[c.address,c.city,c.zip].filter(Boolean).join(', ')}}));}}}><option value="">Not linked</option>{f[k]&&!list.some(v=>String(v.id)===f[k])&&<option value={f[k]}>Linked record #{f[k]}</option>}{list.map(v=><option key={v.id} value={v.id}>{name(v)}</option>)}</select></Field>;
  const validReview=!!reviewed&&!dirty&&!!current;
  return <Modal preservesDraft open onClose={onClose} title={row?`${row.number} · Revision ${row.revision||1}`:`New ${type==='customer'?'customer':'supplier'} PO`} maxWidth="max-w-4xl">
    {receiving&&row&&<ReceiveDelivery poId={row.id} onClose={()=>{setReceiving(false);onClose();}}/>}
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{type==='customer'?'Customer POs received by CJM':'Supplier POs issued by CJM'}</span>{row&&<Status po={row}/>}</div>
      {row&&<nav aria-label="Purchase order sections" className="flex flex-wrap gap-2">{['Order','Review','Documents','History'].map(p=><button key={p} type="button" className={cn(secondaryBtn,pane===p&&'bg-accent')} onClick={()=>setPane(p)}>{p}</button>)}<button className={secondaryBtn} disabled={busy||dirty} onClick={()=>pdf()}><FileDown className="h-4 w-4"/>Export PDF</button></nav>}
      {dirty&&row&&<p className="rounded-lg bg-amber-500/10 p-3 text-sm">Save your changes before reviewing, uploading documents or exporting.</p>}
      {pane==='Order'&&<form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
        {recovered.notice}
        <fieldset disabled={!editable||save.isPending} className="space-y-4 disabled:opacity-75">
          <Section title="Order identity">
            <Field label="Business"><select className={inputCls} value={f.details.business} onChange={e=>dt('business',e.target.value)}><option value="metals">CJM Metals</option><option value="concrete">CJM Concrete</option><option value="insulation">CJM Insulation</option><option value="trades">CJM Trades</option></select></Field>
            {type==='customer'?stringField('customerName','Customer / company'):stringField('vendor','Supplier / vendor')}
            {type==='customer'&&stringField('customerPoNumber','Customer PO number (leave blank if pending)')}
            {stringField('customerProjectNumber','Customer project number')}{stringField('expectedDate','Expected delivery date','date')}
            <Field label="Issue date"><input type="date" className={inputCls} value={f.details.issueDate} onChange={e=>dt('issueDate',e.target.value)}/></Field>
            {type==='customer'&&<Field label="PO received date"><input type="date" className={inputCls} value={f.details.receivedDate} onChange={e=>dt('receivedDate',e.target.value)}/></Field>}
          </Section>
          <Section title="Linked records">
            <div className="sm:col-span-2"><Field label="Find a customer, quote or job"><input className={inputCls} value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="Search names or quote / job numbers"/></Field></div>
            {options.isError&&<RetryBlock query={options}/>}
            {type==='customer'&&selector('clientId','Customer record',options.data?.clients||[],v=>[v.company,v.name].filter(Boolean).join(' - '))}
            {type==='customer'&&selector('leadId','Sales lead / job request',options.data?.leads||[],v=>v.name)}
            {selector('projectId','CJM job',options.data?.projects||[],v=>`${v.jobNumber} - ${v.name}`)}
            {selector('quoteId','Related quote',options.data?.quotes||[],v=>`${v.number} - ${v.customerName||''} (${v.status})`)}
            {type==='customer'&&<div className="sm:col-span-2"><button type="button" className={secondaryBtn} disabled={!f.quoteId||busy} onClick={fillQuote}>Fill customer, scope and price from quote</button><p className="mt-2 text-xs text-muted-foreground">Replaces the draft's contact, scope, specifications, deposit and line items with the selected quote. Review the original customer PO for changes.</p></div>}
          </Section>
          <Section title="Contact and delivery">
            {detailField('contactName','Contact name')}{detailField('email','Contact email')}{detailField('phone','Contact phone')}{detailField('billingAddress','Billing address',true)}{detailField('deliveryAddress','Delivery / ship-to address',true)}{detailField('deliveryTerms','Delivery instructions / terms',true)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.details.deliveryIncluded} onChange={e=>dt('deliveryIncluded',e.target.checked)}/>Delivery included in price</label>
          </Section>
          <Section title="Scope and responsibilities">
            {detailField('scope','Included work / scope',true)}{detailField('exclusions','Exclusions',true)}{detailField('finish','Finish / paint responsibilities',true)}{detailField('customerMaterials','Customer-supplied materials',true)}<div className="sm:col-span-2">{detailField('specifications','Specifications / approved drawing references',true)}</div>
          </Section>
          <fieldset className="space-y-3 rounded-xl border border-border p-4"><legend className="px-2 font-semibold">Line items</legend>
            {f.lines.map((l,i)=><div key={i} className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_75px_80px_110px_40px]">
              <label className="col-span-3 sm:col-span-1"><span className="text-xs">Description</span><input required aria-label={`Line ${i+1} description`} className={inputCls} value={l.description} onChange={e=>update('lines',f.lines.map((v,n)=>n===i?{...v,description:e.target.value}:v))}/></label>
              {(['qty','unit','price'] as const).map(k=><label key={k}><span className="text-xs">{k==='qty'?'Qty':k==='unit'?'Unit':'Unit $'}</span><input aria-label={`Line ${i+1} ${k}`} className={inputCls} inputMode={k==='unit'?'text':'decimal'} value={l[k]||''} onChange={e=>update('lines',f.lines.map((v,n)=>n===i?{...v,[k]:e.target.value}:v))}/></label>)}
              <button type="button" aria-label={`Remove line ${i+1}`} disabled={f.lines.length===1} className="justify-self-end self-end p-2" onClick={()=>update('lines',f.lines.filter((_,n)=>n!==i))}><X className="h-5 w-5"/></button>
            </div>)}<button type="button" className={secondaryBtn} onClick={()=>update('lines',[...f.lines,blankLine()])}><Plus className="h-4 w-4"/>Add line</button>
          </fieldset>
          <Section title="Pricing and payment">
            {stringField('discount','Discount amount ($)')}{stringField('shipping','Freight / delivery charge ($)')}{stringField('tax','Tax rate (%)')}{stringField('deposit','Deposit amount ($)')}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.taxShipping} onChange={e=>update('taxShipping',e.target.checked)}/>Include freight in taxable amount</label><div className="sm:col-span-2">{detailField('paymentTerms','Payment terms',true)}</div>
          </Section>
          <Field label="Notes"><textarea className={inputCls+' h-auto py-2'} rows={3} value={f.notes} onChange={e=>update('notes',e.target.value)}/></Field>
        </fieldset>
        {mathError?<p role="alert" className="text-red-600">{mathError}</p>:totals&&<dl className="grid grid-cols-2 gap-2 rounded-xl bg-accent p-4 text-sm">{[['Subtotal',totals.subtotalCents],['Discount',-totals.discountCents],['Freight / delivery',totals.shippingCents],['Tax',totals.taxCents],['Total',totals.totalCents],['Deposit',totals.depositCents],['Balance after deposit',totals.balanceCents]].map(([l,v])=><div key={l} className="contents"><dt className={l==='Total'?'font-bold':''}>{l}</dt><dd className="text-right tabular-nums">{formatMoney(Number(v))}</dd></div>)}</dl>}
        {editable?<button disabled={save.isPending||!!mathError} className={primaryBtn}>{save.isPending&&<Loader2 className="h-4 w-4 animate-spin"/>}{row?'Save changes':'Save draft PO'}</button>:<p className="text-sm text-muted-foreground">Approved and issued order details are locked. Use Review to create a revision with a reason.</p>}
      </form>}
      {row&&pane==='Review'&&<div className="space-y-4">{detail.isError?<RetryBlock query={detail}/>:!current?<p>Loading review…</p>:<>
        <h3 className="font-semibold">Quote comparison</h3>{row.quoteId&&!current.review?.quote&&<p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm">The linked quote is unavailable. Check the saved quote snapshot and original documents, then record how this was resolved.</p>}
        {!current.review?.quote?<p className="text-sm">No quote linked. Review the scope, price and original documents directly.</p>:<><p className="text-sm">Compared with {current.review.quote.number}, version {current.review.quote.version}.</p><div className="space-y-3">{current.review.differences.map((d:any,i:number)=><div key={i} className="rounded-lg border border-amber-400/40 p-3 text-sm"><strong>{d.field.replace(' (cents)','')}</strong><div className="mt-2 grid gap-2 sm:grid-cols-2">{(['quote','order'] as const).map(k=><div key={k}><span className="font-medium">{k==='quote'?'Quote:':'PO:'}</span><p className="whitespace-pre-wrap break-words">{d.field.includes('(cents)')?formatMoney(Number(d[k])):String(d[k])||'Not recorded'}</p></div>)}</div></div>)}</div>{!current.review.differences.length&&<p className="text-sm">No differences detected in the compared fields.</p>}</>}
        <p className="text-sm text-muted-foreground">{current.review?.reminder}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the original documents, scope, exclusions, customer materials, delivery dates, payment terms and any quote differences.</label>
        <Field label="Review / revision reason or sent-to details"><textarea className={inputCls+' h-auto py-2'} rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Record resolutions, revision reason, or recipient and delivery method."/></Field>
        <div className="flex flex-wrap gap-2">{(ORDER_TRANSITIONS[row.orderType as OrderType][row.status as OrderStatus]||[]).map(status=><button key={status} className={secondaryBtn} disabled={action.isPending||dirty||(['approved','confirmed'].includes(status)&&!validReview)} onClick={()=>action.mutate({path:'transition',body:{status,reason,reviewed,reviewToken:current.review.reviewToken}})}>{status==='sent'?'Record sent to supplier':status==='confirmed'?'Confirm customer PO':`Mark ${ORDER_LABELS[status].toLowerCase()}`}</button>)}</div>
        {row.orderType==='supplier'&&['open','sent'].includes(row.status)&&<button className={primaryBtn} onClick={()=>setReceiving(true)}>Receive delivery</button>}
        {!['cancelled','closed','received','invoiced'].includes(row.status)&&<button className={secondaryBtn} disabled={action.isPending||dirty||reason.trim().length<3||row.partiallyReceived} onClick={()=>action.mutate({path:'revise',body:{reason}})}>Create revision</button>}
        <p className="text-xs text-muted-foreground">Status changes record your action. They do not send email, accept a quote, create invoices or release funds. Customer POs require an original document and the customer's PO number before confirmation.</p>
      </>}</div>}
      {row&&pane==='Documents'&&<div className="space-y-4"><p className="text-sm">Attach original POs, drawings, correspondence and delivery records. Files stay private to authorized suite users; saved originals remain in history.</p><Field label="Document type"><select className={inputCls} value={docKind} onChange={e=>setDocKind(e.target.value)}>{['original_po','drawing','correspondence','delivery','other'].map(k=><option key={k} value={k}>{k.replaceAll('_',' ')}</option>)}</select></Field><Field label="Upload document (PDF, Word or image; 10 MB maximum)"><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={uploading||dirty||['closed','cancelled'].includes(row.status)} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value='';}}/></Field>{uploading&&<p>Uploading…</p>}<ul className="space-y-3">{(current?.documents||row.documents||[]).map((d:any)=><li className="rounded-lg border border-border p-3" key={d.id}><button className="flex items-center gap-2 text-sm underline" onClick={()=>download(`/api/finance/purchase-orders/${row.id}/documents/${d.id}`,d.name)}><Paperclip className="h-4 w-4"/>{d.name}</button><p className="mt-1 text-xs text-muted-foreground">{d.kind.replaceAll('_',' ')} · Revision {d.revision||1} · {formatDate(d.createdAt)} · {Math.ceil(d.size/1024)} KB</p></li>)}</ul></div>}
      {row&&pane==='History'&&<div className="space-y-3">{detail.isError?<RetryBlock query={detail}/>:current?.history?.length?current.history.map((h:any)=><div key={h.id} className="rounded-lg border border-border p-3 text-sm"><strong>{h.action.replaceAll('_',' ')}</strong><p>{h.userName} · Revision {h.revision||1} · {new Date(h.createdAt).toLocaleString()}</p>{h.reason&&<p className="mt-2 whitespace-pre-wrap break-words">{h.reason}</p>}<button className="mt-2 underline" disabled={busy} onClick={async()=>{try{const event=await (await apiRequest('GET',`/api/finance/purchase-orders/${row.id}/history/${h.id}`)).json();await pdf(event.snapshot);}catch(e:any){toast({variant:'destructive',title:'Could not open revision',description:e.message});}}}>Export this snapshot</button></div>):<p>No recorded revisions yet.</p>}</div>}
    </div>
  </Modal>;
}

export default function PurchaseOrdersPage(){
  const [type,setType]=useState<OrderType>('customer'),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[editing,setEditing]=useState<Po|null>(null),[open,setOpen]=useState(false);
  useRecordLink('po','/api/finance/purchase-orders',row=>{setType(row.orderType||'supplier');setEditing(row);setOpen(true);});
  const list=useQuery<Po[]>({queryKey:['finance-pos',type,status,search],queryFn:async()=> (await apiRequest('GET',`/api/finance/purchase-orders?orderType=${type}&status=${status}&q=${encodeURIComponent(search)}`)).json()});
  async function edit(row:Po){try{const fresh=await (await apiRequest('GET',`/api/finance/purchase-orders/${row.id}/detail`)).json();setEditing(fresh);setOpen(true);}catch(e:any){toast({variant:'destructive',title:'Could not open order',description:e.message});}}
  return <div className="mx-auto max-w-6xl">
    <Header title="Purchase orders" description="Customer orders received and supplier purchases issued"><button className={primaryBtn} onClick={()=>{setEditing(null);setOpen(true);}}><Plus className="h-5 w-5"/>New {type==='customer'?'customer':'supplier'} PO</button></Header>
    <nav aria-label="PO categories" className="mb-5 flex flex-wrap gap-2">{(['customer','supplier'] as const).map(v=><button className={v===type?primaryBtn:secondaryBtn} key={v} onClick={()=>{setType(v);setStatus('');}}>{v==='customer'?'Customer POs received':'Supplier POs issued'}</button>)}</nav>
    <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_220px]"><Field label="Search orders"><div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground"/><input className={inputCls+' pl-10'} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, PO number or customer project"/></div></Field><Field label="Status"><select className={inputCls} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{ORDER_STATUSES.map(s=><option key={s} value={s}>{ORDER_LABELS[s]}</option>)}</select></Field></div>
    {list.isError?<RetryBlock query={list}/>:list.isLoading?<p>Loading orders…</p>:!list.data?.length?<div className="rounded-xl border border-dashed p-8 text-center"><h2 className="font-semibold">No {type} POs found</h2><p className="mt-2 text-sm text-muted-foreground">{type==='customer'?'Record an incoming customer order, link the quote and attach the original PO.':'Create an order for materials or subcontracted services, then track its deliveries.'}</p></div>:<div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><thead className="bg-accent"><tr>{['Order','Customer / supplier','Customer project','Expected','Total','Status'].map(h=><th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>{list.data.map(row=><tr key={row.id} className="border-t border-border"><td className="p-3"><button className="font-semibold underline" onClick={()=>edit(row)}>{row.number}</button>{row.customerPoNumber&&<p className="mt-1 text-xs">Customer PO: {row.customerPoNumber}</p>}</td><td className="p-3">{row.customerName||row.vendor}</td><td className="p-3">{row.customerProjectNumber||'—'}</td><td className="p-3 whitespace-nowrap">{row.expectedDate?formatDate(row.expectedDate):'—'}</td><td className="p-3 whitespace-nowrap tabular-nums">{formatMoney(row.totalCents)}</td><td className="p-3"><Status po={row}/></td></tr>)}</tbody></table></div>}
    {open&&<Editor key={editing?.id||type} po={editing} type={type} onClose={()=>{setOpen(false);setEditing(null);}}/>}
  </div>;
}
