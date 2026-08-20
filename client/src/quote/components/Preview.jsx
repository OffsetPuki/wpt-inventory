import { useMemo } from 'react';
import { renderFence } from '../lib/preview/fence.js';
import { renderGate } from '../lib/preview/gate.js';
import { renderCarport } from '../lib/preview/carport.js';
import { renderRailing } from '../lib/preview/railing.js';
import { renderPergola } from '../lib/preview/pergola.js';
import { renderTable } from '../lib/preview/table.js';
import { summaryLine } from '../data/configurators.js';

const RENDERERS = { fence: renderFence, gate: renderGate, carport: renderCarport, railing: renderRailing, pergola: renderPergola, table: renderTable };
const ARIA = { fence: 'Fence preview', gate: 'Gate preview', carport: 'Carport preview', railing: 'Railing preview', pergola: 'Pergola preview', table: 'Table preview' };

/** Live SVG preview driven by the same config state as the price estimate. */
export default function Preview({ type, state }) {
  const html = useMemo(() => {
    const fn = RENDERERS[type];
    try { return fn ? fn(state) : ''; }
    catch (err) { console.error('preview render failed', err); return ''; }
  }, [type, state]);

  const summary = useMemo(() => summaryLine(type, state), [type, state]);

  // A Custom build has no drawing to render — an empty stage would just be a
  // hole in the page, so the line items move up into its place.
  if (!RENDERERS[type]) return null;

  return (
    <div className="preview">
      <div className="preview-top">
        <span className="eyebrow">Your design</span>
        <span className="preview-summary">{summary}</span>
      </div>
      <div className="preview-stage">
        <svg
          viewBox="0 0 800 450"
          role="img"
          aria-label={ARIA[type] || 'Preview'}
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div className="preview-caption">Live preview</div>
    </div>
  );
}
