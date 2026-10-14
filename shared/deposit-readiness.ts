export type DepositInvoice = {
  status: string;
  kind?: string | null;
  total_cents?: number;
  deposit_cents?: number | null;
  paid_cents: number;
  restated_from?: string | null;
};

/** An issued deposit bill is itself an obligation; a draft is not a payment. */
export function depositReadiness(invoices: DepositInvoice[]) {
  let requiredCents = 0, paidCents = 0, dueCents = 0, count = 0;
  for (const invoice of invoices) {
    if (['draft', 'void'].includes(invoice.status)) continue;
    let amount = Math.max(0, invoice.deposit_cents || 0);
    if (invoice.kind === 'deposit') {
      let original: { totalCents?: number } | null = null;
      try { original = invoice.restated_from ? JSON.parse(invoice.restated_from) : null; } catch { /* Legacy invoice: use its explicit amount. */ }
      amount = Math.max(amount, Number(original?.totalCents ?? invoice.total_cents) || 0);
    }
    if (amount <= 0) continue;
    count++;
    const paid = Math.max(0, Math.min(amount, invoice.paid_cents || 0));
    requiredCents += amount;
    paidCents += paid;
    dueCents += amount - paid;
  }
  return { configured: count > 0, requiredCents, paidCents, dueCents, satisfied: count > 0 && dueCents === 0 };
}
