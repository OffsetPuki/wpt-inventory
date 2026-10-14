import { sqlite } from './storage';
import { mailEnabled } from './mailer';
const size=25;
function page(value:unknown,total:number){return Math.min(Math.max(0,Math.floor(Number(value)||0)),Math.max(0,Math.ceil(total/size)-1));}
const count=(sql:string)=>(sqlite.prepare(sql).get() as {n:number}).n;
export function suiteHealth(query:Record<string,unknown>){
  // A producer and its delivery are one unresolved message, not two jobs for
  // the owner to retry. Keep the delivery row actionable and show both attempts.
  const active="o.status NOT IN ('completed','stopped') AND NOT EXISTS (SELECT 1 FROM suite_outbox child WHERE child.event_key='delivery:'||o.event_key AND child.status NOT IN ('completed','stopped'))";
  const jobWhere="deleted_at IS NULL AND (client_id IS NULL OR billing_mode='review')";
  const duplicates="SELECT lower(trim(email)) AS contact,group_concat(id) AS ids,count(*) AS count FROM crm_clients WHERE deleted_at IS NULL AND trim(coalesce(email,''))!='' GROUP BY lower(trim(email)) HAVING count(*)>1";
  const totals={outbox:count(`SELECT count(*) n FROM suite_outbox o WHERE ${active}`),payments:count('SELECT count(*) n FROM fin_payment_exceptions WHERE resolved_at IS NULL'),review:count('SELECT count(*) n FROM suite_review_actions WHERE resolved_at IS NULL'),jobs:count(`SELECT count(*) n FROM projects WHERE ${jobWhere}`),duplicates:count('SELECT count(*) n FROM ('+duplicates+')')};
  const pages=Object.fromEntries(Object.entries(totals).map(([key,total])=>[key,page(query[key+'Page'],total)]));
  const since=Date.now()-7*86400000;
  const outbox=(sqlite.prepare(`SELECT o.id,o.event_key,o.kind,o.status,o.attempts,o.available_at,o.last_error,o.created_at,o.payload,
    p.id parent_id,p.attempts producer_attempts,p.payload parent_payload,m.payload mail_payload
    FROM suite_outbox o LEFT JOIN suite_mail m ON 'delivery:'||m.key=o.event_key
    LEFT JOIN suite_outbox p ON p.event_key=m.key
    WHERE ${active} ORDER BY CASE o.status WHEN 'review' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,o.created_at,o.id LIMIT ? OFFSET ?`).all(size,pages.outbox*size) as any[]).map(row=>{
    let data:any={};try{data=JSON.parse(row.payload);}catch{}
    let msg:any=data;
    if(row.kind==='mail') {try{msg=row.mail_payload?JSON.parse(row.mail_payload).msg:{};}catch{msg={};}}
    let parent:any={};try{parent=JSON.parse(row.parent_payload||'{}');}catch{}
    const invoiceId=Number(msg.context?.invoiceId||data.inv?.id||parent.inv?.id),quoteId=Number(msg.context?.quoteId||data.quoteId||parent.quoteId);
    const href=Number.isSafeInteger(invoiceId)&&invoiceId>0?`/finance/invoices?invoice=${invoiceId}`:Number.isSafeInteger(quoteId)&&quoteId>0?`/crm/quotes?quote=${quoteId}`:'/emails';
    const {payload,parent_payload,mail_payload,...safe}=row;
    return {...safe,recipient:typeof msg.to==='string'?msg.to:null,subject:typeof msg.subject==='string'?msg.subject:null,href};
  });
  return {
    mailConfigured:mailEnabled(),totals,pages,pageSize:size,mailWindowDays:7,
    mailFailureAttempts:(sqlite.prepare("SELECT count(*) n FROM audit_log WHERE action='email.failed' AND created_at>=?").get(since) as {n:number}).n,
    recentMailFailures:sqlite.prepare("SELECT id,created_at,target_name FROM audit_log WHERE action='email.failed' AND created_at>=? ORDER BY id DESC LIMIT 10").all(since),
    paymentExceptions:sqlite.prepare('SELECT id,invoice_id,kind,created_at FROM fin_payment_exceptions WHERE resolved_at IS NULL ORDER BY id LIMIT ? OFFSET ?').all(size,pages.payments*size),
    intake:sqlite.prepare("SELECT site,count(*) AS count,max(created_at) AS latest FROM crm_leads WHERE source='website' GROUP BY site").all(),
    outbox,
    review:sqlite.prepare('SELECT * FROM suite_review_actions WHERE resolved_at IS NULL ORDER BY id LIMIT ? OFFSET ?').all(size,pages.review*size),
    unlinkedJobs:sqlite.prepare(`SELECT id,name,customer,billing_mode,client_id FROM projects WHERE ${jobWhere} ORDER BY id LIMIT ? OFFSET ?`).all(size,pages.jobs*size),
    duplicateClients:sqlite.prepare(duplicates+' ORDER BY contact LIMIT ? OFFSET ?').all(size,pages.duplicates*size),
    restoreVerification:sqlite.prepare('SELECT * FROM suite_restore_checks ORDER BY id DESC LIMIT 1').get()||null,
  };
}
