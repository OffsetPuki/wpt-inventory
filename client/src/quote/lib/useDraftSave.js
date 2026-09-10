import { useEffect, useRef, useState } from 'react';
import { apiRequest, getAuthToken } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';
import { captureDraftStorage } from './store.js';
import { createDraftSaver } from './draftSaver.js';

export default function useDraftSave(session, setSession, book, totals) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState(null);
  const [localSaved, setLocalSaved] = useState(true);
  const latest = useRef();
  latest.current = { session, book, totalCents: Math.round((totals?.total || 0) * 100) };
  const storage = useRef(captureDraftStorage());
  const auth = useRef(getAuthToken());
  const active = useRef(true);
  const acknowledged = useRef(null);
  const saver = useRef(null);
  if (!saver.current) saver.current = createDraftSaver({
    getCurrent: () => latest.current,
    online: () => navigator.onLine,
    onStatus: (value, cause) => { if (active.current) { setStatus(value); setError(cause || null); } },
    write: async (sess, totalCents) => {
      if (auth.current !== getAuthToken()) throw new Error('Sign in again to save this draft.');
      const body = { type: sess.type, customerName: sess.customer?.name || null,
        designRef: sess.designRef || null, leadId: sess.leadId || null,
        version: sess.version ?? 1, totalCents, payload: sess };
      return (await apiRequest(sess.quoteId ? 'PATCH' : 'POST', sess.quoteId ? `/api/quotes/${sess.quoteId}` : '/api/quotes', body,
        { signal: AbortSignal.timeout(20000) })).json();
    },
    acknowledge: (row, sent, source) => {
      if (latest.current.session?.sid !== sent.sid || auth.current !== getAuthToken()) return;
      const sameBook = latest.current.book === source.book && latest.current.session.priceBookSnapshot === source.session.priceBookSnapshot;
      const updated = { ...latest.current.session, quoteId: row.id, number: row.number,
        version: row.version, quoteStatus: row.status,
        // Freeze the book used by this request; preserve an intentional unlock
        // or subsequent book edit rather than replacing a newer selection.
        priceBookSnapshot: sameBook ? sent.priceBookSnapshot : latest.current.session.priceBookSnapshot,
        priceBookSnapshotAt: sameBook ? sent.priceBookSnapshotAt : latest.current.session.priceBookSnapshotAt };
      latest.current = { ...latest.current, session: updated };
      acknowledged.current = updated;
      storage.current.save(updated);
      if (active.current) setSession(updated);
      qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
  useEffect(() => {
    if (!session) return;
    if (session !== acknowledged.current) saver.current.schedule();
    const timer = setTimeout(() => setLocalSaved(storage.current.save(latest.current.session)), 350);
    return () => clearTimeout(timer);
  }, [session, book, totals]);
  useEffect(() => {
    active.current = true;
    const local = () => { if (latest.current.session) storage.current.save(latest.current.session); };
    const hidden = () => { if (document.visibilityState === 'hidden') local(); };
    const online = () => saver.current.retry().catch(() => {});
    const offline = () => setStatus('Offline');
    window.addEventListener('pagehide', local);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      active.current = false;
      local();
      window.removeEventListener('pagehide', local);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      // SPA navigation flushes the last edit; pagehide stores the recovery copy.
      saver.current.flush().catch(() => {});
    };
  }, []);
  return { status, error, localSaved,
    flush: async () => { await saver.current.flush(); return { id: latest.current.session?.quoteId, version: latest.current.session?.version }; }, retry: () => saver.current.retry(),
    reset: () => saver.current.reset(),
    markSaved: (current) => saver.current.markSaved(current),
    clear: () => { latest.current = { ...latest.current, session: null }; storage.current.clear(); saver.current.reset(); },
  };
}
