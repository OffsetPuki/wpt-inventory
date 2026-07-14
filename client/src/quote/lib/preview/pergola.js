/**
 * Pure SVG preview generator for a custom pergola.
 *
 * Same contract as the other lib/preview renderers: takes the plain config
 * state, returns inner-SVG markup for an <svg viewBox="0 0 800 450">. Uses the
 * carport's cavalier oblique projection.
 *
 * state: { width, depth, height, shade, color } — see data/configurators.js.
 */

import { shade, pts } from './svg.js';

export function renderPergola(state) {
  const VB_W = 800;
  const GROUND_Y = 392;
  const OBQ_X = 0.46;
  const OBQ_Y = 0.34;

  const width = parseInt(state.width, 10) || 12;
  const depth = parseInt(state.depth, 10) || 12;
  const height = parseInt(state.height, 10) || 8;
  const shaded = state.shade === 'panels';
  const frame = state.color || '#0A0A0A';
  const frameDark = shade(frame, -0.25);

  const parts = [];
  const dim = 'rgba(10,10,10,0.4)';
  const dimText = 'rgba(10,10,10,0.55)';

  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  // ---- fit ----
  const horizFtEq = width + depth * OBQ_X;
  const vertFtEq = height + depth * OBQ_Y + 1.5;
  const pxPerFt = Math.min((VB_W - 120) / horizFtEq, (GROUND_Y - 34) / vertFtEq);
  const widthPx = width * pxPerFt;
  const heightPx = height * pxPerFt;
  const dvx = depth * pxPerFt * OBQ_X;
  const dvy = depth * pxPerFt * OBQ_Y;
  const x0 = (VB_W - (widthPx + dvx)) / 2;
  const xR = x0 + widthPx;
  const eaveY = GROUND_Y - heightPx;
  const postW = Math.max(5, pxPerFt * 0.4);
  const beamH = Math.max(5, pxPerFt * 0.45);
  const raftT = Math.max(3, pxPerFt * 0.3);
  const lift = beamH; // rafters sit on top of the header beams

  // Back posts + back header (faint — they read as behind)
  for (const px of [x0, xR]) {
    parts.push(`<rect x="${(px + dvx - postW / 2).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - dvy - (eaveY - dvy)).toFixed(1)}" fill="${frame}" opacity="0.42" />`);
  }
  parts.push(`<rect x="${(x0 + dvx).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${widthPx.toFixed(1)}" height="${beamH.toFixed(1)}" fill="${frame}" opacity="0.42" />`);

  // Side rails (front-left→back-left, front-right→back-right)
  for (const px of [x0, xR]) {
    parts.push(`<polygon points="${pts([
      [px, eaveY], [px + dvx, eaveY - dvy],
      [px + dvx, eaveY - dvy + beamH], [px, eaveY + beamH],
    ])}" fill="${frameDark}" />`);
  }

  // Mid-span posts once a side passes 16 ft (matches the estimator's count)
  if (Math.max(width, depth) > 16) {
    const midOff = depth > width
      ? { x: dvx / 2, y: dvy / 2, xs: [x0, xR] } // long depth → mid posts on the side rails
      : { x: 0, y: 0, xs: [x0 + widthPx / 2] };  // long width → mid post pair front + back
    for (const bx of midOff.xs) {
      parts.push(`<rect x="${(bx + midOff.x - postW / 2).toFixed(1)}" y="${(eaveY - midOff.y).toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - midOff.y - (eaveY - midOff.y)).toFixed(1)}" fill="${frame}" opacity="0.7" />`);
      if (midOff.xs.length === 1) {
        parts.push(`<rect x="${(bx + dvx - postW / 2).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${postW.toFixed(1)}" height="${heightPx.toFixed(1)}" fill="${frame}" opacity="0.42" />`);
      }
    }
  }

  // Shade panels — translucent plane over the rafter deck
  if (shaded) {
    parts.push(`<polygon points="${pts([
      [x0, eaveY - lift], [xR, eaveY - lift],
      [xR + dvx, eaveY - lift - dvy], [x0 + dvx, eaveY - lift - dvy],
    ])}" fill="${frame}" opacity="0.14" stroke="${frame}" stroke-width="0.8" stroke-opacity="0.4" />`);
  }

  // Rafter deck — evenly spaced, spanning front→back (one every ~16")
  const raftCount = Math.max(5, Math.round(width / 1.33));
  for (let i = 0; i <= raftCount; i++) {
    const px = x0 + (widthPx * i) / raftCount;
    parts.push(`<polygon points="${pts([
      [px - raftT / 2, eaveY - lift], [px + raftT / 2, eaveY - lift],
      [px + raftT / 2 + dvx, eaveY - lift - dvy], [px - raftT / 2 + dvx, eaveY - lift - dvy],
    ])}" fill="${frameDark}" opacity="0.85" />`);
  }
  // Two purlins running across the rafters
  for (const f of [1 / 3, 2 / 3]) {
    parts.push(`<line x1="${(x0 + dvx * f).toFixed(1)}" y1="${(eaveY - lift - dvy * f - raftT * 0.6).toFixed(1)}" x2="${(xR + dvx * f).toFixed(1)}" y2="${(eaveY - lift - dvy * f - raftT * 0.6).toFixed(1)}" stroke="${frame}" stroke-width="${Math.max(2, raftT * 0.7).toFixed(1)}" />`);
  }

  // Front posts + front header beam (solid, closest to viewer)
  for (const px of [x0, xR]) {
    parts.push(`<rect x="${(px - postW / 2).toFixed(1)}" y="${eaveY.toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - eaveY).toFixed(1)}" fill="${frame}" />`);
  }
  parts.push(`<rect x="${x0.toFixed(1)}" y="${eaveY.toFixed(1)}" width="${widthPx.toFixed(1)}" height="${beamH.toFixed(1)}" fill="${frame}" />`);
  // Corner knee braces on the front frame
  const braceLen = Math.min(widthPx * 0.18, heightPx * 0.3, 40);
  const braceW = Math.max(2, postW * 0.45);
  parts.push(`<line x1="${x0.toFixed(1)}" y1="${(eaveY + beamH + braceLen).toFixed(1)}" x2="${(x0 + braceLen).toFixed(1)}" y2="${(eaveY + beamH).toFixed(1)}" stroke="${frame}" stroke-width="${braceW.toFixed(1)}" stroke-linecap="round" />`);
  parts.push(`<line x1="${xR.toFixed(1)}" y1="${(eaveY + beamH + braceLen).toFixed(1)}" x2="${(xR - braceLen).toFixed(1)}" y2="${(eaveY + beamH).toFixed(1)}" stroke="${frame}" stroke-width="${braceW.toFixed(1)}" stroke-linecap="round" />`);

  // ---- dimensions ----
  const wY = GROUND_Y + 14;
  parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY}" x2="${xR.toFixed(1)}" y2="${wY}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY - 3}" x2="${x0.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${xR.toFixed(1)}" y1="${wY - 3}" x2="${xR.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${((x0 + xR) / 2).toFixed(1)}" y="${wY + 13}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}">${width} FT</text>`);
  parts.push(`<line x1="${(xR + 10).toFixed(1)}" y1="${(GROUND_Y + 6).toFixed(1)}" x2="${(xR + dvx + 10).toFixed(1)}" y2="${(GROUND_Y - dvy + 6).toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${(xR + dvx / 2 + 26).toFixed(1)}" y="${(GROUND_Y - dvy / 2 + 4).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1" fill="${dimText}">${depth} FT</text>`);
  const hX = x0 - 22;
  const hMidY = (eaveY + GROUND_Y) / 2;
  parts.push(`<line x1="${hX.toFixed(1)}" y1="${eaveY.toFixed(1)}" x2="${hX.toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${(hX - 6).toFixed(1)}" y="${hMidY.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}" transform="rotate(-90 ${(hX - 6).toFixed(1)} ${hMidY.toFixed(1)})">${height} FT</text>`);

  return parts.join('');
}
