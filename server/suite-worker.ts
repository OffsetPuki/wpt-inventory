import { readMail } from "./mail-queue";
import { sqlite } from "./storage";
import { sendMail, sendOwnerMail } from "./mailer";
import { renderTemplate, firstNameOf } from "./email-templates";
import {workerStarted,workerFinished} from './operational-status';
let busy = false;
export async function runSuiteFollowups() {
  if (busy) return;
  busy = true;
  let failed=false;
  try {
    workerStarted('follow-ups');
    resolveObsoleteTasks();
    sqlite
      .prepare(
        "UPDATE suite_outbox SET status='pending' WHERE status='running' AND locked_at<?",
      )
      .run(Date.now() - 5 * 60000);
    const rows = sqlite
      .prepare(
        "SELECT * FROM suite_outbox WHERE status IN ('pending','failed') AND attempts<8 AND available_at<=? ORDER BY id LIMIT 5",
      )
      .all(Date.now()) as any[];
    for (const row of rows) {
      if (
        !sqlite
          .prepare(
            "UPDATE suite_outbox SET status='running',attempts=attempts+1,locked_at=? WHERE id=? AND status IN ('pending','failed')",
          )
          .run(Date.now(), row.id).changes
      )
        continue;
      try {
        const data = JSON.parse(row.payload);
        let ok = false;
        if (row.kind === "mail") {
          const saved = readMail(data.key);
          ok =
            !!saved.row.accepted_at ||
            (await sendMail(saved.msg, { deliveryKey: data.key }));
        } else if (row.kind === "preview-feedback-owner") {
          ok = await sendOwnerMail({subject:data.subject,text:data.text,deliveryKey:row.event_key});
        } else if (row.kind.startsWith("queue")) {
          const finance = await import("./finance");
          if (row.kind === "queueReviewRequest") {
            const current: any = sqlite
              .prepare(
                "SELECT 1 FROM fin_invoices WHERE id=? AND status='paid' AND deleted_at IS NULL",
              )
              .get(data.inv.id);
            if (current)
              await finance.run_queueReviewRequest(data.inv, row.event_key);
          } else if (row.kind === "queuePaymentReceipt")
            await finance.run_queuePaymentReceipt(
              data.inv,
              data.amountCents,
              row.event_key,
            );
          else if (row.kind === "queueInvoiceEmail") {
            const current: any = sqlite
              .prepare("SELECT status,deleted_at FROM fin_invoices WHERE id=?")
              .get(data.inv.id);
            if (current && !current.deleted_at && current.status !== "void")
              await finance.run_queueInvoiceEmail(data.inv, row.event_key);
          } else throw new Error("Unknown finance follow-up");
          ok = true;
        } else if (row.kind.startsWith("quote-accepted")) {
          const quote: any = sqlite
            .prepare(
              "SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL AND status='accepted'",
            )
            .get(data.quoteId);
          if (!quote) {
            sqlite
              .prepare(
                "UPDATE suite_outbox SET status='stopped',last_error='Quote is no longer active' WHERE id=?",
              )
              .run(row.id);
            continue;
          }
          const customer = JSON.parse(quote.payload).customer || {};
          if (row.kind === "quote-accepted-owner")
            ok = await sendOwnerMail({
              subject: `[CJM Trades] Quote accepted — ${quote.number}`,
              text: `${data.recordedBy ? `${data.recordedBy} manually marked ${quote.number} accepted` : `${customer.name || quote.customer_name || "Customer"} accepted ${quote.number}`}. The linked job and draft invoice are ready.`,
              deliveryKey: row.event_key,
            });
          else if (!customer.email) ok = true;
          else {
            const msg = renderTemplate("quote.accepted", {
              customerName: customer.name || quote.customer_name || "there",
              firstName: firstNameOf(customer.name || quote.customer_name),
              quoteNumber: quote.number,
            });
            ok =
              !msg ||
              (await sendMail(
                { to: customer.email, ...msg, deliveryKey: row.event_key, context:{quoteId:quote.id,version:quote.version} },
                { deliveryKey: row.event_key },
              ));
          }
        } else throw new Error("Unknown follow-up type.");
        if (
          !ok &&
          (row.kind.startsWith("quote-accepted") || row.kind === "preview-feedback-owner") &&
          sqlite
            .prepare("SELECT 1 FROM suite_mail WHERE key=?")
            .get(row.event_key)
        )
          ok = true;
        if (!ok)
          throw new Error(
            "Email provider has not confirmed acceptance. Check email configuration or retry.",
          );
        sqlite
          .prepare(
            "UPDATE suite_outbox SET status='completed',completed_at=?,last_error=NULL WHERE id=?",
          )
          .run(Date.now(), row.id);
      } catch (e: any) {
        sqlite
          .prepare(
            "UPDATE suite_outbox SET status='failed',last_error=?,available_at=? WHERE id=? AND status NOT IN ('review','stopped')",
          )
          .run(
            String(e.message).slice(0, 300),
            Date.now() + Math.min(3600000, 60000 * 2 ** row.attempts),
            row.id,
          );
      }
    }
  } catch {
    failed=true;
    console.error('[suite-worker] Follow-up sweep failed; see health status.');
  } finally {
    try {workerFinished('follow-ups',failed);}catch{console.error('[suite-worker] Could not record heartbeat.');}
    busy = false;
  }
}
export function startSuiteWorker() {
  const timer = setInterval(() => void runSuiteFollowups(), 15000);
  timer.unref();
  void runSuiteFollowups();
  return () => clearInterval(timer);
}

