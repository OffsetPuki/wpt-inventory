/**
 * Pure SVG preview generator for industrial insulation — the engineering
 * cutaway ported from the insulation site's section.mjs (CJM-Insulation/src/
 * lib/section.mjs): pipe section with radial hatch, vertical tank, horizontal
 * autoclave, dashed removable blanket covers.
 *
 * Same contract as the other lib/preview renderers: takes the plain config
 * state, returns inner-SVG markup for an <svg viewBox="0 0 800 450">. The
 * original draws in a 400×240 frame with inherited stroke; here the whole
 * drawing rides in one scaled group with explicit strokes.
 *
 * The site's version also labels the jacket surface temperature — that needs
 * its heat-loss model, which prices nothing, so this port leaves it out.
 *
 * state: { system, tempF, nps, lengthFt, diaFt, heightFt, count, thickness } —
 * see data/configurators.js.
 */

import { PIPE_OD } from '../tradeMath.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);
const line = (x1, y1, x2, y2, extra = '') =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${extra}/>`;
const text = (x, y, s, extra = '') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.6)" stroke="none" ${extra}>${esc(s)}</text>`;

/** Radial hatch between two radii — the insulation layer in section. */
function ringHatch(cx, cy, r1, r2, n = 28) {
  let s = '<g stroke-opacity="0.3" stroke-width="1">';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s += line(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
  }
  return s + '</g>';
}

function pipeSection(state) {
  const od = PIPE_OD[state.nps] ?? PIPE_OD['4'];
  const t = state.system === 'blanket' ? 1.5 : Number(state.thickness) || 2;
  const rOutIn = od / 2 + t;
  const scale = 84 / rOutIn;
  const rOut = 84;
  const rPipe = Math.max(10, (od / 2) * scale);
  const cx = 168, cy = 120;
  const removable = state.system === 'blanket';

  let s = '';
  s += ringHatch(cx, cy, rPipe, rOut);
  // Jacket (or sewn cover — dashed, with its D-ring straps)
  s += `<circle cx="${cx}" cy="${cy}" r="${rOut}" stroke-width="1.8"${removable ? ' stroke-dasharray="7 5"' : ''}/>`;
  if (removable) {
    s += '<g stroke-opacity="0.7">'
      + `<rect x="${cx + rOut - 3}" y="${cy - 26}" width="10" height="7"/>`
      + `<rect x="${cx + rOut - 3}" y="${cy + 19}" width="10" height="7"/>`
      + '</g>';
  }
  // Pipe wall and bore
  s += `<circle cx="${cx}" cy="${cy}" r="${rPipe.toFixed(1)}" stroke-width="1.6"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${Math.max(4, rPipe - 5).toFixed(1)}" stroke-opacity="0.35"/>`;

  // Thickness dimension on the +x axis
  const dimY = cy - 4;
  s += '<g stroke-opacity="0.55">'
    + line(cx + rPipe, dimY - 6, cx + rPipe, dimY + 6)
    + line(cx + rOut, dimY - 6, cx + rOut, dimY + 6)
    + line(cx + rPipe, dimY, cx + rOut, dimY)
    + '</g>';
  s += text(cx + (rPipe + rOut) / 2, dimY - 12, `${t}"`, 'text-anchor="middle"');

  // Line temperature inside the bore
  s += text(cx, cy + 4, `${state.tempF}°F`, 'text-anchor="middle"');

  // Caption: what this section belongs to
  const cap = removable ? `${state.count} × ${state.nps}"` : `${state.nps}" × ${state.lengthFt} ft`;
  s += text(330, 30, cap, 'text-anchor="middle"');
  return s;
}

function vesselSection(state) {
  const vertical = state.system === 'tank';
  const shellFt = Number(state.heightFt) || 12;
  let s = '';
  if (vertical) {
    // Vertical tank: shell, top head, insulation outline offset outward
    const x1 = 150, x2 = 250, yTop = 58, yBot = 196, off = 12;
    s += '<g stroke-opacity="0.3" stroke-width="1">';
    for (let y = yTop + 8; y < yBot; y += 12) s += line(x1 - off, y, x1, y) + line(x2, y, x2 + off, y);
    s += '</g>';
    s += `<path d="M${x1} ${yBot} V${yTop} A50 18 0 0 1 ${x2} ${yTop} V${yBot}" stroke-width="1.6"/>`;
    s += `<path d="M${x1 - off} ${yBot} V${yTop - 4} A${50 + off} ${18 + off} 0 0 1 ${x2 + off} ${yTop - 4} V${yBot}" stroke-width="1.8"/>`;
    s += line(x1 - off - 14, yBot, x2 + off + 14, yBot, 'stroke-opacity="0.4"');
    // Banding
    s += `<g stroke-opacity="0.5">${line(x1 - off, 100, x2 + off, 100)}${line(x1 - off, 150, x2 + off, 150)}</g>`;
    s += text(200, 128, `${state.tempF}°F`, 'text-anchor="middle"');
    s += text(200, 40, `${state.diaFt} ft ⌀`, 'text-anchor="middle"');
    s += text(316, 128, `${shellFt} ft`);
  } else {
    // Horizontal autoclave: capsule with both heads, dashed removable door cover
    const y1 = 82, y2 = 158, x1 = 96, x2 = 296, off = 11, ry = (y2 - y1) / 2, cy = (y1 + y2) / 2;
    s += '<g stroke-opacity="0.3" stroke-width="1">';
    for (let x = x1 + 6; x < x2; x += 12) s += line(x, y1 - off, x, y1) + line(x, y2, x, y2 + off);
    s += '</g>';
    s += `<path d="M${x1} ${y1} H${x2} A26 ${ry} 0 0 1 ${x2} ${y2} H${x1} A26 ${ry} 0 0 1 ${x1} ${y1}" stroke-width="1.6"/>`;
    s += `<path d="M${x1} ${y1 - off} H${x2} A${26 + off} ${ry + off} 0 0 1 ${x2} ${y2 + off} H${x1}" stroke-width="1.8"/>`;
    // Door head: removable cover, sewn — dashed
    s += `<path d="M${x1} ${y1 - off} A${26 + off} ${ry + off} 0 0 0 ${x1} ${y2 + off}" stroke-width="1.8" stroke-dasharray="6 4"/>`;
    // Saddles
    s += `<g stroke-opacity="0.5">${line(x1 + 34, y2 + off, x1 + 34, 196)}${line(x2 - 34, y2 + off, x2 - 34, 196)}</g>`;
    s += line(60, 196, 340, 196, 'stroke-opacity="0.4"');
    s += text(196, cy + 4, `${state.tempF}°F`, 'text-anchor="middle"');
    s += text(196, 46, `${state.diaFt} ft ⌀ × ${shellFt} ft`, 'text-anchor="middle"');
  }
  return s;
}

export function renderInsulation(state) {
  const inner = state.system === 'tank' || state.system === 'autoclave'
    ? vesselSection(state)
    : pipeSection(state);
  // The site draws in a 400×240 frame with inherited currentColor strokes —
  // scale it into the suite's 800×450 stage with explicit ink.
  return '<g transform="translate(25 15) scale(1.875)" fill="none" stroke="#0A0A0A" stroke-linecap="round">'
    + inner
    + '</g>';
}
