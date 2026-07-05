import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';

/**
 * Send-to-customer panel — mints the public cjmmetals.com/quote/<token> link
 * for a saved quote (the first share moves it from draft to sent) and can
 * email it straight to the customer. Rendered from the Saved list rows and
 * from the details step once the quote has saved.
 */
export default function ShareQuote({ quoteId, customerEmail, onBeforeShare }) {
  const qc = useQueryClient();

  // The Saved list omits the payload (it's the big JSON blob), so a caller
  // that doesn't know the customer's email leaves the prop undefined and the
  // panel reads it from the full row instead.
  const { data: row } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => (await apiRequest('GET', `/api/quotes/${quoteId}`)).json(),
    enabled: customerEmail === undefined,
  });
  let email = customerEmail;
  if (email === undefined) {
    try { email = JSON.parse(row?.payload || '{}')?.customer?.email || ''; } catch { email = ''; }
  }

  const [sendEmail, setSendEmail] = useState(true);
  const [result, setResult] = useState(null); // { url, emailed, wantedEmail }

  const share = useMutation({
    mutationFn: async (body) => (await apiRequest('POST', `/api/quotes/${quoteId}/share`, body)).json(),
    onSuccess: (res, body) => {
      setResult({ url: res.url, emailed: res.emailed, wantedEmail: !!body.sendEmail });
      // The first share moves the quote draft → sent — refresh the Saved list badge.
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not create the link', description: e?.message }),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.url);
      toast({ variant: 'success', title: 'Link copied' });
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Select the link and copy it manually.' });
    }
  };

  return (
    <div className="share-panel">
      {!result ? (
        <>
          {email ? (
            <label className="share-check">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email the link to {email}
            </label>
          ) : (
            <p className="hint">No customer email on this quote — create the link and text it over.</p>
          )}
          <div className="btn-row">
            <button
              className="btn sq-btn"
              onClick={() => {
                // Details step: flush edits typed on this screen (customer
                // name, notes) so the public page shows what's on screen.
                if (onBeforeShare) onBeforeShare();
                share.mutate(email && sendEmail ? { sendEmail: true, email } : {});
              }}
              disabled={share.isPending}
            >
              {share.isPending ? 'Working…' : email && sendEmail ? 'Send to customer' : 'Create share link'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="share-row">
            <input className="share-url" readOnly value={result.url} onFocus={(e) => e.target.select()} />
            <button className="btn ghost sq-btn" onClick={copy}>Copy link</button>
          </div>
          <p className="hint">
            {result.emailed
              ? `Emailed to ${email}. The customer can view and accept the quote at that link.`
              : result.wantedEmail
                ? 'The email did not go out — copy the link and send it yourself.'
                : 'Copy the link and text or email it to the customer — they can accept the quote right there.'}
          </p>
        </>
      )}
    </div>
  );
}
