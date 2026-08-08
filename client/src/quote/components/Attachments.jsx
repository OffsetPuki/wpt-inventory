// =============================================================================
//  Quote attachments — the proof that rides along with the price.
//
//  Load-simulation renders out of Fusion 360, shop drawings, reference photos:
//  anything that shows the customer WHY the piece is built the way it is. The
//  bar-table case is the motivating one — a screenshot of the stress study says
//  "this top will carry what you're going to put on it" far better than a
//  sentence in the notes.
//
//  Files go through the suite's existing POST /api/upload (auth'd, images only,
//  10 MB, unguessable filenames) and the quote payload stores just the /uploads
//  URL + caption. No base64 in the database.
// =============================================================================

import { useRef, useState } from 'react';
import { getAuthToken } from '@/lib/queryClient';

const MAX_FILES = 6;

export default function Attachments({ items, onChange }) {
  const list = Array.isArray(items) ? items : [];
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function uploadOne(file) {
    const fd = new FormData();
    fd.append('photo', file);
    const token = getAuthToken();
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { 'X-Auth': token } : {},
      body: fd,
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      throw new Error(msg.message || `Upload failed (HTTP ${res.status})`);
    }
    return (await res.json()).url;
  }

  async function onPick(e) {
    const files = [...(e.target.files || [])];
    if (inputRef.current) inputRef.current.value = ''; // let the same file re-pick
    if (!files.length) return;
    const room = MAX_FILES - list.length;
    if (room <= 0) { setError(`Up to ${MAX_FILES} images per quote.`); return; }

    setBusy(true);
    setError('');
    const added = [];
    try {
      for (const file of files.slice(0, room)) {
        added.push({ url: await uploadOne(file), caption: '' });
      }
      if (files.length > room) setError(`Only the first ${room} were added — ${MAX_FILES} max.`);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
      // Keep whatever DID upload, even if a later file in the batch failed.
      if (added.length) onChange([...list, ...added]);
    }
  }

  const setCaption = (i, caption) =>
    onChange(list.map((a, n) => (n === i ? { ...a, caption } : a)));
  const remove = (i) => onChange(list.filter((_, n) => n !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="attach">
      <div className="attach-head">
        <span>Simulation &amp; drawings</span>
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy || list.length >= MAX_FILES}
          onClick={() => inputRef.current && inputRef.current.click()}
        >
          {busy ? 'Uploading…' : '+ Add image'}
        </button>
      </div>
      <p className="attach-hint">
        Stress studies, load simulations, shop drawings — they print on the quote and
        show on the customer's online copy, so they can see the engineering behind it.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPick}
      />
      {error && <p className="attach-error">{error}</p>}

      {list.length > 0 && (
        <ul className="attach-list">
          {list.map((a, i) => (
            <li key={a.url + i} className="attach-item">
              <img src={a.url} alt={a.caption || 'Quote attachment'} />
              <div className="attach-fields">
                <input
                  type="text"
                  placeholder="Caption — e.g. Load simulation: 300 lb on the top, 0.4 mm deflection"
                  value={a.caption || ''}
                  onChange={(e) => setCaption(i, e.target.value)}
                />
                <div className="attach-actions">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} title="Move down">↓</button>
                  <button type="button" className="danger" onClick={() => remove(i)}>Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