export function resolveObsoleteTasks() {
  const rows = sqlite
    .prepare(
      "SELECT id,auto_key FROM pm_tasks WHERE auto_created=1 AND status!='done' AND deleted_at IS NULL AND auto_key IS NOT NULL",
    )
    .all() as any[];
  for (const t of rows) {
    let clear = false;
    const k = String(t.auto_key);
    if (k.startsWith('auto:quote-follow-up:'))
      clear = !sqlite.prepare("SELECT 1 FROM quotes WHERE number=? AND deleted_at IS NULL AND status='sent'").get(k.slice('auto:quote-follow-up:'.length));
    if (k.startsWith('auto:draft-invoice:'))
      clear = !sqlite.prepare("SELECT 1 FROM fin_invoices WHERE number=? AND deleted_at IS NULL AND status='draft'").get(k.slice('auto:draft-invoice:'.length));
    if (/^auto:(lead-follow-up|stale-lead|lead-quote-chase):/.test(k))
      clear = !sqlite.prepare("SELECT 1 FROM crm_leads WHERE id=? AND deleted_at IS NULL AND stage NOT IN ('won','lost')").get(Number(k.split(':')[2]));
    if (k === 'auto:missing-receipts')
      clear = !sqlite.prepare("SELECT 1 FROM fin_expenses WHERE deleted_at IS NULL AND coalesce(receipt_url,'')='' AND amount_cents>=7500 AND created_at<? LIMIT 1").get(Date.now()-3*86400000);
    if (k.startsWith("suite:review:"))
      clear = !sqlite
        .prepare(
          "SELECT 1 FROM review_requests r JOIN fin_invoices i ON i.id=r.invoice_id WHERE i.id=? AND i.status='paid' AND i.deleted_at IS NULL AND r.submitted_at IS NULL",
        )
        .get(Number(k.split(":")[2]));
    if (k.startsWith("auto:invoice-chase:"))
      clear = !sqlite
        .prepare(
          "SELECT 1 FROM fin_invoices WHERE number=? AND deleted_at IS NULL AND status IN ('sent','partial','overdue') AND total_cents-coalesce(retainage_cents,0)-paid_cents>0 AND due_date<business_today()",
        )
        .get(k.slice("auto:invoice-chase:".length));
    if (k.startsWith("auto:late-po:"))
      clear = !sqlite
        .prepare(
          "SELECT 1 FROM fin_purchase_orders WHERE number=? AND deleted_at IS NULL AND order_type='supplier' AND status IN ('open','sent') AND expected_date<business_today()",
        )
        .get(k.slice("auto:late-po:".length));
    if (k.startsWith("auto:unbilled:")) {
      const id = Number(k.split(":")[2]);
      clear =
        !sqlite
          .prepare(
            "SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND billing_mode='time_materials'",
          )
          .get(id) ||
        (!sqlite
          .prepare(
            "SELECT 1 FROM fin_expenses WHERE project_id=? AND deleted_at IS NULL AND billable=1 AND invoice_id IS NULL",
          )
          .get(id) &&
          !sqlite
            .prepare(
              "SELECT 1 FROM pm_time_entries WHERE project_id=? AND ended_at IS NOT NULL AND billable=1 AND invoice_id IS NULL",
            )
            .get(id) &&
          !sqlite
            .prepare(
              "SELECT 1 FROM suite_stock_costs WHERE project_id=? AND invoice_id IS NULL",
            )
            .get(id) &&
          !sqlite
            .prepare(
              "SELECT 1 FROM hr_time_corrections c JOIN pm_time_entries t ON t.id=c.time_entry_id WHERE t.project_id=? AND t.billable=1 AND c.invoice_id IS NULL",
            )
            .get(id));
    }
    if (clear)
      sqlite
        .prepare("UPDATE pm_tasks SET status='done',completed_at=? WHERE id=?")
        .run(Date.now(), t.id);
  }
}
