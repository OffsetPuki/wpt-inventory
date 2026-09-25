import { z } from 'zod';

export const wireDetailsSchema = z.object({
  accountName: z.string().trim().min(1, 'Enter the account holder name').max(160),
  bankName: z.string().trim().min(1, 'Enter the bank name').max(160),
  routing: z.string().trim().regex(/^\d{9}$/, 'Enter the 9-digit wire routing number'),
  account: z.string().trim().regex(/^\d{4,34}$/, 'Enter the account number'),
  accountType: z.enum(['Checking', 'Savings']),
  nameNote: z.string().trim().max(500).default(''),
});
export type WireDetails = z.infer<typeof wireDetailsSchema>;
export const emptyWireDetails: WireDetails = {
  accountName: '', bankName: '', routing: '', account: '', accountType: 'Checking', nameNote: '',
};
export const invoicePaymentOptionsSchema = z.object({
  stripe: z.boolean(),
  wire: z.boolean(),
  wireDetails: wireDetailsSchema.nullable(),
}).superRefine((v, ctx) => {
  if (!v.stripe && !v.wire) ctx.addIssue({ code: 'custom', message: 'Select Stripe, Wire, or both' });
  if (v.wire && !v.wireDetails) ctx.addIssue({ code: 'custom', message: 'Complete the wire-transfer details' });
}).transform(v => ({ ...v, wireDetails: v.wire ? v.wireDetails : null }));
export type InvoicePaymentOptions = z.infer<typeof invoicePaymentOptionsSchema>;
export const defaultPaymentOptions: InvoicePaymentOptions = { stripe: true, wire: false, wireDetails: null };

// NULL belongs to invoices created before payment choices existed. Preserve
// their original behavior until the owner explicitly changes their options.
// Invalid stored data must never accidentally enable checkout or expose a bank.
export function readPaymentOptions(raw?: string | null): InvoicePaymentOptions | null {
  if (raw == null) return null;
  try {
    const result = invoicePaymentOptionsSchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data;
  } catch { /* fail closed */ }
  return { stripe: false, wire: false, wireDetails: null };
}
export function stripeAllowed(raw?: string | null): boolean {
  return readPaymentOptions(raw)?.stripe ?? true;
}
