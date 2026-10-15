import { useEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, Loader2, MessageSquare } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { prepareReplyPhotos, type ReplyPhotoSheet } from '@/lib/lead-reply-photos';
import type { LeadReplyPacket } from '@shared/lead-reply';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-60';

export default function LeadReply({ leadId, unsaved }: { leadId: number; unsaved: boolean }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [packet, setPacket] = useState<LeadReplyPacket>();
  const [sheets, setSheets] = useState<ReplyPhotoSheet[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [status, setStatus] = useState('');
  const [review, setReview] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || unsaved) return;
    const controller = new AbortController();
    let photoSheets: ReplyPhotoSheet[] = [];
    setPacket(undefined); setSheets([]); setMissing([]); setError(''); setPhotoError(''); setStatus('');
    void (async () => {
      try {
        const data: LeadReplyPacket = await (await apiRequest('GET', `/api/crm/leads/${leadId}/reply-packet`, undefined, { signal: controller.signal })).json();
        if (controller.signal.aborted) return;
        setPacket(data); setLoadingPhotos(data.photos.length > 0);
        try {
          const result = await prepareReplyPhotos(leadId, data.photos, controller.signal);
          photoSheets = result.sheets;
          if (controller.signal.aborted) { photoSheets.forEach(s => URL.revokeObjectURL(s.url)); return; }
          setSheets(result.sheets); setMissing(result.missing);
        } catch (failure) {
          if (!controller.signal.aborted) setPhotoError(failure instanceof Error ? failure.message : 'Photos could not be prepared.');
        } finally { if (!controller.signal.aborted) setLoadingPhotos(false); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the request.');
      }
    })();
    return () => { controller.abort(); photoSheets.forEach(sheet => URL.revokeObjectURL(sheet.url)); };
  }, [open, leadId, attempt, unsaved]);

  async function copyRequest() {
    if (!packet || unsaved) return;
    try {
      await navigator.clipboard.writeText(packet.prompt);
      setStatus('Request copied. Paste it into ChatGPT, then add the photos before sending.');
    } catch {
      setReview(true);
      setStatus('Copy is unavailable. Select and copy the request below, or download it and attach it in ChatGPT.');
      requestAnimationFrame(() => { text.current?.focus(); text.current?.select(); });
    }
  }

  async function copyPhotos(sheet: ReplyPhotoSheet) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': sheet.blob })]);
      setStatus(`${sheet.labels} copied. Paste into the same ChatGPT message before sending.`);
    } catch { setStatus('Photo copy is unavailable in this browser. Download the photo sheet and attach it in ChatGPT.'); }
  }

  function downloadRequest() {
    if (!packet) return;
    const url = URL.createObjectURL(new Blob([packet.prompt], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `lead-${leadId}-request.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section aria-label="Reply with ChatGPT" className="space-y-3">
    <button type="button" className={button} aria-expanded={open} aria-controls={`lead-reply-${leadId}`} onClick={() => setOpen(value => !value)}><MessageSquare size={17} aria-hidden />Reply with ChatGPT</button>
    {open && <div id={`lead-reply-${leadId}`} className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
      {unsaved ? <p role="status" className="text-sm">Save your changes and log any activity note first, so ChatGPT gets the latest information.</p>
        : error ? <div role="alert" className="space-y-2"><p className="text-sm">{error}</p><button type="button" className={button} onClick={() => setAttempt(value => value + 1)}>Retry request</button></div>
        : !packet ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Gathering the complete request…</p>
        : <>
          <div><h3 className="font-semibold">Get help with your reply</h3><p className="mt-1 text-sm text-muted-foreground">Includes saved contact details, the full request, designs and activity. You review and send the customer’s reply yourself.</p></div>
          {packet.warnings.length > 0 && <div role="alert" className="text-sm text-destructive">{packet.warnings.join(' ')}</div>}
          <div className="space-y-2">
            <a className={`${button} !bg-primary !text-primary-foreground`} href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" onClick={() => void copyRequest()}><ExternalLink size={16} aria-hidden />Copy request &amp; open ChatGPT</a>
            <p className="text-sm">Paste the request into ChatGPT{packet.photos.length > 0 ? ', then add the photos below before sending.' : ' to get a suggested reply.'}</p>
            <p className="text-xs text-muted-foreground">This copies customer information to your clipboard. Photos must be pasted or attached separately in ChatGPT.</p>
          </div>
          {packet.photos.length > 0 && <div className="space-y-3">
            <h4 className="text-sm font-semibold">Add the photos ({packet.photos.length})</h4>
            {loadingPhotos && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Preparing photo sheets…</p>}
            {(photoError || missing.length > 0) && <div role="alert" className="space-y-2 text-sm"><p>{photoError || `${missing.join(', ')} could not load. The photo sheets are incomplete.`}</p><button type="button" className={button} onClick={() => setAttempt(value => value + 1)}>Retry photos</button></div>}
            {sheets.map((sheet, index) => <div key={sheet.filename} className="rounded-lg border border-border bg-background p-3">
              <p className="mb-2 text-sm font-medium">{sheet.labels}</p>
              <div className="flex flex-wrap gap-2">
                {typeof ClipboardItem !== 'undefined' && <button type="button" className={button} onClick={() => void copyPhotos(sheet)} aria-label={`Copy photo sheet ${index + 1}`}><Copy size={16} aria-hidden />Copy photos</button>}
                <a className={button} href={sheet.url} download={sheet.filename} aria-label={`Download photo sheet ${index + 1}`}><Download size={16} aria-hidden />Download photos</a>
              </div>
            </div>)}
            <p className="text-xs text-muted-foreground">Paste each photo sheet into the same ChatGPT message, or download and attach it. For small details, use the original images below.</p>
            <details><summary className="min-h-10 cursor-pointer text-sm underline">Original images</summary><div className="flex flex-wrap gap-3">{packet.photos.map(photo => <a key={photo.url} href={photo.url} download={photo.filename} className="min-h-11 py-3 text-sm underline">{photo.label}</a>)}</div></details>
          </div>}
          <p role="status" aria-live="polite" className="text-sm">{status}</p>
          <details open={review} onToggle={event => setReview(event.currentTarget.open)}>
            <summary className="min-h-10 cursor-pointer text-sm underline">Review or copy the full request</summary>
            <textarea ref={text} aria-label="ChatGPT request" readOnly value={packet.prompt} rows={10} className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => void copyRequest()}><Copy size={16} aria-hidden />Copy request</button><button type="button" className={button} onClick={downloadRequest}><Download size={16} aria-hidden />Download request</button></div>
          </details>
        </>}
    </div>}
  </section>;
}
