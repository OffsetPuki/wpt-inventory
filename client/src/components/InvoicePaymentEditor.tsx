import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/useApiMutation';
import { inputCls, secondaryBtn } from '@/lib/ui-styles';
import { emptyWireDetails, defaultPaymentOptions, type InvoicePaymentOptions, type WireDetails } from '@shared/invoice-payment-options';

export default function InvoicePaymentEditor({ value, onChange }: {
  value: InvoicePaymentOptions | null;
  onChange: (value: InvoicePaymentOptions) => void;
}) {
  const { data, isLoading } = useQuery<{wireDetails: WireDetails | null}>({
    queryKey: ['invoice-payment-instructions'],
    queryFn: async () => (await apiRequest('GET', '/api/finance/payment-instructions')).json(),
  });
  const options = value ?? defaultPaymentOptions;
  const details = options.wireDetails ?? emptyWireDetails;
  const updateDetails = (patch: Partial<WireDetails>) => onChange({...options, wireDetails: {...details, ...patch}});
  const saveDefaults = useApiMutation({
    request: () => ({method: 'PUT', url: '/api/finance/payment-instructions', body: {wireDetails: details}}),
    invalidate: [['invoice-payment-instructions']],
    successTitle: 'Wire details saved for future invoices',
    errorTitle: 'Could not save wire details',
  });
  return <fieldset className="rounded-lg border border-border bg-muted/40 p-3">
    <legend className="px-1 text-sm font-semibold">Payment options</legend>
    <p className="mb-3 text-xs text-muted-foreground">Choose what the customer sees on this invoice. You can select both.</p>
    {value === null && <p className="mb-3 text-xs text-muted-foreground">This older invoice keeps its existing payment setup until you change a choice below.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={options.stripe}
          onChange={e => onChange({...options, stripe: e.target.checked})} />
        <span><span className="block text-sm font-semibold">Stripe — pay online</span><span className="text-xs text-muted-foreground">Show the online payment button after sending.</span></span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={options.wire}
          onChange={e => onChange({...options, wire: e.target.checked, wireDetails: options.wireDetails ?? data?.wireDetails ?? {...emptyWireDetails}})} />
        <span><span className="block text-sm font-semibold">Wire — bank transfer</span><span className="text-xs text-muted-foreground">Show your bank details and invoice reference.</span></span>
      </label>
    </div>
    {options.wire && <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Domestic wire-transfer details</p>
        {data?.wireDetails && <button type="button" className="text-xs underline" onClick={() => onChange({...options, wireDetails: {...data.wireDetails!}})}>Use saved wire details</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ['accountName', 'Account holder name'], ['bankName', 'Bank name'],
          ['routing', 'Wire routing number'], ['account', 'Account number'],
        ] as const).map(([key, label]) => <label key={key} className="flex min-w-0 flex-col gap-1.5 text-sm">
          {label}<input className={inputCls} autoComplete="off" required
            maxLength={key === 'routing' ? 9 : key === 'account' ? 34 : 160}
            inputMode={key === 'routing' || key === 'account' ? 'numeric' : 'text'}
            value={details[key]} onChange={e => updateDetails({[key]: e.target.value})} />
        </label>)}
        <label className="flex flex-col gap-1.5 text-sm">Account type
          <select className={inputCls} value={details.accountType} onChange={e => updateDetails({accountType: e.target.value as WireDetails['accountType']})}>
            <option>Checking</option><option>Savings</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">Additional wire instructions (optional)
        <textarea className={inputCls + ' min-h-20 py-2'} maxLength={500} value={details.nameNote} onChange={e => updateDetails({nameNote: e.target.value})} />
      </label>
      <p className="text-xs text-muted-foreground">Use the routing number for domestic wires. The invoice number is added as the payment reference automatically.</p>
      <button type="button" className={secondaryBtn} disabled={saveDefaults.isPending || isLoading} onClick={() => saveDefaults.mutate()}>Save wire details for future invoices</button>
      <p className="text-xs text-muted-foreground">Saved details fill future invoices. Existing invoices keep their own details.</p>
    </div>}
  </fieldset>;
}
