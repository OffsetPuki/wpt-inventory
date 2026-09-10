// Serialized saves with a trailing save for edits made during a request.
// Kept independent of React so delayed responses and recovery can be tested.
export function draftSignature({ session, book, totalCents }) {
  const { sid, quoteId, number, version, quoteStatus, priceBookSnapshot,
    priceBookSnapshotAt, ...content } = session;
  return JSON.stringify([content, book, totalCents]);
}

export function createDraftSaver({ getCurrent, write, acknowledge, onStatus, online = () => true, delay = 900 }) {
  let timer, pending, stopped = false, failure = null;
  const saved = new Map();
  const editable = (s) => s && (!s.quoteStatus || s.quoteStatus === 'draft');
  const run = async () => {
    while (!stopped) {
      const current = getCurrent();
      if (!editable(current?.session)) return current?.session?.quoteId;
      if (!online()) throw Object.assign(new Error('Offline — changes are saved on this device.'), { offline: true });
      const key = draftSignature(current);
      const previous = saved.get(current.session.sid);
      if (previous?.key === key) { onStatus('Saved'); return previous.row.id; }
      const sess = {
        ...current.session,
        ...(previous ? { quoteId: previous.row.id, version: previous.row.version } : {}),
        priceBookSnapshot: current.session.priceBookSnapshot || current.book,
        priceBookSnapshotAt: current.session.priceBookSnapshotAt || new Date().toISOString(),
      };
      onStatus('Saving');
      const row = await write(sess, current.totalCents);
      // A retried first POST can return the original creation receipt. Compare
      // its actual content before acknowledging the edits as saved.
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const acknowledgedKey = draftSignature({ session: payload, book: payload.priceBookSnapshot || current.book, totalCents: row.totalCents });
      saved.set(sess.sid, { key: acknowledgedKey, row });
      acknowledge(row, sess, current);
      // getCurrent reads the latest edit, never the stale request's closure.
    }
  };
  const flush = () => {
    clearTimeout(timer);
    if (pending) return pending;
    if (failure?.status === 409 || failure?.status === 404) return Promise.reject(failure);
    failure = null;
    pending = run().catch(error => {
      failure = error;
      onStatus(error.offline || !online() ? 'Offline' : error.status === 409 ? 'Conflict' : 'Not saved', error);
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  };
  return {
    schedule() {
      clearTimeout(timer);
      if (stopped || !editable(getCurrent()?.session) || failure) return;
      onStatus(online() ? 'Saving' : 'Offline');
      timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    },
    flush,
    retry() { if (failure?.status !== 409 && failure?.status !== 404) failure = null; return flush(); },
    markSaved(current) {
      failure = null;
      saved.set(current.session.sid, { key: draftSignature(current), row: { id: current.session.quoteId, version: current.session.version } });
      onStatus('Saved');
    },
    reset() { failure = null; clearTimeout(timer); },
    dispose() { stopped = true; clearTimeout(timer); },
  };
}
