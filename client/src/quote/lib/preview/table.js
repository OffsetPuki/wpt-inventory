/**
 * Pure SVG preview generator for a custom table base.
 *
 * Same contract as the other lib/preview renderers: takes the plain config
 * state, returns inner-SVG markup for an <svg viewBox="0 0 800 450">. Uses the
 * carport/pergola cavalier oblique projection.
 *
 * The wood top is drawn hatched and outlined rather than solid — CJM builds the
 * steel base only, and the preview should never let anyone forget that.
 *
 * state: { lengthFt, widthIn, frameHeightIn, topThicknessIn, footrest, color,
 *          qty } — see data/configurators.js.
 */

import { shade, pts } from './svg.js';
import { tableBaseFootprint } from '../../data/configurators.js';

export function renderTable(state) {
  const VB_W = 800;
  const GROUND_Y = 392;
  const OBQ_X = 0.46;
  const OBQ_Y = 0.34;

  const topLenFt = Number(state.lengthFt) || 8;
  const topWidthIn = Number(state.widthIn) || 21;
  const frameHeightIn = Number(state.frameHeightIn) || 40;
  const topThickIn = Number(state.topThicknessIn) || 1.5;
  const hasFootrest = state.footrest !== 'no';
  const frame = state.color || '#0A0A0A';
  const frameDark = shade(frame, -0.25);
  const wood = '#B89472';

  const base = tableBaseFootprint({ lengthFt: topLenFt, widthIn: topWidthIn });
  const baseLenFt = base.lengthFt;
  const baseDepthFt = base.widthIn / 12;
  const frameHeightFt = frameHeightIn / 12;
  const topThickFt = topThickIn / 12;

  const parts = [];
  const dim = 'rgba(10,10,10,0.4)';
  const dimText = 'rgba(10,10,10,0.55)';

  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  // ---- fit ----
  const horizFtEq = baseLenFt + baseDepthFt * OBQ_X;
  const vertFtEq = frameHeightFt + topThickFt + baseDepthFt * OBQ_Y + 0.8;
  const pxPerFt = Math.min((VB_W - 150) / horizFtEq, (GROUND_Y - 46) / vertFtEq);
  const lenPx = baseLenFt * pxPerFt;
  const frameH = frameHeightFt * pxPerFt;
  const dvx = baseDepthFt * pxPerFt * OBQ_X;
  const dvy = baseDepthFt * pxPerFt * OBQ_Y;
  const x0 = (VB_W - (lenPx + dvx)) / 2;
  const xR = x0 + lenPx;
  const railY = GROUND_Y - frameH;          // top of the steel base
  const legW = Math.max(4, pxPerFt * (3 / 12));   // 2×3 tube, 3 in face forward
  const railH = Math.max(4, pxPerFt * (3 / 12));  // 2×3 rails, 3 in tall
  const plateH = Math.max(2, pxPerFt * (0.5 / 12));

  // Rails stop behind the legs (matches the estimator's baseLen − 0.5 ft)
  const inset = Math.min(legW, pxPerFt * 0.25);

  // ---- back frame (faint — reads as behind) ----
  for (const px of [x0, xR]) {
    parts.push(`<rect x="${(px + dvx - legW / 2).toFixed(1)}" y="${(railY - dvy).toFixed(1)}" width="${legW.toFixed(1)}" height="${frameH.toFixed(1)}" fill="${frame}" opacity="0.42" />`);
  }
  parts.push(`<rect x="${(x0 + dvx).toFixed(1)}" y="${(railY - dvy).toFixed(1)}" width="${lenPx.toFixed(1)}" height="${railH.toFixed(1)}" fill="${frame}" opacity="0.42" />`);
  // Back lower rail
  const lowerY = railY + frameH * 0.62;
  parts.push(`<rect x="${(x0 + dvx).toFixed(1)}" y="${(lowerY - dvy).toFixed(1)}" width="${lenPx.toFixed(1)}" height="${(railH * 0.85).toFixed(1)}" fill="${frame}" opacity="0.42" />`);

  // ---- side rails running front→back at each end ----
  for (const px of [x0, xR]) {
    parts.push(`<polygon points="${pts([
      [px, railY], [px + dvx, railY - dvy],
      [px + dvx, railY - dvy + railH], [px, railY + railH],
    ])}" fill="${frameDark}" />`);
  }

  // ---- cross members between the side frames, one every ~16 in ----
  const crossCount = Math.max(3, Math.round((baseLenFt * 12) / 16) + 1);
  const crossT = Math.max(2, pxPerFt * (2 / 12));
  for (let i = 0; i <= crossCount; i++) {
    const px = x0 + (lenPx * i) / crossCount;
    parts.push(`<polygon points="${pts([
      [px - crossT / 2, railY + railH], [px + crossT / 2, railY + railH],
      [px + crossT / 2 + dvx, railY + railH - dvy], [px - crossT / 2 + dvx, railY + railH - dvy],
    ])}" fill="${frameDark}" opacity="0.75" />`);
  }

  // ---- foot plates under each end frame ----
  for (const px of [x0, xR]) {
    parts.push(`<polygon points="${pts([
      [px - legW, GROUND_Y - plateH], [px + legW, GROUND_Y - plateH],
      [px + legW + dvx, GROUND_Y - plateH - dvy], [px - legW + dvx, GROUND_Y - plateH - dvy],
    ])}" fill="${frameDark}" />`);
    parts.push(`<rect x="${(px - legW).toFixed(1)}" y="${(GROUND_Y - plateH).toFixed(1)}" width="${(legW * 2).toFixed(1)}" height="${plateH.toFixed(1)}" fill="${frame}" />`);
  }

  // ---- front frame (solid, closest to viewer) ----
  for (const px of [x0, xR]) {
    parts.push(`<rect x="${(px - legW / 2).toFixed(1)}" y="${railY.toFixed(1)}" width="${legW.toFixed(1)}" height="${frameH.toFixed(1)}" fill="${frame}" />`);
  }
  parts.push(`<rect x="${(x0 + inset).toFixed(1)}" y="${railY.toFixed(1)}" width="${(lenPx - inset * 2).toFixed(1)}" height="${railH.toFixed(1)}" fill="${frame}" />`);
  parts.push(`<rect x="${(x0 + inset).toFixed(1)}" y="${lowerY.toFixed(1)}" width="${(lenPx - inset * 2).toFixed(1)}" height="${(railH * 0.85).toFixed(1)}" fill="${frame}" />`);

  // ---- foot rest ----
  if (hasFootrest) {
    const frY = GROUND_Y - frameH * 0.28;
    const frT = Math.max(3, pxPerFt * (2 / 12));
    parts.push(`<rect x="${(x0 + inset).toFixed(1)}" y="${frY.toFixed(1)}" width="${(lenPx - inset * 2).toFixed(1)}" height="${frT.toFixed(1)}" fill="${frame}" />`);
    parts.push(`<rect x="${(x0 + inset).toFixed(1)}" y="${frY.toFixed(1)}" width="${(lenPx - inset * 2).toFixed(1)}" height="${(frT * 0.32).toFixed(1)}" fill="${shade(frame, 0.28)}" />`);
  }

  // ---- the customer's wood top: hatched + outlined, NOT part of the quote ----
  const topThickPx = Math.max(3, topThickFt * pxPerFt);
  // The top sits inset from the base's ends by the overhang (1.5 in per side)
  const topInsetPx = Math.max(0, ((baseLenFt - topLenFt) / 2) * pxPerFt);
  const tL = x0 + topInsetPx;
  const tR = xR - topInsetPx;
  const topY = railY - topThickPx;
  parts.push(
    '<pattern id="cjm-tbl-wood" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">'
    + `<rect width="7" height="7" fill="${wood}" fill-opacity="0.13" />`
    + `<line x1="0" y1="0" x2="0" y2="7" stroke="${wood}" stroke-width="1.6" stroke-opacity="0.55" /></pattern>`,
  );
  // top face (going back), then the front edge
  parts.push(`<polygon points="${pts([
    [tL, topY], [tR, topY], [tR + dvx, topY - dvy], [tL + dvx, topY - dvy],
  ])}" fill="url(#cjm-tbl-wood)" stroke="${wood}" stroke-width="1" stroke-dasharray="5 3" />`);
  parts.push(`<rect x="${tL.toFixed(1)}" y="${topY.toFixed(1)}" width="${(tR - tL).toFixed(1)}" height="${topThickPx.toFixed(1)}" fill="url(#cjm-tbl-wood)" stroke="${wood}" stroke-width="1" stroke-dasharray="5 3" />`);
  parts.push(`<text x="${((tL + tR) / 2 + dvx / 2).toFixed(1)}" y="${(topY - dvy - 8).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1.5" fill="${dimText}">TOP BY CUSTOMER — NOT INCLUDED</text>`);

  // ---- dimensions ----
  const wY = GROUND_Y + 14;
  parts.push(`<line x1="${tL.toFixed(1)}" y1="${wY}" x2="${tR.toFixed(1)}" y2="${wY}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${tL.toFixed(1)}" y1="${wY - 3}" x2="${tL.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${tR.toFixed(1)}" y1="${wY - 3}" x2="${tR.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${((tL + tR) / 2).toFixed(1)}" y="${wY + 13}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}">${topLenFt} FT TOP</text>`);
  parts.push(`<line x1="${(xR + 10).toFixed(1)}" y1="${(GROUND_Y + 6).toFixed(1)}" x2="${(xR + dvx + 10).toFixed(1)}" y2="${(GROUND_Y - dvy + 6).toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${(xR + dvx / 2 + 30).toFixed(1)}" y="${(GROUND_Y - dvy / 2 + 4).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1" fill="${dimText}">${topWidthIn} IN</text>`);
  const hX = x0 - 24;
  const hMidY = (railY + GROUND_Y) / 2;
  parts.push(`<line x1="${hX.toFixed(1)}" y1="${railY.toFixed(1)}" x2="${hX.toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${(hX - 3).toFixed(1)}" y1="${railY.toFixed(1)}" x2="${(hX + 3).toFixed(1)}" y2="${railY.toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${(hX - 3).toFixed(1)}" y1="${GROUND_Y}" x2="${(hX + 3).toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${(hX - 7).toFixed(1)}" y="${hMidY.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}" transform="rotate(-90 ${(hX - 7).toFixed(1)} ${hMidY.toFixed(1)})">${frameHeightIn} IN FRAME</text>`);

  return parts.join('');
}
