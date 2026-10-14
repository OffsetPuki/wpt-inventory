import {L,useLanguage} from '@/lib/language';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';

export default function ShareQuote({ quoteId, customerEmail, onBeforeShare, onIssued, onShared, onBusy, actionsId, disabled = false }) {
  const {t}=useLanguage();
  const [actionsTarget, setActionsTarget] = useState(null);
  useEffect(() => { setActionsTarget(actionsId ? document.getElementById(actionsId) : null); }, [actionsId]);
  const actions = node => actionsTarget ? createPortal(node, actionsTarget) : node;
  const qc = useQueryClient();
  const { data: row, isFetching } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => (await apiRequest('GET', `/api/quotes/${quoteId}`)).json(),
    enabled: customerEmail === undefined && !!quoteId,
  });
  let email = customerEmail;
  if (email === undefined) { try { email = JSON.parse(row?.payload || '{}').customer?.email || ''; } catch { email = ''; } }
  email = String(email || '').trim();
  const [linkName,setLinkName]=useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const copy = async url => {
    try { await navigator.clipboard.writeText(url); setCopied(true); return true; }
    catch { setCopied(false); return false; }
  };
  const share = useMutation({
    onMutate: () => onBusy?.(true),
    mutationFn: async action => {
      const saved = onBeforeShare ? await onBeforeShare() : { id: quoteId, version: row?.version };
      const res = await (await apiRequest('POST', `/api/quotes/${saved?.id || quoteId}/share`, {
        ...(linkName.trim()?{linkName:linkName.trim()}:{}), sendEmail: action === 'email', ...(action === 'email' ? { email } : {}), version: saved?.version,
      })).json();
      res.url=res.shortUrl||res.url;
      const copied = action === 'copy' && await copy(res.url);
      return { ...res, wantedEmail: action === 'email', copied };
    },
    onSuccess: res => {
      setResult(res);
      onShared?.(res);
      qc.invalidateQueries({queryKey:['quotes']});
      qc.invalidateQueries({queryKey:['quote',quoteId]});
      // Keep a selectable link visible even when clipboard access or mail fails.
    },
    onError: e => toast({variant:'destructive',title:'Quote could not be sent',description:e.message}),
    onSettled: () => onBusy?.(false),
  });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  if (result) return <div className="share-panel" role="status">
    <p>{result.wantedEmail ? result.emailed ? `${t("Email sent to")} ${email}.` : t("Quote issued, but email was not delivered. Use the link below.") : copied ? t("Quote issued. Link copied.") : t("Quote issued. Select and copy the link below.")}</p>
    {result.projectUrl&&<p><a href={result.projectUrl} target="_blank" rel="noopener noreferrer"><L>{"Open customer project page"}</L></a><button className="btn ghost" onClick={()=>copy(result.projectUrl)}><L>{"Copy project page"}</L></button></p>}
    <div className="share-row"><input aria-label="Quote share link" readOnly className="share-url" value={result.url} onFocus={e => e.target.select()} /><button className="btn ghost sq-btn" onClick={() => copy(result.url)}><L>{"Copy link"}</L></button></div>
    {onIssued && actions(<button className="btn" onClick={() => onIssued(result)}><L>{"Done"}</L></button>)}
  </div>;
  return <div className="share-panel"><details><summary><L>{"Customize customer link"}</L></summary><label className="field"><span><L>{"Link name (optional)"}</L></span><input maxLength={60} value={linkName} placeholder="e.g. jose-shop" onChange={e=>setLinkName(e.target.value)}/></label><p className="hint"><L>{"Your project name plus a private random code. Existing links keep working."}</L></p></details>
    <p className="hint">{validEmail ? `${t("Send to")} ${email}` : t("Add a valid customer email to send by email, or copy a link.")}</p>
    {actions(<div className="btn-row">
      <button className="btn" disabled={disabled || !validEmail || share.isPending || isFetching} onClick={() => share.mutate('email')}>{share.isPending && share.variables === 'email' ? t("Sending…") : t("Send email")}</button>
      <button className="btn ghost" disabled={disabled || !quoteId || share.isPending || isFetching} onClick={() => share.mutate('copy')}>{share.isPending && share.variables === 'copy' ? t("Creating link…") : t("Copy link")}</button>
    </div>)}
  </div>;
}
