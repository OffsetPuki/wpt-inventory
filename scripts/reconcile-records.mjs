// Read-only review of a database or restored snapshot. No migrations or repairs.
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function reconcileRecords(file) {
  const db = new Database(path.resolve(file), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const has = (table) =>
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
    const report = {
      database: path.resolve(file),
      createdAt: new Date().toISOString(),
      readOnly: true,
    };
    const columns = (table) =>
      db.pragma(`table_info(${table})`).map((c) => c.name);
    if (has("fin_invoices") && has("fin_invoice_payments")) {
      report.paymentMismatches = db
        .prepare(
          `SELECT i.id,i.number,i.status,i.paid_cents AS invoicePaidCents,
        coalesce(sum(p.amount_cents),0) AS ledgerPaidCents FROM fin_invoices i LEFT JOIN fin_invoice_payments p ON p.invoice_id=i.id
        GROUP BY i.id HAVING invoicePaidCents != ledgerPaidCents`,
        )
        .all();
      report.duplicatePaymentReferences = db
        .prepare(
          `SELECT reference,count(*) AS count,sum(amount_cents) AS totalCents
        FROM fin_invoice_payments WHERE reference IS NOT NULL AND reference!='' GROUP BY reference HAVING count(*)>1`,
        )
        .all();
    }
    if (has("items"))
      report.negativeStock = db
        .prepare("SELECT id,name,quantity FROM items WHERE quantity<0")
        .all();
    if (has("quotes") && has("projects") && has("fin_invoices")) {
      const quoteLink = columns("fin_invoices").includes("quote_id")
        ? "i.quote_id=q.id OR "
        : "";
      report.acceptedQuotesMissingHandoff = db
        .prepare(
          `SELECT q.id,q.number,
        (SELECT count(*) FROM projects p WHERE p.job_number=q.number AND p.deleted_at IS NULL) AS projects,
        (SELECT count(*) FROM fin_invoices i WHERE (${quoteLink}i.notes LIKE 'From quote '||q.number||' — %') AND i.deleted_at IS NULL) AS invoices
        FROM quotes q WHERE q.status='accepted' AND q.deleted_at IS NULL AND (projects=0 OR invoices=0)`,
        )
        .all();
    }
    if (has("hr_employees"))
      report.payrollHistoryReview = db
        .prepare(
          `SELECT id,first_name,last_name,pay_type,pay_rate_cents,hire_date,end_date,status
      FROM hr_employees ORDER BY id`,
        )
        .all();
    report.payrollNote =
      "Verify imported opening rates against prior payroll records. The old system did not preserve past rate changes, so this report cannot reconstruct them.";
    return report;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2])
    throw new Error(
      "Usage: node scripts/reconcile-records.mjs PATH_TO_DATABASE",
    );
  console.log(JSON.stringify(reconcileRecords(process.argv[2]), null, 2));
}
